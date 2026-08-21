// [SPEC-15] Save a live-coded slot back into the library — the return leg of the
// workshop ⇄ instrument cycle [SPEC-18.1]. The advanced mode [SPEC-9.2] keeps its
// edits in memory only [SPEC-9.1]; this turns one of them into a real
// `library/<catégorie>/<slug>.track.yaml` [SPEC-4.6].
//
// Nothing is written that the loader would refuse: the produced YAML goes through
// `validateTrackText`, the very check `Library` runs on disk [SPEC-18.16], and the
// pattern must have been evaluated once without error.
//
// Deliberately NOT an Intent: an intent is a PLAY gesture — recorded in the
// session journal [SPEC-11.2], replayable, and emitted by MIDI or the Stream Deck.
// Writing a file is none of that (a replay would silently rewrite the library, and
// the File System Access API requires a real user gesture anyway). It sits beside
// `assignSlotTrack` / `saveSessionToBrowser`: GUI-only authoring actions.

import { derived, get, writable } from 'svelte/store';
import { library } from '@core/library/Library';
import { serializeTrack, type TrackDraft } from '@core/library/serialize';
import { validateTrackText } from '@core/library/validate';
import {
  chooseFolder,
  isSupported,
  restoreFolder,
  trackExists,
  writeTrack,
} from '@core/composer/libraryFolder';
import { notify } from '@stores/logStore';
import { measureLength } from '@stores/rackStore';

/** Fallback loop length when neither the source track nor the measure says. */
const DEFAULT_BEATS = 4;

export const exportOpen = writable<boolean>(false);
/** Why the last action failed, in full. Never silent [SPEC-14.3]. */
export const exportError = writable<string | null>(null);
export const exportStatus = writable<string | null>(null);
export const exportBusy = writable<boolean>(false);

/** Code being exported, frozen when the dialog opens (the panel keeps editing). */
export const exportCode = writable<string>('');
export const exportName = writable<string>('');
export const exportCategory = writable<string>('');
export const exportSlug = writable<string>('');
export const exportBeats = writable<number>(DEFAULT_BEATS);
/** Tags as typed, comma-separated. */
export const exportTags = writable<string>('');
/** Camelot key and gain, carried over from the source track (not editable here:
 *  the live code is the UNTRANSPOSED pattern, so its key still applies). */
export const exportKey = writable<string | undefined>(undefined);
export const exportGain = writable<number | undefined>(undefined);
export const exportComment = writable<string | undefined>(undefined);

/** Id of the slot's track, to detect an identifier change. [SPEC-17.51] */
export const exportSourceId = writable<string | null>(null);
/** Loop length measured on the code itself; null = variable or not measured. */
export const measuredBeats = writable<number | null>(null);
/** Set when the code does not evaluate — blocks the write [SPEC-18.16]. */
export const patternError = writable<string | null>(null);

/** Name of the authorized folder, null while writing is not possible yet. */
export const exportFolder = writable<string | null>(null);
export const targetExists = writable<boolean>(false);
export const canWriteToDisk = isSupported();

/** Categories already present in the library, for the picker. */
export const knownCategories: string[] = library.categories;

/** Target id `catégorie/slug` — the identity the instrument binds pads to. */
export const targetId = derived(
  [exportCategory, exportSlug],
  ([$category, $slug]) => `${$category}/${$slug}`,
);

