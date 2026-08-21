// [SPEC-18.8] Turn the events a pattern produced into rows for a piano roll.
//
// Nothing here parses code: the input is what `StrudelEngine.queryEvents()`
// observed, so the view can never disagree with what will be heard [SPEC-18.6].
//
// A Strudel event carries whatever controls the pattern set. Three shapes matter:
//   - `note` (name or MIDI number) → a pitched row, positioned by MIDI number
//   - `s` (+ optional `n` sample index) → a sound row, one per sound name
//   - anything else → a single catch-all row, so nothing is silently dropped

import type { HapInfo, SourceRange } from '@core/engine/StrudelEngine';
import { isAccidental, midiToNoteName, toMidi } from '@core/music/notes';

export const BEATS_PER_CYCLE = 4;

/** One colour per `stack()` layer, shared by the roll and the layer strip so an
 *  event can be traced back to the line that wrote it. [SPEC-18.9] */
export const LAYER_COLORS = ['#6ee7b7', '#7dd3fc', '#fca5a5', '#fcd34d', '#c4b5fd', '#f0abfc'];

export interface RollRow {
  key: string;
  label: string;
  /** MIDI number for pitched rows; undefined for sound rows. */
  midi?: number;
  /** Black key — shaded in the view. */
  accidental: boolean;
}

export interface RollEvent {
  rowKey: string;
  /** Beats from the start of the query. */
  begin: number;
  end: number;
  /** False when the attack happened before the queried span (tail of a long note). */
  hasOnset: boolean;
  /** 0..1, from the event's `gain` when present. Drives opacity. */
  gain: number;
  label: string;
  /** Index of the `stack()` layer that produced it, for colouring. [SPEC-18.9] */
  layer: number;
  /** Character ranges of the source that produced it. [SPEC-18.27] Only meaningful
   *  when the queried string was the text the user is looking at. */
  locations: SourceRange[];
}

/** Playback state of an event at a given moment. [SPEC-18.27] */
export type EventPhase = 'idle' | 'attack' | 'held';

/** How long the attack flash lasts, in beats. Short enough to read as a hit
 *  rather than a level: a kick lasts a whole beat, and lighting it up for that
 *  long looks sluggish. */
export const FLASH_BEATS = 1 / 8;

/**
 * Where an event stands relative to the playhead. [SPEC-18.27]
 * `phaseBeats` is the playhead position WITHIN the declared phrase, which is the
 * whole drawn width since the view spans exactly one turn [SPEC-18.26].
 */
export function eventPhase(event: RollEvent, phaseBeats: number | null): EventPhase {
  if (phaseBeats === null) return 'idle';
  if (phaseBeats < event.begin || phaseBeats >= event.end) return 'idle';
  return phaseBeats - event.begin < FLASH_BEATS ? 'attack' : 'held';
}

/** Playhead position inside the declared phrase, or null when stopped.
 *  Modulo, like the instrument's slot gauge: Strudel patterns are aligned to the
 *  global cycle grid, so the absolute beat maps straight onto the phrase. */
export function phaseWithin(playheadBeat: number | null, phraseBeats: number): number | null {
  if (playheadBeat === null || phraseBeats <= 0) return null;
  return (((playheadBeat % phraseBeats) + phraseBeats) % phraseBeats);
}

/** Events queried from one layer. */
export interface LayerHaps {
  layer: number;
  haps: HapInfo[];
}

export interface Roll {
  rows: RollRow[];
  events: RollEvent[];
  /** Length of the queried span, in beats. */
  spanBeats: number;
}

const UNKNOWN_ROW = '∅';

function soundLabel(value: Record<string, unknown>): string {
  const s = String(value.s);
  const n = value.n;
  return typeof n === 'number' && n !== 0 ? `${s}:${n}` : s;
}

/** Build the roll model from queried events, one group per `stack()` layer. */
export function buildRoll(groups: LayerHaps[], spanCycles: number): Roll {
  const rows = new Map<string, RollRow>();
  const events: RollEvent[] = [];

  for (const group of groups) {
    for (const hap of group.haps) {
      const { value } = hap;
      let rowKey: string;
      let label: string;

      const midi = 'note' in value ? toMidi(value.note) : null;
      if (midi !== null) {
        const rounded = Math.round(midi);
        rowKey = `note:${rounded}`;
        label = midiToNoteName(midi);
        if (!rows.has(rowKey)) {
          rows.set(rowKey, { key: rowKey, label, midi: rounded, accidental: isAccidental(midi) });
        }
      } else if (typeof value.s === 'string') {
        label = soundLabel(value);
        rowKey = `s:${label}`;
        if (!rows.has(rowKey)) rows.set(rowKey, { key: rowKey, label, accidental: false });
      } else {
        rowKey = UNKNOWN_ROW;
        label = 'autre';
        if (!rows.has(rowKey)) rows.set(rowKey, { key: rowKey, label, accidental: false });
      }

      const gain = typeof value.gain === 'number' ? Math.min(1, Math.max(0, value.gain)) : 1;
      events.push({
        rowKey,
        begin: hap.begin * BEATS_PER_CYCLE,
        end: hap.end * BEATS_PER_CYCLE,
        hasOnset: hap.hasOnset,
        gain,
        label,
        layer: group.layer,
        locations: hap.locations,
      });
    }
  }

  // Pitched rows first, highest note on top (piano-roll convention); then sound
  // rows alphabetically, so a drum pattern keeps a stable vertical order.
  const ordered = [...rows.values()].sort((a, b) => {
    if (a.midi !== undefined && b.midi !== undefined) return b.midi - a.midi;
    if (a.midi !== undefined) return -1;
    if (b.midi !== undefined) return 1;
    return a.label.localeCompare(b.label);
  });

  return { rows: ordered, events, spanBeats: spanCycles * BEATS_PER_CYCLE };
}

/** Phrase lengths a track declares. [SPEC-4.2] */
const STANDARD_PHRASES = [4, 8, 16, 32, 64];

/**
 * Phrase length to declare for a pattern whose measured period is `periodBeats`.
 * [SPEC-18.21]
 *
 * The period alone is the wrong answer: `s("bd*4")` repeats every beat, and no one
 * calls that a one-beat track. The musical answer is the smallest STANDARD phrase
 * that contains the period — which is exactly what the library's own 23 tracks
 * declare, in every single case (verified against their `beats` fields).
 *
 * Returns null for a non-periodic pattern: there is nothing to declare, and
 * guessing would be worse than saying so.
 */
export function phraseBeatsFor(periodBeats: number | null): number | null {
  if (periodBeats === null || periodBeats <= 0) return null;
  return STANDARD_PHRASES.find((p) => p >= periodBeats) ?? Math.ceil(periodBeats / 64) * 64;
}

/**
 * Cycles to query for a phrase of `beats` beats: exactly ONE turn. [SPEC-18.26]
 *
 * The view used to show two turns so the repeat would be visible, but drawing the
 * same bars twice made the roll read as a longer piece than the declared length —
 * one counted eight kicks against a « 4 beats » readout. The whole width is now
 * the loop, so the right edge IS where it turns over. Capped so a long phrase
 * stays readable.
 */
export function spanCyclesFor(phraseBeats: number | null): number {
  const beats = phraseBeats && phraseBeats > 0 ? phraseBeats : 8;
  return Math.min(64 / BEATS_PER_CYCLE, beats / BEATS_PER_CYCLE);
}
