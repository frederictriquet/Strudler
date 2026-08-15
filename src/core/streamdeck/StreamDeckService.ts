// [SPEC-17.4-adjacent] Elgato Stream Deck adapter via WebHID. Another producer
// of the unified Intents ([PLAN B]), plus rich per-key feedback (each key is an
// LCD → we paint state colors on them). ⚠ Hardware not validated; requires the
// Elgato software to be closed (it otherwise claims the HID device).
//
// Layout for the MK.2 (5 columns × 3 rows):
//   row 0: M+ (arm storing) then scene slots 1-4          [SPEC-17.36]
//   row 1: PHASER + three tempo-locked echoes             [SPEC-17.46/17.47]
//   row 2: held gestures — DROP, LP, HP, RISE, GATE       [SPEC-17.40 → 17.44]
// The loops themselves live on the APC's 64 pads, so the Stream Deck is kept for
// global, stateful functions where per-key colour feedback earns its place.

import { requestStreamDecks, getStreamDecks, type StreamDeckWeb } from '@elgato-stream-deck/webhid';
import type { StreamDeckButtonControlDefinition } from '@elgato-stream-deck/webhid';
import type { Intent } from '@core/intent/intents';
import { ECHO_BEATS } from '@core/engine/StrudelEngine';

const SCENE_ROW = 0; // first row holds M+ and the scene slots
const STORE_COLUMN = 0; // M+ key
// Last row holds the momentary gestures. [SPEC-17.40/17.41]
const HOLD_ROW = 2;
const DROP_COLUMN = 0;
const LOWPASS_COLUMN = 1;
const HIGHPASS_COLUMN = 2;
const RISER_COLUMN = 3;
const GATE_COLUMN = 4;
// Middle row: further held gestures. [SPEC-17.46]
const EFFECT_ROW = 1;
const PHASER_COLUMN = 0;
const ECHO_COLUMNS = [1, 2, 3] as const; // one per ECHO_BEATS entry

/** What the assigned keys must show. */
export interface SceneView {
  storeMode: boolean;
  /** One entry per scene slot: does it hold anything? */
  filled: boolean[];
  /** Index of the scene currently recalled, or null. */
  active: number | null;
  /** True while the DROP key is held. */
  dropActive: boolean;
  /** Which filter gesture is held, if any. [SPEC-17.41/17.42] */
  filterHold: 'lp' | 'hp' | 'riser' | null;
  /** True while the rhythmic gate is held. [SPEC-17.44] */
  gateActive: boolean;
  /** True while the global phaser is held. [SPEC-17.46] */
  phaserActive: boolean;
  /** Held echo sends, keyed by length in beats. [SPEC-17.47] */
  echoActive: Record<number, boolean>;
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
  dropIdle: [90, 40, 50], // DROP at rest
  dropActive: [235, 60, 60], // DROP held
  filterIdle: [35, 60, 90], // LP / HP at rest
  filterActive: [70, 170, 255], // filter held
  riserIdle: [70, 45, 95], // RISE at rest
  riserActive: [190, 110, 255], // RISE climbing
  gateIdle: [30, 80, 70], // GATE at rest
  gateActive: [40, 230, 190], // GATE chopping
  phaserIdle: [95, 70, 25], // PHASER at rest
  phaserActive: [255, 175, 45], // PHASER sweeping
  echoIdle: [40, 45, 100], // ECHO at rest
  echoActive: [120, 130, 255], // ECHO feeding
} satisfies Record<string, RGB>;

export type StreamDeckStatus = 'idle' | 'connecting' | 'ready' | 'error';

/** Label drawn on a key, or '' for a plain colour fill. [SPEC-17.39] */
function labelFor(column: number, row: number): string {
  if (row === HOLD_ROW) {
    if (column === DROP_COLUMN) return 'DROP';
    if (column === LOWPASS_COLUMN) return 'LP';
    if (column === HIGHPASS_COLUMN) return 'HP';
    if (column === RISER_COLUMN) return 'RISE';
    if (column === GATE_COLUMN) return 'GATE';
  }
  if (row === EFFECT_ROW) {
    if (column === PHASER_COLUMN) return 'PHASER';
    const echo = ECHO_COLUMNS.indexOf(column as (typeof ECHO_COLUMNS)[number]);
    if (echo >= 0) return `ECHO\n${ECHO_BEATS[echo]}`;
  }
  if (row !== SCENE_ROW) return '';
  return column === STORE_COLUMN ? 'M+' : String(column); // scene slots 1..4
}

/** Readable text colour over a background (perceived luminance). */
function inkFor([r, g, b]: RGB): string {
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#101216' : '#f2f4f8';
}

/**
 * Draw a labelled key as raw RGBA pixels. Keys are LCDs, so text is just an image
 * we render with a canvas; returns null if canvas is unavailable, and the caller
 * then falls back to a plain colour. [SPEC-17.39]
 */
