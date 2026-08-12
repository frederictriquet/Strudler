// [SPEC-13] Reactive channel-rack state + the single intent dispatcher shared by
// the GUI and MIDI ([PLAN B] unified input surface). Also wires MIDI input →
// intent and rack state → LED output ([SPEC-6.2/6.4]).

import { writable, get } from 'svelte/store';
import { engine } from '@core/engine/StrudelEngine';
import { clock, setBpm } from '@stores/clockStore';
import { createDefaultRack, DEFAULT_CHANNEL_COUNT } from '@core/channels/ChannelRack';
import { library } from '@core/library/Library';
import {
  coerceEffects,
  coerceFxFocus,
  FX_KINDS,
  type ChannelState,
} from '@core/channels/types';
import type { Intent } from '@core/intent/intents';
import { Launcher, type LauncherState, type LaunchMode } from '@core/launch/Launcher';
import {
  SESSION_VERSION,
  parseSession,
  serializeSession,
  type Session,
  type SessionEvent,
} from '@core/session/types';
import { midi } from '@core/midi/MidiService';
import { DEFAULT_CAMELOT } from '@core/music/camelot';
import {
  controllerMappings,
  ledStatus,
  lookupEntry,
  mappingForDevice,
  resolveIntent,
  slotButtonTargets,
  slotVisual,
} from '@core/mapping/mapping';
import { recordMidiEvent } from '@stores/midiMonitorStore';
import { loadJson, saveJson } from '@core/persist/storage';
import { fullReloadOnHmr } from '@core/persist/hmr';
import { loadDefaultSamples } from '@stores/samplesStore';
import { notify } from '@stores/logStore';
import {
  recordPhysicalIntent,
  isContinuousIntent,
  shouldTakeOver,
  physicalKey,
  resetTakeover,
} from '@stores/physicalStore';

// Owns the rack, launcher, LED cache and every reactive store below: a hot swap
// would run two copies at once (GUI on the new one, audio on the old). [SPEC-17.31]
fullReloadOnHmr(import.meta.hot);

const rack = createDefaultRack();
const launcher = new Launcher(clock, rack);

export const channelsState = writable<ChannelState[]>(rack.snapshot());
export const launcherState = writable<LauncherState>(launcher.state);
export const audioEnabled = writable<boolean>(false);
export const rackError = writable<string | null>(null);
export const persistError = writable<string | null>(null);
export const slotsPerChannel = writable<number>(rack.slotsPerChannel);

rack.onError((message) => rackError.set(message)); // surface audio errors [SPEC-14.3]

let lastChannels: ChannelState[] = rack.snapshot();

// --- Persistence [SPEC-13.2] : restore associations/settings, save on change ---

interface Settings {
  bpm: number;
  /** Legacy global launch mode; migrated to per-channel `quantized` on load. */
  mode?: 'immediate' | 'quantized';
  window: LauncherState['window'];
  showSlotProgress: boolean;
  musicalKey: string | null;
  forceKey?: boolean;
  /** Stored scenes: armed-slot keys per slot, null when empty. [SPEC-17.36] */
  scenes?: (string[] | null)[];
}

/** Show an animated progress gauge on playing slot buttons. Optional, persisted;
 *  toggled from the MIDI/Session modal. [SPEC-17.10] */
export const showSlotProgress = writable<boolean>(true);

/** Scene slots on the Stream Deck's first row (M+ then 4 slots). [SPEC-17.36] */
export const SCENE_COUNT = 4;
/** Stored scenes: armed-slot keys, `null` = empty slot. Persisted. */
export const scenes = writable<(string[] | null)[]>(Array(SCENE_COUNT).fill(null));
/** True while the next scene press stores instead of recalling. */
export const sceneStoreMode = writable<boolean>(false);
/** Last recalled scene, cleared as soon as the armed set is changed by hand. */
export const activeScene = writable<number | null>(null);

/** Selected musical key (Camelot code, e.g. "8A"), for harmonic mixing with an
 *  external set. Defaults to DEFAULT_CAMELOT, persisted. Drives live transpose of
 *  pitched tracks (those with a `key` field). [SPEC-17.14, SPEC-17.19] */
export const musicalKey = writable<string | null>(DEFAULT_CAMELOT);

