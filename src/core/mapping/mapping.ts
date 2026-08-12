// [SPEC-6.2/6.3] Declarative controller mapping. Each controller is described by
// a port-name match and a list of entries binding a physical control (CC or note)
// to a logical function. Nothing is hard-coded elsewhere ([SPEC-5.5]); adding a
// controller = adding a mapping, no engine change ([SPEC-6.3]). Device identity
// (port name) resolves CC/note collisions between controllers ([SPEC-6.5]) —
// e.g. nano Mute CC 48-55 vs APC faders CC 48-55.

import type { Intent } from '@core/intent/intents';
import { DEFAULT_SLOTS_PER_CHANNEL, FX_KINDS } from '@core/channels/types';

export type ControlType = 'fader' | 'knob' | 'button';
export type MessageType = 'cc' | 'note';

export type IntentFunction =
  | 'channelVolume'
  | 'channelFilter'
  | 'channelEffectToggle'
  | 'channelFxPrev'
  | 'channelFxNext'
  | 'channelFxToggle'
  | 'channelFxKnob'
  | 'channelFxFader'
  | 'slotToggle'
  | 'modeToggle'
  | 'channelModeToggle'
  | 'windowPrev'
  | 'windowNext'
  | 'resync'
  | 'nudgeBack'
  | 'nudgeForward'
  | 'transportStart'
  | 'transportStop';

export interface MappingEntry {
  type: ControlType;
  messageType: MessageType;
  /** CC number or note number, depending on messageType. */
  code: number;
  intent: IntentFunction;
  channel?: number;
  slot?: number;
}

/** Visual state of a slot button, for LED color coding. `pendingStart` /
 *  `pendingStop` distinguish a queued quantized toggle that will start vs stop
 *  the slot. [SPEC-6.4, SPEC-17.16] */
export type SlotVisual = 'empty' | 'assigned' | 'playing' | 'pendingStart' | 'pendingStop';

/** How to address this controller's button LEDs. On RGB controllers (APC mini
 *  mk2) each state maps to a palette color (velocity) and, optionally, a note
 *  channel for brightness/blink; on single-color LEDs (nanoKONTROL2) states just
 *  collapse to on/off. [SPEC-6.4, SPEC-17.15] */
export interface LedSpec {
  type: MessageType;
  /** Palette color (note velocity) or CC value per slot visual state. */
  color: Record<SlotVisual, number>;
  /** Optional note channel (0-15) per state — APC uses it for brightness/blink. */
  statusChannel?: Partial<Record<SlotVisual, number>>;
}

export interface ControllerMapping {
  /** Substring matched (case-insensitive) against the MIDI port name. [SPEC-6.2] */
  match: string;
  name: string;
  entries: MappingEntry[];
  led: LedSpec;
}

const CC = 0xf0 & 0xb0; // 0xB0
const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const PRESS_THRESHOLD = 64; // CC buttons send 127 on press, 0 on release
/** Phase shift per nudge press, in beats (a 16th note). [SPEC-17.34] */
export const NUDGE_BEATS = 0.25;

function messageKind(status: number): MessageType | null {
  const s = status & 0xf0;
  if (s === 0xb0) return 'cc';
  if (s === NOTE_ON || s === NOTE_OFF) return 'note';
  return null;
}

/** Korg nanoKONTROL2 default preset (Scene 1). CC map from study/nanokontrol2.md.
 *  Reserved for per-channel EFFECTS now that the APC drives the sounds [SPEC-17.21/
 *  17.23/17.28]: per strip, S = previous effect, R = next effect, M = on/off of the
 *  focused effect; the knob (p1) and fader (p2) edit its two parameters. Browsing
 *  with S/R gives access to the whole effect list while keeping all 8 channels. */
function buildNanoKontrol2(channels = 8): ControllerMapping {
  const entries: MappingEntry[] = [];
  const cc = (code: number, intent: IntentFunction, channel?: number, slot?: number, type: ControlType = 'button'): MappingEntry => ({
    type,
    messageType: 'cc',
    code,
    intent,
    channel,
    slot,
  });
  for (let ch = 0; ch < channels; ch++) {
    entries.push(cc(0 + ch, 'channelFxFader', ch, undefined, 'fader')); // fader → p2
    entries.push(cc(16 + ch, 'channelFxKnob', ch, undefined, 'knob')); // knob → p1
    // S = effet précédent, M = on/off de l'effet en focus, R = effet suivant. [SPEC-17.28]
    entries.push(cc(32 + ch, 'channelFxPrev', ch));
    entries.push(cc(48 + ch, 'channelFxToggle', ch));
    entries.push(cc(64 + ch, 'channelFxNext', ch));
  }
  entries.push(cc(41, 'transportStart')); // PLAY → (re)start clock
  entries.push(cc(42, 'transportStop')); // STOP → stop everything
  entries.push(cc(46, 'modeToggle')); // CYCLE  [SPEC-7.5]
  entries.push(cc(58, 'windowPrev')); // TRACK ◄ [SPEC-7.6]
  entries.push(cc(59, 'windowNext')); // TRACK ►
  entries.push(cc(60, 'resync')); // MARKER SET  [SPEC-8.2]
  // MARKER ◄ ► (either side of SET) → nudge the phase back / forward. [SPEC-17.34]
  entries.push(cc(61, 'nudgeBack'));
  entries.push(cc(62, 'nudgeForward'));
  return {
    match: 'nanokontrol2',
    name: 'Korg nanoKONTROL2',
    entries,
    // Single-color LED: lit when playing/pending, off otherwise (can't show the
    // start-vs-stop distinction — that's an RGB-controller feature).
    led: {
      type: 'cc',
      color: { empty: 0, assigned: 0, playing: 127, pendingStart: 127, pendingStop: 127 },
    },
  };
}

