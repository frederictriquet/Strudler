// [SPEC-13, PLAN A] Small, safe localStorage wrapper. Storage can be unavailable
// or throw (private mode, quota); those errors are returned/thrown to the caller
// so they can be surfaced, never silently swallowed ([SPEC-14.3]).

const PREFIX = 'strudler:';

function available(): boolean {
  return typeof localStorage !== 'undefined';
}

/** Load and parse a JSON value, or return the fallback if absent/unreadable. */
export function loadJson<T>(key: string, fallback: T): T {
  if (!available()) return fallback;
  const raw = localStorage.getItem(PREFIX + key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    // Corrupted entry: report, keep the fallback, don't crash the app.
    console.warn(`[persist] entrée « ${key} » illisible, ignorée:`, err);
    return fallback;
  }
}

/** Persist a JSON value. Throws on failure (quota/denied) so callers can surface it. */
export function saveJson(key: string, value: unknown): void {
  if (!available()) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (err) {
    throw new Error(`Échec de sauvegarde « ${key} »: ${(err as Error).message}`, { cause: err });
  }
}

export function removeKey(key: string): void {
  if (!available()) return;
  localStorage.removeItem(PREFIX + key);
}