/** Force pitched tracks to the selected key (transposition on/off). Persisted;
 *  off = tracks play in their written key. [SPEC-17.20] */
export const forceKey = writable<boolean>(false);

// Feed selected key + force flag to the engine and re-evaluate pitched voices so
// their baked-in transpose offset updates. [SPEC-17.19/17.20]
function applyKeyToEngine(): void {
  engine.setSelectedKey(get(musicalKey));
  engine.setForceKey(get(forceKey));
  if (engine.isStarted) void rack.rebuildActiveVoices();
}
musicalKey.subscribe(applyKeyToEngine);
forceKey.subscribe(applyKeyToEngine);

// Restore persisted associations/volume/filter (playing forced off) before
// wiring reactivity, so the app reopens in its previous state. [SPEC-13.2]
const savedRack = loadJson<ChannelState[] | null>('rack', null);
if (Array.isArray(savedRack)) {
  const knownCategories = new Set(library.categories);
  const coerced = savedRack.map((ch) => ({
    ...ch,
    // Drop categories that no longer exist in the library. [SPEC-5.5]
    categories: ch.categories.filter((c) => knownCategories.has(c)),
    quantized: typeof ch.quantized === 'boolean' ? ch.quantized : false, // [SPEC-17.17]
    effects: coerceEffects(ch.effects), // fills in effects added since [SPEC-17.23/17.28]
    fxFocus: coerceFxFocus(ch.fxFocus),
    slots: ch.slots.map((s) => {
      // Drop bindings to tracks that no longer exist in the library.
      const track = s.trackId ? library.getTrack(s.trackId) : undefined;
      return {
        ...s,
        playing: false,
        pending: false,
        trackId: track ? s.trackId : null,
        trackName: track ? track.name : null,
        trackBeats: track ? track.beats : null,
      };
    }),
  }));
  void rack.restore(coerced);
}
const savedSettings = loadJson<Settings | null>('settings', null);
if (savedSettings) {
  setBpm(savedSettings.bpm);
  launcher.setWindow(savedSettings.window);
  // Migrate a legacy global mode to per-channel, unless the restored rack already
  // carries per-channel quantization. [SPEC-17.17]
  if (savedSettings.mode === 'quantized' && !Array.isArray(savedRack)) {
    rack.setAllQuantized(true);
  }
  if (typeof savedSettings.showSlotProgress === 'boolean') {
    showSlotProgress.set(savedSettings.showSlotProgress);
  }
  if (typeof savedSettings.musicalKey === 'string' || savedSettings.musicalKey === null) {
    musicalKey.set(savedSettings.musicalKey);
  }
  if (typeof savedSettings.forceKey === 'boolean') {
    forceKey.set(savedSettings.forceKey);
  }
  if (Array.isArray(savedSettings.scenes)) {
    // Keep exactly SCENE_COUNT entries, and only string arrays. [SPEC-17.36]
    scenes.set(
      Array.from({ length: SCENE_COUNT }, (_, i) => {
        const s = savedSettings.scenes?.[i];
        return Array.isArray(s) && s.every((k) => typeof k === 'string') ? s : null;
      }),
    );
  }
}
// Sounds are driven by the APC (8 pads/column); the nano is for effects. Slots
// are fixed at 8 — coerce any persisted 3-slot rack. [SPEC-17.21]
rack.setSlotsPerChannel(8);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistNow(): void {
  try {
    saveJson('rack', lastChannels);
    saveJson('settings', {
      bpm: clock.currentBpm,
      window: launcher.state.window,
      showSlotProgress: get(showSlotProgress),
      musicalKey: get(musicalKey),
      forceKey: get(forceKey),
      scenes: get(scenes),
    });
    persistError.set(null);
  } catch (err) {
    persistError.set((err as Error).message); // surface storage failures [SPEC-14.3]
  }
}
function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 400);
}
/** Trigger a persist after an external settings change (e.g. tempo). */
export function persistSoon(): void {
  schedulePersist();
}

launcher.subscribe((state) => {
  launcherState.set(state);
  schedulePersist();
});

// LED cache keyed by `${device}:${code}`, storing the last message signature
// (`${status}:${value}`) so we send only diffs (no MIDI flood) and each connected
// controller lights independently. Status is included because the APC varies the
// note channel per state (blink). [SPEC-6.4]
const ledCache = new Map<string, string>();

