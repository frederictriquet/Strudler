// [SPEC-17.29] Last known physical position of the hardware faders/knobs.
//
// MIDI controllers cannot be queried: their real knob/fader position is unknown
// until the control is moved. The logical value therefore drifts from the
// physical one (GUI edits, effect focus changes, page reload), and the next touch
// jumps. We remember every position we DID observe (from incoming MIDI only —
// never from GUI edits) so the UI can draw a "ghost" marker showing where the
// hardware actually sits.
//
// Not persisted on purpose: the hardware may have been moved while the app was
// closed, so a restored value would be a guess presented as fact. The ghost only
// ever shows positions this session actually observed.

import { writable } from 'svelte/store';
import type { Intent } from '@core/intent/intents';
import { fullReloadOnHmr } from '@core/persist/hmr';

// Holds singleton state: a hot swap would leave the UI bound to a fresh store
// while the audio path keeps the old one. [SPEC-17.31]
fullReloadOnHmr(import.meta.hot);

/** Continuous intents produced by a physical fader/knob. */
type ContinuousIntent = Extract<
  Intent,
  { type: 'channelVolume' | 'channelFilter' | 'channelFxKnob' | 'channelFxFader' }
>;

const CONTINUOUS = new Set<Intent['type']>([
  'channelVolume',
  'channelFilter',
  'channelFxKnob',
  'channelFxFader',
]);

/** `${intentType}:${channel}` → last observed position, 0..1. */
export const physicalPositions = writable<Record<string, number>>({});

export function physicalKey(type: ContinuousIntent['type'], channel: number): string {
  return `${type}:${channel}`;
}

/** True when this intent carries a continuous (fader/knob) position. */
export function isContinuousIntent(intent: Intent): intent is ContinuousIntent {
  return CONTINUOUS.has(intent.type);
}

/** Record a position from an intent that came from hardware. No-op for the rest.
 *  Returns the previously known position (undefined the first time). */
export function recordPhysicalIntent(intent: Intent): number | undefined {
  if (!isContinuousIntent(intent)) return undefined;
  const { type, channel, value } = intent;
  const key = physicalKey(type, channel);
  let previous: number | undefined;
  physicalPositions.update((map) => {
    previous = map[key];
    return map[key] === value ? map : { ...map, [key]: value };
  });
  return previous;
}

// --- Soft takeover / pickup [SPEC-17.30] ---
//
// A hardware control whose physical position differs from the value it drives
// must first be moved onto that value before it takes over; until then its moves
// only feed the ghost, so nothing jumps.
//
// A control that already HAS control keeps it, however fast it is moved: a quick
// sweep can send successive messages far apart, and comparing that gap to a
// tolerance would wrongly drop it. Ownership is therefore tracked by value — we
// remember the value this control last wrote, and it keeps control as long as the
// parameter still holds it. As soon as something else changes the parameter (GUI
// edit, effect focus change, restore), the two differ and pickup re-arms.

/** Tolerance in 0..1 units for "the control has reached the value". ~2.5 MIDI steps. */
const PICKUP_TOLERANCE = 0.02;
/** Float equality slack for "is the parameter still where this control left it?". */
const OWNED_EPSILON = 1e-6;

/** Value each control last wrote, keyed like `physicalPositions`. */
const ownedValues = new Map<string, number>();

/**
 * Should a hardware move be applied? Soft takeover:
 *
 * - A control that still HOLDS the parameter (nothing else changed it since) keeps
 *   driving it, however fast it is moved. Ownership is tracked *by value*, not by
 *   proximity: a quick sweep sends messages far apart, and comparing that gap to a
 *   tolerance would drop the control mid-gesture.
 * - A control that is out of sync (the parameter was changed by the GUI, by an
 *   effect focus change [SPEC-17.28], or restored) is ignored until it is moved
 *   ONTO the value — the ghost shows the gap to close. Nothing jumps, and the
 *   parameter holds still meanwhile.
 *
 * @param key control key (`physicalKey(...)`)
 * @param previous last known physical position (undefined if never moved)
 * @param incoming new physical position
 * @param logical current value of the parameter it drives
 */
export function shouldTakeOver(
  key: string,
  previous: number | undefined,
  incoming: number,
  logical: number,
): boolean {
  const owned = ownedValues.get(key);
  const inControl = owned !== undefined && Math.abs(owned - logical) <= OWNED_EPSILON;
  const caughtUp =
    Math.abs(incoming - logical) <= PICKUP_TOLERANCE ||
    // Fast catch-up: between two messages the control may jump over the value.
    // Crossing it counts as reaching it.
    (previous !== undefined && (previous - logical) * (incoming - logical) < 0);

  if (!inControl && !caughtUp) return false;
  ownedValues.set(key, incoming);
  return true;
}

/** Forget ownership (e.g. controller reconnected), so pickup re-arms. */
export function resetTakeover(): void {
  ownedValues.clear();
}
