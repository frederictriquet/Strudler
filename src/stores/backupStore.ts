// [SPEC-13.5→13.9] Observable state of the disk mirror, and the place where every
// backup failure becomes visible.
//
// A sauvegarde that fails in the console only is worse than none: it advertises a
// protection that isn't there. Everything here routes through `notify()`
// [SPEC-14.3].

import { writable, get } from 'svelte/store';
import { notify } from '@stores/logStore';
import {
  applyBundle,
  backupNow,
  exportBundleText,
  exportFileName,
  fetchIndex,
  fetchSnapshot,
  parseBundle,
  requestPersistentStorage,
  startAutoBackup,
  takeRestoreOutcome,
  type BackupIndex,
  type SnapshotInfo,
} from '@core/persist/backup';

export type MirrorStatus = 'unknown' | 'ready' | 'unavailable' | 'error';

export const mirrorStatus = writable<MirrorStatus>('unknown');
export const lastSavedAt = writable<string | null>(null);
export const lastBytes = writable<number>(0);
export const mirrorError = writable<string | null>(null);
export const snapshots = writable<SnapshotInfo[]>([]);
export const persistentStorage = writable<boolean | null>(null);
export const origin = typeof location !== 'undefined' ? location.origin : '';

/** Human-readable date, or a dash. Snapshot names are ISO, values may be empty. */
export function formatStamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(2)} Mo`;
}

let started = false;

/** Wire the mirror. Idempotent — both pages call it from their root component. */
export function initBackup(): void {
  if (started) return;
  started = true;

  // What `restoreFromDiskIfEmpty()` did before the app mounted. [SPEC-13.8]
  const restored = takeRestoreOutcome();
  if (restored?.kind === 'restored') {
    const folder = restored.libraryFolder
      ? ` Le dossier « ${restored.libraryFolder} » doit être réautorisé.`
      : '';
    notify(
      'warn',
      `État restauré depuis la sauvegarde du ${formatStamp(restored.savedAt)} (${restored.count} entrées).${folder}`,
    );
  } else if (restored?.kind === 'error') {
    notify('error', `Restauration impossible : ${restored.message}`);
  }

  startAutoBackup((ev) => {
    if (ev.kind === 'saved') {
      mirrorStatus.set('ready');
      mirrorError.set(null);
      lastSavedAt.set(ev.savedAt);
      lastBytes.set(ev.bytes);
      return;
    }
    if (ev.kind === 'unavailable') {
      mirrorStatus.set('unavailable');
      mirrorError.set(null);
      notify(
        'warn',
        'Miroir disque indisponible : cette page n’est pas servie par Vite, les données ne sont sauvegardées que dans le navigateur.',
      );
      return;
    }
    mirrorStatus.set('error');
    mirrorError.set(ev.message);
    notify('error', `Sauvegarde sur disque en échec : ${ev.message}`);
  });

  void refreshBackupIndex();
  void requestPersistentStorage().then((ok) => persistentStorage.set(ok));
}

/** Re-read what is on disk (current copy + snapshot list). */
export async function refreshBackupIndex(): Promise<void> {
  try {
    const index: BackupIndex = await fetchIndex();
    snapshots.set(index.snapshots);
    if (index.current) {
      lastSavedAt.set(index.current.savedAt);
      lastBytes.set(index.current.bytes);
    }
    if (get(mirrorStatus) !== 'error') mirrorStatus.set('ready');
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'MIRROR_ABSENT' || err instanceof TypeError) {
      mirrorStatus.set('unavailable');
      return;
    }
    mirrorStatus.set('error');
    mirrorError.set(message);
    notify('error', `Lecture des sauvegardes impossible : ${message}`);
  }
}

/** Mirror right now (button "Sauvegarder maintenant"). */
export async function saveNow(): Promise<void> {
  await backupNow();
  await refreshBackupIndex();
}

/**
 * Replace the browser state with a dated snapshot, then reload — the stores read
 * their keys at import time, so only a fresh document can show the restored state.
 */
export async function restoreSnapshot(name: string): Promise<void> {
  try {
    const bundle = await fetchSnapshot(name);
    const count = await applyBundle(bundle);
    notify('success', `${count} entrées restaurées depuis ${formatStamp(bundle.savedAt)}.`);
    location.reload();
  } catch (err) {
    const message = (err as Error).message;
    mirrorError.set(message);
    notify('error', `Restauration impossible : ${message}`);
  }
}

/** Download the whole state as one file — the only way across machines. [SPEC-13.9] */
export function exportAll(): void {
  try {
    const blob = new Blob([exportBundleText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName();
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    notify('error', `Export impossible : ${(err as Error).message}`);
  }
}

export interface ImportPreview {
  savedAt: string;
  origin: string;
  count: number;
  libraryFolder: string | null;
  text: string;
}

/** Inspect a file without touching the browser state, so the user can confirm. */
export function previewImport(text: string): ImportPreview {
  const bundle = parseBundle(text); // throws with a readable message [SPEC-14.3]
  return {
    savedAt: bundle.savedAt,
    origin: bundle.origin,
    count: Object.keys(bundle.keys).length,
    libraryFolder: bundle.libraryFolder,
    text,
  };
}

/** Apply a previously previewed file, then reload. */
export async function confirmImport(preview: ImportPreview): Promise<void> {
  try {
    const count = await applyBundle(parseBundle(preview.text));
    notify('success', `${count} entrées importées.`);
    location.reload();
  } catch (err) {
    notify('error', `Import impossible : ${(err as Error).message}`);
  }
}