// Lit value for a per-channel quantize button (APC track buttons are single-color;
// any non-zero velocity lights them). [SPEC-17.17]
const MODE_LED_ON = 127;

function syncLeds(channels: ChannelState[]): void {
  // Push slot-button state to every known controller; midi.send is a no-op if
  // that device has no connected output. Both controllers light at once. [SPEC-6.1]
  for (const mapping of controllerMappings) {
    for (const { channel, slot, code } of slotButtonTargets(
      mapping,
      channels.length,
      rack.slotsPerChannel,
    )) {
      const s = channels[channel]?.slots[slot];
      const visual = slotVisual({
        trackId: s?.trackId ?? null,
        playing: s?.playing ?? false,
        pending: s?.pending ?? false,
      });
      const value = mapping.led.color[visual];
      const status = ledStatus(mapping.led.type, mapping.led.statusChannel?.[visual] ?? 0);
      const key = `${mapping.match}:${code}`;
      const sig = `${status}:${value}`;
      if (ledCache.get(key) === sig) continue;
      // Cache only when actually sent, so LEDs resync once an output appears.
      if (midi.send(mapping.match, [status, code, value])) ledCache.set(key, sig);
    }

    // Per-channel quantize buttons (APC bottom row): lit when quantized. [SPEC-17.17]
    for (const entry of mapping.entries) {
      if (entry.intent !== 'channelModeToggle' || entry.channel === undefined) continue;
      const quantized = channels[entry.channel]?.quantized ?? false;
      const status = ledStatus(mapping.led.type);
      const value = quantized ? MODE_LED_ON : 0;
      const key = `${mapping.match}:mode:${entry.code}`;
      const sig = `${status}:${value}`;
      if (ledCache.get(key) === sig) continue;
      if (midi.send(mapping.match, [status, entry.code, value])) ledCache.set(key, sig);
    }

    // Per-channel effect buttons (nano). M = state of the FOCUSED effect; S and R
    // light together as a "this channel has active effects" cue. [SPEC-17.28]
    for (const entry of mapping.entries) {
      const isToggle = entry.intent === 'channelFxToggle';
      const isNav = entry.intent === 'channelFxPrev' || entry.intent === 'channelFxNext';
      if ((!isToggle && !isNav) || entry.channel === undefined) continue;
      const ch = channels[entry.channel];
      const lit = isToggle
        ? (ch?.effects?.[ch.fxFocus]?.on ?? false)
        : FX_KINDS.some((k) => ch?.effects?.[k]?.on);
      const status = ledStatus(mapping.led.type);
      const value = lit ? MODE_LED_ON : 0;
      const key = `${mapping.match}:fx:${entry.code}`;
      const sig = `${status}:${value}`;
      if (ledCache.get(key) === sig) continue;
      if (midi.send(mapping.match, [status, entry.code, value])) ledCache.set(key, sig);
    }
  }
}

// Mirror rack → store (+ LED + persist) on every change. [SPEC-6.4, SPEC-10.5, SPEC-13.2]
rack.subscribe((channels) => {
  lastChannels = channels;
  channelsState.set(channels);
  slotsPerChannel.set(channels[0]?.slots.length ?? rack.slotsPerChannel);
  syncLeds(channels);
  schedulePersist();
});

/** Change how many slots each channel has (1..8). Persisted. [SPEC-5.5, Q3] */
export function setSlotsPerChannel(n: number): void {
  rack.setSlotsPerChannel(n);
}

/** Toggle the animated per-slot progress gauge. Persisted. [SPEC-17.10] */
export function setShowSlotProgress(on: boolean): void {
  showSlotProgress.set(on);
  schedulePersist();
}

/** Set the selected musical key (Camelot code, or null to unset). Persisted. [SPEC-17.14] */
export function setMusicalKey(code: string | null): void {
  musicalKey.set(code);
  schedulePersist();
}

/** Enable/disable forcing tracks to the selected key. Persisted. [SPEC-17.20] */
export function setForceKey(on: boolean): void {
  forceKey.set(on);
  schedulePersist();
}

// On controller (re)connect, forget cached LED values and push the full state.
// [SPEC-6.4, SPEC-14.5]
midi.onPortsChanged(() => {
  ledCache.clear();
  syncLeds(lastChannels);
  // A reconnected controller may have been moved meanwhile: drop ownership so
  // soft takeover re-arms instead of trusting a stale position. [SPEC-17.30]
  resetTakeover();
});

