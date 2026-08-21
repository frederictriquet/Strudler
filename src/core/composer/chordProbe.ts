// [SPEC-18.30] Ask Strudel whether a chord symbol is usable — and under which
// spelling.
//
// Detection names a set of notes; it does not say Strudel will play it. Measured
// on Strudel 1.2.6, one symbol hides four different answers:
//
//   - slash chords (`Gm/D`, `C/E`, `F6/D`) THROW «Invalid argument»;
//   - `.dict("triads")` yields NOTHING for anything that is not a plain triad
//     (`Dm7`, `G7`, `C6`, `Cadd9`) — a silent silence, since the pattern
//     evaluates fine and simply produces no event;
//   - several common names are unknown under the spelling tonal prefers, yet
//     accepted under another of their aliases: `Cmaj7` ✗ / `CM7` ✓, `Cdim` ✗ /
//     `Co` ✓, `Csus4` ✗ / `Csus` ✓, `Cdim7` ✗ / `Co7` ✓;
//   - and a dictionary can ACCEPT a symbol while voicing the wrong notes:
//     `Caug` under `dict("triads")` sounds Eb Ab C, not C E G#.
//
// So a spelling is kept only when Strudel voices the pitch classes that were
// pasted — exactly, or as a subset with no foreign note. The second case is real
// and must not be refused: Strudel voices `Dm7` as D F C, dropping the fifth, the
// way a pianist would. The dropped notes are NAMED instead, since a voicing that
// quietly loses a note is the kind of thing you discover on stage.
//
// Trying beats judging: a hard-coded table would go stale the day Strudel changes
// a dictionary, and the failure mode would again be silence [SPEC-14.3].

import { get as chordTypeOf } from '@tonaljs/chord-type';
import { engine } from '@core/engine/StrudelEngine';
import { midiToNoteName, noteNameToMidi, toMidi } from '@core/music/notes';
import type { Candidate } from '@core/music/chordDetect';

/** Which chord dictionary makes the symbol sound right. */
export type ChordDict = 'triads' | 'default';

export interface ChordSolution {
  /** Spelling Strudel accepts AND voices correctly. */
  symbol: string;
  dict: ChordDict;
  /** Notes `voicing()` produces, for the user to compare with theirs. */
  notes: string[];
  /** Bass to add as a pedal layer, when the inversion had to be dropped. */
  bass: string | null;
  /** True when `symbol` is not the name that was detected (alias substitution). */
  renamed: boolean;
  /** Pasted notes this voicing leaves out, e.g. `["A"]` for `Dm7`. Empty when
   *  the voicing sounds every note. */
  dropped: string[];
}

export type ChordVerdict = ChordSolution | { problem: string };

export function isSolved(v: ChordVerdict): v is ChordSolution {
  return 'symbol' in v;
}

/** Pitch-class set of note names — the identity a chord must reproduce. */
export function pitchClasses(notes: string[]): Set<number> {
  const set = new Set<number>();
  for (const name of notes) {
    const midi = noteNameToMidi(name);
    if (midi !== null) set.add(((midi % 12) + 12) % 12);
  }
  return set;
}

/** Pitch classes of `expected` that `got` does not sound. */
function missingFrom(expected: Set<number>, got: Set<number>): number[] {
  return [...expected].filter((pc) => !got.has(pc));
}

/** True when `got` introduces a pitch class that was not pasted — the signal that
 *  the dictionary voiced a DIFFERENT chord (`Caug` under `triads`). */
function hasForeign(expected: Set<number>, got: Set<number>): boolean {
  return [...got].some((pc) => !expected.has(pc));
}

/** Names of the pasted notes whose pitch class is in `pcs`, octave dropped. */
function namesOf(notes: string[], pcs: number[]): string[] {
  const wanted = new Set(pcs);
  const out: string[] = [];
  for (const name of notes) {
    const midi = noteNameToMidi(name);
    if (midi === null) continue;
    const pc = ((midi % 12) + 12) % 12;
    const bare = name.replace(/-?\d+$/, '');
    if (wanted.has(pc) && !out.includes(bare)) out.push(bare);
  }
  return out;
}