/**
 * Akai APC mini mk2 (added by config, [SPEC-6.1]). Hardware validated on device.
 * - Faders: CC 48-55 → channel volume (collides with nano Mute CC 48-55; resolved
 *   by device name, [SPEC-6.5]).
 * - 8×8 grid: note = row*8 + col, with row 0 at the BOTTOM of the pad. The GUI
 *   lists slots top→bottom, so we invert: slot = 7 - row → the TOP physical row is
 *   slot 0. channel = col. Gives up to 8 slots per channel (Q3).
 * - Bottom track buttons (notes 100-107) → per-channel quantize toggle (the "9th
 *   button" under each column). [SPEC-17.17]
 * - Scene-launch column (notes 112-115) → global mode / window / resync.
 */
const APC_TRACK_BUTTON_BASE = 100; // bottom row of 8 buttons: notes 100..107

function buildApcMiniMk2(channels = 8): ControllerMapping {
  const entries: MappingEntry[] = [];
  for (let ch = 0; ch < channels; ch++) {
    entries.push({ type: 'fader', messageType: 'cc', code: 48 + ch, intent: 'channelVolume', channel: ch });
    // Bottom button under each column → toggle that channel's quantization.
    entries.push({
      type: 'button',
      messageType: 'note',
      code: APC_TRACK_BUTTON_BASE + ch,
      intent: 'channelModeToggle',
      channel: ch,
    });
  }
  for (let note = 0; note < 64; note++) {
    const col = note % 8;
    const row = Math.floor(note / 8);
    const slot = 7 - row; // invert: top physical row = slot 0, matching the GUI order
    entries.push({ type: 'button', messageType: 'note', code: note, intent: 'slotToggle', channel: col, slot });
  }
  entries.push({ type: 'button', messageType: 'note', code: 112, intent: 'modeToggle' });
  entries.push({ type: 'button', messageType: 'note', code: 113, intent: 'windowPrev' });
  entries.push({ type: 'button', messageType: 'note', code: 114, intent: 'windowNext' });
  entries.push({ type: 'button', messageType: 'note', code: 115, intent: 'resync' });
  return {
    match: 'apc mini mk2',
    name: 'Akai APC mini mk2',
    entries,
    // RGB pads: velocity = color in the mk2 palette (grouped by 4 brightness
    // steps). Confirmed: 21 ≈ green. Others follow the standard palette and can
    // be tuned. Note channel 0 = solid; pending blinks via channel 10. [SPEC-17.15]
    led: {
      type: 'note',
      color: {
        empty: 0, // off
        assigned: 45, // blue — a track is loaded but idle (clearly visible)
        playing: 21, // green — solid
        pendingStart: 21, // green, blinking → about to START
        pendingStop: 5, // red, blinking → about to STOP
      },
      // Note channel = brightness/behavior on the mk2. Assigned-idle stays dim
      // (channel 0 = 10%, unobtrusive); playing is full brightness (channel 6 =
      // 100%); queued toggles blink (channel 10).
      statusChannel: { playing: 6, pendingStart: 10, pendingStop: 10 },
    },
  };
}

// Registry of known controllers. Both usable simultaneously. [SPEC-6.1]
export const controllerMappings: ControllerMapping[] = [buildNanoKontrol2(), buildApcMiniMk2()];

/** Find the mapping for a device by port name (substring, case-insensitive). */
export function mappingForDevice(portName: string): ControllerMapping | null {
  const lower = portName.toLowerCase();
  return controllerMappings.find((m) => lower.includes(m.match.toLowerCase())) ?? null;
}

/** The mapping entry a raw message targets, or null when unmapped. Used by the
 *  MIDI monitor to show whether a control is bound. [SPEC-17.35] */
export function lookupEntry(
  mapping: ControllerMapping,
  status: number,
  data1: number,
): MappingEntry | null {
  const kind = messageKind(status);
  if (!kind) return null;
  return mapping.entries.find((e) => e.messageType === kind && e.code === data1) ?? null;
}

