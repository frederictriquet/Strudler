// [SPEC-18.30] A pasted set of notes → the chord symbol that names it.
//
// The workshop can turn degrees into symbols already, but the reverse is what a
// real session needs: a riff copied from a video reads `[d3,a3,f4]`, and those
// absolute notes are a dead end — they cannot be transposed and `voicing()`
// cannot re-inflect them [SPEC-17.48]. Naming the set is the step that turns it
// back into music you can move.
//
// Note names are read in both alphabets — `d3,a3,f4` and `ré3,la3,fa4` — because
// that is what a French-speaking musician has in front of them; the output is
// always the English spelling, which is the only one `chord()` takes.
//
// Detection is delegated to tonal (`@tonaljs/chord-detect`), the same family
// Strudel's own chord support is built on. Whether Strudel ACCEPTS the resulting
// symbol is a separate question, answered by asking Strudel itself — see
// `core/composer/chordProbe.ts`. Guessing here would be how a name that looks
// right ends up silent.

import { detect } from '@tonaljs/chord-detect';
import { get as chordTypeOf } from '@tonaljs/chord-type';
import { frenchNoteName } from './camelot';
import { noteNameFor, scaleStepSemitones } from './chords';
import { noteNameToMidi } from './notes';
import type { KeyMode } from './camelot';

