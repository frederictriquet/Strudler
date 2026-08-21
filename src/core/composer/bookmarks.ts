// [SPEC-18.20] Bookmarked sounds.
//
// The bank holds 1000+ sounds, of which a given set uses a handful. Marking those
// turns the browser from a directory into a palette.
//
// A mark is a `soundKey`: `hh` for the sound, `hh:4` for one of its variants
// [SPEC-18.29]. Storing the Strudel syntax itself means the set needs no encoding
// of its own, and an old file of bare names stays valid without migration.
//
// Kept out of the track file on purpose: a bookmark says something about the
// PERFORMER's habits, not about the loop, and would be noise in a `.track.yaml`
// [SPEC-4.6].
//
// Persisted through the app's own storage wrapper, which surfaces quota/denied
// errors instead of hiding them [SPEC-13, SPEC-14.3]. Reads never throw: a
// corrupted entry degrades to «no bookmarks», never to a broken browser.

import { loadJson, saveJson } from '@core/persist/storage';

const KEY = 'composer:soundBookmarks';

/** Read the saved set. Unknown/corrupted content yields an empty set. */
export function loadBookmarks(): Set<string> {
  const raw = loadJson<unknown>(KEY, null);
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((name): name is string => typeof name === 'string'));
}

/**
 * Persist the set. Throws on storage failure so the caller can SAY so — silently
 * losing a bookmark is the kind of small betrayal that erodes trust in the tool.
 */
export function saveBookmarks(names: ReadonlySet<string>): void {
  saveJson(KEY, [...names].sort());
}