/** `a, b , c` → `['a', 'b', 'c']`, empty entries dropped. */
function parseTags(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

function draftOf(): TrackDraft {
  return {
    name: get(exportName).trim(),
    beats: get(exportBeats),
    // The live code comes from `slotCode()`, where `${VAR}` is ALREADY substituted
    // [SPEC-4.7]: re-declaring `vars` would leave fragments the pattern no longer
    // mentions, so the exported file inlines them.
    patternSource: get(exportCode).trim(),
    vars: {},
    tags: parseTags(get(exportTags)),
    gain: get(exportGain),
    key: get(exportKey),
    comment: get(exportComment),
  };
}

/** The exact text that will be written — also shown for review. [SPEC-18.14] */
export const exportYaml = derived(
  [exportName, exportBeats, exportCode, exportTags, exportKey, exportGain, exportComment],
  () => serializeTrack(draftOf()),
);

/**
 * Everything that must be settled before writing. [SPEC-18.16]
 * `blocking` prevents the write; `warnings` only require a confirmation.
 * Same rules as the workshop's `saveCheck`, so both pages refuse the same files.
 */
export const exportCheck = derived(
  [exportYaml, exportCategory, exportSlug, exportSourceId, targetId, patternError, targetExists],
  ([$yaml, $category, $slug, $sourceId, $targetId, $patternError, $targetExists]) => {
    const blocking: string[] = [];
    const warnings: string[] = [];

    if (!/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/.test($slug)) {
      blocking.push('Nom de fichier invalide (lettres, chiffres, espace, tiret, souligné).');
    }
    if (!/^[a-z0-9-]+$/.test($category)) {
      blocking.push('Catégorie invalide (minuscules, chiffres, tirets).');
    }
    // The check the loader runs, so the instrument can never write a file it would
    // then reject at the next reload. [SPEC-4.6]
    const validated = validateTrackText($yaml);
    if (typeof validated === 'string') blocking.push(validated);
    if ($patternError) blocking.push(`Code non évaluable : ${$patternError}`);

    if ($targetExists) {
      warnings.push(`Le fichier ${$targetId}.track.yaml existe déjà : il sera écrasé.`);
    }
    // Saving under another id leaves the pads bound to the OLD id, which stays
    // unresolved until its file comes back. [SPEC-17.51]
    if ($sourceId && $sourceId !== $targetId) {
      warnings.push(
        `L'identifiant change (${$sourceId} → ${$targetId}) : les pads associés à ${$sourceId} resteront liés à l'ancienne piste, et seront en défaut si son fichier n'existe plus.`,
      );
    }
    return { blocking, warnings };
  },
);

/** What the slot offers as a starting point for the file. */
export interface ExportSource {
  /** Effective code of the slot (override or disk pattern). */
  code: string;
  /** `catégorie/slug` of the assigned track, null when the slot is unbound. */
  trackId: string | null;
  /** Display name, null when the id does not resolve. [SPEC-17.51] */
  trackName: string | null;
  /** Declared loop length of the source track, null when unknown. */
  trackBeats: number | null;
}

/**
 * Open the export dialog for a slot, pre-filled with its track's identity so the
 * common case — making a live evolution permanent — is a single confirmation.
 */
export function openTrackExport(source: ExportSource): void {
  exportError.set(null);
  exportStatus.set(null);
  exportBusy.set(false);
  measuredBeats.set(null);
  patternError.set(null);
  targetExists.set(false);

  const [category = '', slug = ''] = (source.trackId ?? '').split('/');
  const track = source.trackId ? library.getTrack(source.trackId) : undefined;

  exportCode.set(source.code);
  exportSourceId.set(source.trackId);
  exportCategory.set(category || knownCategories[0] || 'divers');
  exportSlug.set(slug || 'piste-live');
  // An unresolved id [SPEC-17.51] carries no name: fall back on the slug, then on
  // a placeholder — an empty `name` would only surface later as a blocking check.
  exportName.set(source.trackName ?? track?.name ?? (slug || 'Piste live'));
  exportBeats.set(source.trackBeats ?? track?.beats ?? DEFAULT_BEATS);
  exportTags.set((track?.tags ?? []).join(', '));
  exportKey.set(track?.key);
  exportGain.set(track?.gain);
  exportComment.set(
    `Exporté du mode avancé le ${new Date().toLocaleString('fr-FR')}${
      source.trackId ? ` (source : ${source.trackId})` : ''
    }.`,
  );

  exportOpen.set(true);
  void restoreSavedFolder();
  void measureCode(source.trackBeats === null && track === undefined);
}

export function closeTrackExport(): void {
  exportOpen.set(false);
}

/**
 * Evaluate the code once to prove it runs and to propose a length. The measured
 * period is the SMALLEST one (`s("bd*4")` repeats every beat) while `beats` states
 * the musical phrase [SPEC-17.10]: it is only adopted when nothing else is known,
 * and otherwise merely offered.
 */
async function measureCode(adopt: boolean): Promise<void> {
  const { beats, error } = await measureLength(get(exportCode));
  patternError.set(error);
  measuredBeats.set(beats);
  if (adopt && beats !== null) exportBeats.set(beats);
}

/** Adopt the measured length as the declared `beats`. */
export function adoptMeasuredBeats(): void {
  const beats = get(measuredBeats);
  if (beats !== null) exportBeats.set(beats);
}

/** Refresh the "file already exists" warning — an async check cannot live in a
 *  derived store. Call after any change of category/slug. */
export async function refreshTargetExists(): Promise<void> {
  targetExists.set(await trackExists(get(exportCategory), get(exportSlug)));
}

/** Warning about the folder just chosen — wrong level, most often. [SPEC-18.15] */
export const exportFolderWarning = writable<string | null>(null);

/** Choose the library folder. MUST be called from a user gesture. Always reopens
 *  the picker, so a wrong choice can be corrected. */
export async function pickExportFolder(): Promise<void> {
  exportError.set(null);
  try {
    const chosen = await chooseFolder();
    exportFolder.set(chosen.name);
    exportFolderWarning.set(chosen.problem);
    await refreshTargetExists();
    exportStatus.set(`Dossier : ${chosen.name}`);
  } catch (err) {
    // A cancelled picker is a choice, not a failure worth shouting about.
    if ((err as Error).name === 'AbortError') return;
    const message = `Dossier inaccessible : ${(err as Error).message}`;
    exportError.set(message);
    notify('error', message); // [SPEC-14.3]
  }
}

/** Reattach a folder authorized in a previous session, without prompting. */
export async function restoreSavedFolder(): Promise<void> {
  exportFolder.set(await restoreFolder());
  if (get(exportFolder)) await refreshTargetExists();
}

/**
 * Write `library/<catégorie>/<slug>.track.yaml`. [SPEC-15, SPEC-18.15]
 * Refuses on any blocking check; `confirmed` acknowledges the warnings (overwrite,
 * identifier change). Returns true when the file was written.
 */
export async function saveTrackExport(confirmed: boolean): Promise<boolean> {
  exportError.set(null);
  const check = get(exportCheck);
  if (check.blocking.length > 0) {
    const message = `Enregistrement refusé — ${check.blocking.join(' · ')}`;
    exportError.set(message);
    notify('error', message); // [SPEC-14.3]
    return false;
  }
  if (!confirmed && check.warnings.length > 0) return false; // the dialog asks first

  exportBusy.set(true);
  try {
    const path = await writeTrack(get(exportCategory), get(exportSlug), get(exportYaml));
    exportStatus.set(`Enregistré : ${path}`);
    exportSourceId.set(get(targetId));
    await refreshTargetExists();
    notify('success', `Piste enregistrée dans la bibliothèque : ${path}`);
    return true;
  } catch (err) {
    const message = `Enregistrement impossible : ${(err as Error).message}`;
    exportError.set(message);
    notify('error', message); // [SPEC-14.3]
    return false;
  } finally {
    exportBusy.set(false);
  }
}

/** Fallback when the browser cannot write to a folder: download the file, with
 *  where to drop it. Blocking checks still apply — no invalid file leaves here. */
export function downloadTrackExport(): void {
  exportError.set(null);
  const check = get(exportCheck);
  if (check.blocking.length > 0) {
    const message = `Téléchargement refusé — ${check.blocking.join(' · ')}`;
    exportError.set(message);
    notify('error', message); // [SPEC-14.3]
    return;
  }
  const url = URL.createObjectURL(new Blob([get(exportYaml)], { type: 'text/yaml' }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${get(exportSlug)}.track.yaml`;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  const where = `library/${get(exportCategory)}/`;
  exportStatus.set(`Téléchargé — à déposer dans ${where}`);
  notify('info', `Piste téléchargée : à déposer dans ${where}`);
}
