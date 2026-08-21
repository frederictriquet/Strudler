// [SPEC-18.8] Note names ↔ MIDI numbers, for placing events on a vertical axis.
//
// Strudel hands back whatever the pattern produced: `note("c2")` yields the name,
// `chord(...).voicing()` yields MIDI numbers, `n("0 3")` yields sample indices.
// A derived view must cope with all three without importing @strudel/* ([PLAN F]).

/** Semitone offset of each natural note within an octave. */
const NATURALS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** MIDI number of C4, the convention Strudel uses (c4 = 60). */
const C4 = 60;

/**
 * Parse a note name (`c`, `C#3`, `eb2`, `Gs6`) into a MIDI number.
 * Returns null when the string is not a note name.
 * Accepts `#`/`s` for sharp and `b`/`f` for flat, repeatable; octave defaults to 4.
 */
export function noteNameToMidi(name: string): number | null {
  const match = /^([a-gA-G])([#sbf]*)(-?\d+)?$/.exec(name.trim());
  if (!match) return null;
  const [, letter, accidentals, octave] = match;
  const base = NATURALS[letter.toLowerCase()];
  if (base === undefined) return null;
  let shift = 0;
  for (const a of accidentals) {
    // `b` is ambiguous (B natural vs flat) but only ever appears here as an
    // accidental — the note letter was already consumed by the first group.
    shift += a === '#' || a === 's' ? 1 : -1;
  }
  const oct = octave === undefined ? 4 : Number(octave);
  return C4 + (oct - 4) * 12 + base + shift;
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Render a MIDI number as a note name (`60` → `C4`). */
export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${SHARP_NAMES[pc]}${octave}`;
}

/** True for the black keys of a piano keyboard — used to shade the roll. */
export function isAccidental(midi: number): boolean {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return [1, 3, 6, 8, 10].includes(pc);
}

/** Coerce whatever a pattern produced for `note` into a MIDI number, or null. */
export function toMidi(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return noteNameToMidi(value);
  return null;
}
