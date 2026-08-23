// [SPEC-5] Channel rack — the logical model between intents and the audio
// engine. A channel aggregates categories, a volume, a filter and a set of slots
// (buttons) each bound to a track ([SPEC-5.1]). Nothing is hard-coded: categories
// and slot→track bindings live here and are editable at runtime ([SPEC-5.3/5.5]).
//
// The rack is the single source of truth for channel state; it emits a snapshot
// on every change so the store can mirror it (GUI) and refresh LEDs ([SPEC-6.4]).
//
// [SPEC-20] It holds SEVERAL pad sets, one of which is current: the 64 pads
// address that one, and every method below without an explicit set works on it.
// A set is a complete rack preset [SPEC-20.2]; loops armed in a set keep playing
// when it is left [SPEC-20.4], which is why voices carry their set's id.

import { engine } from '@core/engine/StrudelEngine';
import { library } from '@core/library/Library';
import { DEFAULT_CHANNEL_GAIN, NEUTRAL_FILTER } from '@core/engine/StrudelEngine';
import { transposeSemitones } from '@core/music/camelot';
import {
  DEFAULT_SLOTS_PER_CHANNEL,
  coerceChannelLaunch,
  stepChannelLaunch as nextLaunch,
  defaultEffects,
  neutralFx,
  stepFx,
  coerceEffects,
  coerceFxFocus,
  isMissingTrack,
  type ChannelState,
  type ChannelLaunch,
  type SlotState,
  type FxKind,
} from './types';
import {
  MAX_SETS,
  DEFAULT_SET_COLOR,
  assignedCount,
  defaultSetName,
  isEmptySet,
  newSetId,
  nextFreeColor,
  playingCount,
  setColorHex,
  slotRef,
  type PadSet,
  type SetColor,
  type SetSummary,
} from './sets';

export const DEFAULT_CHANNEL_COUNT = 8;

/** Listener of rack changes: the current set's channels, plus the view of every
 *  set (names, colors, counts) the GUI and the LEDs need. [SPEC-20.5/20.6] */
type RackListener = (channels: ChannelState[], sets: SetSummary[]) => void;

function emptySlot(): SlotState {
  return {
    trackId: null,
    trackName: null,
    trackBeats: null,
    playing: false,
    pending: false,
    codeOverride: null,
  };
}

function createChannels(count: number, slotsPerChannel: number): ChannelState[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    categories: [],
    volume: DEFAULT_CHANNEL_GAIN,
    filter: 0.5,
    launch: 'immediate' as ChannelLaunch, // [SPEC-17.17/17.60]
    effects: defaultEffects(), // per-channel LPF / delay / reverb [SPEC-17.23]
    fxFocus: 'lpf' as FxKind,
    slots: Array.from({ length: slotsPerChannel }, emptySlot),
  }));
}

type ErrorListener = (message: string) => void;
/** A voice must be ramped, in or out, over one window. The rack knows the mode,
 *  the store knows the window and the tempo — hence a callback rather than a clock
 *  inside `core/channels`. [SPEC-17.60/17.60.2] */
export interface FadeRequest {
  set: string;
  channel: number;
  slot: number;
  /** `in` = just armed, ramp up to 1. `out` = stopping, ramp down to 0 and then
   *  call `finishFadeOut`. */
  kind: 'in' | 'out';
}
type FadeListener = (request: FadeRequest) => void;

/** An armed slot, wherever it lives — the stage output reads this. [SPEC-20.13] */
export interface ArmedSlot {
  /** Id of the set holding it (stable across reordering). [SPEC-20.9] */
  set: string;
  setName: string;
  channel: number;
  /** First category of its channel, the label used by the cue stream. */
  category: string | null;
  slot: number;
  trackId: string;
}

export const MIN_SLOTS_PER_CHANNEL = 1;
export const MAX_SLOTS_PER_CHANNEL = 8; // Akai APC mini mk2 column height

export class ChannelRack {
  /** Every pad set, in display order. Never empty. [SPEC-20.8] */
  private readonly sets: PadSet[];
  /** Position of the set the pads currently address. [SPEC-20.3] */
  private activeIndex = 0;
  private readonly listeners = new Set<RackListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly fadeListeners = new Set<FadeListener>();
  /** Voices fading OUT: they still sound and are dropped when the ramp ends. A
   *  second press cancels the fade-out instead of stopping abruptly. [SPEC-17.60.2] */
  private readonly fadingOut = new Set<string>();

