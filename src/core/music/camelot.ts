// [SPEC-17.14] Camelot wheel — musical key reference for harmonic mixing.
// Each Camelot code (1A..12A minor, 1B..12B major) maps to a root note and a
// pitch class (C=0..B=11). Kept as a small, pure data table so the key selector
// and any later feature (transposing loops to match the mix) share one source.

export type KeyMode = 'minor' | 'major';

export interface CamelotKey {
  /** Camelot code, e.g. "8A" (A minor) or "8B" (C major). */
  code: string;
  /** Root note spelling, e.g. "A", "C#", "Ab". */
  root: string;
  mode: KeyMode;
  /** Pitch class of the root, C=0 … B=11. For later transposition use. */
  pc: number;
}

// Minor keys (A side of the wheel), Camelot 1A..12A.
const MINOR: Array<[string, string, number]> = [
  ['1A', 'Ab', 8],
  ['2A', 'Eb', 3],
  ['3A', 'Bb', 10],
  ['4A', 'F', 5],
  ['5A', 'C', 0],
  ['6A', 'G', 7],
  ['7A', 'D', 2],
  ['8A', 'A', 9],
  ['9A', 'E', 4],
  ['10A', 'B', 11],
  ['11A', 'F#', 6],
  ['12A', 'Db', 1], // Db minor — Camelot convention (enharmonic C# minor)
];

// Major keys (B side of the wheel), Camelot 1B..12B.
const MAJOR: Array<[string, string, number]> = [
  ['1B', 'B', 11],
  ['2B', 'F#', 6],
  ['3B', 'Db', 1],
  ['4B', 'Ab', 8],
  ['5B', 'Eb', 3],
  ['6B', 'Bb', 10],
  ['7B', 'F', 5],
  ['8B', 'C', 0],
  ['9B', 'G', 7],
  ['10B', 'D', 2],
  ['11B', 'A', 9],
  ['12B', 'E', 4],
];

export const CAMELOT_MINOR: CamelotKey[] = MINOR.map(([code, root, pc]) => ({
  code,
  root,
  mode: 'minor',
  pc,
}));

export const CAMELOT_MAJOR: CamelotKey[] = MAJOR.map(([code, root, pc]) => ({
  code,
  root,
  mode: 'major',
  pc,
}));

export const CAMELOT_KEYS: CamelotKey[] = [...CAMELOT_MINOR, ...CAMELOT_MAJOR];

// Wheel order interleaving minor/major by number: 1A, 1B, 2A, 2B, … 12A, 12B.
// Neighbours on this list are harmonically related, which suits the selector.
export const CAMELOT_WHEEL: CamelotKey[] = CAMELOT_MINOR.flatMap((m, i) => [m, CAMELOT_MAJOR[i]]);

/** Default key selected automatically (A minor — the Camelot reference "8A"). */
export const DEFAULT_CAMELOT = '8A';

const BY_CODE = new Map(CAMELOT_KEYS.map((k) => [k.code, k]));

export function keyByCode(code: string | null): CamelotKey | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

/** Pitch class (0-11) of the key's MINOR tonic: the root for a minor code, the
 *  relative minor for a major code (major root − 3 semitones ≡ +9). Used for
 *  Camelot-compatible transposition. [SPEC-17.19] */
export function minorPcOf(code: string | null): number | null {
  const k = keyByCode(code);
  if (!k) return null;
  return k.mode === 'minor' ? k.pc : (k.pc + 9) % 12;
}

/** Semitone offset (−5..+6) to transpose a loop written in `fromCode` so its key
 *  center matches `toCode` (both reduced to their minor tonic). [SPEC-17.19] */
export function transposeSemitones(fromCode: string | null, toCode: string | null): number {
  const from = minorPcOf(fromCode);
  const to = minorPcOf(toCode);
  if (from === null || to === null) return 0;
  let off = (to - from + 12) % 12; // 0..11
  if (off > 6) off -= 12; // nearest direction
  return off;
}

/** Short note label, e.g. "Am" (minor) or "C" (major). */
export function shortNote(k: CamelotKey): string {
  return k.mode === 'minor' ? `${k.root}m` : k.root;
}

/** Long note label, e.g. "A mineur" / "C majeur". */
export function longNote(k: CamelotKey): string {
  return `${k.root} ${k.mode === 'minor' ? 'mineur' : 'majeur'}`;
}

// French solfège note names (do, ré, mi…), with the accidental as a symbol.
const SOLFEGE: Record<string, string> = {
  C: 'DO',
  D: 'RÉ',
  E: 'MI',
  F: 'FA',
  G: 'SOL',
  A: 'LA',
  B: 'SI',
};

/** French root, e.g. "la♭", "do♯", "fa". */
export function frenchRoot(k: CamelotKey): string {
  const base = SOLFEGE[k.root[0]] ?? k.root[0];
  const acc = k.root.slice(1);
  const symbol = acc === '#' ? '♯' : acc === 'b' ? '♭' : '';
  return base + symbol;
}

/** Short French note label, e.g. "lam" (minor) or "do" (major). */
export function shortNoteFr(k: CamelotKey): string {
  return k.mode === 'minor' ? `${frenchRoot(k)}m` : frenchRoot(k);
}

/** Long French note label, e.g. "la mineur" / "do majeur". */
export function longNoteFr(k: CamelotKey): string {
  return `${frenchRoot(k)} ${k.mode === 'minor' ? 'mineur' : 'majeur'}`;
}
