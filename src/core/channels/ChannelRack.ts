// [SPEC-5] Channel rack — the logical model between intents and the audio
// engine. A channel aggregates categories, a volume, a filter and a set of slots
// (buttons) each bound to a track ([SPEC-5.1]). Nothing is hard-coded: categories
// and slot→track bindings live here and are editable at runtime ([SPEC-5.3/5.5]).
//
// The rack is the single source of truth for channel state; it emits a snapshot
// on every change so the store can mirror it (GUI) and refresh LEDs ([SPEC-6.4]).

import { engine } from '@core/engine/StrudelEngine';
import { library } from '@core/library/Library';
import { DEFAULT_CHANNEL_GAIN } from '@core/engine/StrudelEngine';
import { transposeSemitones } from '@core/music/camelot';
import {
  DEFAULT_SLOTS_PER_CHANNEL,
  defaultEffects,
  neutralFx,
  stepFx,
  coerceEffects,
  coerceFxFocus,
  isMissingTrack,
  FX_HEAVY,
  type ChannelState,
  type SlotState,
  type FxKind,
} from './types';

export const DEFAULT_CHANNEL_COUNT = 8;

type RackListener = (channels: ChannelState[]) => void;

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

type ErrorListener = (message: string) => void;

export const MIN_SLOTS_PER_CHANNEL = 1;
export const MAX_SLOTS_PER_CHANNEL = 8; // Akai APC mini mk2 column height

export class ChannelRack {
  private readonly channels: ChannelState[];
  private readonly listeners = new Set<RackListener>();
  private readonly errorListeners = new Set<ErrorListener>();

  constructor(
    count: number = DEFAULT_CHANNEL_COUNT,
    slotsPerChannel: number = DEFAULT_SLOTS_PER_CHANNEL,
  ) {
    this.channels = Array.from({ length: count }, (_, id) => ({
      id,
      categories: [],
      volume: DEFAULT_CHANNEL_GAIN,
      filter: 0.5,
      quantized: false, // immediate by default [SPEC-17.17]
      effects: defaultEffects(), // per-channel LPF / delay / reverb [SPEC-17.23]
      fxFocus: 'lpf' as FxKind,
      slots: Array.from({ length: slotsPerChannel }, emptySlot),
    }));
    // Seed engine gains/filters/effects so volume, tone & fx are correct from the
    // first sound.
    for (const ch of this.channels) {
      engine.setChannelGain(ch.id, ch.volume);
      engine.setChannelFilter(ch.id, ch.filter);
      engine.setChannelEffects(ch.id, ch.effects);
    }
  }

  get count(): number {
    return this.channels.length;
  }

  /** Slots per channel — derived from the model (uniform across channels). */
  get slotsPerChannel(): number {
    return this.channels[0]?.slots.length ?? DEFAULT_SLOTS_PER_CHANNEL;
  }

  /**
   * Resize every channel to `n` slots (1..8, [SPEC-5.5], Q3). Growing adds empty
   * slots; shrinking stops and drops the removed ones. Nano uses slots 0-2,
   * APC up to 0-7. Persisted via the rack snapshot.
   */
  setSlotsPerChannel(n: number): void {
    const count = Math.max(MIN_SLOTS_PER_CHANNEL, Math.min(MAX_SLOTS_PER_CHANNEL, Math.floor(n)));
    if (count === this.slotsPerChannel) return;
    for (const ch of this.channels) {
      if (ch.slots.length > count) {
        for (let s = count; s < ch.slots.length; s++) {
          if (ch.slots[s].playing && engine.isStarted) {
            engine.setVoice(ch.id, s, null).catch((err) => this.emitError(err));
          }
        }
        ch.slots = ch.slots.slice(0, count);
      } else {
        while (ch.slots.length < count) ch.slots.push(emptySlot());
      }
    }
    this.emit();
  }

  /** Snapshot (deep-ish copy) for the reactive store. */
  snapshot(): ChannelState[] {
    return this.channels.map((c) => ({
      ...c,
      categories: [...c.categories],
      slots: c.slots.map((s) => ({ ...s })),
    }));
  }

