// [SPEC-19] MIDI sink — beat clock + transport + one note per category.
//
// The universal standard: any lighting or VJ software (QLC+, Resolume, VDMX…)
// reads MIDI beat clock for tempo and learns notes for triggers, with no code on
// its side.
//
// Timing is what makes this worth doing. Web MIDI accepts a timestamp on send(),
// so every message is SCHEDULED at its exact instant instead of being fired by a
// JS timer: the beat clock does not jitter, and a hit is announced ahead of time
// because the scheduler already knows it. [SPEC-19]

import { midi } from '@core/midi/MidiService';
import type { EmittedCue } from './types';

/** MIDI System Real-Time / Common messages used here. */
const CLOCK = 0xf8;
const START = 0xfa;
const STOP = 0xfc;
const SPP = 0xf2;

/** MIDI beat clock is defined as 24 ticks per quarter note. 1 beat = 1 quarter. */
export const PPQN = 24;

/**
 * How far ahead clock ticks are scheduled. Generous on purpose: Web MIDI emits a
 * timestamped message even if JS is not running, so scheduling a second ahead
 * keeps the clock steady through a stall — a background tab (rAF throttled to
 * ~1 Hz), a garbage collection, a heavy re-evaluation. [SPEC-19.7]
 */
const SCHEDULE_AHEAD_MS = 1200;

/** Note-On length for a hit. Long enough for a MIDI-learn to latch, short enough
 *  not to overlap the next one at speed. */
const NOTE_MS = 20;

/** Default MIDI channel for hit notes (1-based, as shown in host software). */
export const DEFAULT_CUE_MIDI_CHANNEL = 16;

/** Default output port, matched by substring. On macOS the IAC Driver is the
 *  virtual cable between two apps; keeping it distinct from the controllers'
 *  port means cue traffic never disturbs LED feedback. [SPEC-6.4] */
export const DEFAULT_CUE_PORT_MATCH = 'IAC';

/**
 * Note per category, following the General MIDI drum numbering so the mapping
 * feels familiar in host software. Unknown categories fall back to FALLBACK_NOTE
 * and are reported once. Extend freely: a category is just a library folder.
 */
export const CATEGORY_NOTES: Record<string, number> = {
  kick: 36,
  snare: 38,
  hats: 42,
  perc: 39,
  clap: 39,
  bass: 48,
  lead: 50,
  chords: 52,
  pad: 53,
};

export const FALLBACK_NOTE = 60;

export interface MidiCueOptions {
  /** Substring of the output port name. */
  portMatch: () => string;
  /** 1-based MIDI channel for hit notes. */
  channel: () => number;
  /** Reported once per unknown category. */
  onWarning: (message: string) => void;
}

export class MidiCueOut {
  private readonly options: MidiCueOptions;
  /** Absolute tick index (beat × PPQN + k) already sent, so scheduling ahead can
   *  never emit the same tick twice — beats overlap the scheduling horizon. */
  private lastTick = -1;
  private running = false;
  private bpm = 120;
  private readonly warned = new Set<string>();

  constructor(options: MidiCueOptions) {
    this.options = options;
  }

  /** Stop the clock cleanly — a receiver left on a running clock keeps chasing. */
  shutdown(): void {
    if (this.running) this.send([STOP]);
    this.running = false;
  }

  handle(cue: EmittedCue): void {
    switch (cue.type) {
      case 'tempo':
        this.bpm = cue.bpm;
        break;
      case 'transport':
        if (cue.running) {
          // Song Position Pointer first (in MIDI beats = sixteenth notes), then
          // Start: the receiver knows WHERE we are before it starts counting.
          this.sendSongPosition(cue.beat);
          this.send([START]);
          this.lastTick = -1;
        } else {
          this.send([STOP]);
        }
        this.running = cue.running;
        break;
      case 'beat':
        // Re-anchor on every beat: the anchor comes from the audio clock, so the
        // tick grid cannot drift away from what is heard.
        if (this.running) this.scheduleTicks(cue.beat, cue.at);
        break;
      case 'onset':
        this.sendHit(cue.category, cue.gain, cue.at);
        break;
      case 'slot':
        // Arming is a state change, not a hit: nothing to send on this transport.
        break;
    }
  }

  /**
   * Schedule every tick from this beat up to the horizon, at its exact instant.
   *
   * Ticks are indexed absolutely (`beat × PPQN + k`) so overlapping horizons never
   * duplicate one, and the grid is re-anchored on each beat's own instant, which
   * comes from the audio clock: it cannot drift from what is heard.
   */
  private scheduleTicks(beat: number, beatAt: number): void {
    const tickMs = 60000 / this.bpm / PPQN;
    const horizon = Date.now() + SCHEDULE_AHEAD_MS;
    const firstTick = beat * PPQN;
    for (let tick = Math.max(firstTick, this.lastTick + 1); ; tick++) {
      const at = beatAt + (tick - firstTick) * tickMs;
      if (at > horizon) return;
      this.sendAt([CLOCK], at);
      this.lastTick = tick;
    }
  }

  private sendHit(category: string | null, gain: number, at: number): void {
    const note = this.noteFor(category);
    const velocity = Math.max(1, Math.min(127, Math.round(gain * 127)));
    const channel = Math.max(1, Math.min(16, Math.round(this.options.channel()))) - 1;
    this.sendAt([0x90 | channel, note, velocity], at);
    this.sendAt([0x80 | channel, note, 0], at + NOTE_MS);
  }

  private noteFor(category: string | null): number {
    if (category && category in CATEGORY_NOTES) return CATEGORY_NOTES[category];
    const key = category ?? '(sans catégorie)';
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.options.onWarning(
        `Catégorie « ${key} » sans note MIDI attribuée : repli sur la note ${FALLBACK_NOTE}. ` +
          `Notes connues : ${Object.keys(CATEGORY_NOTES).join(', ')}.`,
      );
    }
    return FALLBACK_NOTE;
  }

  /** MIDI Song Position Pointer counts sixteenth notes (4 per beat), 14-bit. */
  private sendSongPosition(beat: number): void {
    const sixteenths = Math.max(0, Math.round(beat * 4)) & 0x3fff;
    this.send([SPP, sixteenths & 0x7f, (sixteenths >> 7) & 0x7f]);
  }

  private send(bytes: number[]): void {
    midi.send(this.options.portMatch(), bytes);
  }

  /** `at` is epoch ms; Web MIDI timestamps are on the performance.now() clock. */
  private sendAt(bytes: number[], at: number): void {
    midi.sendAt(this.options.portMatch(), bytes, at - performance.timeOrigin);
  }
}
