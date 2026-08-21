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
  fireWriteHook();
}

export function removeKey(key: string): void {
  if (!available()) return;
  localStorage.removeItem(PREFIX + key);
  fireWriteHook(); // a deletion is a state change too, and must reach the mirror
}

// --- Durability support [SPEC-13.5] ---------------------------------------------
//
// Everything below exists so the whole persisted state can be copied OUT of the
// browser. localStorage is bound to one origin and one profile: clearing site
// data, storage eviction, a port change (`:5174`) or a lost profile all wipe it.
// A copy on disk is the only real answer — see `backup.ts`.
//
// The sweep is deliberately GENERIC: it enumerates whatever carries the prefix
// instead of naming keys. A key added later (a new setting, a new kind of
// bookmark) is therefore backed up without anyone remembering to register it,
// which is the one property that makes "no data can be lost" hold over time.
//
// Values are copied as RAW TEXT, never re-parsed or re-serialised. The backup
// understands nothing about what it carries, so a schema change in `rack` or
// `settings` cannot break it, and no migration of its own is ever needed.

let writeHook: (() => void) | null = null;
let hookMuted = false;

/** Install (or clear) the callback fired after every successful write. */
export function setWriteHook(fn: (() => void) | null): void {
  writeHook = fn;
}

function fireWriteHook(): void {
  if (hookMuted || !writeHook) return;
  try {
    writeHook();
  } catch (err) {
    // Last-resort guard: a failing mirror must never break the local write that
    // just succeeded. The hook itself reports its own failures in the UI.
    console.warn('[persist] crochet de sauvegarde en échec:', err);
  }
}

/** Every prefixed entry, keyed WITHOUT the prefix, values as stored (raw JSON text). */
export function snapshotAll(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!available()) return out;
  for (let i = 0; i < localStorage.length; i += 1) {
    const full = localStorage.key(i);
    if (!full || !full.startsWith(PREFIX)) continue;
    const raw = localStorage.getItem(full);
    if (raw !== null) out[full.slice(PREFIX.length)] = raw;
  }
  return out;
}

/**
 * Write back a set produced by `snapshotAll()`. Returns how many entries landed.
 * The write hook is muted throughout, so restoring cannot bounce straight back
 * to disk. Throws on quota so the caller can say so.
 */
export function restoreAll(keys: Record<string, string>): number {
  if (!available()) return 0;
  let count = 0;
  hookMuted = true;
  try {
    for (const [key, raw] of Object.entries(keys)) {
      if (typeof raw !== 'string') continue; // hostile/corrupted bundle: skip, don't throw
      localStorage.setItem(PREFIX + key, raw);
      count += 1;
    }
  } finally {
    hookMuted = false;
  }
  return count;
}

/** True as soon as ONE prefixed entry exists — i.e. "this browser is not blank". */
export function hasAnyState(): boolean {
  if (!available()) return false;
  for (let i = 0; i < localStorage.length; i += 1) {
    const full = localStorage.key(i);
    if (full && full.startsWith(PREFIX)) return true;
  }
  return false;
}