  subscribe(listener: RackListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  /** Subscribe to audio errors (e.g. a track pattern fails to evaluate). [SPEC-14.3] */
  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private emitError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    for (const l of this.errorListeners) l(message);
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
    // Stop the old track if it was playing before re-binding.
    if (slot.playing) void this.toggleSlot(channelId, slotIndex);
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
  slotCode(channelId: number, slotIndex: number): string {
    const slot = this.channels[channelId]?.slots[slotIndex];
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
  private voiceCode(channelId: number, slotIndex: number): string {
    const trackId = this.channels[channelId]?.slots[slotIndex]?.trackId ?? null;
    return this.wrapForKey(this.slotCode(channelId, slotIndex), trackId);
  }

  // --- Realtime controls ---

  /** [SPEC-7.1] Immediate volume via the engine's live gain ref. */
  setVolume(channelId: number, value: number): void {
    const ch = this.channels[channelId];
    if (!ch) return;
    ch.volume = Math.min(1, Math.max(0, value));
    engine.setChannelGain(channelId, ch.volume);
    this.emit();
  }

  /** [SPEC-7.2] Immediate bipolar filter via the engine's live filter ref. */
  setFilter(channelId: number, value: number): void {
    const ch = this.channels[channelId];
    if (!ch) return;
    ch.filter = Math.min(1, Math.max(0, value));
    engine.setChannelFilter(channelId, ch.filter);
    this.emit();
  }

  // --- Per-channel launch quantization [SPEC-17.17] ---

  isChannelQuantized(channelId: number): boolean {
    return this.channels[channelId]?.quantized ?? false;
  }

  setChannelQuantized(channelId: number, value: boolean): void {
    const ch = this.channels[channelId];
    if (!ch || ch.quantized === value) return;
    ch.quantized = value;
    this.emit();
  }

  toggleChannelQuantized(channelId: number): void {
    const ch = this.channels[channelId];
    if (!ch) return;
    ch.quantized = !ch.quantized;
    this.emit();
  }

  /** Set every channel's quantization at once (global toggle). Returns the value applied. */
  setAllQuantized(value: boolean): void {
    let changed = false;
    for (const ch of this.channels) {
      if (ch.quantized !== value) {
        ch.quantized = value;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** True if every channel is quantized (for the global mode indicator). */
  get allQuantized(): boolean {
    return this.channels.every((ch) => ch.quantized);
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
    // Heavy effects are conditionally present in the chain → rebuild this
    // channel's playing voices so they pick it up. [SPEC-17.28]
    if (FX_HEAVY.has(effect) && engine.isStarted) {
      void this.rebuildChannelVoices(channelId);
    }
  }

  /** Re-evaluate the playing voices of one channel (used when its chain shape
   *  changes, e.g. a heavy effect toggled). [SPEC-17.28] */
  private async rebuildChannelVoices(channelId: number): Promise<void> {
    const ch = this.channels[channelId];
    if (!ch) return;
    for (let s = 0; s < ch.slots.length; s++) {
      const slot = ch.slots[s];
      if (!slot.playing || !slot.trackId) continue;
      try {
        await engine.setVoice(channelId, s, this.voiceCode(channelId, s));
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

  /** [SPEC-7.3/7.4 immediate] Toggle a slot's track on/off. */
  async toggleSlot(channelId: number, slotIndex: number): Promise<void> {
    const ch = this.channels[channelId];
    const slot = ch?.slots[slotIndex];
    if (!slot || !slot.trackId) return; // empty slot: nothing to trigger
    // Binding kept but unresolved: say so instead of arming a silent slot.
    // A live-coded override still has something to play. [SPEC-17.51, SPEC-9.2]
    if (isMissingTrack(slot) && slot.codeOverride === null) {
      this.emitError(
        new Error(`Piste introuvable dans la bibliothèque : « ${slot.trackId} » (fichier supprimé ou renommé)`),
      );
      return;
    }
    slot.playing = !slot.playing;
    this.emit();

    // Audio only when the engine is unlocked; otherwise state/LED still update
    // and the voice is (re)built on enableAudio(). [SPEC-14.2]
    if (!engine.isStarted) return;
    try {
      if (slot.playing) {
        await engine.setVoice(channelId, slotIndex, this.voiceCode(channelId, slotIndex));
      } else {
        await engine.setVoice(channelId, slotIndex, null);
      }
    } catch (err) {
      this.emitError(err); // surface eval errors, never swallow [SPEC-14.3]
    }
  }

  /** Rebuild all active voices — used right after the audio is unlocked. */
  async rebuildActiveVoices(): Promise<void> {
    for (const ch of this.channels) {
      for (let s = 0; s < ch.slots.length; s++) {
        const slot = ch.slots[s];
        // Skip unresolved bindings: there is no code to evaluate. [SPEC-17.51]
        if (isMissingTrack(slot) && slot.codeOverride === null) continue;
        if (slot.playing && slot.trackId) {
          try {
            await engine.setVoice(ch.id, s, this.voiceCode(ch.id, s));
          } catch (err) {
            this.emitError(err);
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
    const slot = this.channels[channelId]?.slots[slotIndex];
    if (!slot || !slot.trackId) return;
    slot.codeOverride = code;
    slot.playing = true; // evaluating arms the slot — the whole point of the button
    this.emit();
    if (engine.isStarted && engine.isTransportRunning) {
      try {
        await engine.setVoice(channelId, slotIndex, this.wrapForKey(code, slot.trackId));
      } catch (err) {
        this.emitError(err);
      }
    }
  }

  /** Drop the override, reverting the slot to its disk pattern. [SPEC-9.1] */
  async resetSlotCode(channelId: number, slotIndex: number): Promise<void> {
    const slot = this.channels[channelId]?.slots[slotIndex];
    if (!slot) return;
    slot.codeOverride = null;
    this.emit();
    if (slot.playing && slot.trackId && engine.isStarted) {
      try {
        await engine.setVoice(channelId, slotIndex, this.voiceCode(channelId, slotIndex));
      } catch (err) {
        this.emitError(err);
      }
    }
  }

  /** Mark/unmark a slot as having a pending quantized toggle. [SPEC-8.4] */
  setPending(channelId: number, slotIndex: number, pending: boolean): void {
    const slot = this.channels[channelId]?.slots[slotIndex];
    if (!slot) return;
    slot.pending = pending;
    this.emit();
  }

  /**
   * Replace the whole rack state (used to restore a recorded session's initial
   * state). Rebuilds the audio to match the restored playing slots. [SPEC-11.2]
   */
  async restore(state: ChannelState[]): Promise<void> {
    engine.stop(); // clear all current voices first
    for (const src of state) {
      const ch = this.channels[src.id];
      if (!ch) continue;
      ch.categories = [...src.categories];
      ch.volume = src.volume;
      ch.filter = src.filter;
      ch.effects = coerceEffects(src.effects); // fills in effects added since [SPEC-17.28]
      ch.fxFocus = coerceFxFocus(src.fxFocus);
      engine.setChannelGain(ch.id, ch.volume);
      engine.setChannelFilter(ch.id, ch.filter);
      engine.setChannelEffects(ch.id, ch.effects);
      ch.slots = src.slots.map((s) => ({ ...s, pending: false }));
    }
    this.emit();
    if (engine.isStarted) await this.rebuildActiveVoices();
  }

  /** Per-channel quantization, captured with a scene. Unlike volumes and effects,
   *  it is a discrete mode and not a knob position, so restoring it yanks nothing
   *  — and a scene must launch the way it was memorized. [SPEC-17.52] */
  quantizedSnapshot(): boolean[] {
    return this.channels.map((ch) => ch.quantized);
  }

  /** The set of currently armed slots, as `channel:slot` keys — a scene. Only the
   *  armed set is captured: volumes and effects stay under the performer's hands,
   *  so recalling a scene never yanks a fader. [SPEC-17.36] */
  armedSnapshot(): string[] {
    const keys: string[] = [];
    for (const ch of this.channels) {
      ch.slots.forEach((slot, s) => {
        if (slot.playing && slot.trackId) keys.push(`${ch.id}:${s}`);
      });
    }
    return keys;
  }

  /** Slots that must be toggled to go from the current state to `target`. */
  diffToScene(target: readonly string[]): Array<{ channel: number; slot: number }> {
    const wanted = new Set(target);
    const changes: Array<{ channel: number; slot: number }> = [];
    for (const ch of this.channels) {
      ch.slots.forEach((slot, s) => {
        if (!slot.trackId) return; // empty slot: nothing to toggle
        const shouldPlay = wanted.has(`${ch.id}:${s}`);
        // `pending` means a queued toggle will flip it, so account for that.
        const willPlay = slot.pending ? !slot.playing : slot.playing;
        if (shouldPlay !== willPlay) changes.push({ channel: ch.id, slot: s });
      });
    }
    return changes;
  }

  /** Stop everything and clear playing/pending state. */
  stopAll(): void {
    engine.stop();
    for (const ch of this.channels) {
      for (const slot of ch.slots) {
        slot.playing = false;
        slot.pending = false;
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