/** Convert a raw MIDI message into an Intent, or null if unmapped/ignored. */
export function resolveIntent(
  mapping: ControllerMapping,
  status: number,
  data1: number,
  data2: number,
): Intent | null {
  const kind = messageKind(status);
  if (!kind) return null;
  const entry = mapping.entries.find((e) => e.messageType === kind && e.code === data1);
  if (!entry) return null;

  // Press detection: CC ≥ threshold; note = NoteOn with velocity > 0.
  const pressed =
    kind === 'cc' ? data2 >= PRESS_THRESHOLD : (status & 0xf0) === NOTE_ON && data2 > 0;

  switch (entry.intent) {
    case 'channelVolume':
      return { type: 'channelVolume', channel: entry.channel ?? 0, value: data2 / 127 };
    case 'channelFilter':
      return { type: 'channelFilter', channel: entry.channel ?? 0, value: data2 / 127 };
    case 'channelFxKnob':
      return { type: 'channelFxKnob', channel: entry.channel ?? 0, value: data2 / 127 };
    case 'channelFxFader':
      return { type: 'channelFxFader', channel: entry.channel ?? 0, value: data2 / 127 };
    case 'channelEffectToggle':
      return pressed
        ? { type: 'channelEffectToggle', channel: entry.channel ?? 0, effect: FX_KINDS[entry.slot ?? 0] }
        : null;
    case 'channelFxPrev':
      return pressed ? { type: 'channelFxPrev', channel: entry.channel ?? 0 } : null;
    case 'channelFxNext':
      return pressed ? { type: 'channelFxNext', channel: entry.channel ?? 0 } : null;
    case 'channelFxToggle':
      return pressed ? { type: 'channelFxToggle', channel: entry.channel ?? 0 } : null;
    case 'slotToggle':
      return pressed ? { type: 'slotToggle', channel: entry.channel ?? 0, slot: entry.slot ?? 0 } : null;
    case 'modeToggle':
      return pressed ? { type: 'modeToggle' } : null;
    case 'channelModeToggle':
      return pressed ? { type: 'channelModeToggle', channel: entry.channel ?? 0 } : null;
    case 'windowPrev':
      return pressed ? { type: 'windowPrev' } : null;
    case 'windowNext':
      return pressed ? { type: 'windowNext' } : null;
    case 'resync':
      return pressed ? { type: 'resync' } : null;
    case 'nudgeBack':
      return pressed ? { type: 'gridNudge', beats: -NUDGE_BEATS } : null;
    case 'nudgeForward':
      return pressed ? { type: 'gridNudge', beats: NUDGE_BEATS } : null;
    case 'transportStart':
      return pressed ? { type: 'transportStart' } : null;
    case 'transportStop':
      return pressed ? { type: 'transportStop' } : null;
    default:
      return null;
  }
}

/** Code (CC/note) to address a slot button's LED on this controller, or null. */
export function slotButtonCode(
  mapping: ControllerMapping,
  channel: number,
  slot: number,
): number | null {
  const entry = mapping.entries.find(
    (e) => e.type === 'button' && e.intent === 'slotToggle' && e.channel === channel && e.slot === slot,
  );
  return entry ? entry.code : null;
}

/** All (channel, slot, code) button targets, for full LED refresh. [SPEC-6.4] */
export function slotButtonTargets(
  mapping: ControllerMapping,
  channelCount: number,
  slotsPerChannel: number = DEFAULT_SLOTS_PER_CHANNEL,
): Array<{ channel: number; slot: number; code: number }> {
  const targets: Array<{ channel: number; slot: number; code: number }> = [];
  for (let channel = 0; channel < channelCount; channel++) {
    for (let slot = 0; slot < slotsPerChannel; slot++) {
      const code = slotButtonCode(mapping, channel, slot);
      if (code !== null) targets.push({ channel, slot, code });
    }
  }
  return targets;
}

/** MIDI status byte for a LED message of the given type, on the given channel
 *  (0-15). The channel selects brightness/blink behavior on the APC. [SPEC-6.4] */
export function ledStatus(type: MessageType, channel = 0): number {
  return (type === 'note' ? NOTE_ON : CC) | (channel & 0x0f);
}

/** Resolve a slot's visual state from its assignment/play/pending flags. A queued
 *  quantized toggle resolves to pendingStart (currently stopped → will play) or
 *  pendingStop (currently playing → will stop). [SPEC-17.16] */
export function slotVisual(state: {
  trackId: string | null;
  playing: boolean;
  pending: boolean;
}): SlotVisual {
  if (!state.trackId) return 'empty';
  if (state.pending) return state.playing ? 'pendingStop' : 'pendingStart';
  if (state.playing) return 'playing';
  return 'assigned';
}
