// [SPEC-19] Stage output — wiring: state/engine → CueBus → sinks (MIDI, WebSocket).
//
// This is the ONLY place that knows both the app's stores and the cue sinks, which
// keeps `core/cues/` free of UI/store imports. It reads existing state rather than
// asking the rest of the app to report to it: nothing in rackStore had to change.
//
// Both outputs are OFF by default and cost nothing while off — with no sink
// attached, the bus drops every emit and the engine's trigger hook returns at once.

import { get, writable } from 'svelte/store';
import { engine, type TriggerInfo } from '@core/engine/StrudelEngine';
import { cues } from '@core/cues/CueBus';
import type { Cue, CueSnapshot } from '@core/cues/types';
import {
  MidiCueOut,
  DEFAULT_CUE_MIDI_CHANNEL,
  DEFAULT_CUE_PORT_MATCH,
} from '@core/cues/MidiCueOut';
import { WsCueOut, type WsCueState } from '@core/cues/WsCueOut';
import { clock, clockState, beatsPerBar } from '@stores/clockStore';
import { channelsState, transportRunning, windowPhase } from '@stores/rackStore';
import { notify } from '@stores/logStore';
import { loadJson, saveJson } from '@core/persist/storage';
import { fullReloadOnHmr } from '@core/persist/hmr';
import type { ChannelState } from '@core/channels/types';

// Owns the sinks and the engine/clock subscriptions. [SPEC-17.31]
fullReloadOnHmr(import.meta.hot);

export const DEFAULT_CUE_WS_URL = 'ws://127.0.0.1:8765';

const MIDI_SINK = 'midi';
const WS_SINK = 'websocket';

interface CueSettings {
  midi: boolean;
  ws: boolean;
  portMatch: string;
  channel: number;
  url: string;
}

const saved = loadJson<Partial<CueSettings> | null>('cues', null);

export const cueMidiEnabled = writable<boolean>(saved?.midi === true);
export const cueWsEnabled = writable<boolean>(saved?.ws === true);
export const cuePortMatch = writable<string>(saved?.portMatch ?? DEFAULT_CUE_PORT_MATCH);
export const cueMidiChannel = writable<number>(saved?.channel ?? DEFAULT_CUE_MIDI_CHANNEL);
export const cueWsUrl = writable<string>(saved?.url ?? DEFAULT_CUE_WS_URL);

/** Live view for the settings panel. */
export const cueWsState = writable<WsCueState>('idle');
export const cueWsError = writable<string | null>(null);
export const cueCount = writable<number>(0);

function persist(): void {
  try {
    saveJson('cues', {
      midi: get(cueMidiEnabled),
      ws: get(cueWsEnabled),
      portMatch: get(cuePortMatch),
      channel: get(cueMidiChannel),
      url: get(cueWsUrl),
    } satisfies CueSettings);
  } catch (err) {
    notify('error', `Réglages de sortie scénique non sauvegardés : ${(err as Error).message}`);
  }
}

const midiOut = new MidiCueOut({
  portMatch: () => get(cuePortMatch),
  channel: () => get(cueMidiChannel),
  onWarning: (message) => notify('warn', message),
});

const wsOut = new WsCueOut();

// --- Cue production -------------------------------------------------------

/** Category labelling a channel's cues: its first one (a channel may hold several). */
function categoryOf(channel: ChannelState | undefined): string | null {
  return channel?.categories[0] ?? null;
}

function channelsSnapshot(): ChannelState[] {
  return get(channelsState);
}

function snapshot(): CueSnapshot {
  return {
    bpm: get(clockState).bpm,
    beatsPerBar,
    running: get(transportRunning),
    channels: channelsSnapshot().map((ch) => ({ id: ch.id, categories: [...ch.categories] })),
  };
}

function emit(cue: Cue): void {
  cues.emit(cue);
  cueCount.set(cues.emitted);
}

/** Engine → onset cue. `orbit` is `channel + 1` [SPEC-17.37], so the channel — and
 *  therefore the category — comes for free. */
function onTrigger(info: TriggerInfo): void {
  const channelId = info.orbit === null ? null : info.orbit - 1;
  if (channelId === null) return; // a voice without orbit is not a channel's sound
  const channel = channelsSnapshot().find((ch) => ch.id === channelId);
  emit({
    type: 'onset',
    channel: channelId,
    category: categoryOf(channel),
    sound: info.sound,
    note: info.note,
    gain: info.gain,
    at: engine.audioTimeToEpochMs(info.audioTime),
  });
}

let unsubscribers: Array<() => void> = [];
let lastWholeBeat: number | null = null;
let lastBpm: number | null = null;
let lastRunning: boolean | null = null;
let lastPlaying = new Map<string, string | null>();

/**
 * Whole-beat crossings, read off the master clock's rAF ticker.
 *
 * Emits EVERY beat crossed since the previous frame, not just the current one:
 * Chrome throttles requestAnimationFrame to ~1 Hz in a background tab, and a gap
 * would otherwise swallow beats — with the MIDI clock, whose tick grid is anchored
 * on them, going silent. Late beats are still emitted, with an `at` in the past
 * that says so honestly. `MidiCueOut` covers the same gap by scheduling ticks
 * ahead of time. [SPEC-19.6]
 */
