// [SPEC-13] Central app state (Svelte store) for MIDI. Phase 0: connection
// status, live port list, and nanoKONTROL2 presence, updated on hot-plug
// ([SPEC-14.5]).

import { writable } from 'svelte/store';
import { midi, type MidiPortInfo, type MidiStatus } from '@core/midi/MidiService';
import { mappingForDevice } from '@core/mapping/mapping';
import { notify } from '@stores/logStore';

export interface MidiState {
  status: MidiStatus;
  supported: boolean;
  ports: MidiPortInfo[];
  hasNanoKontrol2: boolean;
  error: string | null;
}

export const midiState = writable<MidiState>({
  status: 'idle',
  supported: MidiService_isSupported(),
  ports: [],
  hasNanoKontrol2: false,
  error: null,
});

function MidiService_isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}

/** Names of connected input ports recognized by a controller mapping. */
function recognizedControllers(ports: MidiPortInfo[]): string[] {
  const names = new Map<string, string>();
  for (const p of ports) {
    if (p.direction !== 'input' || p.state !== 'connected') continue;
    const mapping = mappingForDevice(p.name);
    if (mapping) names.set(mapping.match, mapping.name);
  }
  return [...names.values()];
}

let lastRecognized = '';
let midiReady = false; // true after the initial connect summary is logged

function refresh(ports: MidiPortInfo[]): void {
  midiState.set({
    status: midi.currentStatus,
    supported: MidiService_isSupported(),
    ports,
    hasNanoKontrol2: midi.hasNanoKontrol2(),
    error: null,
  });
  // Log recognized-controller CHANGES on hot-plug (after the initial summary). [SPEC-14.5]
  const key = recognizedControllers(ports).join(', ');
  if (midiReady && key !== lastRecognized) {
    notify(key ? 'success' : 'info', key ? `MIDI : ${key} connecté` : 'MIDI : plus de contrôleur reconnu');
  }
  lastRecognized = key;
}

/** Request MIDI access and start tracking ports. Logs the outcome. */
export async function connectMidi(): Promise<void> {
  if (!MidiService_isSupported()) {
    midiState.update((s) => ({ ...s, status: 'unsupported' }));
    notify('error', 'MIDI : Web MIDI indisponible (utiliser Chrome ou Edge)');
    return;
  }
  midiState.update((s) => ({ ...s, status: 'requesting', error: null }));
  notify('info', 'MIDI : connexion…');
  try {
    midi.onPortsChanged(refresh);
    await midi.requestAccess();
    const ports = midi.listPorts();
    const recognized = recognizedControllers(ports);
    const inputs = ports.filter((p) => p.direction === 'input' && p.state === 'connected').length;
    lastRecognized = recognized.join(', ');
    midiReady = true;
    // Always log the outcome, so the user sees MIDI did connect. [SPEC-14.3]
    if (recognized.length > 0) {
      notify('success', `MIDI : ${lastRecognized} connecté`);
    } else {
      notify('info', `MIDI : connecté — aucun contrôleur reconnu (${inputs} entrée(s))`);
    }
    refresh(ports);
  } catch (err) {
    const message = (err as Error).message;
    midiState.update((s) => ({ ...s, status: midi.currentStatus, error: message }));
    notify('error', `MIDI : échec de connexion — ${message}`);
    throw err;
  }
}
