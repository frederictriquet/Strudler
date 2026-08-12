// [SPEC-13] Library state for the GUI. The manifest is built once at load
// ([SPEC-4.3]); load errors are exposed so a broken track file is visible rather
// than silently vanishing ([SPEC-14.3]). Playback happens through the channel
// rack (phase 3); the assignment editor lands in phase 6.

import { library } from '@core/library/Library';
import type { LoadedTrack, TrackLoadError } from '@core/library/types';

export const tracksByCategory: Map<string, LoadedTrack[]> = library.byCategory();
export const categories: string[] = library.categories;
export const loadErrors: TrackLoadError[] = library.errors;

/** Tracks whose category is among the given ones, for slot assignment. [SPEC-5.4] */
export function tracksForCategories(cats: string[]): LoadedTrack[] {
  return cats.flatMap((c) => tracksByCategory.get(c) ?? []);
}

/** "category · name" label for a track id, or the raw id if unknown. */
export function trackLabel(id: string | null): string {
  if (!id) return '—';
  const t = library.getTrack(id);
  return t ? `${t.category} · ${t.name}` : id;
}
