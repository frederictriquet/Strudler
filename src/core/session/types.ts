// [SPEC-11.2/11.4, PLAN C.5] Session journal format. Gestures only (Q5): every
// event is an Intent timestamped in beats relative to the recording start. The
// header carries the tempo and the initial channel/launch state so replay
// reproduces the performance against the clock ([SPEC-11.2]).

import type { Intent } from '@core/intent/intents';
import type { ChannelState } from '@core/channels/types';
import type { LaunchMode, WindowSize } from '@core/launch/Launcher';

export const SESSION_VERSION = 1;

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
  /** Full channel state at record start (associations, volume, filter, playing). */
  initialChannels: ChannelState[];
  events: SessionEvent[];
}

/** Parse and validate a session JSON string. Throws on malformed input. [SPEC-14.3] */
export function parseSession(json: string): Session {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`JSON invalide: ${(err as Error).message}`, { cause: err });
  }
  const s = data as Partial<Session>;
  if (typeof s.version !== 'number') throw new Error('session: `version` manquant');
  if (s.version !== SESSION_VERSION) {
    throw new Error(`session: version ${s.version} non supportée (attendu ${SESSION_VERSION})`);
  }
  if (typeof s.bpm !== 'number') throw new Error('session: `bpm` manquant');
  if (!Array.isArray(s.initialChannels)) throw new Error('session: `initialChannels` manquant');
  if (!Array.isArray(s.events)) throw new Error('session: `events` manquant');
  return s as Session;
}

export function serializeSession(session: Session): string {
  return JSON.stringify(session, null, 2);
}