const MAX_CATCHUP_BEATS = 8;

function subscribeClock(): () => void {
  return clock.onBeat((position) => {
    if (!position.running) {
      lastWholeBeat = null;
      return;
    }
    const whole = Math.floor(position.beat);
    if (lastWholeBeat === whole) return;
    const bpm = get(clockState).bpm;
    const beatMs = 60000 / bpm;
    // Instant of the CURRENT beat, back-computed from the fractional position: an
    // animation frame can be ~16 ms late, which is visible on a light.
    const currentAt = Date.now() - (position.beat - whole) * beatMs;
    // After a long gap, replay at most a bar or two: a receiver has nothing to do
    // with a hundred beats fired at once.
    const from =
      lastWholeBeat === null ? whole : Math.max(lastWholeBeat + 1, whole - MAX_CATCHUP_BEATS);
    lastWholeBeat = whole;
    for (let beat = from; beat <= whole; beat++) {
      const phase = windowPhase(beat);
      emit({
        type: 'beat',
        beat,
        bar: Math.floor(beat / beatsPerBar),
        beatInBar: beat % beatsPerBar,
        window: phase.window,
        windowIndex: phase.index,
        at: currentAt - (whole - beat) * beatMs,
      });
    }
  });
}

function subscribeTempo(): () => void {
  return clockState.subscribe((state) => {
    if (state.bpm === lastBpm) return;
    lastBpm = state.bpm;
    emit({ type: 'tempo', bpm: state.bpm, beatsPerBar });
  });
}

function subscribeTransport(): () => void {
  return transportRunning.subscribe((running) => {
    if (running === lastRunning) return;
    lastRunning = running;
    emit({ type: 'transport', running, beat: clock.getBeat() });
  });
}

/** Slot arming, derived from the rack snapshot — no extra call site to maintain. */
function subscribeSlots(): () => void {
  return channelsState.subscribe((channels) => {
    const next = new Map<string, string | null>();
    for (const ch of channels) {
      ch.slots.forEach((slot, index) => {
        const key = `${ch.id}:${index}`;
        const value = slot.playing ? (slot.trackId ?? '') : null;
        next.set(key, value);
        const before = lastPlaying.get(key);
        if (before === value) return;
        // First pass records the baseline instead of replaying it as changes.
        if (lastPlaying.size > 0) {
          emit({
            type: 'slot',
            channel: ch.id,
            category: categoryOf(ch),
            slot: index,
            playing: slot.playing,
            track: slot.trackId,
          });
        }
      });
    }
    lastPlaying = next;
  });
}

// --- Sink management ------------------------------------------------------

function syncMidiSink(enabled: boolean): void {
  if (enabled) {
    cues.addSink(MIDI_SINK, (cue) => midiOut.handle(cue));
    // Announce the state a receiver needs before the first tick.
    emit({ type: 'tempo', bpm: get(clockState).bpm, beatsPerBar });
    if (get(transportRunning)) emit({ type: 'transport', running: true, beat: clock.getBeat() });
  } else {
    cues.removeSink(MIDI_SINK);
    midiOut.shutdown(); // leave the receiver on a stopped clock, not a stale one
  }
}

function syncWsSink(enabled: boolean): void {
  if (enabled) {
    cues.addSink(WS_SINK, (cue) => wsOut.handle(cue));
    wsOut.start(get(cueWsUrl), snapshot);
  } else {
    cues.removeSink(WS_SINK);
    wsOut.stop();
  }
}

export function setCueMidiEnabled(on: boolean): void {
  cueMidiEnabled.set(on);
  syncMidiSink(on);
  persist();
}

export function setCueWsEnabled(on: boolean): void {
  cueWsEnabled.set(on);
  syncWsSink(on);
  persist();
}

export function setCuePortMatch(value: string): void {
  cuePortMatch.set(value);
  persist();
}

export function setCueMidiChannel(value: number): void {
  cueMidiChannel.set(Math.max(1, Math.min(16, Math.round(value))));
  persist();
}

/** Change the receiver URL; reconnects immediately when the output is on. */
export function setCueWsUrl(value: string): void {
  cueWsUrl.set(value);
  persist();
  if (get(cueWsEnabled)) wsOut.start(value, snapshot);
}

/** Start producing cues. Called once at app startup. */
export function initCueOutputs(): void {
  if (unsubscribers.length > 0) return;
  unsubscribers = [
    engine.onTrigger(onTrigger),
    engine.onTriggerError((err) =>
      notify('error', `Sortie scénique — événement perdu : ${err.message}`),
    ),
    cues.onError((err, sink) => notify('error', `Sortie scénique (${sink}) : ${err.message}`)),
    wsOut.onState((state, error) => {
      cueWsState.set(state);
      cueWsError.set(error);
      // A failing receiver must be visible while playing, not only in the modal.
      if (state === 'error' && error) notify('warn', `Sortie scénique (WebSocket) : ${error}`);
    }),
    subscribeTempo(),
    subscribeTransport(),
    subscribeSlots(),
    subscribeClock(),
  ];
  // Restore the persisted outputs last, so the producers are already live.
  if (get(cueMidiEnabled)) syncMidiSink(true);
  if (get(cueWsEnabled)) syncWsSink(true);
}