  constructor(
    count: number = DEFAULT_CHANNEL_COUNT,
    slotsPerChannel: number = DEFAULT_SLOTS_PER_CHANNEL,
  ) {
    this.sets = [
      {
        id: 'set-1',
        name: 'Set 1',
        color: DEFAULT_SET_COLOR,
        channels: createChannels(count, slotsPerChannel),
      },
    ];
    // Seed engine gains/filters/effects so volume, tone & fx are correct from the
    // first sound.
    this.pushChannelParams();
  }

  /** Channels of the current set: the target of every method without a set. */
  private get channels(): ChannelState[] {
    return this.sets[this.activeIndex].channels;
  }

  get count(): number {
    return this.channels.length;
  }

  /** Slots per channel — derived from the model (uniform across channels). */
  get slotsPerChannel(): number {
    return this.channels[0]?.slots.length ?? DEFAULT_SLOTS_PER_CHANNEL;
  }

  /**
   * Resize every channel of EVERY set to `n` slots (1..8, [SPEC-5.5], Q3).
   * Growing adds empty slots; shrinking stops and drops the removed ones. A set
   * left at another size would change the grid's height on switching, so the
   * resize is global. Persisted via the rack snapshot.
   */
  setSlotsPerChannel(n: number): void {
    const count = Math.max(MIN_SLOTS_PER_CHANNEL, Math.min(MAX_SLOTS_PER_CHANNEL, Math.floor(n)));
    if (count === this.slotsPerChannel) return;
    for (const set of this.sets) {
      for (const ch of set.channels) {
        if (ch.slots.length > count) {
          for (let s = count; s < ch.slots.length; s++) {
            if (ch.slots[s].playing && engine.isStarted) {
              engine.setVoice(ch.id, s, null, set.id).catch((err) => this.emitError(err));
            }
          }
          ch.slots = ch.slots.slice(0, count);
        } else {
          while (ch.slots.length < count) ch.slots.push(emptySlot());
        }
      }
    }
    this.emit();
  }

  /** Snapshot (deep-ish copy) of the CURRENT set, for the reactive store. */
  snapshot(): ChannelState[] {
    return this.channels.map((c) => ({
      ...c,
      categories: [...c.categories],
      slots: c.slots.map((s) => ({ ...s })),
    }));
  }

