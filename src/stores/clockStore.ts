// [SPEC-13] Reactive clock state for the GUI. The Clock (time authority) is
// driven by the audio Engine as its TimeSource; this store mirrors its position
// via the rAF ticker. [SPEC-3.4, 3.5]

import { writable } from 'svelte/store';
import { engine } from '@core/engine/StrudelEngine';
import { Clock, DEFAULT_BPM } from '@core/clock/Clock';
import { fullReloadOnHmr } from '@core/persist/hmr';

// Owns the master clock (the app's time authority). [SPEC-17.31]
fullReloadOnHmr(import.meta.hot);

export const clock = new Clock(engine, DEFAULT_BPM);
export const beatsPerBar = clock.beatsPerBar;

export interface ClockState {
  bpm: number;
  beat: number; // absolute beats since start
  cycle: number; // absolute bars since start
  running: boolean;
}

export const clockState = writable<ClockState>({
  bpm: DEFAULT_BPM,
  beat: 0,
  cycle: 0,
  running: false,
});

/** Change tempo live (scheduler preserves phase continuity). [SPEC-3.5] */
export function setBpm(bpm: number): void {
  clock.setBpm(bpm);
  clockState.update((s) => ({ ...s, bpm: clock.currentBpm }));
}

let unsubscribe: (() => void) | null = null;

/** Start mirroring the clock position into the store (call on GUI mount). */
export function startClockTicker(): void {
  if (unsubscribe) return;
  unsubscribe = clock.onBeat((pos) => {
    clockState.update((s) => ({ ...s, beat: pos.beat, cycle: pos.cycle, running: pos.running }));
  });
}

export function stopClockTicker(): void {
  unsubscribe?.();
  unsubscribe = null;
}
