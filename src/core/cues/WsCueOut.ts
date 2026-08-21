// [SPEC-19] WebSocket sink — one JSON object per cue, for a receiving app.
//
// Strudler is the CLIENT: a browser cannot listen on a port, so the receiving app
// owns the server. On connect we send a `hello` carrying the current state, so a
// receiver that starts late is immediately in sync.
//
// Reconnects on its own as long as the output is enabled — a lighting cue must not
// be lost for the rest of a set because a receiver restarted. Failures are exposed
// (state + message), never console-only. [SPEC-14.3]

import { CUE_PROTOCOL_VERSION, type CueSnapshot, type EmittedCue } from './types';

export type WsCueState = 'idle' | 'connecting' | 'open' | 'error';

const RECONNECT_MS = 2000;

export class WsCueOut {
  private socket: WebSocket | null = null;
  private url = '';
  private retry: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  private snapshot: (() => CueSnapshot) | null = null;
  private state: WsCueState = 'idle';
  private error: string | null = null;
  private stateListeners = new Set<(state: WsCueState, error: string | null) => void>();
  /** Cues dropped because the socket was not open — surfaced, not hidden. */
  private dropped = 0;

  get currentState(): WsCueState {
    return this.state;
  }

  get lastError(): string | null {
    return this.error;
  }

  get droppedCount(): number {
    return this.dropped;
  }

  onState(listener: (state: WsCueState, error: string | null) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Open (or re-open) the connection. Idempotent for an unchanged URL. */
  start(url: string, snapshot: () => CueSnapshot): void {
    this.snapshot = snapshot;
    this.wanted = true;
    if (this.url === url && (this.state === 'open' || this.state === 'connecting')) return;
    this.url = url;
    this.close();
    this.open();
  }

  stop(): void {
    this.wanted = false;
    this.close();
    this.setState('idle', null);
  }

  /** Serialize and send a cue. Silently impossible → counted, not ignored. */
  handle(cue: EmittedCue): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.dropped++;
      return;
    }
    this.socket.send(JSON.stringify({ v: CUE_PROTOCOL_VERSION, ...cue }));
  }

  private open(): void {
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (err) {
      // Malformed URL: no point retrying the same one.
      this.wanted = false;
      this.setState('error', `URL invalide (${(err as Error).message})`);
      return;
    }
    this.socket = socket;
    this.setState('connecting', null);

    socket.onopen = () => {
      this.setState('open', null);
      const snap = this.snapshot?.();
      if (snap) {
        socket.send(
          JSON.stringify({
            v: CUE_PROTOCOL_VERSION,
            type: 'hello',
            app: 'strudler',
            t: Date.now(),
            ...snap,
          }),
        );
      }
    };
    // onerror carries no reason in browsers; onclose always follows, so the
    // message is built there from the close code.
    socket.onerror = () => {
      this.error = `connexion impossible à ${this.url}`;
    };
    socket.onclose = (event) => {
      if (this.socket === socket) this.socket = null;
      if (!this.wanted) {
        this.setState('idle', null);
        return;
      }
      const why = event.reason || this.error || `fermée (code ${event.code})`;
      this.setState('error', `${why} — nouvelle tentative dans ${RECONNECT_MS / 1000} s`);
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.retry !== null) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.wanted) this.open();
    }, RECONNECT_MS);
  }

  private close(): void {
    if (this.retry !== null) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onerror = socket.onclose = null;
      socket.close();
    }
  }

  private setState(state: WsCueState, error: string | null): void {
    this.state = state;
    this.error = error;
    for (const listener of this.stateListeners) listener(state, error);
  }
}
