// [SPEC-10.6] "Placement" mode: click a library track to hold it, then click a
// slot of a channel whose categories include the track's category to assign it.
// Bridges the library and the rack without drag-and-drop.

import { writable } from 'svelte/store';
import { library } from '@core/library/Library';
import type { LoadedTrack } from '@core/library/types';

export const placementMode = writable<boolean>(false);
export const heldTrack = writable<LoadedTrack | null>(null);

export function togglePlacement(): void {
  placementMode.update((on) => {
    const next = !on;
    if (!next) heldTrack.set(null); // leaving the mode drops the held track
    return next;
  });
}

/** Hold a track (or release it if it is already the held one). */
export function holdTrack(id: string): void {
  const track = library.getTrack(id) ?? null;
  heldTrack.update((cur) => (cur && track && cur.id === track.id ? null : track));
}

export function clearHeld(): void {
  heldTrack.set(null);
}
