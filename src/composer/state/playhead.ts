// [SPEC-18.27] Playback position of the workshop, in beats, corrected so that what
// is seen coincides with what is heard.
//
// Why a correction is needed. `engine.now()` forwards Strudel's `scheduler.now()`,
// which subtracts the query tick (`clock.duration`, 0.05 s) but NOT the scheduler's
// `latency` (0.1 s) — while every event is actually sounded at `targetTime +
// latency` (`@strudel/core/cyclist.mjs`). The raw position therefore runs ~0.1 s
// ahead of the audio: a fifth of a beat at 120 BPM, plainly visible on a kick.
// The official REPL carries the same drift; the instrument's slot gauge too.
//
// Why an own ticker rather than `core/clock/Clock.ts`, which already owns a shared
// rAF loop: `Clock` also owns `setBpm`/`applyTempo` and would become a second
// authority on the tempo, while `composerStore.applyBpm()` already drives
// `engine.setCps()` directly. Fifteen lines of ticker cost less than an ambiguous
// ownership of the tempo.

import { writable } from 'svelte/store';
import { engine } from '@core/engine/StrudelEngine';
import { BEATS_PER_CYCLE } from '@core/composer/roll';

/**
 * Residual advance of the scheduler over the audio, in seconds.
 *
 * Mirrors the hard-coded `latency = 0.1` of Strudel's `Cyclist`, which `repl()`
 * does not expose — so this constant has to be maintained by hand if Strudel ever
 * changes it. It is the single value to adjust if the cursor still visibly leads
 * or lags the sound.
 */
export const SCHEDULER_LATENCY_S = 0.1;

/** Absolute position in beats since the transport started, or null when stopped. */
export const playheadBeat = writable<number | null>(null);

let frame: number | null = null;

/** Read the corrected position once. Exposed for tests and one-off reads. */
export function currentBeat(cps: number): number {
  return (engine.now() - SCHEDULER_LATENCY_S * cps) * BEATS_PER_CYCLE;
}

/**
 * Start following the transport. `getCps` is read every frame so a tempo change
 * takes effect without restarting the ticker.
 *
 * Idempotent. Nothing runs while stopped: the loop is only alive between
 * `startPlayhead` and `stopPlayhead`, so the workshop costs nothing at rest.
 */
export function startPlayhead(getCps: () => number): void {
  if (frame !== null) return;
  const tick = (): void => {
    // The engine reports 0 while the scheduler is stopped, which would park the
    // cursor at beat 0 instead of hiding it.
    playheadBeat.set(engine.isTransportRunning ? currentBeat(getCps()) : null);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

export function stopPlayhead(): void {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  playheadBeat.set(null);
}
