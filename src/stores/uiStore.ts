// UI state: visibility of the MIDI/Session settings modal.

import { writable } from 'svelte/store';

export const settingsOpen = writable<boolean>(false);

export function openSettings(): void {
  settingsOpen.set(true);
}

export function closeSettings(): void {
  settingsOpen.set(false);
}