// --- Phase nudge [SPEC-17.34] ---
//
// Aligning loops with an external mix: the tempo may match while the phase does
// not. Nudging shifts BOTH what is heard (every voice, via `.late()`) and the
// quantization grid, so launch boundaries keep matching the audio. Offset is in
// beats, shown in the GUI; not persisted (it only makes sense against whatever is
// currently playing outside).

export const phaseOffsetBeats = writable<number>(0);

export function nudgeGrid(beats: number): void {
  const next = get(phaseOffsetBeats) + beats;
  applyPhaseOffset(next);
}

/** Cancel the nudge, back in phase with the cycle grid. */
export function resetPhaseOffset(): void {
  applyPhaseOffset(0);
}

function applyPhaseOffset(beats: number): void {
  const previous = get(phaseOffsetBeats);
  phaseOffsetBeats.set(beats);
  engine.setPhaseOffset(beats / clock.beatsPerBar); // beats → cycles
  launcher.nudgeOrigin(beats - previous); // keep the launch grid on the audio
  if (engine.isStarted) void rack.rebuildActiveVoices(); // voices carry `.late()`
}

// --- Scenes / snapshots (Stream Deck row 1: M+ then 4 slots) [SPEC-17.36] ---
//
// A scene is the set of armed slots. Storing is deliberately behind a mode ("M+")
// so a recall press can never overwrite by accident in the middle of a set;
// storing then leaves the mode, so the buttons are back to recalling right away.
// Recalls go through the normal slot-toggle path, so each channel's own
// quantization [SPEC-17.17] applies — a quantized channel switches on the window
// boundary. Only the armed set is captured: faders and effects are never yanked.

let recalling = false;

export function toggleSceneStoreMode(): void {
  sceneStoreMode.update((v) => !v);
}

/** Press on a scene button: store when armed, else recall. [SPEC-17.36] */
export function pressScene(index: number): void {
  if (index < 0 || index >= SCENE_COUNT) return;
  if (get(sceneStoreMode)) {
    storeScene(index);
    sceneStoreMode.set(false); // storing leaves the mode: no accidental overwrite
  } else {
    recallScene(index);
  }
}

function storeScene(index: number): void {
  scenes.update((list) => {
    const next = [...list];
    next[index] = rack.armedSnapshot();
    return next;
  });
  activeScene.set(index);
  schedulePersist();
  notify('success', `Scène ${index + 1} mémorisée`);
}

function recallScene(index: number): void {
  const scene = get(scenes)[index];
  if (!scene) {
    notify('info', `Scène ${index + 1} vide`);
    return;
  }
  recalling = true;
  try {
    for (const { channel, slot } of rack.diffToScene(scene)) {
      dispatch({ type: 'slotToggle', channel, slot });
    }
  } finally {
    recalling = false;
  }
  activeScene.set(index);
}

/** Position of a beat within the current quantization window (for the GUI). */
export function windowPhase(beat: number): ReturnType<Launcher['windowPhase']> {
  return launcher.windowPhase(beat);
}

