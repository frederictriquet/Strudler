// [SPEC-18.15] Write a track straight into the `library/` folder on disk.
//
// The folder is authorized ONCE through the File System Access API; the handle is
// kept in IndexedDB so a page reload does not ask again (handles are
// structured-cloneable, unlike paths, which the browser never exposes).
// Chrome/Edge only — the same requirement the instrument already has for Web MIDI
// and WebHID [SPEC-14.1]. Everything here reports failures rather than swallowing
// them [SPEC-14.3]; the caller decides what to show.

import { saveJson } from '@core/persist/storage';

const DB_NAME = 'strudler-composer';
const STORE = 'handles';
const KEY = 'libraryFolder';

/** [SPEC-13.5] The handle itself cannot leave IndexedDB, but its NAME can. Kept in
 *  localStorage so the state backup carries it: after restoring on another
 *  machine or profile, the UI can say which folder to re-authorize instead of
 *  letting the user discover it when a save fails. */
export const FOLDER_NAME_KEY = 'composer:libraryFolderName';

function rememberName(name: string): void {
  try {
    saveJson(FOLDER_NAME_KEY, name);
  } catch (err) {
    // A hint that could not be stored must never block choosing a folder.
    console.warn('[libraryFolder] nom du dossier non mémorisé:', err);
  }
}

/** True when the browser can write to a chosen folder at all. */
export function isSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponible'));
  });
}

async function idbGet(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
    req.onerror = () => reject(req.error ?? new Error('lecture IndexedDB impossible'));
  });
}

async function idbPut(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('écriture IndexedDB impossible'));
  });
}

let handle: FileSystemDirectoryHandle | null = null;

/** Ask for permission on a stored handle. `prompt` requires a user gesture. */
async function ensurePermission(
  dir: FileSystemDirectoryHandle,
  prompt: boolean,
): Promise<boolean> {
  const desc = { mode: 'readwrite' as const };
  const current = (await dir.queryPermission?.(desc)) ?? 'granted';
  if (current === 'granted') return true;
  if (!prompt) return false;
  const asked = (await dir.requestPermission?.(desc)) ?? 'denied';
  return asked === 'granted';
}

/**
 * Reattach the folder chosen in a previous session, WITHOUT prompting.
 * Returns its name when usable — call at startup to show whether saving is ready.
 */
export async function restoreFolder(): Promise<string | null> {
  if (!isSupported()) return null;
  try {
    const stored = await idbGet();
    if (!stored) return null;
    if (!(await ensurePermission(stored, false))) {
      // Permission lapsed: keep the handle so a single click can revive it.
      handle = stored;
      return null;
    }
    handle = stored;
    rememberName(stored.name);
    return stored.name;
  } catch {
    return null; // no stored folder is a normal state, not an error
  }
}

/**
 * Choose (or re-authorize) the library folder. MUST be called from a user
 * gesture. Returns the folder name.
 */
export async function chooseFolder(): Promise<FolderChoice> {
  if (!isSupported()) {
    throw new Error(
      "Ce navigateur ne permet pas d'écrire dans un dossier (Chrome ou Edge requis).",
    );
  }
  // ALWAYS open the picker. It used to short-circuit on a stored handle whose
  // permission was still granted, which made the button a no-op and left no way
  // to correct a wrong folder — the one thing a user needs it for.
  const picked = await window.showDirectoryPicker!({ id: 'strudler-library', mode: 'readwrite' });
  if (!(await ensurePermission(picked, true))) {
    throw new Error('Accès au dossier refusé.');
  }
  handle = picked;
  rememberName(picked.name);
  await idbPut(picked).catch((err) => console.warn('[libraryFolder] handle non persisté:', err));
  return { name: picked.name, problem: await inspectFolder(picked) };
}

/** Renew a lapsed permission on the folder already chosen, without re-picking. */
export async function renewPermission(): Promise<boolean> {
  return handle ? ensurePermission(handle, true) : false;
}

export interface FolderChoice {
  name: string;
  /** Why the folder looks wrong, or null. Advisory: the user may legitimately
   *  keep tracks somewhere else. */
  problem: string | null;
}

/**
 * Sanity-check the chosen folder. [SPEC-18.15]
 *
 * The picker gives no context, and picking `library/perc` instead of `library/`
 * is an easy mistake — the app would then write `perc/<category>/…`, quietly
 * creating a folder inside a folder. Two signals, both cheap:
 *   - `track.schema.json` sits at the library root → certainly right;
 *   - `.track.yaml` files sitting DIRECTLY here → this is a category folder,
 *     i.e. one level too deep, which is exactly the mistake to catch.
 * Anything else earns a soft doubt rather than a refusal: a user-owned track
 * folder is a legitimate target.
 */
async function inspectFolder(dir: FileSystemDirectoryHandle): Promise<string | null> {
  try {
    await dir.getFileHandle('track.schema.json', { create: false });
    return null; // the library root, no doubt possible
  } catch {
    // absent — keep looking
  }
  try {
    for await (const entry of dir.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.track.yaml')) {
        return `« ${dir.name} » contient directement des pistes : c'est un dossier de CATÉGORIE, pas la bibliothèque. Choisissez le dossier « library » qui le contient.`;
      }
    }
  } catch {
    return null; // unreadable listing is not evidence of anything
  }
  return `« ${dir.name} » ne contient pas track.schema.json — ce n'est probablement pas le dossier « library ».`;
}

/** Name of the authorized folder, or null when none is usable yet. */
export function folderName(): string | null {
  return handle?.name ?? null;
}

/** True when a file already exists at `<category>/<slug>.track.yaml`. */
export async function trackExists(category: string, slug: string): Promise<boolean> {
  if (!handle) return false;
  try {
    const dir = await handle.getDirectoryHandle(category, { create: false });
    await dir.getFileHandle(`${slug}.track.yaml`, { create: false });
    return true;
  } catch {
    return false; // missing directory or missing file — both mean "no"
  }
}

/**
 * Write `<category>/<slug>.track.yaml`, creating the category folder if needed
 * (a new category is just a new folder, [SPEC-4.4]). Returns the relative path.
 */
export async function writeTrack(
  category: string,
  slug: string,
  text: string,
): Promise<string> {
  if (!handle) throw new Error("Aucun dossier autorisé — cliquez sur « Dossier… » d'abord.");
  const dir = await handle.getDirectoryHandle(category, { create: true });
  const file = await dir.getFileHandle(`${slug}.track.yaml`, { create: true });
  const stream = await file.createWritable();
  try {
    await stream.write(text);
  } finally {
    await stream.close();
  }
  return `${category}/${slug}.track.yaml`;
}