/** `Cmaj7` → root `C`, suffix `maj7`. The suffix is what tonal aliases. */
function splitRoot(symbol: string): { root: string; suffix: string } | null {
  const m = /^([A-G](?:#|b)*)(.*)$/.exec(symbol);
  return m ? { root: m[1], suffix: m[2] } : null;
}

/**
 * Every spelling worth trying for a symbol, the detected one first.
 *
 * The alternatives come from tonal's own alias list for the chord type, so this
 * follows the dictionary rather than a list I would have to maintain.
 */
export function spellings(symbol: string): string[] {
  const parts = splitRoot(symbol);
  if (!parts) return [symbol];
  const type = chordTypeOf(parts.suffix);
  if (type.empty) return [symbol];
  const others = type.aliases
    .map((alias) => parts.root + alias)
    .filter((candidate) => candidate !== symbol && WRITABLE_SYMBOL.test(candidate));
  return [symbol, ...others];
}

/**
 * Aliases worth evaluating at all.
 *
 * Measured: the typographic aliases (`C°`, `CΔ`, `Cø`) are not rejected by the
 * chord parser but by the MINI-NOTATION one — `°` is not a character it accepts —
 * so they can never work, and trying them only produces log noise. Every type has
 * an ASCII alias that does work (`Co`, `CM7`, `Ch`), so nothing is lost.
 */
const WRITABLE_SYMBOL = /^[A-Za-z0-9#b^+-]+$/;

function voicingCode(symbol: string, dict: ChordDict): string {
  const d = dict === 'triads' ? '.dict("triads")' : '';
  return `chord("${symbol}")${d}.anchor("c4").voicing()`;
}

/** Notes one attempt produces, or null when it throws / yields nothing. */
async function attempt(symbol: string, dict: ChordDict): Promise<string[] | null> {
  try {
    const events = await engine.queryEvents(voicingCode(symbol, dict), 1, { quiet: true });
    const notes = events
      .filter((e) => e.hasOnset)
      .map((e) => {
        const midi = toMidi(e.value.note);
        return midi === null ? String(e.value.note) : midiToNoteName(midi);
      });
    return notes.length > 0 ? [...new Set(notes)] : null;
  } catch {
    // The chord parser throws on slash chords. Not swallowed: the caller turns an
    // exhausted search into a stated `problem`. [SPEC-14.3]
    return null;
  }
}

/**
 * Find a spelling and a dictionary that sound the pasted notes.
 *
 * Order matters twice: `triads` before the default dictionary (tighter voicings,
 * what both library chord tracks use), and the detected spelling before its
 * aliases (it is the name a musician expects to read).
 *
 * A slash chord is retried on its base: the pitch classes are the same, only the
 * bass is lost — and a pedal layer is exactly how to put it back.
 */
export async function solveChord(
  candidate: Candidate,
  pasted: string[],
): Promise<ChordVerdict> {
  const expected = pitchClasses(pasted);
  const tries: Array<{ symbol: string; bass: string | null }> = [
    ...spellings(candidate.symbol).map((symbol) => ({ symbol, bass: null })),
  ];
  if (candidate.bass !== null) {
    tries.push(
      ...spellings(candidate.base).map((symbol) => ({ symbol, bass: candidate.bass })),
    );
  }

  // Two passes over the SAME order of attempts: a complete voicing always wins
  // over an incomplete one, whatever their spellings. Interleaving them would let
  // an alias with a dropped note beat the exact name.
  let partial: ChordSolution | null = null;
  for (const { symbol, bass } of tries) {
    // Slash chords THROW in the chord parser, every one of them, measured. The
    // base is retried below with the bass as a pedal layer, so skipping them
    // costs nothing and halves the evaluations.
    if (symbol.includes('/')) continue;
    for (const dict of ['triads', 'default'] as const) {
      const notes = await attempt(symbol, dict);
      if (!notes) continue;
      const got = pitchClasses(notes);
      if (hasForeign(expected, got)) continue; // a different chord, not this one
      const missing = missingFrom(expected, got);
      const solution: ChordSolution = {
        symbol,
        dict,
        notes,
        bass,
        renamed: symbol !== candidate.symbol,
        dropped: namesOf(pasted, missing),
      };
      if (missing.length === 0) return solution;
      partial ??= solution;
    }
  }
  if (partial) return partial;

  return {
    problem: candidate.bass
      ? `Strudel refuse « ${candidate.symbol} » et ne sait pas voicer « ${candidate.base} » non plus.`
      : `Aucun dictionnaire de Strudel ne sait jouer « ${candidate.symbol} », sous aucun de ses alias.`,
  };
}

/**
 * The snippet to insert.
 *
 * The bass is a plain `note(...)` layer rather than `rootNotes().note()`: that
 * construct wraps its values in a second `{note}` object, and `.add(note(n))` —
 * exactly what Strudler's key transposition does — then returns nothing at all.
 * [SPEC-17.48]
 */
export function chordSnippet(solution: ChordSolution): string {
  const d = solution.dict === 'triads' ? '.dict("triads")' : '';
  const voicing = `chord("${solution.symbol}")${d}.anchor("c4").voicing()`;
  if (!solution.bass) return voicing;
  return `stack(\n  ${voicing},\n  note("${solution.bass.toLowerCase()}3")\n)`;
}

/**
 * Which piano to audition with. [SPEC-18.30.11]
 *
 * `gm_piano` first: its presets sit on the local disk [SPEC-17.55], so the
 * audition works with no network at all. `piano` is the REPL sample bank, whose
 * audio still streams from the CDN [SPEC-17.54] — usable, but not the default
 * when a fully local instrument is right there. Falls back to it when the GM
 * import has not been run, rather than auditioning in silence.
 */
export function chordPreviewSound(): string {
  const registered = new Set(engine.registeredSounds());
  if (registered.has('gm_piano')) return 'gm_piano';
  return 'piano';
}

/**
 * The pattern to AUDITION a solution. [SPEC-18.30.11]
 *
 * Same voicing as the snippet, plus a sound: reading `D3 F3 A3` tells you the
 * notes, hearing the chord tells you whether it is the one you meant — and the
 * two candidate readings of a note set (`FM` and `Am#5` for F A C) differ by a
 * voicing no one can judge on paper.
 *
 * A piano rather than the pattern's own sound: a neutral, pitched reference. The
 * audition is a one-shot [SPEC-18.10], so the held voicing rings out once instead
 * of looping.
 */
export function chordPreviewCode(solution: ChordSolution, sound = chordPreviewSound()): string {
  return `(${chordSnippet(solution)}).s("${sound}")`;
}