/** The single dispatcher. GUI and MIDI both call this. [PLAN B] */
export function dispatch(intent: Intent): void {
  // Tap the gesture stream for recording (not while replaying). [SPEC-11.2]
  if (recording && !replaying) {
    recording.events.push({ t: clock.getBeat() - recording.startBeat, intent });
  }

  switch (intent.type) {
    case 'channelVolume':
      rack.setVolume(intent.channel, intent.value);
      break;
    case 'channelFilter':
      rack.setFilter(intent.channel, intent.value);
      break;
    case 'channelEffectToggle':
      rack.toggleChannelEffect(intent.channel, intent.effect);
      break;
    case 'channelFxPrev':
      rack.stepChannelFxFocus(intent.channel, -1);
      break;
    case 'channelFxNext':
      rack.stepChannelFxFocus(intent.channel, 1);
      break;
    case 'channelFxToggle':
      rack.toggleFocusedChannelEffect(intent.channel);
      break;
    case 'channelFxKnob':
      rack.setChannelFxParam(intent.channel, 'p1', intent.value);
      break;
    case 'channelFxFader':
      rack.setChannelFxParam(intent.channel, 'p2', intent.value);
      break;
    case 'slotToggle':
      // A hand-made change means we are no longer on the recalled scene. [SPEC-17.36]
      if (!recalling) activeScene.set(null);
      if (get(transportRunning)) {
        // Playing: honor the launch mode (immediate or quantized). [SPEC-7.4, SPEC-8]
        launcher.requestSlotToggle(intent.channel, intent.slot);
      } else {
        // Stopped: arming is always immediate (the clock isn't running to quantize to).
        rack.toggleSlot(intent.channel, intent.slot).catch((err: unknown) =>
          rackError.set((err as Error).message),
        );
      }
      break;
    case 'modeToggle':
      // Global button (nano CYCLE / GUI): toggle quantize on ALL channels. [SPEC-17.17]
      rack.setAllQuantized(!rack.allQuantized);
      break;
    case 'channelModeToggle':
      rack.toggleChannelQuantized(intent.channel);
      break;
    case 'windowPrev':
      launcher.windowPrev();
      break;
    case 'windowNext':
      launcher.windowNext();
      break;
    case 'resync':
      launcher.resync();
      break;
    case 'gridNudge':
      nudgeGrid(intent.beats);
      break;
    case 'sceneModeToggle':
      toggleSceneStoreMode();
      break;
    case 'scenePress':
      pressScene(intent.index);
      break;
    case 'transportStart':
      // The AudioContext can only be unlocked by a real gesture (click/key), not
      // by MIDI. On the very first start, guide the user to click once. [SPEC-17.25]
      if (!engine.isAudioRunning) {
        notify(
          'warn',
          'Audio verrouillé : clique une fois sur ▶ Play (ou dans la fenêtre) pour activer l’audio — ensuite le PLAY du Korg fonctionne (règle du navigateur).',
        );
      }
      void startTransport(); // nano PLAY = GUI PLAY
      break;
    case 'transportStop':
      stopTransport(); // nano STOP = GUI STOP
      break;
  }
}

// --- Transport: PLAY / STOP [SPEC-7] ---
//
// PLAY starts playback of the armed voices (and unlocks audio — the click is the
// required user gesture). STOP pauses but keeps the armed set, so PLAY resumes.
// Arming loops (toggling slots) never starts sound on its own.

export const transportRunning = writable<boolean>(false);

export async function startTransport(): Promise<void> {
  try {
    await engine.init(); // needs a user gesture; GUI PLAY provides it
    clock.applyTempo();
    // Ensure the sample bank is loaded (sound names registered) BEFORE playing,
    // otherwise the first cycle triggers "sound bd not found". [SPEC-12.1]
    await loadDefaultSamples().catch(() => undefined);
    await rack.rebuildActiveVoices(); // build voices for armed slots (silent until start)
    await engine.startTransport(); // run the scheduler → armed voices sound
    audioEnabled.set(true);
    transportRunning.set(true);
    rackError.set(null);
  } catch (err) {
    rackError.set((err as Error).message);
  }
}

export function stopTransport(): void {
  engine.stopTransport(); // pause scheduler, keep armed voices → resumable
  transportRunning.set(false);
}

/** Hard stop: silence + clear the whole armed set (used by session stop). */
export function stopAll(): void {
  rack.stopAll();
  transportRunning.set(false);
}

// --- Association editing (live) [SPEC-5.2/5.3, SPEC-10.6] ---

export function assignChannelCategories(channelId: number, categories: string[]): void {
  rack.assignCategories(channelId, categories);
}

export function assignSlotTrack(channelId: number, slotIndex: number, trackId: string | null): void {
  rack.assignSlot(channelId, slotIndex, trackId);
}

// --- Advanced mode / live-coding [SPEC-9.2/9.3] ---

export const advancedMode = writable<boolean>(false);

/** Toggling advanced mode is UI-only; it never interrupts playback. [SPEC-9.3] */
export function toggleAdvanced(): void {
  advancedMode.update((v) => !v);
}

/** Current effective code of a slot (override or disk pattern). */
export function slotCode(channelId: number, slotIndex: number): string {
  return rack.slotCode(channelId, slotIndex);
}

/** Evaluate live-coded pattern for a slot: arm it and play it now. Starts the
 *  transport if it is stopped (the ▶ Évaluer click is the audio-unlock gesture).
 *  Errors surface via rackError. [SPEC-9.2] */
