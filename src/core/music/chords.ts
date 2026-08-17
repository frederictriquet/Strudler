// [SPEC-18.10] Chord progressions written as DEGREES.
//
// Targets the real workflow: a tutorial says «6-1-3-7, si mineur, uplifting» and
// that is all you have. Typing degrees is something you can do without reading
// music; naming the four chords is not. The output is a Strudel chord symbol
// string, inserted into the pattern and then owned by the text [SPEC-18.7].
//
// Altered degrees (`b6`, `b7`, `b3`) are supported because they are how the
// borrowed chords of House actually get written — the C major track in the
// library is I–IV–♭VI–♭VII.

import type { KeyMode } from './camelot';

/** Semitones above the tonic for degrees 1..7. */
const DEGREE_SEMITONES: Record<KeyMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

/** Triad quality of each diatonic degree, as a Strudel chord suffix. */
const DEGREE_QUALITY: Record<KeyMode, string[]> = {
  major: ['', 'm', 'm', '', '', 'm', 'dim'],
  minor: ['m', 'dim', '', 'm', 'm', '', ''],
};

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export interface Chord {
  /** The degree as typed, e.g. "b6". */
  degree: string;
  /** Chord symbol Strudel understands, e.g. "G#m", "Ab", "Bdim". */
  symbol: string;
  /** Pitch class of the root, C=0. */
  pc: number;
}

/** A degree token: an optional accidental then 1..7 (`6`, `b6`, `#4`). */
const DEGREE_RE = /^([b#]?)([1-7])$/;

/**
 * Resolve one degree against a key.
 *
 * The quality of an ALTERED degree is borrowed from the parallel mode when that
 * mode has the same degree naturally — which is exactly how ♭VI and ♭VII behave
 * in a major key (both major, borrowed from the parallel minor). When no such
 * match exists the triad is taken as major, the common default; the workshop
 * shows the result so an unwanted quality can simply be edited in the text.
 */
interface Resolved {
  degree: string;
  pc: number;
  /** Strudel chord suffix: '' (major), 'm', 'dim'. */
  quality: string;
}

function resolveDegree(token: string, mode: KeyMode, tonicPc: number): Resolved | string {
  const match = DEGREE_RE.exec(token.trim());
  if (!match) {
    return `degré invalide : « ${token} » (attendu 1 à 7, éventuellement précédé de b ou #)`;
  }
  const [, accidental, digits] = match;
  const index = Number(digits) - 1;
  const alteration = accidental === 'b' ? -1 : accidental === '#' ? 1 : 0;

  const semitones = DEGREE_SEMITONES[mode][index] + alteration;
  let quality = DEGREE_QUALITY[mode][index];
  if (alteration !== 0) {
    const parallel: KeyMode = mode === 'major' ? 'minor' : 'major';
    quality =
      DEGREE_SEMITONES[parallel][index] === semitones ? DEGREE_QUALITY[parallel][index] : '';
  }

  const pc = (((tonicPc + semitones) % 12) + 12) % 12;
  return { degree: token.trim(), pc, quality };
}

export interface ProgressionOptions {
  /** Pitch class of the tonic, C=0. */
  tonicPc: number;
  mode: KeyMode;
  /** Spell roots with sharps or flats. Enharmonics are equivalent for Strudel;
   *  this only changes what you read. */
  spelling?: 'sharp' | 'flat';
}

/**
 * Build the chords of a degree progression.
 * `degrees` accepts "6-1-3-7", "6 1 3 7" or "6,1,3,7".
 * Returns the chords, or a message naming the first bad token.
 */
export function buildProgression(
  degrees: string,
  { tonicPc, mode, spelling = 'sharp' }: ProgressionOptions,
): Chord[] | string {
  const tokens = degrees.split(/[\s,\-]+/).filter(Boolean);
  if (tokens.length === 0) return 'aucun degré';

  const names = spelling === 'flat' ? FLAT_NAMES : SHARP_NAMES;
  const chords: Chord[] = [];
  for (const token of tokens) {
    const resolved = resolveDegree(token, mode, tonicPc);
    if (typeof resolved === 'string') return resolved;
    chords.push({
      degree: resolved.degree,
      pc: resolved.pc,
      symbol: `${names[resolved.pc]}${resolved.quality}`,
    });
  }
  return chords;
}

/** Render chords as Strudel's alternation string: `<E G#m B F#>`. */
export function progressionPattern(chords: Chord[]): string {
  return `<${chords.map((c) => c.symbol).join(' ')}>`;
}
