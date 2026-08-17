// [SPEC-18.8] Turn the events a pattern produced into rows for a piano roll.
//
// Nothing here parses code: the input is what `StrudelEngine.queryEvents()`
// observed, so the view can never disagree with what will be heard [SPEC-18.6].
//
// A Strudel event carries whatever controls the pattern set. Three shapes matter:
//   - `note` (name or MIDI number) → a pitched row, positioned by MIDI number
//   - `s` (+ optional `n` sample index) → a sound row, one per sound name
//   - anything else → a single catch-all row, so nothing is silently dropped

import type { HapInfo } from '@core/engine/StrudelEngine';
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

/** Cycles to query for a phrase of `beats` beats: two full turns, so the repeat
 *  is visible. Capped so a long phrase stays readable. */
export function spanCyclesFor(phraseBeats: number | null): number {
  const beats = phraseBeats && phraseBeats > 0 ? phraseBeats : 8;
  return Math.min(64 / BEATS_PER_CYCLE, (beats * 2) / BEATS_PER_CYCLE);
}