export async function evalSlotCode(channelId: number, slotIndex: number, code: string): Promise<void> {
  rackError.set(null);
  await rack.setSlotCode(channelId, slotIndex, code); // arm + override, sound if already running
  if (!get(transportRunning)) await startTransport(); // otherwise start playback now
}

export function resetSlotCode(channelId: number, slotIndex: number): void {
  rackError.set(null);
  void rack.resetSlotCode(channelId, slotIndex);
}

/** Estimate the loop length of Strudel code, for the live-coding length hint.
 *  { beats: null } = no period found (variable); { error } = code invalide. */
export async function measureLength(
  code: string,
): Promise<{ beats: number | null; error: string | null }> {
  try {
    const beats = await engine.measureLengthBeats(code);
    return { beats, error: null };
  } catch (err) {
    return { beats: null, error: (err as Error).message };
  }
}

/** Current value of the parameter a continuous control drives, for soft takeover.
 *  The fx knob/fader follow the channel's focused effect. [SPEC-17.30] */
function logicalValueFor(
  type: 'channelVolume' | 'channelFilter' | 'channelFxKnob' | 'channelFxFader',
  channel: number,
): number | undefined {
  const ch = lastChannels[channel];
  if (!ch) return undefined;
  switch (type) {
    case 'channelVolume':
      return ch.volume;
    case 'channelFilter':
      return ch.filter;
    case 'channelFxKnob':
      return ch.effects[ch.fxFocus]?.p1;
    case 'channelFxFader':
      return ch.effects[ch.fxFocus]?.p2;
  }
}

/** Subscribe to MIDI input and route messages through the mapping. Call once. */
export function initMidiDispatch(): void {
  midi.onMessage(({ deviceName, status, data1, data2 }) => {
    const mapping = mappingForDevice(deviceName);
    // Log every incoming message first — including from unrecognised devices — so
    // the monitor shows what the hardware really sends. [SPEC-17.35]
    const entry = mapping ? lookupEntry(mapping, status, data1) : null;
    const kind = (status & 0xf0) === 0xb0 ? 'CC' : (status & 0xf0) === 0x90 ? 'NOTE' : `0x${(status & 0xf0).toString(16)}`;
    recordMidiEvent({
      deviceName,
      kind,
      code: data1,
      value: data2,
      intent: mapping ? (entry?.intent ?? null) : 'appareil non reconnu',
      target:
        entry?.channel !== undefined
          ? `canal ${entry.channel + 1}${entry.slot !== undefined ? ` · slot ${entry.slot + 1}` : ''}`
          : '',
    });
    if (!mapping) return;
    const intent = resolveIntent(mapping, status, data1, data2);
    if (!intent) return;
    // Only hardware moves tell us where a knob/fader physically is. [SPEC-17.29]
    const previous = recordPhysicalIntent(intent);
    // Soft takeover: a control out of sync with its parameter is ignored until it
    // is moved onto the value — its motion only feeds the ghost, and nothing
    // jumps. [SPEC-17.30]
    if (isContinuousIntent(intent)) {
      const logical = logicalValueFor(intent.type, intent.channel);
      const key = physicalKey(intent.type, intent.channel);
      if (logical !== undefined && !shouldTakeOver(key, previous, intent.value, logical)) return;
    }
    dispatch(intent);
  });
}

export const channelCount = DEFAULT_CHANNEL_COUNT;

// --- Record / replay (gestures only, Q5) [SPEC-11] ---

export type SessionStatus = 'idle' | 'recording' | 'replaying';
export const sessionStatus = writable<SessionStatus>('idle');
export const lastSession = writable<Session | null>(null);

interface Recording {
  startBeat: number;
  bpm: number;
  mode: LaunchMode; // derived global view; per-channel state lives in `initial`
  window: LauncherState['window'];
  initial: ChannelState[];
  events: SessionEvent[];
}

let recording: Recording | null = null;
let sessionData: Session | null = null;
let replaying = false;
let replayEvents: SessionEvent[] = [];
let replayIndex = 0;
let replayOrigin = 0;

