// [SPEC-7.4/7.5/7.6, SPEC-8] Launch / quantize layer. Slot toggles go through
// here: in immediate mode they apply at once; in quantized mode they are queued
// and applied at the next beat that is a multiple of the window W relative to a
// re-synchronizable origin ([SPEC-8.2], Q4). A pending toggle can be cancelled by
// pressing again before it fires ([SPEC-8.4], Q2). Track length and W are
// independent ([SPEC-8.5]).

import type { Clock } from '@core/clock/Clock';
import type { ChannelRack } from '@core/channels/ChannelRack';

export type LaunchMode = 'immediate' | 'quantized';

/** Quantization window sizes in beats. [SPEC-7.6] */
export const WINDOWS = [4, 8, 16, 32, 64, 128] as const;
export type WindowSize = (typeof WINDOWS)[number];

const DEFAULT_WINDOW: WindowSize = 16;

// Audio-scheduler look-ahead in seconds: quantized toggles are applied this far
// before the window boundary so the boundary's events are queried with the
// updated voice stack. Must exceed Strudel's zyklus query window (interval 0.1 +
// overlap 0.1 = 0.2 s); a smaller lead misses the boundary and the change only
// lands one event (≈ one beat) later. [SPEC-17.22]
const LOOKAHEAD_SECONDS = 0.25;

export interface LauncherState {
  window: WindowSize;
}

type StateListener = (state: LauncherState) => void;

export class Launcher {
  private readonly clock: Clock;
  private readonly rack: ChannelRack;
  private windowIndex: number = WINDOWS.indexOf(DEFAULT_WINDOW);
  /** Absolute-beat origin of the quantization grid, resettable live. [SPEC-8.2] */
  private origin = 0;
  private readonly pending = new Map<string, number>(); // key → target beat
  private readonly listeners = new Set<StateListener>();

  constructor(clock: Clock, rack: ChannelRack) {
    this.clock = clock;
    this.rack = rack;
    // Apply due pending toggles on each clock tick (rAF-driven).
    this.clock.onBeat(() => this.tick());
  }

  get state(): LauncherState {
    return { window: WINDOWS[this.windowIndex] };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const s = this.state;
    for (const l of this.listeners) l(s);
  }

  private key(channel: number, slot: number): string {
    return `${channel}:${slot}`;
  }

  /** [SPEC-7.4/17.17] Route a slot toggle: immediate, or queued to the window,
   *  based on THIS channel's quantization setting. */
  requestSlotToggle(channel: number, slot: number): void {
    if (!this.rack.isChannelQuantized(channel)) {
      this.clearPending(channel, slot);
      void this.rack.toggleSlot(channel, slot);
      return;
    }
    // Quantized: second press before it fires cancels it. [SPEC-8.4, Q2]
    const key = this.key(channel, slot);
    if (this.pending.has(key)) {
      this.pending.delete(key);
      this.rack.setPending(channel, slot, false);
      return;
    }
    this.pending.set(key, this.nextBoundary());
    this.rack.setPending(channel, slot, true);
  }

  /** Next beat b > now with (b - origin) ≡ 0 (mod W). [SPEC-8.2] */
  private nextBoundary(): number {
    const w = WINDOWS[this.windowIndex];
    const rel = this.clock.getBeat() - this.origin;
    const k = Math.floor(rel / w) + 1;
    return this.origin + k * w;
  }

  private tick(): void {
    if (this.pending.size === 0) return;
    const beat = this.clock.getBeat();
    // Guard against a non-finite clock reading (e.g. NaN before the scheduler is
    // fully running): never fire on it, otherwise `beat < target` is false and
    // every pending toggle would misfire immediately instead of quantizing.
    if (!Number.isFinite(beat)) return;
    // Apply slightly BEFORE the boundary, by the scheduler look-ahead: the audio
    // scheduler commits a boundary's events ~look-ahead seconds early, so a change
    // made exactly at the boundary misses it and only takes effect one event
    // (≈ one beat) later. Firing early lets the boundary's events be (re)scheduled
    // with the new stack, so start/stop land ON the boundary. [SPEC-17.22]
    const lead = this.lookaheadBeats();
    for (const [key, target] of this.pending) {
      if (beat < target - lead) continue;
      this.pending.delete(key);
      const [channel, slot] = key.split(':').map(Number);
      this.rack.setPending(channel, slot, false);
      void this.rack.toggleSlot(channel, slot);
    }
  }

  /** Scheduler look-ahead expressed in beats (≈ SECONDS × bpm/60). Tunable. */
  private lookaheadBeats(): number {
    return LOOKAHEAD_SECONDS * (this.clock.currentBpm / 60);
  }

  private clearPending(channel: number, slot: number): void {
    if (this.pending.delete(this.key(channel, slot))) {
      this.rack.setPending(channel, slot, false);
    }
  }

  // --- [SPEC-7.6] window (quantization mode is now per-channel, see ChannelRack) ---

  setWindow(size: WindowSize): void {
    const idx = WINDOWS.indexOf(size);
    if (idx >= 0) {
      this.windowIndex = idx;
      this.emit();
    }
  }

  windowPrev(): void {
    if (this.windowIndex > 0) {
      this.windowIndex--;
      this.emit();
    }
  }

  windowNext(): void {
    if (this.windowIndex < WINDOWS.length - 1) {
      this.windowIndex++;
      this.emit();
    }
  }

  /** [SPEC-8.2, Q4] Reset the quantization grid origin to the current beat. */
  resync(): void {
    this.origin = this.clock.getBeat();
  }

  /** Shift the quantization grid by `beats` (signed), so launch boundaries stay
   *  aligned with the audio when its phase is nudged. [SPEC-17.34] */
  nudgeOrigin(beats: number): void {
    this.origin += beats;
  }

  /**
   * Position of `beat` within the current window, relative to the (resettable)
   * quantization origin — used by the GUI to show progress toward the next
   * launch boundary. [SPEC-17.6-adjacent, correlate readout to window]
   */
  windowPhase(beat: number): {
    window: WindowSize;
    phaseBeats: number; // 0..W, fractional
    index: number; // whole beat within the window (0..W-1)
    number: number; // how many full windows since the origin
  } {
    const w = WINDOWS[this.windowIndex];
    const rel = beat - this.origin;
    const phaseBeats = ((rel % w) + w) % w; // wrap, handle negatives
    return { window: w, phaseBeats, index: Math.floor(phaseBeats), number: Math.floor(rel / w) };
  }
}