  subscribe(listener: RackListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot(), this.setSummaries());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snap = this.snapshot();
    const sets = this.setSummaries();
    for (const l of this.listeners) l(snap, sets);
  }

  /** Subscribe to audio errors (e.g. a track pattern fails to evaluate). [SPEC-14.3] */
  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Subscribe to fade requests, in and out. [SPEC-17.60/17.60.2] */
  onFade(listener: FadeListener): () => void {
    this.fadeListeners.add(listener);
    return () => this.fadeListeners.delete(listener);
  }

  private emitError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    for (const l of this.errorListeners) l(message);
  }

  // --- Pad sets [SPEC-20] ---

  get activeSetIndex(): number {
    return this.activeIndex;
  }

  get activeSetId(): string {
    return this.sets[this.activeIndex].id;
  }

  get setCount(): number {
    return this.sets.length;
  }

  /** View of every set for the GUI and the LEDs. [SPEC-20.5/20.6/20.10] */
  setSummaries(): SetSummary[] {
    return this.sets.map((set, index) => ({
      id: set.id,
      index,
      name: set.name,
      color: set.color,
      hex: setColorHex(set.color),
      active: index === this.activeIndex,
      assigned: assignedCount(set),
      playing: playingCount(set),
      // The last set is never removable: the pads must always address one.
      deletable: isEmptySet(set) && this.sets.length > 1,
    }));
  }

  /** Deep copy of every set, for persistence and sessions. [SPEC-20.12] */
  setsSnapshot(): PadSet[] {
    return this.sets.map((set) => ({
      id: set.id,
      name: set.name,
      color: set.color,
      channels: set.channels.map((c) => ({
        ...c,
        categories: [...c.categories],
        effects: coerceEffects(c.effects),
        slots: c.slots.map((s) => ({ ...s })),
      })),
    }));
  }

  /**
   * Make another set current. Nothing is started or stopped [SPEC-20.4]: only the
   * pads' addressing changes. The set's channel values ARE pushed to the engine,
   * a set being a complete preset [SPEC-20.2] — hence the documented consequence
   * that loops still running from another set are scaled by the current set's
   * volumes and effects (one orbit per channel, [SPEC-17.37]).
   */
  selectSet(index: number): boolean {
    if (index < 0 || index >= this.sets.length || index === this.activeIndex) return false;
    this.activeIndex = index;
    this.pushChannelParams();
    this.emit();
    return true;
  }

  /**
   * Neighbour set (APC CLIP STOP / SOLO), WITHOUT wrapping: on the first set, a
   * press on « previous » does nothing. The list is linear, so wrapping would
   * jump to the far end — precisely the wrong set, and unrecoverable in one
   * press. [SPEC-20.3]
   */
  stepSet(delta: 1 | -1): boolean {
    return this.selectSet(this.activeIndex + delta);
  }

  setIndexOf(setId: string): number {
    return this.sets.findIndex((s) => s.id === setId);
  }

  /** Add an empty set at the end and make it current. Null when the ceiling is
   *  reached. Caller enforces the edit-mode rule [SPEC-20.7]. */
  addSet(): PadSet | null {
    if (this.sets.length >= MAX_SETS) return null;
    const set: PadSet = {
      id: newSetId(this.sets),
      name: defaultSetName(this.sets),
      color: nextFreeColor(this.sets),
      channels: createChannels(this.count, this.slotsPerChannel),
    };
    this.sets.push(set);
    this.activeIndex = this.sets.length - 1;
    this.levelSetsOnActive(); // a new set inherits the current levels [SPEC-20.15]
    this.pushChannelParams();
    this.emit();
    return set;
  }

  /** Remove an EMPTY set [SPEC-20.8]. Returns why it failed, or null on success. */
  removeSet(index: number): string | null {
    const set = this.sets[index];
    if (!set) return 'set inconnu';
    if (this.sets.length <= 1) return 'le dernier set ne peut pas être supprimé';
    if (!isEmptySet(set)) {
      return `« ${set.name} » n'est pas vide (${assignedCount(set)} pad(s) associé(s))`;
    }
    this.sets.splice(index, 1);
    // Keep the SAME set current whenever possible: removing another one must not
    // move the pads under the performer's hands.
    if (this.activeIndex > index) this.activeIndex--;
    else if (this.activeIndex === index) {
      this.activeIndex = Math.min(index, this.sets.length - 1);
      this.pushChannelParams();
    }
    this.emit();
    return null;
  }

  /** Move a set one step left/right. Ids being stable, nothing is unbound. [SPEC-20.9] */
  moveSet(index: number, delta: -1 | 1): boolean {
    const target = index + delta;
    if (index < 0 || index >= this.sets.length) return false;
    if (target < 0 || target >= this.sets.length) return false;
    const activeId = this.activeSetId;
    const [set] = this.sets.splice(index, 1);
    this.sets.splice(target, 0, set);
    this.activeIndex = this.sets.findIndex((s) => s.id === activeId);
    this.emit();
    return true;
  }

  renameSet(index: number, name: string): boolean {
    const set = this.sets[index];
    const trimmed = name.trim();
    if (!set || trimmed === '' || trimmed === set.name) return false;
    set.name = trimmed;
    this.emit();
    return true;
  }

  recolorSet(index: number, color: SetColor): boolean {
    const set = this.sets[index];
    if (!set || set.color === color) return false;
    set.color = color;
    this.emit();
    return true;
  }

  /** Push the current set's channel values into the engine (gain, filter, fx). */
  private pushChannelParams(): void {
    for (const ch of this.channels) {
      engine.setChannelGain(ch.id, ch.volume);
      engine.setChannelFilter(ch.id, ch.filter);
      engine.setChannelEffects(ch.id, ch.effects);
    }
  }

  private setById(setId: string): PadSet | undefined {
    return this.sets.find((s) => s.id === setId);
  }

  /** Slot addressed by (set, channel, slot) — the set defaults to the current one. */
  private slotAt(channelId: number, slotIndex: number, setId?: string): SlotState | undefined {
    const set = setId === undefined ? this.sets[this.activeIndex] : this.setById(setId);
    return set?.channels[channelId]?.slots[slotIndex];
  }

  // --- Associations ([SPEC-5.2/5.4], editable live [SPEC-5.3]) ---

  assignCategories(channelId: number, categories: string[]): void {
    const ch = this.channels[channelId];
    if (!ch) return;
    ch.categories = [...categories];
    this.emit();
  }

  assignSlot(channelId: number, slotIndex: number, trackId: string | null): void {
    const ch = this.channels[channelId];
    const slot = ch?.slots[slotIndex];
    if (!slot) return;
    // Stop the old track if it was playing before re-binding — NET, without fade:
    // the sound that would fade out is about to be replaced. [SPEC-17.60.2]
    if (slot.playing) void this.toggleSlot(channelId, slotIndex, undefined, { immediate: true });
    slot.codeOverride = null; // new binding → back to the disk pattern [SPEC-9.1]
    if (trackId) {
      const track = library.getTrack(trackId);
      slot.trackId = trackId;
      slot.trackName = track ? track.name : null;
      slot.trackBeats = track ? track.beats : null;
    } else {
      slot.trackId = null;
      slot.trackName = null;
      slot.trackBeats = null;
    }
    this.emit();
  }

  /** Effective code for a slot: live override if any, else the disk pattern. */
  slotCode(channelId: number, slotIndex: number, setId?: string): string {
    const slot = this.slotAt(channelId, slotIndex, setId);
    if (!slot) return '';
    if (slot.codeOverride !== null) return slot.codeOverride;
    const track = slot.trackId ? library.getTrack(slot.trackId) : undefined;
    return track?.pattern ?? '';
  }

  /** Wrap a slot's code with a transpose when its track declares a reference key
   *  (pitched track). The offset (semitones) from the track's key to the selected
   *  key is baked in; changing key re-evaluates voices. Tracks without `key` are
   *  never transposed (drums). Applied only for playback, not the editable code.
   *  [SPEC-17.19] */
  private wrapForKey(code: string, trackId: string | null): string {
    if (!engine.forceKey) return code; // transposition disabled → play as written
    const track = trackId ? library.getTrack(trackId) : undefined;
    if (!track?.key) return code;
    const offset = transposeSemitones(track.key, engine.selectedKey);
    return offset === 0 ? code : `(${code}).add(note(${offset}))`;
  }

  /** Playable code for a slot: effective code + key transpose if pitched. */
  private voiceCode(channelId: number, slotIndex: number, setId?: string): string {
    const trackId = this.slotAt(channelId, slotIndex, setId)?.trackId ?? null;
    return this.wrapForKey(this.slotCode(channelId, slotIndex, setId), trackId);
  }

  // --- Realtime controls ---

  /**
   * [SPEC-7.1] Immediate volume via the engine's live gain ref.
   *
   * The level is written to EVERY set, not just the current one: a channel's
   * volume is a hand-held position, and switching set must never move it
   * [SPEC-20.15]. Keeping one value per channel — rather than not pushing on
   * switch — is what makes the stored state agree with what is heard, whichever
   * set is active.
   */
  setVolume(channelId: number, value: number): void {
    const clamped = Math.min(1, Math.max(0, value));
    let found = false;
    for (const set of this.sets) {
      const ch = set.channels[channelId];
      if (!ch) continue;
      ch.volume = clamped;
      found = true;
    }
    if (!found) return;
    engine.setChannelGain(channelId, clamped);
    this.emit();
  }

  /**
   * Align every set's volumes on the current set's. Called after a restore or a
   * set creation, so a state written before [SPEC-20.15] — or a fresh set born at
   * the default gain — cannot make the level jump on the next switch.
   */
  private levelSetsOnActive(): void {
    const reference = this.sets[this.activeIndex].channels;
    for (const set of this.sets) {
      if (set === this.sets[this.activeIndex]) continue;
      set.channels.forEach((ch, i) => {
        const ref = reference[i];
        if (ref) ch.volume = ref.volume;
      });
    }
  }

  /** [SPEC-7.2] Immediate bipolar filter via the engine's live filter ref. */
  setFilter(channelId: number, value: number): void {
    const ch = this.channels[channelId];
    if (!ch) return;
    const before = ch.filter;
    ch.filter = Math.min(1, Math.max(0, value));
    engine.setChannelFilter(channelId, ch.filter);
    // Crossing the neutral point engages or releases the channel filter, which is
    // now conditionally present in the chain [SPEC-17.53]. Only a crossing needs a
    // re-evaluation — sweeping within one half stays live through the ref.
    const sideOf = (v: number): number => Math.sign(v - NEUTRAL_FILTER);
    if (sideOf(before) !== sideOf(ch.filter) && engine.isStarted) {
      void this.rebuildChannelVoices(channelId);
    }
    this.emit();
  }

  // --- Per-channel launch mode [SPEC-17.17/17.60] ---

  /** How this channel launches: immediate, quantized, or faded in. */
  channelLaunch(channelId: number, setId?: string): ChannelLaunch {
    const set = setId === undefined ? this.sets[this.activeIndex] : this.setById(setId);
    return set?.channels[channelId]?.launch ?? 'immediate';
  }

  setChannelLaunch(channelId: number, mode: ChannelLaunch): void {
    const ch = this.channels[channelId];
    if (!ch || ch.launch === mode) return;
    ch.launch = mode;
    this.emit();
  }

  /** One press of the channel's button: immediate → quantized → fade → … */
  stepChannelLaunch(channelId: number): void {
    const ch = this.channels[channelId];
    if (!ch) return;
    ch.launch = nextLaunch(ch.launch);
    this.emit();
  }

  /** Set every channel's launch mode at once (global button). */
  setAllLaunch(mode: ChannelLaunch): void {
    let changed = false;
    for (const ch of this.channels) {
      if (ch.launch !== mode) {
        ch.launch = mode;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** The shared launch mode, or null when the channels disagree (mixed). */
  get commonLaunch(): ChannelLaunch | null {
    const first = this.channels[0]?.launch ?? 'immediate';
    return this.channels.every((ch) => ch.launch === first) ? first : null;
  }

  // --- Per-channel effects (nano: S = prev, M = on/off, R = next) [SPEC-17.23/17.28] ---

  /** Move the focus to the previous/next effect (nano S / R). Browsing never
   *  changes what is heard — only which effect the knob/fader edit. [SPEC-17.28] */
  stepChannelFxFocus(channelId: number, delta: 1 | -1): void {
    const ch = this.channels[channelId];
    if (!ch) return;
    ch.fxFocus = stepFx(ch.fxFocus, delta);
    this.emit();
  }

  /** Toggle the focused effect (nano M). [SPEC-17.28] */
  toggleFocusedChannelEffect(channelId: number): void {
    const ch = this.channels[channelId];
    if (!ch) return;
    this.toggleChannelEffect(channelId, ch.fxFocus);
  }

  /** Toggle an effect on/off and focus it (so the knob/fader edit it next).
   *  Activating resets its params to neutral so it starts inaudible. Heavy effects
   *  enter/leave the voice chain, so their voices are re-evaluated. [SPEC-17.23/17.28] */
  toggleChannelEffect(channelId: number, effect: FxKind): void {
    const ch = this.channels[channelId];
    if (!ch) return;
    const nowOn = !ch.effects[effect].on;
    ch.effects[effect].on = nowOn;
    if (nowOn) {
      const n = neutralFx(effect);
      ch.effects[effect].p1 = n.p1;
      ch.effects[effect].p2 = n.p2;
    }
    ch.fxFocus = effect;
    engine.setChannelEffects(channelId, ch.effects);
    this.emit();
    // Every effect is now conditionally present in the chain — the light ones so
    // they stop overriding what the track wrote [SPEC-17.53], the heavy ones so
    // they cost nothing while off [SPEC-17.28]. Either way the chain's SHAPE
    // changed, so this channel's playing voices must be re-evaluated.
    if (engine.isStarted) void this.rebuildChannelVoices(channelId);
  }

  /** Re-evaluate the playing voices of one channel IN THE CURRENT SET (used when
   *  its chain shape changes, e.g. a heavy effect toggled). Voices still running
   *  from another set keep the shape they were launched with — the documented
   *  consequence of a single orbit per channel. [SPEC-17.28, SPEC-20.2] */
  private async rebuildChannelVoices(channelId: number): Promise<void> {
    const set = this.sets[this.activeIndex];
    const ch = set.channels[channelId];
    if (!ch) return;
    for (let s = 0; s < ch.slots.length; s++) {
      const slot = ch.slots[s];
      if (!slot.playing || !slot.trackId) continue;
      try {
        await engine.setVoice(channelId, s, this.voiceCode(channelId, s, set.id), set.id);
      } catch (err) {
        this.emitError(err);
      }
    }
  }

  /** Set a parameter of the channel's focused effect. `param` = 'p1' (knob) or
   *  'p2' (fader). Value 0..1. Live via refs — no re-eval. */
  setChannelFxParam(channelId: number, param: 'p1' | 'p2', value: number): void {
    const ch = this.channels[channelId];
    if (!ch) return;
    ch.effects[ch.fxFocus][param] = Math.min(1, Math.max(0, value));
    engine.setChannelEffects(channelId, ch.effects);
    this.emit();
  }

  /** [SPEC-7.3/7.4 immediate] Toggle a slot's track on/off, in `setId` or in the
   *  current set. A queued toggle names its set so it fires where it was pressed
   *  even after a switch. [SPEC-20.4] */
  async toggleSlot(
    channelId: number,
    slotIndex: number,
    setId?: string,
    options: { immediate?: boolean } = {},
  ): Promise<void> {
    const set = setId === undefined ? this.sets[this.activeIndex] : this.setById(setId);
    const slot = set?.channels[channelId]?.slots[slotIndex];
    if (!set || !slot || !slot.trackId) return; // empty slot: nothing to trigger

    const voice = slotRef(set.id, channelId, slotIndex);
    // A press during a fade-out CANCELS it — same rule as a second press on a
    // queued quantized toggle [SPEC-8.4]: the gesture undoes itself, it does not
    // stack. The level climbs back from wherever it had fallen. [SPEC-17.60.2]
    if (this.fadingOut.has(voice)) {
      this.fadingOut.delete(voice);
      slot.pending = false;
      slot.playing = true;
      this.emit();
      for (const l of this.fadeListeners) {
        l({ set: set.id, channel: channelId, slot: slotIndex, kind: 'in' });
      }
      return;
    }
    // Binding kept but unresolved: say so instead of arming a silent slot.
    // A live-coded override still has something to play. [SPEC-17.51, SPEC-9.2]
    if (isMissingTrack(slot) && slot.codeOverride === null) {
      this.emitError(
        new Error(`Piste introuvable dans la bibliothèque : « ${slot.trackId} » (fichier supprimé ou renommé)`),
      );
      return;
    }
    // Fading only ever happens WHILE PLAYING [SPEC-17.60.2]: transport stopped,
    // nothing is heard, so a ramp would run in wall-clock time against silence
    // and be over before PLAY. Arming and disarming are then plain and instant.
    const faded =
      set.channels[channelId]?.launch === 'fade' &&
      !options.immediate &&
      engine.isStarted &&
      engine.isTransportRunning;

    // Fade OUT, decided BEFORE flipping the state: the loop keeps sounding and
    // comes down over one window. Flipping first would emit one frame of
    // "stopped" — a dark pad and a false `slot` cue to the stage output
    // [SPEC-20.13] — before putting it back. [SPEC-17.60.2]
    if (slot.playing && faded) {
      slot.pending = true; // still audible, and visibly about to stop [SPEC-17.16]
      this.fadingOut.add(voice);
      this.emit();
      // The voice is re-evaluated WITH its fade factor at 1: it may have been
      // armed while the channel was in another mode, and its chain would then
      // carry no factor for the ramp to bite on. Re-evaluating does not restart
      // the pattern — Strudel aligns it on the global cycle grid.
      engine.setVoiceFade(set.id, channelId, slotIndex, 1);
      try {
        await engine.setVoice(
          channelId,
          slotIndex,
          this.voiceCode(channelId, slotIndex, set.id),
          set.id,
          true,
        );
      } catch (err) {
        this.emitError(err);
      }
      for (const l of this.fadeListeners) {
        l({ set: set.id, channel: channelId, slot: slotIndex, kind: 'out' });
      }
      return;
    }

    slot.playing = !slot.playing;
    this.emit();

    // Audio only when the engine is unlocked; otherwise state/LED still update
    // and the voice is (re)built on enableAudio(). [SPEC-14.2]
    if (!engine.isStarted) return;
    try {
      if (slot.playing) {
        if (faded) engine.setVoiceFade(set.id, channelId, slotIndex, 0);
        await engine.setVoice(
          channelId,
          slotIndex,
          this.voiceCode(channelId, slotIndex, set.id),
          set.id,
          faded,
        );
        if (faded) {
          for (const l of this.fadeListeners) {
            l({ set: set.id, channel: channelId, slot: slotIndex, kind: 'in' });
          }
        }
      } else {
        engine.clearVoiceFade(set.id, channelId, slotIndex); // next arm starts clean
        await engine.setVoice(channelId, slotIndex, null, set.id);
      }
    } catch (err) {
      this.emitError(err); // surface eval errors, never swallow [SPEC-14.3]
    }
  }

  /**
   * The fade-out reached zero: drop the voice for good. Called by the store when
   * its ramp ends. A fade-out cancelled meanwhile is simply not found, so this is
   * a no-op then — the press that cancelled it wins. [SPEC-17.60.2]
   */
  async finishFadeOut(request: FadeRequest): Promise<void> {
    const voice = slotRef(request.set, request.channel, request.slot);
    if (!this.fadingOut.delete(voice)) return;
    const slot = this.setById(request.set)?.channels[request.channel]?.slots[request.slot];
    if (slot) {
      slot.playing = false;
      slot.pending = false;
      this.emit();
    }
    try {
      await engine.setVoice(request.channel, request.slot, null, request.set);
    } catch (err) {
      this.emitError(err);
    }
    engine.clearVoiceFade(request.set, request.channel, request.slot);
  }

  /** Rebuild all active voices — used right after the audio is unlocked, and on a
   *  key change. Covers EVERY set: armed loops of a set the pads no longer address
   *  must sound too. [SPEC-20.4] */
  async rebuildActiveVoices(): Promise<void> {
    for (const set of this.sets) {
      for (const ch of set.channels) {
        for (let s = 0; s < ch.slots.length; s++) {
          const slot = ch.slots[s];
          // Skip unresolved bindings: there is no code to evaluate. [SPEC-17.51]
          if (isMissingTrack(slot) && slot.codeOverride === null) continue;
          if (slot.playing && slot.trackId) {
            try {
              await engine.setVoice(ch.id, s, this.voiceCode(ch.id, s, set.id), set.id);
            } catch (err) {
              this.emitError(err);
            }
          }
        }
      }
    }
  }

  // --- Live-coding (advanced mode, [SPEC-9.2]) ---

  /** Set a live code override and ARM the slot so the code is audible. If the
   *  transport is already running the voice sounds immediately; otherwise the
   *  slot is armed and the caller starts the transport. [SPEC-9.2] */
  async setSlotCode(channelId: number, slotIndex: number, code: string): Promise<void> {
    const set = this.sets[this.activeIndex];
    const slot = set.channels[channelId]?.slots[slotIndex];
    if (!slot || !slot.trackId) return;
    slot.codeOverride = code;
    slot.playing = true; // evaluating arms the slot — the whole point of the button
    this.emit();
    if (engine.isStarted && engine.isTransportRunning) {
      try {
        await engine.setVoice(channelId, slotIndex, this.wrapForKey(code, slot.trackId), set.id);
      } catch (err) {
        this.emitError(err);
      }
    }
  }

  /** Drop the override, reverting the slot to its disk pattern. [SPEC-9.1] */
  async resetSlotCode(channelId: number, slotIndex: number): Promise<void> {
    const set = this.sets[this.activeIndex];
    const slot = set.channels[channelId]?.slots[slotIndex];
    if (!slot) return;
    slot.codeOverride = null;
    this.emit();
    if (slot.playing && slot.trackId && engine.isStarted) {
      try {
        await engine.setVoice(
          channelId,
          slotIndex,
          this.voiceCode(channelId, slotIndex, set.id),
          set.id,
        );
      } catch (err) {
        this.emitError(err);
      }
    }
  }

  /** Mark/unmark a slot as having a pending quantized toggle. [SPEC-8.4] */
  setPending(channelId: number, slotIndex: number, pending: boolean, setId?: string): void {
    const slot = this.slotAt(channelId, slotIndex, setId);
    if (!slot) return;
    slot.pending = pending;
    this.emit();
  }

  /**
   * Replace the whole rack state, sets included (used to restore persisted state
   * and a recorded session's initial state). Rebuilds the audio to match the
   * restored playing slots. [SPEC-11.2, SPEC-20.12]
   */
  async restoreSets(sets: PadSet[], activeIndex = 0): Promise<void> {
    if (sets.length === 0) return;
    engine.stop(); // clear all current voices first
    this.sets.length = 0;
    for (const src of sets) {
      this.sets.push({
        id: src.id,
        name: src.name,
        color: src.color,
        channels: src.channels.map((ch) => ({
          ...ch,
          categories: [...ch.categories],
          // Pre-[SPEC-17.60] state carried a boolean `quantized`.
          launch: coerceChannelLaunch(
            ch.launch,
            (ch as unknown as { quantized?: unknown }).quantized,
          ),
          effects: coerceEffects(ch.effects), // fills in effects added since [SPEC-17.28]
          fxFocus: coerceFxFocus(ch.fxFocus),
          slots: ch.slots.map((s) => ({ ...s, pending: false })),
        })),
      });
    }
    this.activeIndex = activeIndex >= 0 && activeIndex < this.sets.length ? activeIndex : 0;
    this.levelSetsOnActive(); // levels written before [SPEC-20.15] may diverge between sets
    this.pushChannelParams();
    this.emit();
    if (engine.isStarted) await this.rebuildActiveVoices();
  }

  /**
   * Replace the CURRENT set's channels (legacy single-set restore path, kept for
   * sessions recorded before pad sets). [SPEC-11.2]
   */
  async restore(state: ChannelState[]): Promise<void> {
    const set = this.sets[this.activeIndex];
    await this.restoreSets(
      this.sets.map((s) => (s.id === set.id ? { ...s, channels: state } : s)),
      this.activeIndex,
    );
  }

  /** Per-channel launch mode of the current set, captured with a scene. Unlike
   *  volumes and effects, it is a discrete mode and not a knob position, so
   *  restoring it yanks nothing — and a scene must launch the way it was
   *  memorized. [SPEC-17.52, SPEC-17.60] */
  launchSnapshot(): ChannelLaunch[] {
    return this.channels.map((ch) => ch.launch);
  }

  /** Channels whose launch mode differs from a captured scene, with the mode to
   *  apply (so LEDs and persistence see one change each). [SPEC-17.52/17.60] */
  launchDiff(
    target: readonly ChannelLaunch[],
    setId?: string,
  ): Array<{ channel: number; mode: ChannelLaunch }> {
    const set = setId === undefined ? this.sets[this.activeIndex] : this.setById(setId);
    if (!set) return [];
    const changed: Array<{ channel: number; mode: ChannelLaunch }> = [];
    target.forEach((mode, channel) => {
      const ch = set.channels[channel];
      if (ch && ch.launch !== mode) changed.push({ channel, mode });
    });
    return changed;
  }

  /** The set of currently armed slots ACROSS ALL SETS, as `set:channel:slot` keys
   *  — a scene. A scene that only knew the current set would recall part of what
   *  is sounding [SPEC-20.11]. Only the armed set is captured: volumes and effects
   *  stay under the performer's hands. [SPEC-17.36] */
  armedSnapshot(): string[] {
    const keys: string[] = [];
    for (const set of this.sets) {
      for (const ch of set.channels) {
        ch.slots.forEach((slot, s) => {
          if (slot.playing && slot.trackId) keys.push(slotRef(set.id, ch.id, s));
        });
      }
    }
    return keys;
  }

  /** Slots that must be toggled to go from the current state to `target`, across
   *  every set. [SPEC-20.11] */
  diffToScene(target: readonly string[]): Array<{ set: string; channel: number; slot: number }> {
    const wanted = new Set(target);
    const changes: Array<{ set: string; channel: number; slot: number }> = [];
    for (const set of this.sets) {
      for (const ch of set.channels) {
        ch.slots.forEach((slot, s) => {
          if (!slot.trackId) return; // empty slot: nothing to toggle
          const shouldPlay = wanted.has(slotRef(set.id, ch.id, s));
          // `pending` means a queued toggle will flip it, so account for that.
          const willPlay = slot.pending ? !slot.playing : slot.playing;
          if (shouldPlay !== willPlay) changes.push({ set: set.id, channel: ch.id, slot: s });
        });
      }
    }
    return changes;
  }

  /**
   * Every armed slot, in every set, with what a stage receiver needs to name it
   * [SPEC-19.6]. Driving the slot cues from THIS instead of the current set's
   * snapshot is what keeps a set switch from looking like a burst of loops
   * stopping and starting: switching changes the pads' addressing, not what
   * plays. [SPEC-20.13]
   */
  armedDetail(): ArmedSlot[] {
    const out: ArmedSlot[] = [];
    for (const set of this.sets) {
      for (const ch of set.channels) {
        ch.slots.forEach((slot, s) => {
          if (!slot.playing || !slot.trackId) return;
          out.push({
            set: set.id,
            setName: set.name,
            channel: ch.id,
            category: ch.categories[0] ?? null,
            slot: s,
            trackId: slot.trackId,
          });
        });
      }
    }
    return out;
  }

  /** Stop everything, in every set, and clear playing/pending state. */
  stopAll(): void {
    engine.stop();
    this.fadingOut.clear(); // nothing left to fade [SPEC-17.60.2]
    for (const set of this.sets) {
      for (const ch of set.channels) {
        for (const slot of ch.slots) {
          slot.playing = false;
          slot.pending = false;
        }
      }
    }
    this.emit();
  }
}

/**
 * Build a rack with sensible default associations from the library: one category
 * per channel (in category order), each channel's slots pre-filled with the first
 * tracks of its category. Makes the instrument playable immediately, while
 * everything stays reassignable ([SPEC-5.3]).
 */
export function createDefaultRack(
  count: number = DEFAULT_CHANNEL_COUNT,
  slotsPerChannel: number = DEFAULT_SLOTS_PER_CHANNEL,
): ChannelRack {
  const rack = new ChannelRack(count, slotsPerChannel);
  const categories = library.categories;
  const byCategory = library.byCategory();

  categories.slice(0, count).forEach((category, channelId) => {
    rack.assignCategories(channelId, [category]);
    const tracks = byCategory.get(category) ?? [];
    tracks.slice(0, slotsPerChannel).forEach((track, slotIndex) => {
      rack.assignSlot(channelId, slotIndex, track.id);
    });
  });

  return rack;
}
