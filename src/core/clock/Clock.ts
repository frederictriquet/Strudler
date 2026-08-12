// [SPEC-3.4] Master clock — the single time authority for the whole app (audio,
// quantization, GUI, record). It does NOT run its own competing timer: it wraps
// the audio scheduler (the real time source) and exposes a BPM/beats view on top
// of Strudel's cycle-based position, so there is no drift between what is heard
// and what is displayed.
//
// Beat ↔ cycle convention: 1 Strudel cycle = `beatsPerCycle` beats (default 4,
// i.e. one 4/4 bar). At 120 BPM this yields cps = 120 / 60 / 4 = 0.5, which is
// also Strudel's native default. Beats are the unit used by needs.md and by the
// quantization window W (phase 5). [SPEC-2, SPEC-8]

/** Minimal time source the Clock drives — implemented by the audio Engine. */
export interface TimeSource {
  /** Set tempo as cycles per second. */
  setCps(cps: number): void;
  /** Current transport position in cycles (0 when stopped). */
  now(): number;
  /** True while the scheduler is running. */
  isRunning(): boolean;
}

export const DEFAULT_BPM = 120;
export const MIN_BPM = 20;
export const MAX_BPM = 300;
export const DEFAULT_BEATS_PER_CYCLE = 4;

export type BeatListener = (position: ClockPosition) => void;

export interface ClockPosition {
  /** Absolute beats elapsed since transport start (fractional, unbounded). */
  beat: number;
  /** Absolute cycles (bars) elapsed since start (fractional). */
  cycle: number;
  /** Whether the transport is currently running. */
  running: boolean;
}

export class Clock {
  private readonly source: TimeSource;
  private bpm: number;
  private readonly beatsPerCycle: number;
  private readonly listeners = new Set<BeatListener>();
  private rafId: number | null = null;

  constructor(
    source: TimeSource,
    bpm: number = DEFAULT_BPM,
    beatsPerCycle: number = DEFAULT_BEATS_PER_CYCLE,
  ) {
    this.source = source;
    this.bpm = bpm;
    this.beatsPerCycle = beatsPerCycle;
  }

  get currentBpm(): number {
    return this.bpm;
  }

  get beatsPerBar(): number {
    return this.beatsPerCycle;
  }

  /** Tempo expressed as cycles per second, for the audio scheduler. */
  get cps(): number {
    return this.bpm / 60 / this.beatsPerCycle;
  }

  /**
   * Change the tempo. Applied immediately to the scheduler, which preserves
   * phase continuity, so a running loop keeps playing without a jump. [SPEC-3.4]
   */
  setBpm(bpm: number): void {
    this.bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
    this.source.setCps(this.cps);
  }

  /** Re-push the current tempo to the source (call once the source is ready). */
  applyTempo(): void {
    this.source.setCps(this.cps);
  }

  /** Absolute beats since transport start. */
  getBeat(): number {
    return this.source.now() * this.beatsPerCycle;
  }

  /** Current position snapshot. */
  getPosition(): ClockPosition {
    const cycle = this.source.now();
    return {
      beat: cycle * this.beatsPerCycle,
      cycle,
      running: this.source.isRunning(),
    };
  }

  /**
   * Subscribe to position updates (driven by requestAnimationFrame). The ticker
   * runs while there is at least one listener, so the GUI beat readout stays
   * live even before playback starts. Returns an unsubscribe function.
   */
  onBeat(listener: BeatListener): () => void {
    this.listeners.add(listener);
    this.startTicker();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopTicker();
    };
  }

  private startTicker(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      const position = this.getPosition();
      for (const listener of this.listeners) listener(position);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTicker(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}
