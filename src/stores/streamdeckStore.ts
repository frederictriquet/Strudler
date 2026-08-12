// [PLAN B] Stream Deck wiring: routes key presses through the shared dispatch
// and paints channel/launcher state back onto the keys. WebHID; connect on a
// user gesture. Errors surfaced, never swallowed [SPEC-14.3].

import { writable, get, derived } from 'svelte/store';
import {
  streamDeck,
  StreamDeckService,
  type StreamDeckStatus,
  type SceneView,
} from '@core/streamdeck/StreamDeckService';
import { dispatch, scenes, sceneStoreMode, activeScene } from '@stores/rackStore';
import { notify } from '@stores/logStore';

export const streamDeckSupported = StreamDeckService.isSupported();
export const streamDeckStatus = writable<StreamDeckStatus>('idle');
export const streamDeckError = writable<string | null>(null);

/** What the scene row must display. [SPEC-17.36] */
const sceneView = derived(
  [scenes, sceneStoreMode, activeScene],
  ([list, storeMode, active]): SceneView => ({
    storeMode,
    filled: list.map((s) => s !== null),
    active,
  }),
);

let wired = false;

function wireFeedback(): void {
  if (wired) return;
  wired = true;
  // Repaint the keys on any scene-state change (render() no-ops when no device).
  sceneView.subscribe((view) => streamDeck.render(view));
}

export async function connectStreamDeck(): Promise<void> {
  streamDeckStatus.set('connecting');
  streamDeckError.set(null);
  try {
    await streamDeck.connect(dispatch);
    wireFeedback();
    streamDeck.render(get(sceneView));
    streamDeckStatus.set('ready');
    notify('success', 'Stream Deck connecté');
  } catch (err) {
    const message = (err as Error).message;
    streamDeckStatus.set('error');
    streamDeckError.set(message);
    notify('error', `Stream Deck : échec — ${message}`);
  }
}

/** Reopen a previously-authorized Stream Deck at startup (no prompt). Silent if none. */
export async function reconnectStreamDeck(): Promise<void> {
  try {
    const ok = await streamDeck.reconnect(dispatch);
    if (!ok) return;
    wireFeedback();
    streamDeck.render(get(sceneView));
    streamDeckStatus.set('ready');
    notify('success', 'Stream Deck reconnecté');
  } catch {
    // No authorized device / device busy — stay idle, the modal button remains.
  }
}

export async function disconnectStreamDeck(): Promise<void> {
  await streamDeck.disconnect();
  streamDeckStatus.set('idle');
  notify('info', 'Stream Deck déconnecté');
}