/** A note token: letter, optional accidentals, optional octave. `bb3`, `G#`, `f4`. */
const NOTE_RE = /^([A-Ga-g])((?:#|b|s)*)(-?\d+)?$/;

/**
 * French note names. [SPEC-18.30.5]
 *
 * They cannot collide with the English spelling above: not one of `do ré re mi
 * fa sol la si` parses as an English note (`f` is a letter but `fa` is not a
 * letter followed by an accidental), so the two alphabets can be mixed in a
 * single paste and the order in which they are tried does not matter.
 *
 * `ré` is accepted with or without its accent, and the input is normalised to NFC
 * first: a name copied from the web can arrive decomposed (`e` + combining
 * acute), which no naive comparison would match.
 */
const FRENCH_NAMES: Record<string, string> = {
  do: 'C',
  ré: 'D',
  re: 'D',
  mi: 'E',
  fa: 'F',
  sol: 'G',
  la: 'A',
  si: 'B',
};

// `sol` before `si` is not needed (they do not share a prefix) but longest-first
// keeps the alternation readable and safe if a name is ever added.
const FRENCH_RE = /^(sol|do|ré|re|mi|fa|la|si)((?:#|♯|s|b|♭|f)*)(-?\d+)?$/i;

/** Accidentals as written → what tonal expects (`#` / `b`). */
function normaliseAccidentals(raw: string): string {
  return raw
    .replace(/[s♯]/gi, '#')
    .replace(/[f♭]/gi, 'b')
    .replace(/B/g, 'b'); // an uppercase flat, e.g. `SIB`
}

/**
 * One token → an English note name tonal understands, or null.
 *
 * The result is ALWAYS the English spelling: that is what `chord()` and `note()`
 * take. A French name is an input convenience and never travels into the pattern.
 */
function readNote(token: string, dialect: Dialect): string | null {
  if (dialect === 'letters') {
    const m = NOTE_RE.exec(token);
    if (!m) return null;
    const [, letter, accidentals, octave] = m;
    return `${letter.toUpperCase()}${normaliseAccidentals(accidentals)}${octave ?? ''}`;
  }
  const m = FRENCH_RE.exec(token);
  if (!m) return null;
  const [, name, accidentals, octave] = m;
  const letter = FRENCH_NAMES[name.toLowerCase()];
  return letter === undefined
    ? null
    : `${letter}${normaliseAccidentals(accidentals)}${octave ?? ''}`;
}

export interface Candidate {
  /** Symbol as detected, e.g. `Gm/D`. */
  symbol: string;
  /** The symbol without its bass, e.g. `Gm`. Equal to `symbol` when there is none. */
  base: string;
  /** Bass note of a slash chord, e.g. `D`, or null. */
  bass: string | null;
}

/**
 * Which alphabet a field expects. [SPEC-18.30.5]
 *
 * The two are strictly separated in the UI, one input each, so the notation on
 * offer is visible rather than guessed at. Parsing stays strict per field — but a
 * name belonging to the OTHER alphabet is recognised as such and the user is sent
 * to the right field, instead of being told their note does not exist.
 */
export type Dialect = 'letters' | 'french';

const DIALECT_HINT: Record<Dialect, string> = {
  letters: 'd3, a3, f4, bb3, g#2…',
  french: 'ré3, la3, fa4, sib3, do#2…',
};

const OTHER_FIELD: Record<Dialect, string> = {
  letters: 'le champ DO RÉ MI',
  french: 'le champ A B C',
};

/**
 * Read a pasted list of notes. Accepts what people actually paste: Strudel's own
 * `[d3,a3,f4]`, bare `d3 a3 f4`, `D3, A3, F4`, `note("…")` and all.
 *
 * Returns the notes in the order given (the lowest first matters: it decides the
 * bass, hence whether tonal names an inversion) or a message saying what is wrong.
 */
export function parseNotes(text: string, dialect: Dialect = 'letters'): string[] | string {
  // Strip the wrapping people paste along with the notes.
  const inner = text
    .normalize('NFC') // `ré` copied from the web can arrive decomposed
    .replace(/^\s*(?:note|n)\s*\(\s*"?/i, '')
    .replace(/"?\s*\)\s*$/, '')
    .replace(/[[\]"']/g, ' ');
  const tokens = inner.split(/[\s,;]+/).filter((t) => t !== '');
  if (tokens.length === 0) return `colle des notes, par exemple ${DIALECT_HINT[dialect]}`;

  const notes: string[] = [];
  for (const token of tokens) {
    const note = readNote(token, dialect);
    if (note === null) {
      const other: Dialect = dialect === 'letters' ? 'french' : 'letters';
      if (readNote(token, other) !== null) {
        return `« ${token} » est une note dans l’autre notation — utilise ${OTHER_FIELD[dialect]}.`;
      }
      return `« ${token} » n’est pas une note (attendu : ${DIALECT_HINT[dialect]})`;
    }
    notes.push(note);
  }
  if (notes.length < 3) {
    return `${notes.length} note(s) : il en faut au moins 3 pour nommer un accord`;
  }
  return notes;
}

/** Split `Gm/D` into its parts. A symbol without a slash keeps `bass: null`. */
export function splitSlash(symbol: string): Candidate {
  const slash = symbol.indexOf('/');
  if (slash === -1) return { symbol, base: symbol, bass: null };
  return {
    symbol,
    base: symbol.slice(0, slash),
    bass: symbol.slice(slash + 1),
  };
}

/**
 * Candidate names for a note set, best first (tonal's own ranking: the reading
 * whose root is the lowest note comes first).
 *
 * An empty result is a real answer, not a failure: `[c, d, e]` is not a chord in
 * any dictionary, and saying so is more useful than inventing a name.
 */
export function detectCandidates(notes: string[]): Candidate[] {
  return detect(notes).map(splitSlash);
}

/** Note names without octave, in the order given — what the UI echoes back. */
export function pitchNames(notes: string[]): string[] {
  return notes.map((n) => n.replace(/-?\d+$/, ''));
}

// --- Degrés dans une gamme -----------------------------------------------------

export interface ScaleContext {
  /** Pitch class of the tonic, C = 0. */
  tonicPc: number;
  mode: KeyMode;
  /** Spelling of the notes shown back; enharmonics are the same for Strudel. */
  spelling?: 'sharp' | 'flat';
}

/** A step token: optional accidental then 1..14 (`3`, `b3`, `#4`, `10`). */
const STEP_RE = /^([b#♭♯]?)(\d{1,2})$/;

/** Octave the first step lands in. Low enough that a `1 5 10` spread stays on the
 *  keyboard, high enough that a bass line below it still has room. */
const BASE_OCTAVE = 3;

/**
 * Read scale steps into notes. [SPEC-18.30.6]
 *
 * The third way musicians actually think: «the 1, the 3 and the 5 of D minor».
 * Steps RISE, so `1 5 10` spells the wide voicing of the original riff (D3 A3 F4)
 * rather than piling three notes into one octave — a chord's identity survives
 * either way, but what you hear back does not.
 *
 * Steps beyond 7 continue into the next octave (8 = tonic an octave up); `b3` and
 * `#4` alter a step, because that is how borrowed notes get written.
 */
export function parseDegrees(text: string, scale: ScaleContext): string[] | string {
  const tokens = text
    .replace(/[[\]"']/g, ' ')
    .split(/[\s,;\-]+/)
    .filter((t) => t !== '');
  if (tokens.length === 0) return 'entre des degrés, par exemple 1,3,5';

  const notes: string[] = [];
  let previous = -Infinity;
  for (const token of tokens) {
    const m = STEP_RE.exec(token.normalize('NFC'));
    if (!m) return `« ${token} » n’est pas un degré (attendu 1 à 14, éventuellement b ou #)`;
    const [, accidental, digits] = m;
    const step = Number(digits);
    const semitones = scaleStepSemitones(step, scale.mode);
    if (semitones === null) return `degré ${step} hors gamme (1 à 14)`;
    const alteration = accidental === 'b' || accidental === '♭' ? -1 : accidental === '' ? 0 : 1;

    const midi = 12 * (BASE_OCTAVE + 1) + scale.tonicPc + semitones + alteration;
    // Steps are written in ascending order; a lower one would silently become the
    // bass and change the chord tonal names. Say so instead.
    if (midi < previous) {
      return `« ${token} » descend sous le degré précédent : écris les degrés en montant`;
    }
    previous = midi;
    const pc = ((midi % 12) + 12) % 12;
    notes.push(`${noteNameFor(pc, scale.spelling)}${Math.floor(midi / 12) - 1}`);
  }
  if (notes.length < 3) {
    return `${notes.length} degré(s) : il en faut au moins 3 pour nommer un accord`;
  }
  return notes;
}

// --- Écriture : l'inverse de la lecture ----------------------------------------
//
// Les trois champs montrent la MÊME saisie, chacun dans son écriture. Retaper
// `ré3,la3,fa4` après avoir tapé `d3,a3,f4` n'apprend rien à personne ; voir la
// traduction apparaître, si.

/** English letter → French name. Built from the reading table so the two can
 *  never disagree. */
const TO_FRENCH: Record<string, string> = Object.fromEntries(
  Object.entries(FRENCH_NAMES)
    .filter(([name]) => name !== 're') // `ré` is the spelling shown
    .map(([name, letter]) => [letter, name]),
);

/** Render notes in a dialect. Input is the English spelling `parseNotes` returns. */
export function writeNotes(notes: string[], dialect: Dialect): string {
  if (dialect === 'letters') return notes.map((n) => n.toLowerCase()).join(',');
  return notes
    .map((note) => {
      const m = /^([A-G])([#b]*)(-?\d+)?$/.exec(note);
      if (!m) return note.toLowerCase();
      const [, letter, accidentals, octave] = m;
      return `${TO_FRENCH[letter] ?? letter.toLowerCase()}${accidentals}${octave ?? ''}`;
    })
    .join(',');
}

/**
 * Notes → scale steps, the inverse of `parseDegrees`. [SPEC-18.30.7]
 *
 * A note off the scale is written as an ALTERED step (`#3` for the F# of a D
 * major chord in D minor), which is how borrowed notes get written and is worth
 * reading. Returns null only when no step comes within a semitone, or when the
 * note falls below the tonic or beyond two octaves: the field would then be a
 * lie, and an empty degree field next to two filled note fields is itself the
 * information.
 */
export function writeDegrees(notes: string[], scale: ScaleContext): string | null {
  const steps: string[] = [];
  for (const note of notes) {
    const midi = noteNameToMidi(note);
    if (midi === null) return null;
    // Distance above the tonic placed at BASE_OCTAVE, so `1` is the lowest step.
    const semitones = midi - (12 * (BASE_OCTAVE + 1) + scale.tonicPc);
    if (semitones < 0 || semitones > 24) return null; // out of the two-octave span
    const step = stepOf(semitones, scale.mode, scale.spelling ?? 'sharp');
    if (step === null) return null;
    steps.push(step);
  }
  return steps.join(',');
}

/**
 * Semitones above the tonic → step label (`5`, `b3`, `10`), or null when no step
 * comes within a semitone.
 *
 * A chromatic note sits between two steps and can be read either way — the
 * semitone above the tonic is `#1` or `b2`, both true. Which one is shown follows
 * the ♯/♭ toggle the user already set for the progression, rather than an
 * arbitrary preference: enharmonics are the same note for Strudel, so this only
 * changes what is read.
 */
function stepOf(
  semitones: number,
  mode: KeyMode,
  spelling: 'sharp' | 'flat',
): string | null {
  // A plain step always wins over any alteration.
  for (let step = 1; step <= 14; step += 1) {
    if (scaleStepSemitones(step, mode) === semitones) return String(step);
  }
  const order = spelling === 'flat' ? [-1, 1] : [1, -1];
  for (const delta of order) {
    for (let step = 1; step <= 14; step += 1) {
      const base = scaleStepSemitones(step, mode);
      if (base !== null && base + delta === semitones) {
        return `${delta === -1 ? 'b' : '#'}${step}`;
      }
    }
  }
  return null;
}

// --- Nom français d'un accord --------------------------------------------------
//
// Le symbole que Strudel accepte est anglais (`Dm`, `CM7`, `Co`) et doit rester
// tel quel dans le pattern. Mais lire « RÉ mineur » à côté dit immédiatement de
// quel accord il s'agit, ce que `Dm` ne fait pas pour tout le monde.

/**
 * Chord type (tonal's canonical NAME, alias-independent) → French wording.
 *
 * Keyed on the type name rather than on the suffix so every alias of the same
 * chord collapses to one entry: `maj7`, `M7`, `Δ` and `^7` all resolve to
 * "major seventh".
 */
const FRENCH_QUALITY: Record<string, string> = {
  major: 'majeur',
  minor: 'mineur',
  diminished: 'diminué',
  augmented: 'augmenté',
  'major seventh': 'majeur 7',
  'dominant seventh': '7',
  'minor seventh': 'mineur 7',
  'half-diminished': 'demi-diminué',
  'diminished seventh': 'diminué 7',
  sixth: 'sixte',
  'minor sixth': 'mineur sixte',
  'suspended fourth': 'sus4',
  'suspended second': 'sus2',
  'dominant ninth': '9',
  'major ninth': 'majeur 9',
  'minor ninth': 'mineur 9',
  eleventh: '11',
  'dominant thirteenth': '13',
  'sixth added ninth': 'sixte ajoutée 9',
  'minor augmented': 'mineur augmenté',
  'minor/major seventh': 'mineur majeur 7',
  altered: 'altéré',
};

/**
 * French reading of a chord symbol: `Dm` → «RÉ mineur», `Bb` → «SI♭ majeur»,
 * `CM7` → «DO majeur 7». [SPEC-18.30.8]
 *
 * An unknown or untranslated quality keeps its suffix verbatim (`Em#5` → «MI #5»)
 * rather than being guessed at: a half-translated label is honest, an invented one
 * is not.
 */
export function frenchChordName(symbol: string): string {
  const m = /^([A-G](?:#|b)*)(.*)$/.exec(symbol);
  if (!m) return symbol;
  const [, root, suffix] = m;
  const type = chordTypeOf(suffix);
  const quality =
    (type.empty ? undefined : FRENCH_QUALITY[type.name]) ??
    (suffix === '' ? 'majeur' : suffix);
  return `${frenchNoteName(root)} ${quality}`.trim();
}
