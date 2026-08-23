// [SPEC-11.2/11.4, PLAN C.5] Session journal format. Gestures only (Q5): every
// event is an Intent timestamped in beats relative to the recording start. The
// header carries the tempo and the initial channel/launch state so replay
// reproduces the performance against the clock ([SPEC-11.2]).

import type { Intent } from '@core/intent/intents';
import type { ChannelState } from '@core/channels/types';
import { DEFAULT_SET_COLOR, type PadSet } from '@core/channels/sets';
import type { LaunchMode, WindowSize } from '@core/launch/Launcher';

/** 2 = pad sets [SPEC-20.12]; version 1 carried a single `initialChannels`. */
export const SESSION_VERSION = 2;

export interface SessionEvent {
  /** Beats elapsed since recording start. */
  t: number;
  intent: Intent;
}

export interface Session {
  version: number;
  bpm: number;
  mode: LaunchMode;
  window: WindowSize;
  /** Every pad set at record start (associations, volume, filter, playing), and
   *  which one the pads addressed. [SPEC-20.12] */
  initialSets: PadSet[];
  activeSet: number;
  events: SessionEvent[];
}

/** A version-1 session: one rack, no sets. Migrated on load. */
interface SessionV1 {
  version: 1;
  bpm: number;
  mode: LaunchMode;
  window: WindowSize;
  initialChannels: ChannelState[];
  events: SessionEvent[];
}

/** Wrap a pre-sets session into a single set, so an old journal stays replayable
 *  instead of being rejected. [SPEC-20.12] */
function migrateV1(s: SessionV1): Session {
  return {
    version: SESSION_VERSION,
    bpm: s.bpm,
    mode: s.mode,
    window: s.window,
    initialSets: [
      { id: 'set-1', name: 'Set 1', color: DEFAULT_SET_COLOR, channels: s.initialChannels },
    ],
    activeSet: 0,
    events: Array.isArray(s.events) ? s.events : [],
  };
}

/** Parse and validate a session JSON string. Throws on malformed input. [SPEC-14.3] */
export function parseSession(json: string): Session {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`JSON invalide: ${(err as Error).message}`, { cause: err });
  }
  const s = data as Partial<Session> & Partial<SessionV1>;
  if (typeof s.version !== 'number') throw new Error('session: `version` manquant');
  if (typeof s.bpm !== 'number') throw new Error('session: `bpm` manquant');
  if (!Array.isArray(s.events)) throw new Error('session: `events` manquant');
  if (s.version === 1) {
    if (!Array.isArray(s.initialChannels)) throw new Error('session: `initialChannels` manquant');
    return migrateV1(s as SessionV1);
  }
  if (s.version !== SESSION_VERSION) {
    throw new Error(`session: version ${s.version} non supportée (attendu ${SESSION_VERSION})`);
  }
  if (!Array.isArray(s.initialSets) || s.initialSets.length === 0) {
    throw new Error('session: `initialSets` manquant');
  }
  return {
    ...(s as Session),
    activeSet: typeof s.activeSet === 'number' ? s.activeSet : 0,
  };
}

export function serializeSession(session: Session): string {
  return JSON.stringify(session, null, 2);
}
