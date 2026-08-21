// [SPEC-13.5→13.9] Durability of the persisted state.
//
// Everything the user types lives in localStorage on ONE origin. Three unrelated
// accidents wipe it, and none of them is fixed by switching storage technology
// (IndexedDB obeys exactly the same clearing and eviction rules):
//
//   1. origin drift    — the app opened on `:5174` sees a blank localStorage;
//   2. clearing/eviction — "clear browsing data", or eviction under disk pressure
//      on an origin that never asked to be persistent;
//   3. an application bug overwriting a key, with no previous state kept.
//
// The answer is a copy OUTSIDE the browser: the dev/preview server writes the
// whole prefixed state to `<projet>/.state/` (see `vite-plugins/stateBackup.ts`),
// keeps dated snapshots, and hands it back when the browser turns up empty.
//
// This module is UI-free: it reports through a callback so `stores/backupStore.ts`
// can surface every failure as a toast [SPEC-14.3]. A backup failing in silence
// would be worse than no backup at all — it would advertise a protection that
// isn't there.

import { hasAnyState, restoreAll, setWriteHook, snapshotAll } from './storage';

const ENDPOINT = '/__state';
const DEBOUNCE_MS = 2000;

/** Bumped only if the envelope changes; `keys` carries raw text and never migrates. */
export const BUNDLE_FORMAT = 1;

/** Well-known key holding the authorized library folder's name. Duplicated as a
 *  literal (rather than imported from `core/composer`) to keep the performance
 *  page free of workshop code; it is only a human-readable hint in the file. */
const FOLDER_NAME_KEY = 'composer:libraryFolderName';

export interface StateBundle {
  format: number;
  savedAt: string;
  /** Informative only — NEVER a condition. Restoring a `:5173` bundle onto
   *  `:5174` is precisely what rescues the origin-drift case. */
  origin: string;
  /** Name of the library folder to re-authorize after a restore, or null. */
  libraryFolder: string | null;
  keys: Record<string, string>;
}

export interface SnapshotInfo {
  name: string;
  savedAt: string | null;
  bytes: number;
}

export interface BackupIndex {
  current: { savedAt: string | null; bytes: number } | null;
  snapshots: SnapshotInfo[];
}

export type BackupEvent =
  | { kind: 'saved'; savedAt: string; bytes: number }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

export type RestoreOutcome =
  | { kind: 'kept' } // this browser already holds state — nothing to rescue
  | { kind: 'none' } // mirror reachable, but no backup yet
  | { kind: 'unavailable' } // no dev/preview server behind this page
  | { kind: 'restored'; savedAt: string; count: number; libraryFolder: string | null }
  | { kind: 'error'; message: string };

// --- Bundle ---------------------------------------------------------------------

/** Read the CURRENT localStorage (never an in-memory view) and wrap it.
 *
 *  Reading afresh matters: the instrument and the workshop are two documents on
 *  one origin, so whichever page saves must write the complete picture rather
 *  than its own partial state. */
export function buildBundle(): StateBundle {
  const keys = snapshotAll();
  let folder: string | null = null;
  const rawFolder = keys[FOLDER_NAME_KEY];
  if (rawFolder) {
    try {
      const parsed: unknown = JSON.parse(rawFolder);
      if (typeof parsed === 'string') folder = parsed;
    } catch {
      folder = null; // a hint that won't parse is simply absent
    }
  }
  return {
    format: BUNDLE_FORMAT,
    savedAt: new Date().toISOString(),
    origin: typeof location !== 'undefined' ? location.origin : '',
    libraryFolder: folder,
    keys,
  };
}

/** Validate an untrusted bundle (imported file, hand-edited backup). Throws. */
export function parseBundle(text: string): StateBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Fichier illisible (JSON invalide) : ${(err as Error).message}`, { cause: err });
  }
  if (!raw || typeof raw !== 'object') throw new Error('Fichier de sauvegarde vide ou invalide.');
  const b = raw as Partial<StateBundle>;
  if (!b.keys || typeof b.keys !== 'object' || Array.isArray(b.keys)) {
    throw new Error("Ce fichier ne contient pas de bloc « keys » — ce n'est pas une sauvegarde Strudler.");
  }
  const entries = Object.entries(b.keys).filter(([, v]) => typeof v === 'string');
  if (entries.length === 0) throw new Error('Sauvegarde vide : aucune donnée à restaurer.');
  return {
    format: typeof b.format === 'number' ? b.format : 0,
    savedAt: typeof b.savedAt === 'string' ? b.savedAt : '',
    origin: typeof b.origin === 'string' ? b.origin : '',
    libraryFolder: typeof b.libraryFolder === 'string' ? b.libraryFolder : null,
    keys: Object.fromEntries(entries) as Record<string, string>,
  };
}

// --- Transport ------------------------------------------------------------------

/** A static build has no `/__state` routes; a SPA fallback answers with HTML.
 *  Anything that is not JSON therefore means "no mirror behind this page". */
async function readJson<T>(res: Response): Promise<T> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new Error('MIRROR_ABSENT');
  return (await res.json()) as T;
}

let mirrorAvailable = true;

/** True until a request proves the dev/preview server isn't behind this page. */
export function isMirrorAvailable(): boolean {
  return mirrorAvailable;
}

export async function fetchIndex(): Promise<BackupIndex> {
  const res = await fetch(`${ENDPOINT}/index`, { cache: 'no-store' });
  if (!res.ok) throw new Error('MIRROR_ABSENT');
  return readJson<BackupIndex>(res);
}

export async function fetchCurrent(): Promise<StateBundle | null> {
  const res = await fetch(`${ENDPOINT}/current`, { cache: 'no-store' });
  if (res.status === 404) {
    // Two very different situations answer 404: "the mirror is running but has no
    // copy yet", and "there is no mirror at all". Telling the user the wrong one
    // would either hide a missing protection or invent a loss. The mirror answers
    // 404 as JSON on purpose (`sendJson` in `vite-plugins/stateBackup.ts`); a
    // static server answers with HTML or plain text.
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) throw new Error('MIRROR_ABSENT');
    return null;
  }
  if (!res.ok) throw new Error('MIRROR_ABSENT');
  return readJson<StateBundle>(res);
}

export async function fetchSnapshot(name: string): Promise<StateBundle> {
  const res = await fetch(`${ENDPOINT}/snapshot/${encodeURIComponent(name)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Instantané « ${name} » introuvable (${res.status}).`);
  return readJson<StateBundle>(res);
}

/** Send the current state to disk. Resolves with the bundle's size in bytes. */
export async function sendBundle(): Promise<{ savedAt: string; bytes: number }> {
  const bundle = buildBundle();
  const body = JSON.stringify(bundle, null, 2);
  const res = await fetch(`${ENDPOINT}/current`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (res.status === 404 || res.status === 405) throw new Error('MIRROR_ABSENT');
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Le serveur a refusé la sauvegarde (${res.status}) ${detail}`.trim());
  }
  return { savedAt: bundle.savedAt, bytes: body.length };
}

