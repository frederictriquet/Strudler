// [SPEC-18.15] Write a track straight into the `library/` folder on disk.
//
// The folder is authorized ONCE through the File System Access API; the handle is
// kept in IndexedDB so a page reload does not ask again (handles are
// structured-cloneable, unlike paths, which the browser never exposes).
// Chrome/Edge only — the same requirement the instrument already has for Web MIDI
// and WebHID [SPEC-14.1]. Everything here reports failures rather than swallowing
// them [SPEC-14.3]; the caller decides what to show.

const DB_NAME = 'strudler-composer';
const STORE = 'handles';
const KEY = 'libraryFolder';

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
    return stored.name;
  } catch {
    return null; // no stored folder is a normal state, not an error
  }
}

/**
 * Choose (or re-authorize) the library folder. MUST be called from a user
 * gesture. Returns the folder name.
 */
export async function chooseFolder(): Promise<string> {
  if (!isSupported()) {
    throw new Error(
      "Ce navigateur ne permet pas d'écrire dans un dossier (Chrome ou Edge requis).",
    );
  }
  // A handle kept from a previous session only needs its permission renewed.
  if (handle && (await ensurePermission(handle, true))) return handle.name;

  const picked = await window.showDirectoryPicker!({ id: 'strudler-library', mode: 'readwrite' });
  if (!(await ensurePermission(picked, true))) {
    throw new Error('Accès au dossier refusé.');
  }
  handle = picked;
  await idbPut(picked).catch(() => undefined); // persistence is a convenience, not a requirement
  return picked.name;
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
