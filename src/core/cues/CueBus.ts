// [SPEC-19] Cue bus — one producer, several named sinks (MIDI, WebSocket, …).
//
// Deliberately dumb: it stamps cues and fans them out. It holds no transport and
// no UI dependency, so a new output is just another sink.
//
// Two rules it enforces for the sinks:
//   - a sink that throws must not break the others, and never the audio thread
//     that produced the cue → each call is isolated;
//   - such a failure is never swallowed → it is republished to the error
//     listeners, which the store turns into a visible notice. [SPEC-14.3]

import type { Cue, EmittedCue } from './types';

export type CueListener = (cue: EmittedCue) => void;
export type CueErrorListener = (error: Error, sink: string) => void;

export class CueBus {
  private readonly sinks = new Map<string, CueListener>();
  private readonly errorListeners = new Set<CueErrorListener>();
  private count = 0;

  /** True when at least one sink is attached — callers skip the work otherwise. */
  get active(): boolean {
    return this.sinks.size > 0;
  }

  /** Cues emitted since startup (shown in the UI as proof the stream is alive). */
  get emitted(): number {
    return this.count;
  }

  /** Attach (or replace) a sink under a stable name. */
  addSink(name: string, listener: CueListener): void {
    this.sinks.set(name, listener);
  }

  removeSink(name: string): void {
    this.sinks.delete(name);
  }

  hasSink(name: string): boolean {
    return this.sinks.has(name);
  }

  onError(listener: CueErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Stamp and fan out. Cheap no-op while nothing is listening. */
  emit(cue: Cue): void {
    if (this.sinks.size === 0) return;
    const stamped = { ...cue, t: Date.now() } as EmittedCue;
    this.count++;
    for (const [name, sink] of this.sinks) {
      try {
        sink(stamped);
      } catch (err) {
        this.emitError(err as Error, name);
      }
    }
  }

  /** Report a sink failure (also used by the sinks themselves, e.g. a socket). */
  emitError(error: Error, sink: string): void {
    for (const listener of this.errorListeners) listener(error, sink);
  }
}

/** Single bus for the app. */
export const cues = new CueBus();