// --- Automatic mirroring --------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
let report: (ev: BackupEvent) => void = () => {};
let inFlight = false;
let again = false;

async function flush(): Promise<void> {
  if (!mirrorAvailable) return;
  if (inFlight) {
    again = true; // a write landed mid-request: mirror once more when it returns
    return;
  }
  inFlight = true;
  try {
    const { savedAt, bytes } = await sendBundle();
    report({ kind: 'saved', savedAt, bytes });
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'MIRROR_ABSENT') {
      // Stop hammering a server that has no such route (static build).
      mirrorAvailable = false;
      setWriteHook(null);
      report({ kind: 'unavailable' });
    } else {
      report({ kind: 'error', message });
    }
  } finally {
    inFlight = false;
    if (again) {
      again = false;
      void flush();
    }
  }
}

/**
 * Mirror every write to disk, from now on.
 *
 * Hooked into the storage layer rather than called by each writer: a single
 * choke point covers all present AND future keys, so nothing can be forgotten.
 */
export function startAutoBackup(reporter: (ev: BackupEvent) => void): void {
  report = reporter;
  setWriteHook(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, DEBOUNCE_MS);
  });
}

/** Force a mirror now (used after an explicit restore/import). */
export async function backupNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await flush();
}

// --- Restore --------------------------------------------------------------------

let lastRestore: RestoreOutcome | null = null;

/**
 * Rescue a blank browser from the disk copy. Called from the entry points BEFORE
 * the root component is imported: `stores/rackStore.ts` reads its keys at module
 * evaluation time, so restoring any later would have no effect.
 *
 * Never throws — it runs before anything can display an error, so the outcome is
 * parked in `takeRestoreOutcome()` for the store to surface once mounted.
 */
export async function restoreFromDiskIfEmpty(): Promise<RestoreOutcome> {
  const outcome = await computeRestore();
  lastRestore = outcome;
  return outcome;
}

async function computeRestore(): Promise<RestoreOutcome> {
  // A browser holding ANY state is authoritative: never overwrite live data.
  if (hasAnyState()) return { kind: 'kept' };
  try {
    const bundle = await fetchCurrent();
    if (!bundle) return { kind: 'none' };
    const count = restoreAll(bundle.keys);
    if (count === 0) return { kind: 'none' };
    return {
      kind: 'restored',
      savedAt: typeof bundle.savedAt === 'string' ? bundle.savedAt : '',
      count,
      libraryFolder: typeof bundle.libraryFolder === 'string' ? bundle.libraryFolder : null,
    };
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'MIRROR_ABSENT' || err instanceof TypeError) return { kind: 'unavailable' };
    return { kind: 'error', message };
  }
}

/** Read (once) what `restoreFromDiskIfEmpty()` did, so the UI can announce it. */
export function takeRestoreOutcome(): RestoreOutcome | null {
  const out = lastRestore;
  lastRestore = null;
  return out;
}

/** Overwrite the browser state with a bundle, then mirror it. Throws on failure. */
export async function applyBundle(bundle: StateBundle): Promise<number> {
  const count = restoreAll(bundle.keys);
  await backupNow().catch(() => undefined); // the local write already succeeded
  return count;
}

// --- Manual export / import -----------------------------------------------------

/** Pretty-printed bundle, for the "export everything" button. */
export function exportBundleText(): string {
  return JSON.stringify(buildBundle(), null, 2);
}

/** Suggested filename: `strudler-backup-2026-08-19.json`. */
export function exportFileName(): string {
  return `strudler-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

// --- Eviction ------------------------------------------------------------------

/**
 * Ask the browser to mark this origin persistent, which exempts it from
 * eviction under disk pressure. Returns null when unsupported.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch (err) {
    console.warn('[backup] storage.persist() a échoué:', err);
    return null;
  }
}
