// [SPEC-18.30.9] Mark an evaluation as SPECULATIVE, so its failures are not
// reported to the user.
//
// The workshop probes Strudel on purpose: `core/composer/chordProbe.ts` tries a
// chord symbol under several spellings and dictionaries to find one that works,
// and a spelling that fails is an expected, handled outcome. Strudel does not
// know that — it broadcasts every eval error on `strudel.log`, which the log
// capture [SPEC-17.57] then turns into a toast. Typing `1,3,5` in the chord field
// produced «[eval] error: Invalid argument» out of nowhere, and a set of four
// candidates produced seven such messages.
//
// A counter rather than a boolean: probes overlap (a fast typist starts one while
// another is in flight) and a boolean would be cleared by whichever finished first.
//
// Known limit: the flag spans an `await`, so a genuine error raised by an
// unrelated evaluation during that window would also be swallowed. The window is
// the duration of one `repl.evaluate`, and the alternative — a stream of spurious
// error toasts on every keystroke — costs far more trust than it saves.

let depth = 0;

/** True while a speculative evaluation is in flight. */
export function isEvalQuiet(): boolean {
  return depth > 0;
}

/** Run `fn` with eval errors treated as expected. Restores the count on throw. */
export async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  depth += 1;
  try {
    return await fn();
  } finally {
    depth -= 1;
  }
}