export function startRecording(): void {
  const { window } = launcher.state;
  recording = {
    startBeat: clock.getBeat(),
    bpm: clock.currentBpm,
    // Derived global view for display; the authoritative per-channel quantization
    // is captured in `initial` (the rack snapshot). [SPEC-17.17]
    mode: rack.allQuantized ? 'quantized' : 'immediate',
    window,
    initial: rack.snapshot(),
    events: [],
  };
  sessionStatus.set('recording');
}

export function stopRecording(): Session | null {
  if (!recording) return null;
  const session: Session = {
    version: SESSION_VERSION,
    bpm: recording.bpm,
    mode: recording.mode,
    window: recording.window,
    initialChannels: recording.initial,
    events: recording.events,
  };
  recording = null;
  sessionData = session;
  lastSession.set(session);
  sessionStatus.set('idle');
  return session;
}

/**
 * Restore the session's initial state, then re-emit its gestures on the clock.
 * Explicit action only (Rejouer button) — never automatic. Starts the transport
 * so the restored state sounds and the clock advances.
 */
export async function startReplay(session: Session | null = sessionData): Promise<void> {
  if (replaying || !session) return;
  // Restore initial state. [SPEC-11.2] Per-channel quantization is restored via
  // rack.restore(initialChannels); session.mode is informational only. [SPEC-17.17]
  setBpm(session.bpm);
  launcher.setWindow(session.window);
  await engine.init(); // Rejouer click is a gesture → unlock audio if needed
  await rack.restore(session.initialChannels);
  await engine.startTransport();
  transportRunning.set(true);
  audioEnabled.set(true);

  replayEvents = [...session.events].sort((a, b) => a.t - b.t);
  replayIndex = 0;
  replayOrigin = clock.getBeat();
  replaying = true;
  sessionStatus.set('replaying');
  if (replayEvents.length === 0) finishReplay();
}

/** User-requested stop: halt the replay AND silence what it left playing. */
export function stopReplay(): void {
  finishReplay();
  rack.stopAll();
}

/** Internal: stop scheduling further events. A natural end keeps the sound. */
function finishReplay(): void {
  replaying = false;
  replayEvents = [];
  replayIndex = 0;
  sessionStatus.set('idle');
}

// Re-emit due events on each clock tick. [SPEC-11.2]
clock.onBeat(() => {
  if (!replaying) return;
  const elapsed = clock.getBeat() - replayOrigin;
  while (replayIndex < replayEvents.length && replayEvents[replayIndex].t <= elapsed) {
    dispatch(replayEvents[replayIndex].intent); // not recorded (replaying=true)
    replayIndex++;
  }
  if (replayIndex >= replayEvents.length) finishReplay();
});

// --- Persistence (JSON file) [SPEC-11.4, SPEC-13.4] ---

export function loadSessionJson(json: string): void {
  const session = parseSession(json); // throws on malformed input [SPEC-14.3]
  sessionData = session;
  lastSession.set(session);
  rackError.set(null);
}

export function serializeCurrentSession(): string | null {
  return sessionData ? serializeSession(sessionData) : null;
}

// --- Saved sessions list (localStorage) [SPEC-13.4] ---

export interface SavedSession {
  id: string;
  name: string;
  savedAt: string;
  session: Session;
}

export const savedSessions = writable<SavedSession[]>(loadJson<SavedSession[]>('sessions', []));

function persistSessions(list: SavedSession[]): void {
  try {
    saveJson('sessions', list);
    persistError.set(null);
  } catch (err) {
    persistError.set((err as Error).message);
  }
}

/** Store the current session in the browser under a name. [SPEC-13.4] */
export function saveSessionToBrowser(name: string): void {
  if (!sessionData) return;
  const entry: SavedSession = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: name.trim() || new Date().toLocaleString('fr-FR'),
    savedAt: new Date().toISOString(),
    session: sessionData,
  };
  savedSessions.update((list) => {
    const next = [entry, ...list];
    persistSessions(next);
    return next;
  });
}

export function deleteSavedSession(id: string): void {
  savedSessions.update((list) => {
    const next = list.filter((s) => s.id !== id);
    persistSessions(next);
    return next;
  });
}

/** Make a saved session current (so it can be replayed / exported). */
export function selectSavedSession(id: string): void {
  const entry = get(savedSessions).find((s) => s.id === id);
  if (!entry) return;
  sessionData = entry.session;
  lastSession.set(entry.session);
}
