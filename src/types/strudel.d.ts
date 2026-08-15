// Minimal ambient declarations for the subset of the Strudel API used by the
// Engine. The @strudel/* packages ship as JS without type definitions; we
// declare only what we consume, keeping the Engine boundary explicit
// ([PLAN F] "isoler l'Engine derrière une interface stable").

declare module '@strudel/core' {
  export interface Scheduler {
    start(): void;
    stop(): void;
    pause(): void;
    /** Current position in cycles (0 when not started). */
    now(): number;
    /** True while running. */
    started: boolean;
  }
  export interface Repl {
    scheduler: Scheduler;
    // Returns the evaluated pattern, or undefined when evaluation failed.
    evaluate(code: string, autostart?: boolean): Promise<unknown | undefined>;
    start(): void;
    stop(): void;
    setCps(cps: number): unknown;
  }
  export function repl(options: {
    defaultOutput: unknown;
    getTime: () => number;
    transpiler?: unknown;
    onEvalError?: (err: Error) => void;
  }): Repl;

  /** Exposes a live-mutable value at query time (no re-eval needed). */
  export function ref<T>(accessor: () => T): unknown;
  export function evalScope(...modules: Array<Promise<unknown> | unknown>): Promise<void>;
}

declare module '@strudel/mini' {
  export const mini: unknown;
}

declare module '@strudel/webaudio' {
  export function getAudioContext(): AudioContext;
  export function initAudioOnFirstClick(): Promise<void>;
  export function registerSynthSounds(): Promise<void>;
  export const webaudioOutput: unknown;
  /** Load a sample bank (URL, 'github:user/repo', or a sample map). [SPEC-12] */
  export function samples(
    sampleMap: unknown,
    baseUrl?: string,
    options?: unknown,
  ): Promise<void>;
}

declare module '@strudel/tonal' {
  // Registered as pattern methods (chord, voicing, anchor, rootNotes, scale…) and
  // only ever used from evaluated pattern code, so the module is opaque here: we
  // just hand it to evalScope. [SPEC-17.48]
  export const scale: unknown;
}

declare module '@strudel/transpiler' {
  export function transpiler(code: string, options?: unknown): unknown;
}
