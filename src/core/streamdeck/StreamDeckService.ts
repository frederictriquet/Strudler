// [SPEC-17.4-adjacent] Elgato Stream Deck adapter via WebHID. Another producer
// of the unified Intents ([PLAN B]), plus rich per-key feedback (each key is an
// LCD → we paint state colors on them). ⚠ Hardware not validated; requires the
// Elgato software to be closed (it otherwise claims the HID device).
//
// Layout for the MK.2 (5 columns × 3 rows) — scenes only for now [SPEC-17.36]:
//   row 0: key 1 = M+ (arm storing), keys 2-5 = scene slots 1-4
//   rows 1-2: unassigned (dark)
// The loops themselves live on the APC's 64 pads, so the Stream Deck is kept for
// global, stateful functions where per-key colour feedback earns its place.

import { requestStreamDecks, getStreamDecks, type StreamDeckWeb } from '@elgato-stream-deck/webhid';
import type { StreamDeckButtonControlDefinition } from '@elgato-stream-deck/webhid';
import type { Intent } from '@core/intent/intents';

const SCENE_ROW = 0; // first row holds M+ and the scene slots
const STORE_COLUMN = 0; // M+ key

/** What the scene row must show. */
export interface SceneView {
  storeMode: boolean;
  /** One entry per scene slot: does it hold anything? */
  filled: boolean[];
  /** Index of the scene currently recalled, or null. */
  active: number | null;
}

type RGB = readonly [number, number, number];
const COLOR = {
  off: [10, 11, 14], // unassigned key: as dark as possible
  storeIdle: [70, 80, 95], // M+ at rest
  storeArmed: [255, 190, 40], // M+ armed: the next press stores
  sceneEmpty: [24, 28, 36], // slot with nothing in it
  sceneFilled: [40, 90, 200], // slot holding a scene
  sceneActive: [40, 220, 150], // scene currently recalled
  willStore: [120, 90, 20], // store mode, empty slot: will record here
  willOverwrite: [235, 150, 30], // store mode, filled slot: will overwrite
} satisfies Record<string, RGB>;

export type StreamDeckStatus = 'idle' | 'connecting' | 'ready' | 'error';

export class StreamDeckService {
  private device: StreamDeckWeb | null = null;
  private buttons: StreamDeckButtonControlDefinition[] = [];
  private lastColor = new Map<number, string>();
  private onIntent: ((intent: Intent) => void) | null = null;

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  get connected(): boolean {
    return this.device !== null;
  }

  /** Open a Stream Deck (WebHID prompt — must run on a user gesture). */
  async connect(onIntent: (intent: Intent) => void): Promise<void> {
    if (!StreamDeckService.isSupported()) {
      throw new Error('WebHID indisponible (utiliser Chrome ou Edge).');
    }
    const device = (await requestStreamDecks())[0];
    if (!device) throw new Error('Aucun Stream Deck sélectionné.');
    await this.attach(device, onIntent);
  }

  /**
   * Reopen a previously-authorized Stream Deck without any prompt (no user
   * gesture needed). Returns true if one was reconnected. Used at startup.
   */
  async reconnect(onIntent: (intent: Intent) => void): Promise<boolean> {
    if (!StreamDeckService.isSupported()) return false;
    const device = (await getStreamDecks())[0];
    if (!device) return false;
    await this.attach(device, onIntent);
    return true;
  }

  private async attach(device: StreamDeckWeb, onIntent: (intent: Intent) => void): Promise<void> {
    this.onIntent = onIntent;
    this.device = device;
    this.buttons = device.CONTROLS.filter(
      (c): c is StreamDeckButtonControlDefinition => c.type === 'button',
    );

    device.on('down', (control) => {
      if (control.type !== 'button') return;
      const intent = this.controlToIntent(control.column, control.row);
      if (intent && this.onIntent) this.onIntent(intent);
    });
    device.on('error', (err) => {
      // Surface via console; the device likely disconnected. [SPEC-14.3]
      console.warn('[streamdeck] error:', err);
      this.handleDisconnect();
    });

    await device.clearPanel().catch(() => undefined);
    await device.setBrightness(80).catch(() => undefined);
  }

  async disconnect(): Promise<void> {
    if (!this.device) return;
    try {
      await this.device.clearPanel();
      await this.device.close();
    } catch {
      // ignore close errors
    }
    this.handleDisconnect();
  }

  private handleDisconnect(): void {
    this.device = null;
    this.buttons = [];
    this.lastColor.clear();
  }

  private controlToIntent(column: number, row: number): Intent | null {
    if (row !== SCENE_ROW) return null; // rows 2-3 unassigned for now
    if (column === STORE_COLUMN) return { type: 'sceneModeToggle' };
    return { type: 'scenePress', index: column - 1 };
  }

  private colorFor(column: number, row: number, view: SceneView): RGB {
    if (row !== SCENE_ROW) return COLOR.off;
    if (column === STORE_COLUMN) return view.storeMode ? COLOR.storeArmed : COLOR.storeIdle;
    const index = column - 1;
    const filled = view.filled[index] ?? false;
    // In store mode the slots show what a press would do: overwrite, or record.
    if (view.storeMode) return filled ? COLOR.willOverwrite : COLOR.willStore;
    if (index === view.active) return COLOR.sceneActive;
    return filled ? COLOR.sceneFilled : COLOR.sceneEmpty;
  }

  /** Paint the current state onto the keys (diffed to avoid flooding HID). */
  render(view: SceneView): void {
    if (!this.device) return;
    for (const button of this.buttons) {
      const [r, g, b] = this.colorFor(button.column, button.row, view);
      const key = `${r},${g},${b}`;
      if (this.lastColor.get(button.index) === key) continue;
      this.lastColor.set(button.index, key);
      this.device.fillKeyColor(button.index, r, g, b).catch(() => undefined);
    }
  }
}

export const streamDeck = new StreamDeckService();
