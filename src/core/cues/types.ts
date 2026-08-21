// [SPEC-19] Stage output — the cue stream.
//
// Strudler knows exactly what is being played: tempo, position in the phrase, and
// every hit BEFORE it is audible (the scheduler works ahead). A lighting desk or a
// visual engine therefore needs no spectral analysis — it just needs to be told.
// This module defines WHAT is told; the transports (MIDI, WebSocket) are separate
// sinks, and nothing here knows about them.
//
// Strudler only EMITS. Rendering (visuals, DMX) belongs to the receiving app.

/** Wire format version, carried by every serialized cue. Bump on a breaking change. */
export const CUE_PROTOCOL_VERSION = 1;

/** A channel as the receiver sees it, for the opening handshake. */
export interface CueChannel {
  id: number;
  /** Categories bound to the channel; the first one labels its cues. */
  categories: string[];
}

/** State of the instrument at connection time, so a receiver starts in sync. */
export interface CueSnapshot {
  bpm: number;
  beatsPerBar: number;
  running: boolean;
  channels: CueChannel[];
}

/**
 * One cue. Discriminated by `type` and made of plain data only, so it can be
 * JSON-serialized as is.
 *
 * Times are epoch milliseconds (`Date.now()` scale), NOT audio-context time:
 * they must stay comparable in another process. `at` is the instant an event is
 * MEANT to happen, always in the future — that lead is the whole point.
 */
export type Cue =
  /** Tempo changed (also sent once when the stream opens). */
  | { type: 'tempo'; bpm: number; beatsPerBar: number }
  /** PLAY / STOP. `beat` is the position at that moment. */
  | { type: 'transport'; running: boolean; beat: number }
  /** A whole beat was crossed. `at` = that beat's own instant. */
  | {
      type: 'beat';
      beat: number;
      bar: number;
      beatInBar: number;
      /** Quantization window in beats and position within it. [SPEC-8] */
      window: number;
      windowIndex: number;
      at: number;
    }
  /** A note actually played, resolved back to its channel. `at` = its attack. */
  | {
      type: 'onset';
      channel: number;
      category: string | null;
      sound: string | null;
      note: string | number | null;
      /** 0..1 as played (channel fader included). */
      gain: number;
      at: number;
    }
  /** A slot was armed or stopped. */
  | {
      type: 'slot';
      channel: number;
      category: string | null;
      slot: number;
      playing: boolean;
      track: string | null;
    };

export type CueType = Cue['type'];

/** A cue as emitted: stamped with the instant it left Strudler. */
export type EmittedCue = Cue & { t: number };