function renderLabelledKey(
  width: number,
  height: number,
  bg: RGB,
  text: string,
): Uint8ClampedArray | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = `rgb(${bg[0]}, ${bg[1]}, ${bg[2]})`;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = inkFor(bg);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Labels vary in length ('1' … 'ECHO 16'), so lay them out on the lines given
  // by '\n' and shrink until the widest one fits the key. [SPEC-17.39]
  const lines = text.split('\n');
  const family = 'ui-monospace, "SF Mono", Menlo, monospace';
  let size = Math.round((height * 0.42) / Math.max(1, lines.length * 0.75));
  for (; size > 8; size--) {
    ctx.font = `bold ${size}px ${family}`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= width * 0.86) break;
  }
  const lineHeight = size * 1.1;
  const top = height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, width / 2, top + i * lineHeight));
  return ctx.getImageData(0, 0, width, height).data;
}

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

    const emit = (control: { type: string; column: number; row: number }, pressed: boolean) => {
      if (control.type !== 'button') return;
      const intent = this.controlToIntent(control.column, control.row, pressed);
      if (intent && this.onIntent) this.onIntent(intent);
    };
    device.on('down', (control) => emit(control, true));
    // Releases matter for momentary keys (DROP). [SPEC-17.40]
    device.on('up', (control) => emit(control, false));
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
    // Losing the device mid-press must not leave a held gesture stuck on. [SPEC-17.40/17.41]
    this.onIntent?.({ type: 'dropHold', on: false });
    this.onIntent?.({ type: 'filterHold', mode: 'lp', on: false });
    this.onIntent?.({ type: 'filterHold', mode: 'hp', on: false });
    this.onIntent?.({ type: 'filterHold', mode: 'riser', on: false });
    this.onIntent?.({ type: 'gateHold', on: false });
    this.onIntent?.({ type: 'phaserHold', on: false });
    for (const beats of ECHO_BEATS) this.onIntent?.({ type: 'echoHold', beats, on: false });
    this.device = null;
    this.buttons = [];
    this.lastColor.clear();
  }

  /** Intent for a press (`pressed`) or a release. Momentary keys emit on both. */
  private controlToIntent(column: number, row: number, pressed: boolean): Intent | null {
    if (row === HOLD_ROW) {
      // Momentary gestures: active only while held. [SPEC-17.40/17.41]
      if (column === DROP_COLUMN) return { type: 'dropHold', on: pressed };
      if (column === LOWPASS_COLUMN) return { type: 'filterHold', mode: 'lp', on: pressed };
      if (column === HIGHPASS_COLUMN) return { type: 'filterHold', mode: 'hp', on: pressed };
      if (column === RISER_COLUMN) return { type: 'filterHold', mode: 'riser', on: pressed };
      if (column === GATE_COLUMN) return { type: 'gateHold', on: pressed };
    }
    if (row === EFFECT_ROW) {
      if (column === PHASER_COLUMN) return { type: 'phaserHold', on: pressed };
      const echo = ECHO_COLUMNS.indexOf(column as (typeof ECHO_COLUMNS)[number]);
      if (echo >= 0) return { type: 'echoHold', beats: ECHO_BEATS[echo], on: pressed };
    }
    if (!pressed || row !== SCENE_ROW) return null; // the rest acts on press only
    if (column === STORE_COLUMN) return { type: 'sceneModeToggle' };
    return { type: 'scenePress', index: column - 1 };
  }

  private colorFor(column: number, row: number, view: SceneView): RGB {
    if (row === HOLD_ROW) {
      if (column === DROP_COLUMN) return view.dropActive ? COLOR.dropActive : COLOR.dropIdle;
      if (column === LOWPASS_COLUMN) {
        return view.filterHold === 'lp' ? COLOR.filterActive : COLOR.filterIdle;
      }
      if (column === HIGHPASS_COLUMN) {
        return view.filterHold === 'hp' ? COLOR.filterActive : COLOR.filterIdle;
      }
      if (column === RISER_COLUMN) {
        return view.filterHold === 'riser' ? COLOR.riserActive : COLOR.riserIdle;
      }
      if (column === GATE_COLUMN) return view.gateActive ? COLOR.gateActive : COLOR.gateIdle;
    }
    if (row === EFFECT_ROW) {
      if (column === PHASER_COLUMN) {
        return view.phaserActive ? COLOR.phaserActive : COLOR.phaserIdle;
      }
      const echo = ECHO_COLUMNS.indexOf(column as (typeof ECHO_COLUMNS)[number]);
      if (echo >= 0) {
        return view.echoActive[ECHO_BEATS[echo]] ? COLOR.echoActive : COLOR.echoIdle;
      }
    }
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
    const device = this.device;
    if (!device) return;
    for (const button of this.buttons) {
      const color = this.colorFor(button.column, button.row, view);
      const [r, g, b] = color;
      const label = labelFor(button.column, button.row);
      // The label is part of the cache key: a colour change must redraw the text.
      const key = `${r},${g},${b}|${label}`;
      if (this.lastColor.get(button.index) === key) continue;
      this.lastColor.set(button.index, key);

      const pixels =
        label && button.feedbackType === 'lcd'
          ? renderLabelledKey(button.pixelSize.width, button.pixelSize.height, color, label)
          : null;
      if (pixels) {
        device.fillKeyBuffer(button.index, pixels, { format: 'rgba' }).catch(() => undefined);
      } else {
        device.fillKeyColor(button.index, r, g, b).catch(() => undefined);
      }
    }
  }
}

export const streamDeck = new StreamDeckService();
