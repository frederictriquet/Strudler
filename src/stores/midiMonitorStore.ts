// [SPEC-17.35] MIDI monitor: the last raw messages received, with what they are
// bound to. Controllers cannot be queried and their CC map varies with the preset
// or scene, so guessing which control sends what is guesswork — this shows it.

import { writable } from 'svelte/store';
import { fullReloadOnHmr } from '@core/persist/hmr';

fullReloadOnHmr(import.meta.hot); // holds singleton state [SPEC-17.31]

export interface MidiEvent {
  id: number;
  deviceName: string;
  /** 'CC' or 'NOTE', plus the raw status byte for anything else. */
  kind: string;
  /** CC number or note number. */
  code: number;
  value: number;
  /** Logical function it is bound to, or null when unmapped. */
  intent: string | null;
  /** Channel/slot the entry targets, for display. */
  target: string;
}

const MAX_EVENTS = 14;

export const midiEvents = writable<MidiEvent[]>([]);
/** Total messages seen, so it is obvious whether anything arrives at all. */
export const midiEventCount = writable<number>(0);

let seq = 0;

export function recordMidiEvent(event: Omit<MidiEvent, 'id'>): void {
  midiEvents.update((list) => [{ ...event, id: seq++ }, ...list].slice(0, MAX_EVENTS));
  midiEventCount.update((n) => n + 1);
}

export function clearMidiEvents(): void {
  midiEvents.set([]);
  midiEventCount.set(0);
}
