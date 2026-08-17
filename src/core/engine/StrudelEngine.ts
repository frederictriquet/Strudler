// [SPEC-3] Music-as-code engine — wraps Strudel core/mini/webaudio behind a
// stable interface, so the rest of the app never depends on Strudel internals
// directly ([PLAN F] "isoler l'Engine derrière une interface stable").
//
// Also acts as the Clock's TimeSource ([SPEC-3.4]): it owns the audio scheduler,
// which is the single authoritative time source of the app.

import * as strudelCore from '@strudel/core';
import * as strudelMini from '@strudel/mini';
// Chords & voicings: `chord(...).anchor(...).voicing()` keeps a progression in a
// fixed register with automatic voice leading, instead of shifting a fixed set of
// notes around. [SPEC-17.48]
import * as strudelTonal from '@strudel/tonal';
import * as strudelWebaudio from '@strudel/webaudio';
import { transpiler } from '@strudel/transpiler';
import { DEFAULT_BEATS_PER_CYCLE, type TimeSource } from '@core/clock/Clock';
import { defaultEffects, type ChannelEffects } from '@core/channels/types';
import {
  snapTo,
  TREMOLO_DIVS,
  PHASER_CYCLES,
  CRUSH_BITS,
  COARSE_FACTORS,
} from '@core/channels/fxParams';
import { fullReloadOnHmr } from '@core/persist/hmr';

// Owns the audio graph and the Strudel repl. [SPEC-17.31]
fullReloadOnHmr(import.meta.hot);

const { repl, evalScope, ref } = strudelCore;
const { getAudioContext, webaudioOutput, registerSynthSounds, initAudioOnFirstClick, samples } =
  strudelWebaudio;

// Re-exported by @strudel/webaudio from superdough, which ships no types. Reached
// defensively: if it ever goes away, the drop still works through the per-event
// gain ref, it just no longer cuts sounds already ringing. [SPEC-17.40]
type OrbitBuses = {
  nodes?: Record<
    number,
    {
      output?: { gain?: AudioParam };
      djfNode?: { parameters?: { get(name: string): AudioParam | undefined } };
    }
  >;
  /** Master chain: everything meets at destinationGain before the destination. */
  output?: { destinationGain?: AudioNode };
};
const getSuperdoughAudioController = (
  strudelWebaudio as unknown as { getSuperdoughAudioController?: () => OrbitBuses | undefined }
).getSuperdoughAudioController;

export type EngineStatus = 'idle' | 'starting' | 'ready' | 'playing' | 'error';

/**
 * One event produced by a pattern, as returned by `queryEvents`. [SPEC-18.8]
 * Times are in CYCLES from the start of the query (1 cycle = 4 beats).
 */
export interface HapInfo {
  /** Clipped start/end inside the queried span. */
  begin: number;
  end: number;
  /** The event's true extent, which may exceed the queried span. */
  wholeBegin: number;
  wholeEnd: number;
  /** False for a fragment whose attack happened before the queried span. */
  hasOnset: boolean;
  /** Control values (`s`, `n`, `note`, `gain`, …) as plain data. */
  value: Record<string, unknown>;
}

type Repl = ReturnType<typeof repl>;

export const DEFAULT_CHANNEL_GAIN = 0.8;
export const NEUTRAL_FILTER = 0.5;

/** Cap on waiting for AudioContext.resume(): outside a user gesture the promise
 *  can stay pending forever, and the caller must still get an answer. [SPEC-17.50] */
const RESUME_TIMEOUT_MS = 2000;

// Bipolar filter mapping ([SPEC-7.2], Q1 = single bipolar knob). One value
// f ∈ [0,1] per channel: 0.5 = neutral, f<0.5 sweeps a low-pass down (darker),
// f>0.5 sweeps a high-pass up (thinner). Each half bypasses (opens fully) at the
// center, so both filters are always applied but inaudible at f=0.5.
const LPF_MIN = 120;
const LPF_MAX = 20000;
const HPF_MIN = 20;
const HPF_MAX = 8000;

function lpfCutoff(f: number): number {
  if (f >= NEUTRAL_FILTER) return LPF_MAX; // right half: low-pass open
  const t = f / NEUTRAL_FILTER; // 0 (full left) .. 1 (center)
  return LPF_MIN * Math.pow(LPF_MAX / LPF_MIN, t);
}

function hpfCutoff(f: number): number {
  if (f <= NEUTRAL_FILTER) return HPF_MIN; // left half: high-pass open
  const t = (f - NEUTRAL_FILTER) / NEUTRAL_FILTER; // 0 (center) .. 1 (full right)
  return HPF_MIN * Math.pow(HPF_MAX / HPF_MIN, t);
}

// --- Per-channel effect mapping (0..1 knob/fader → engine units). [SPEC-17.23] ---
// Delay time as a fraction of a cycle (1 cycle = 4 beats), tempo-synced via the
// fxdtime ref: 0.125 cycle = one 1/8 note. [SPEC-17.24]
const FX_DELAY_DIV = 0.125;
// Global DJ filter (`djf`): 0.5 bypasses, below is low-pass, above high-pass.
// The held gestures use fixed, musical positions. [SPEC-17.41]
export const DJF_NEUTRAL = 0.5;
export const DJF_LOWPASS = 0.2; // ≈ 375 Hz — keeps kick and bass, cuts the top
export const DJF_HIGHPASS = 0.75; // ≈ 915 Hz — strips the low end, keeps the air
export const DJF_RISER_TOP = 0.9; // ≈ 6 kHz — where a held riser climbs to
/** Riser climb, in beats. Ramped linearly in `djf`, whose cutoff curve is a 4th
 *  power — so the sweep is exponential in Hz, which is how the ear reads it. */
export const RISER_BEATS = 8;
/** Rhythmic gate: steps per beat (2 = eighth notes) and how much of a step is open. */
export const GATE_STEPS_PER_BEAT = 2;
const GATE_DUTY = 0.5;
const GATE_LOOKAHEAD_S = 0.2; // schedule this far ahead, so timing is sample-accurate
const GATE_EDGE_S = 0.004; // short fade on each edge, avoids clicks
/** Beats over which the chop deepens: the gate fades in instead of slamming. */
const GATE_FADE_IN_BEATS = 8;

// Held global phaser [SPEC-17.46]: superdough already has one, so it is driven
// through the same refs as the per-channel PHS effect rather than rebuilt in Web
// Audio. Slow sweep (4 cycles = 16 beats), tempo-locked.
const GLOBAL_PHASER_CYCLES = 4;
const GLOBAL_PHASER_DEPTH = 1.2;

// Tempo-locked echoes [SPEC-17.47]: a send per musical length, held on a key.
export const ECHO_BEATS = [1, 2, 4] as const;
const ECHO_FEEDBACK = 0.55; // each repeat ~5 dB down: a few audible echoes
const ECHO_WET = 0.8;
const ECHO_SEND_RAMP_S = 0.02;
const ECHO_MAX_DELAY_S = 12; // room for 4 beats even at very slow tempos
function fxLpfHz(p: number): number {
  return LPF_MIN * Math.pow(LPF_MAX / LPF_MIN, Math.min(1, Math.max(0, p)));
}
function fxHpfHz(p: number): number {
  return HPF_MIN * Math.pow(HPF_MAX / HPF_MIN, Math.min(1, Math.max(0, p)));
}
const clamp01 = (p: number): number => Math.min(1, Math.max(0, p));
const fxQ = (p: number): number => clamp01(p) * 25; // resonance 0..25
const fxDelayFb = (p: number): number => clamp01(p) * 0.9; // feedback 0..0.9
const fxDelayMix = (p: number): number => clamp01(p) * 0.8; // wet 0..0.8
const fxRoomMix = (p: number): number => clamp01(p); // room 0..1
const fxRoomSize = (p: number): number => 0.1 + clamp01(p) * 3.9; // size 0.1..4
// PHASER: sweep length snapped to binary cycle divisions (tempo-synced, like the
// tremolo), depth = all-pass Q. superdough only builds the phaser when depth > 0,
// so depth 0 is a free bypass. [SPEC-17.32, SPEC-17.33]
const fxPhaserDepth = (p: number): number => clamp01(p) * 1.5;
// TREMOLO: pulses per cycle (1 cycle = 4 beats); superdough computes the LFO
// frequency as cps × sync, so it follows the tempo. [SPEC-17.32]
const fxTremoloSync = (p: number): number => snapTo(TREMOLO_DIVS, p);
const fxTremoloDepth = (p: number): number => clamp01(p);
// LOFI: bit depth and decimation are counts → binary steps. [SPEC-17.33]
const fxBits = (p: number): number => snapTo(CRUSH_BITS, p);
const fxCoarse = (p: number): number => snapTo(COARSE_FACTORS, p);
// DRIVE: wave-shaping distortion + shaper, with a compensating postgain so
// turning it up does not blow the level. [SPEC-17.28]
const fxDistort = (p: number): number => clamp01(p) * 2.5;
const fxShape = (p: number): number => clamp01(p) * 0.6;
const fxDrivePost = (p1: number, p2: number): number =>
  1 - 0.5 * Math.max(clamp01(p1), clamp01(p2));

export class StrudelEngine implements TimeSource {
  private repl: Repl | null = null;
  private measureRepl: Repl | null = null; // throwaway repl for length measurement (never started)
  private armed: Promise<void> | null = null;
  private scopeReady: Promise<void> | null = null;
  private lastEvalError: Error | null = null;

  // Per-channel gain/filter, read live through refs (`chgain`/`chlpf`/`chhpf`)
  // so knob & fader moves take effect immediately without re-evaluating the
  // pattern. [SPEC-7.1, SPEC-7.2]
  private readonly channelGains = new Map<number, number>();
  private readonly channelFilters = new Map<number, number>();
  // Per-channel effects (LPF / delay / reverb), read live via fx* refs. [SPEC-17.23]
  private readonly channelEffects = new Map<number, ChannelEffects>();
  // Current tempo (cycles per second), for tempo-synced delay time. [SPEC-17.24]
  private cps = 0.5;
  // Global phase offset in cycles, applied to every voice with `.late()`. The
  // scheduler has no phase API, so shifting what is HEARD means shifting the
  // patterns themselves. [SPEC-17.34]
  private phaseOffsetCycles = 0;

  // Selected musical key (Camelot code) + whether transposition is forced. When
  // forceKey is off, pitched tracks play in their written key. [SPEC-17.19/17.20]
  private selectedKeyCode: string | null = null;
  private forceKeyOn = false;

  /**
   * Arm audio unlock. MUST be called once at app startup, BEFORE any click:
   * initAudioOnFirstClick resolves on the *next* mousedown, so if it were armed
   * from inside a click handler it would miss the current gesture and hang until
   * the following click. Arming at mount lets the first user mousedown (incl. the
   * Start button) resume the AudioContext.
   */
  arm(): void {
    if (this.armed) return;
    this.armed = initAudioOnFirstClick();
    // Register the pattern-eval scope eagerly (no audio graph needed for this).
    this.scopeReady = (async () => {
      await evalScope(strudelCore, strudelMini, strudelWebaudio, strudelTonal);
      await registerSynthSounds();
      // Live per-channel control accessors available inside evaluated code.
      await evalScope({
        chgain: (id: number) => ref(() => this.gainFor(id)),
        // Per-channel effect refs. The LP/HP cutoffs fall back to the bipolar
        // filter when their fx is off; delay/reverb are neutral (0) when off, so
        // toggling and knob/fader moves are instant without re-eval. [SPEC-17.23]
        fxcut: (id: number) => ref(() => this.fxCutFor(id)),
        fxq: (id: number) => ref(() => this.fxQFor(id)),
        fxhcut: (id: number) => ref(() => this.fxHCutFor(id)),
        fxhq: (id: number) => ref(() => this.fxHQFor(id)),
        fxdmix: (id: number) => ref(() => this.fxDelayMixFor(id)),
        fxdfb: (id: number) => ref(() => fxDelayFb(this.fxFor(id).delay.p1)),
        fxroom: (id: number) => ref(() => this.fxRoomFor(id)),
        fxsize: (id: number) => ref(() => fxRoomSize(this.fxFor(id).reverb.p2)),
        // Tempo-synced delay time in seconds (global, updates with the tempo). [SPEC-17.24]
        fxdtime: () => ref(() => this.delayTimeSeconds()),
        // Global DJ filter, shared by every channel. [SPEC-17.41]
        gdjf: () => ref(() => this.globalDjf),
        // Phaser: always in the chain — depth 0 means superdough builds nothing,
        // so it costs nothing while off. [SPEC-17.32]
        fxphrate: (id: number) => ref(() => this.fxPhaserRateFor(id)),
        fxphdepth: (id: number) => ref(() => this.fxPhaserDepthFor(id)),
        // Tremolo (tempo-synced, heavy → inserted only while active). [SPEC-17.32]
        fxtrsync: (id: number) => ref(() => fxTremoloSync(this.fxFor(id).tremolo.p1)),
        fxtrdepth: (id: number) => ref(() => fxTremoloDepth(this.fxFor(id).tremolo.p2)),
        // Heavy effects: only present in the chain while active. [SPEC-17.28]
        fxbits: (id: number) => ref(() => fxBits(this.fxFor(id).lofi.p1)),
        fxcoarse: (id: number) => ref(() => fxCoarse(this.fxFor(id).lofi.p2)),
        fxdist: (id: number) => ref(() => fxDistort(this.fxFor(id).drive.p1)),
        fxshape: (id: number) => ref(() => fxShape(this.fxFor(id).drive.p2)),
        fxpost: (id: number) =>
          ref(() => fxDrivePost(this.fxFor(id).drive.p1, this.fxFor(id).drive.p2)),
      });
    })();
  }

  /**
   * Resume the AudioContext, then init(). MUST be called from a user gesture,
   * synchronously (no await before it) so the transient activation still holds.
   *
   * superdough's own initAudio() cannot be relied on: its guard reads
   * `if ((!audioCtx) instanceof OfflineAudioContext) await audioCtx.resume()` —
   * `(!audioCtx)` is a boolean, so the test is always false and resume() is never
   * called (superdough 1.3.0). We resume ourselves. [SPEC-17.50]
   *
   * Returns true once the context is actually running.
   */
  async unlock(): Promise<boolean> {
    const ctx = getAudioContext();
    if (ctx.state !== 'running') {
      // A resume() outside a gesture can stay pending forever — never block on it.
      await Promise.race([
        ctx.resume(),
        new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS)),
      ]);
    }
    if (!this.armed) this.arm();
    await this.init();
    return this.isAudioRunning;
  }

  /** AudioContext state, for diagnostics ('suspended' | 'running' | 'closed'). */
  get audioState(): string {
    try {
      return getAudioContext().state;
    } catch (err) {
      return `indisponible (${(err as Error).message})`;
    }
  }

  /**
   * Wait for the audio context to be unlocked and the scope to be ready, then
   * build the REPL. Call from within a user gesture (awaits the armed unlock,
   * which resolves on that gesture's mousedown).
   */
  async init(): Promise<void> {
    if (!this.armed) this.arm();
    await this.armed;
    await this.scopeReady;

    if (this.repl) return;

    const ctx = getAudioContext();
    this.repl = repl({
      defaultOutput: webaudioOutput,
      getTime: () => ctx.currentTime,
      transpiler,
      // evaluate() swallows eval errors internally; capture them so play() can
      // surface them instead of failing silently. [SPEC-14.3]
      onEvalError: (err: Error) => {
        this.lastEvalError = err;
      },
    });
  }

  // --- Voice/stack model ([SPEC-5.1]) ---
  //
  // Each active clip is a "voice" keyed by `${channel}:${slot}`. The audible
  // output is the stack of all active voices, each routed through its channel
  // gain (live ref → immediate volume [SPEC-7.1]). Toggling a slot rebuilds and
  // re-evaluates the stack; the scheduler keeps running (silence when empty) so
  // the master clock never stops. Rebuilds are serialized to avoid races on
  // rapid toggles.
  private readonly voices = new Map<string, string>();
  private rebuilding = false;
  private pendingRebuild = false;
  // Transport running state. When false, the stack is set but the scheduler is
  // NOT started, so arming voices (toggling slots) stays silent until PLAY.
  private running = false;

  private voiceKey(channel: number, slot: number): string {
    return `${channel}:${slot}`;
  }

  /**
   * Wrap a pattern in its channel chain. Filters, delay, reverb and gain are
   * always present and driven live by refs (immediate, no re-eval). The heavy
   * effects (lofi = crush+coarse, drive = distort+shape) create an AudioWorklet
   * per event in superdough, so they are inserted ONLY while active — their
   * on/off triggers a voice re-eval, their parameters stay live. [SPEC-17.23/17.28]
   */
  private voiceChain(code: string, channel: number): string {
    const fx = this.fxFor(channel);
    // Phase nudge first: it shifts the pattern in time, before any processing.
    const shifted =
      this.phaseOffsetCycles === 0 ? `(${code})` : `(${code}).late(${this.phaseOffsetCycles})`;
    // One orbit per channel (1-based, matching the channel numbers shown in the
    // GUI). superdough builds the delay and reverb buses PER ORBIT, so this both
    // makes those effects truly per-channel and lets a pattern sidechain a precise
    // channel with `.duck(n)`. Safe on a stereo output: orbits only map to separate
    // output pairs when `multiChannelOrbits` is enabled, which it is not. [SPEC-17.37]
    let chain =
      `${shifted}.orbit(${channel + 1})` +
      `.lpf(fxcut(${channel})).lpq(fxq(${channel}))` +
      `.hpf(fxhcut(${channel})).hpq(fxhq(${channel}))` +
      `.delay(fxdmix(${channel})).delaytime(fxdtime()).delayfeedback(fxdfb(${channel}))` +
      `.room(fxroom(${channel})).roomsize(fxsize(${channel}))` +
      `.phaserrate(fxphrate(${channel})).phaserdepth(fxphdepth(${channel}))` +
      `.djf(gdjf())`; // global filter gesture, bypassed at 0.5 [SPEC-17.41]
    if (fx.tremolo.on) {
      chain += `.tremolosync(fxtrsync(${channel})).tremolodepth(fxtrdepth(${channel}))`;
    }
    if (fx.lofi.on) chain += `.crush(fxbits(${channel})).coarse(fxcoarse(${channel}))`;
    if (fx.drive.on) {
      chain += `.distort(fxdist(${channel})).shape(fxshape(${channel})).postgain(fxpost(${channel}))`;
    }
    return `${chain}.gain(chgain(${channel}))`;
  }

  /** Add/replace (code) or remove (null) a voice, then rebuild the stack. */
  async setVoice(channel: number, slot: number, code: string | null): Promise<void> {
    if (!this.channelGains.has(channel)) this.channelGains.set(channel, DEFAULT_CHANNEL_GAIN);
    const key = this.voiceKey(channel, slot);
    if (code === null) {
      this.voices.delete(key);
    } else {
      this.voices.set(key, this.voiceChain(code, channel));
    }
    await this.rebuild();
  }

  /** True if any voice is active. */
  get hasVoices(): boolean {
    return this.voices.size > 0;
  }

  private async rebuild(): Promise<void> {
    if (!this.repl) throw new Error('StrudelEngine.rebuild() appelé avant init()');
    if (this.rebuilding) {
      this.pendingRebuild = true;
      return;
    }
    this.rebuilding = true;
    try {
      do {
        this.pendingRebuild = false;
        const parts = [...this.voices.values()];
        const code = parts.length === 0 ? 'silence' : `stack(${parts.join(', ')})`;
        this.lastEvalError = null;
        // autostart = transport running: arming while stopped stays silent.
        const pattern = await this.repl.evaluate(code, this.running);
        if (this.lastEvalError || pattern === undefined) {
          throw this.lastEvalError ?? new Error(`Échec d'évaluation: ${code}`);
        }
      } while (this.pendingRebuild);
    } finally {
      this.rebuilding = false;
    }
  }

  /** Hard stop: clear all voices and stop the scheduler. */
  stop(): void {
    this.running = false;
    this.voices.clear();
    if (!this.repl) return;
    this.repl.scheduler.stop();
  }

  // --- Transport ([SPEC-7], PLAY/STOP) ---

  /** Start playback: run the scheduler so the armed voice stack sounds. */
  async startTransport(): Promise<void> {
    if (!this.repl) return;
    this.running = true;
    await this.rebuild(); // evaluate with autostart → scheduler starts
  }

  /** Pause playback: stop the scheduler but KEEP the armed voices, so PLAY resumes. */
  stopTransport(): void {
    this.running = false;
    this.repl?.scheduler.stop();
  }

  get isTransportRunning(): boolean {
    return this.running;
  }

  // --- Pattern length measurement (live-coding hint, [SPEC-9.2]) ---
  //
  // A Strudel pattern is a pure function of time, so its loop length isn't stored
  // anywhere — we recover it by QUERYING the pattern (no audio) and finding the
  // smallest shift under which its onset+value set is invariant. Uses a dedicated
  // repl that is never started, so measuring never disturbs live playback.

  private ensureMeasureRepl(): Repl {
    if (this.measureRepl) return this.measureRepl;
    const ctx = getAudioContext();
    this.measureRepl = repl({
      defaultOutput: webaudioOutput,
      getTime: () => ctx.currentTime,
      transpiler,
      onEvalError: (err: Error) => {
        this.lastEvalError = err;
      },
    });
    return this.measureRepl;
  }

  /**
   * Query a pattern's events over `cycles` cycles, without any audio. [SPEC-18.8]
   *
   * Same mechanism as measureLengthBeats (throwaway repl, never started), exposed
   * so a caller can DERIVE a view — a piano roll, a step grid — from what the
   * pattern actually produces, rather than from a parallel model that could drift
   * from the code [SPEC-18.6]. Keeping it here upholds the rule that only the
   * engine talks to Strudel ([PLAN F]).
   *
   * Throws on an eval/query error so the caller can report "code invalide".
   */
  async queryEvents(code: string, cycles: number): Promise<HapInfo[]> {
    await this.scopeReady;
    const r = this.ensureMeasureRepl();
    this.lastEvalError = null;
    const evaluated = await r.evaluate(code, false); // autostart false → no scheduler, no sound
    if (this.lastEvalError) throw this.lastEvalError;
    const pattern = evaluated as { queryArc?: (b: number, e: number) => unknown[] } | undefined;
    if (!pattern || typeof pattern.queryArc !== 'function') {
      throw new Error('Pattern invalide');
    }

    type RawHap = {
      part: { begin: unknown; end: unknown };
      whole?: { begin: unknown; end: unknown };
      value: unknown;
      hasOnset?: () => boolean;
    };
    let haps: RawHap[];
    try {
      haps = pattern.queryArc(0, cycles) as RawHap[];
    } catch (err) {
      throw new Error(`Requête du pattern impossible : ${(err as Error).message}`);
    }

    return haps.map((h) => {
      // `whole` carries the event's real extent; `part` is the clipped fragment
      // inside the queried span. Prefer whole for the drawn duration.
      const span = h.whole ?? h.part;
      const value =
        h.value !== null && typeof h.value === 'object'
          ? ({ ...(h.value as Record<string, unknown>) } as Record<string, unknown>)
          : ({ value: h.value } as Record<string, unknown>);
      return {
        begin: Number(h.part.begin),
        end: Number(h.part.end),
        wholeBegin: Number(span.begin),
        wholeEnd: Number(span.end),
        hasOnset: h.hasOnset ? h.hasOnset() : true,
        value,
      };
    });
  }

  /**
   * Estimate a pattern's loop length in beats by querying it. Returns the number
   * of beats after which the pattern repeats, or null when no period is found
   * within the search window (e.g. randomized patterns → "variable"). Throws on
   * an eval/query error so the caller can show "code invalide". [SPEC-9.2]
   */
  async measureLengthBeats(code: string, beatsPerCycle = 4): Promise<number | null> {
    await this.scopeReady;
    const r = this.ensureMeasureRepl();
    this.lastEvalError = null;
    const evaluated = await r.evaluate(code, false); // autostart false → no scheduler, no sound
    if (this.lastEvalError) throw this.lastEvalError;
    const pattern = evaluated as { queryArc?: (b: number, e: number) => unknown[] } | undefined;
    if (!pattern || typeof pattern.queryArc !== 'function') {
      throw new Error('Pattern invalide');
    }

    const SEARCH_BEATS = 64; // longest loop we report
    const cpb = 1 / beatsPerCycle; // cycles per beat
    const spanCycles = SEARCH_BEATS * 2 * cpb; // query 2× so any period ≤64 repeats at least once
    const grid = (x: number) => Math.round(x * 96) / 96; // snap to a 96-ppq grid, absorb fp noise

    type Hap = { part: { begin: unknown }; value: unknown; hasOnset?: () => boolean };
    let haps: Hap[];
    try {
      haps = pattern.queryArc(0, spanCycles) as Hap[];
    } catch (err) {
      throw new Error(`Requête du pattern impossible : ${(err as Error).message}`);
    }

    const sig = (v: unknown): string => {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    };
    const onsets = haps
      .filter((h) => (h.hasOnset ? h.hasOnset() : true))
      .map((h) => ({ t: grid(Number(h.part.begin)), v: sig(h.value) }));
    if (onsets.length === 0) return null; // silence / nothing to measure

    const set = new Set(onsets.map((o) => `${o.t}|${o.v}`));
    const eps = 1e-6;
    for (let pb = 1; pb <= SEARCH_BEATS; pb++) {
      const p = pb * cpb;
      let periodic = true;
      for (const o of onsets) {
        const shifted = o.t + p;
        if (shifted >= spanCycles - eps) continue; // no data past the query window
        if (!set.has(`${grid(shifted)}|${o.v}`)) {
          periodic = false;
          break;
        }
      }
      if (periodic) return pb;
    }
    return null; // no period within the window → variable/very long
  }

  /**
   * Load a sample bank so tracks can use real samples (bd, sd, hh, …). [SPEC-12.1]
   * Needs the audio scope ready (call after init). Samples are fetched on first
   * use and cached in memory; the Service Worker caches the network for offline.
   */
  async loadSamples(source: string): Promise<void> {
    await this.scopeReady;
    await samples(source);
  }

  // --- Channel volume ([SPEC-3.3], full Channels model in phase 3) ---

  setChannelGain(channelId: number, gain: number): void {
    this.channelGains.set(channelId, Math.min(1, Math.max(0, gain)));
  }

  private gainFor(channelId: number): number {
    if (this.droppedChannels.has(channelId)) return 0; // held drop [SPEC-17.40]
    return this.channelGains.get(channelId) ?? DEFAULT_CHANNEL_GAIN;
  }

  /** [SPEC-7.2] Bipolar filter position 0..1 (0.5 neutral). Immediate via ref. */
  setChannelFilter(channelId: number, value: number): void {
    this.channelFilters.set(channelId, Math.min(1, Math.max(0, value)));
  }

  private filterFor(channelId: number): number {
    return this.channelFilters.get(channelId) ?? NEUTRAL_FILTER;
  }

  // --- Per-channel effects (LPF / delay / reverb) [SPEC-17.23] ---

  /** Push the whole effect state for a channel; the fx* refs read it live. */
  setChannelEffects(channelId: number, effects: ChannelEffects): void {
    this.channelEffects.set(channelId, effects);
  }

  private fxFor(channelId: number): ChannelEffects {
    return this.channelEffects.get(channelId) ?? defaultEffects();
  }

  /** LPF cutoff: fx low-pass when on, else the bipolar channel filter. */
  private fxCutFor(channelId: number): number {
    const fx = this.fxFor(channelId);
    return fx.lpf.on ? fxLpfHz(fx.lpf.p1) : lpfCutoff(this.filterFor(channelId));
  }

  private fxQFor(channelId: number): number {
    const fx = this.fxFor(channelId);
    return fx.lpf.on ? fxQ(fx.lpf.p2) : 0;
  }

  /** HPF cutoff: fx high-pass when on, else the bipolar channel filter. */
  private fxHCutFor(channelId: number): number {
    const fx = this.fxFor(channelId);
    return fx.hpf.on ? fxHpfHz(fx.hpf.p1) : hpfCutoff(this.filterFor(channelId));
  }

  private fxHQFor(channelId: number): number {
    const fx = this.fxFor(channelId);
    return fx.hpf.on ? fxQ(fx.hpf.p2) : 0;
  }

  private fxDelayMixFor(channelId: number): number {
    const fx = this.fxFor(channelId);
    return fx.delay.on ? fxDelayMix(fx.delay.p2) : 0;
  }

  // --- Momentary drop (held gesture) [SPEC-17.40] ---
  //
  // Cutting through the per-event gain ref alone would only silence the NEXT
  // note, leaving anything already ringing untouched. So the channel's orbit
  // output is ramped down as well — that acts on the audio bus, hence on sounds
  // in flight. The ref keeps new events silent while the drop is held.

  private readonly droppedChannels = new Set<number>();

  /** Silence these channels (empty = release the drop). Immediate. */
  setDropped(channels: readonly number[]): void {
    const next = new Set(channels);
    const touched = new Set<number>([...next, ...this.droppedChannels]);
    this.droppedChannels.clear();
    for (const c of next) this.droppedChannels.add(c);
    for (const channel of touched) this.applyOrbitGain(channel);
  }

  get isDropped(): boolean {
    return this.droppedChannels.size > 0;
  }

  // --- Global filter sweep (held gesture) [SPEC-17.41] ---
  //
  // Uses superdough's `djf`, a DJ-style bipolar filter living ON THE ORBIT:
  // 0.5 = bypass, below = low-pass, above = high-pass. Because the node sits on
  // the bus, changing it affects sounds already ringing — unlike a per-event
  // parameter. The value is both pushed straight onto existing nodes (immediate)
  // and carried by the `gdjf` ref in the voice chain (so the node gets created,
  // and new events keep the right setting).

  private globalDjf = DJF_NEUTRAL;

  /** Set the global filter: 0.5 = off, <0.5 low-pass, >0.5 high-pass. */
  setGlobalFilter(value: number): void {
    this.globalDjf = Math.min(1, Math.max(0, value));
    if (!this.repl || !getSuperdoughAudioController) return;
    const nodes = getSuperdoughAudioController()?.nodes;
    if (!nodes) return;
    const now = getAudioContext().currentTime;
    for (const orbit of Object.values(nodes)) {
      const param = orbit?.djfNode?.parameters?.get('value');
      param?.setTargetAtTime(this.globalDjf, now, 0.01);
    }
  }

  get globalFilter(): number {
    return this.globalDjf;
  }

  /** Seconds a riser climb lasts at the current tempo. [SPEC-17.42] */
  riserSeconds(): number {
    return RISER_BEATS / (this.cps * DEFAULT_BEATS_PER_CYCLE);
  }

  /** Ramp a channel's orbit output to 0 (dropped) or 1. Short ramp avoids clicks. */
  private applyOrbitGain(channel: number): void {
    const param = this.orbitGainParam(channel);
    if (!param) return; // that orbit has never produced sound — nothing to cut
    const now = getAudioContext().currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(this.droppedChannels.has(channel) ? 0 : 1, now, 0.005);
  }

  /** Output gain of a channel's orbit, or null if that orbit does not exist yet. */
  private orbitGainParam(channel: number): AudioParam | null {
    if (!this.repl || !getSuperdoughAudioController) return null; // audio not up
    return getSuperdoughAudioController()?.nodes?.[channel + 1]?.output?.gain ?? null; // orbit = ch+1
  }

  // Single master insert point, created once: everything superdough produces goes
  // through `masterHub`, and every send returns into `masterOut`. Each effect
  // rewiring the master itself would be a good way to end up silent. [SPEC-17.47]
  private masterHub: GainNode | null = null;
  private masterOut: GainNode | null = null;

  private ensureMasterInsert(): { hub: GainNode; out: GainNode } | null {
    if (this.masterHub && this.masterOut) return { hub: this.masterHub, out: this.masterOut };
    if (!this.repl || !getSuperdoughAudioController) return null;
    const master = getSuperdoughAudioController()?.output?.destinationGain;
    if (!master) return null;

    const ctx = getAudioContext();
    const hub = new GainNode(ctx);
    const out = new GainNode(ctx);
    master.disconnect();
    master.connect(hub);
    hub.connect(out); // dry path — sends are added in parallel
    out.connect(ctx.destination);
    this.masterHub = hub;
    this.masterOut = out;
    return { hub, out };
  }

  // --- Tempo-locked echo sends (held) [SPEC-17.47] ---
  //
  // One delay line per musical length. Holding opens the SEND, not the return:
  // releasing stops feeding the line but lets its tail ring out and decay — which
  // is the whole point of an echo, and why this gesture does not stop dead like
  // the others.

  private readonly echoes = new Map<number, { send: GainNode; delay: DelayNode }>();

  private ensureEcho(beats: number): { send: GainNode; delay: DelayNode } | null {
    const existing = this.echoes.get(beats);
    if (existing) return existing;
    const insert = this.ensureMasterInsert();
    if (!insert) return null;

    const ctx = getAudioContext();
    const send = new GainNode(ctx, { gain: 0 });
    const delay = new DelayNode(ctx, {
      maxDelayTime: ECHO_MAX_DELAY_S,
      delayTime: this.echoSeconds(beats),
    });
    const feedback = new GainNode(ctx, { gain: ECHO_FEEDBACK });
    const wet = new GainNode(ctx, { gain: ECHO_WET });

    insert.hub.connect(send).connect(delay);
    delay.connect(feedback).connect(delay); // repeats, decaying
    delay.connect(wet).connect(insert.out);

    const echo = { send, delay };
    this.echoes.set(beats, echo);
    return echo;
  }

  private echoSeconds(beats: number): number {
    return Math.min(ECHO_MAX_DELAY_S, beats / (this.cps * DEFAULT_BEATS_PER_CYCLE));
  }

  /** Hold an echo of `beats` length. Releasing lets the tail ring out. */
  setEcho(beats: number, on: boolean): void {
    const echo = this.ensureEcho(beats);
    if (!echo) return;
    const now = getAudioContext().currentTime;
    if (on) echo.delay.delayTime.setValueAtTime(this.echoSeconds(beats), now); // follow tempo
    echo.send.gain.cancelScheduledValues(now);
    echo.send.gain.setValueAtTime(echo.send.gain.value, now);
    echo.send.gain.linearRampToValueAtTime(on ? 1 : 0, now + ECHO_SEND_RAMP_S);
  }



  // --- Rhythmic gate (held) [SPEC-17.44] ---
  //
  // Chops every channel on a tempo-locked grid. Edges are SCHEDULED AHEAD on the
  // audio clock rather than pushed frame by frame: a rAF loop would place them
  // with up to ~8 ms of jitter, which is audible on a gate. Runs on the orbit
  // output gain (the bus), so held sounds are chopped too — a per-event gain
  // would only mute whole notes.

  private gateActive = false;
  private gateTimer: ReturnType<typeof setInterval> | null = null;
  private gateNextBeat = 0; // next gate edge, in absolute beats
  private gateStartBeat = 0; // when the gesture began, to fade the chop in

  setGate(on: boolean): void {
    if (on === this.gateActive) return;
    this.gateActive = on;
    if (this.gateTimer !== null) {
      clearInterval(this.gateTimer);
      this.gateTimer = null;
    }
    if (!on) {
      // Back to full level, still honouring any held drop.
      for (const channel of this.channelGains.keys()) this.applyOrbitGain(channel);
      return;
    }
    if (!this.repl) return;
    const step = 1 / GATE_STEPS_PER_BEAT;
    this.gateStartBeat = this.currentBeat();
    this.gateNextBeat = Math.ceil(this.gateStartBeat / step) * step; // snap to the grid
    this.scheduleGate();
    this.gateTimer = setInterval(() => this.scheduleGate(), 25);
  }

  get isGating(): boolean {
    return this.gateActive;
  }

  private currentBeat(): number {
    return this.now() * DEFAULT_BEATS_PER_CYCLE;
  }

  private beatsToSeconds(beats: number): number {
    return beats / (this.cps * DEFAULT_BEATS_PER_CYCLE);
  }

  private scheduleGate(): void {
    if (!this.gateActive || this.cps <= 0) return;
    const ctx = getAudioContext();
    const step = 1 / GATE_STEPS_PER_BEAT;
    const nowBeat = this.currentBeat();
    // Queue every edge falling inside the look-ahead window.
    for (let guard = 0; guard < 64; guard++) {
      const ahead = this.beatsToSeconds(this.gateNextBeat - nowBeat);
      if (ahead > GATE_LOOKAHEAD_S) break;
      const openAt = Math.max(ctx.currentTime, ctx.currentTime + ahead);
      const closeAt = openAt + this.beatsToSeconds(step * GATE_DUTY);
      // The chop deepens over the first beats, so holding the key eases the
      // rhythm in instead of slamming to full silence. [SPEC-17.45]
      const depth = Math.min(1, (this.gateNextBeat - this.gateStartBeat) / GATE_FADE_IN_BEATS);
      const closedLevel = 1 - depth;
      for (const channel of this.channelGains.keys()) {
        if (this.droppedChannels.has(channel)) continue; // a held drop wins
        const param = this.orbitGainParam(channel);
        if (!param) continue;
        param.setTargetAtTime(1, openAt, GATE_EDGE_S);
        param.setTargetAtTime(closedLevel, closeAt, GATE_EDGE_S);
      }
      this.gateNextBeat += step;
    }
  }

  private fxRoomFor(channelId: number): number {
    const fx = this.fxFor(channelId);
    return fx.reverb.on ? fxRoomMix(fx.reverb.p1) : 0;
  }

  // --- Held global phaser [SPEC-17.46] ---
  //
  // Rides the SAME control refs as the per-channel PHS effect: superdough takes a
  // single phaser setting per event, so a second `.phaserrate()` in the chain
  // would just overwrite the first. The gesture therefore wins over the channel's
  // own phaser while held, and everything falls back afterwards.

  private globalPhaserOn = false;

  setGlobalPhaser(on: boolean): void {
    this.globalPhaserOn = on;
  }

  get isPhasing(): boolean {
    return this.globalPhaserOn;
  }

  /** Phaser depth, or 0 when off — superdough then skips building it. [SPEC-17.32] */
  private fxPhaserDepthFor(channelId: number): number {
    if (this.globalPhaserOn) return GLOBAL_PHASER_DEPTH;
    const fx = this.fxFor(channelId);
    return fx.phaser.on ? fxPhaserDepth(fx.phaser.p2) : 0;
  }

  /** Phaser LFO rate in Hz, from a sweep length in cycles → tempo-synced. [SPEC-17.33] */
  private fxPhaserRateFor(channelId: number): number {
    const cycles = this.globalPhaserOn
      ? GLOBAL_PHASER_CYCLES
      : snapTo(PHASER_CYCLES, this.fxFor(channelId).phaser.p1);
    return this.cps / cycles;
  }

  // --- Musical key / transpose ([SPEC-17.19]) ---

  /** Set the selected key (Camelot code). The rack re-evaluates pitched voices
   *  so the baked-in transpose offset updates. */
  setSelectedKey(code: string | null): void {
    this.selectedKeyCode = code;
  }

  get selectedKey(): string | null {
    return this.selectedKeyCode;
  }

  /** Enable/disable forcing pitched tracks to the selected key. [SPEC-17.20] */
  setForceKey(on: boolean): void {
    this.forceKeyOn = on;
  }

  get forceKey(): boolean {
    return this.forceKeyOn;
  }

  // --- TimeSource (driven by the Clock, [SPEC-3.4]) ---

  setCps(cps: number): void {
    if (cps > 0) this.cps = cps; // remembered for tempo-synced delay time [SPEC-17.24]
    this.repl?.setCps(cps);
  }

  /** Delay time in seconds for the current tempo (FX_DELAY_DIV of a cycle). */
  private delayTimeSeconds(): number {
    return FX_DELAY_DIV / this.cps;
  }

  // --- Phase nudge [SPEC-17.34] ---

  /** Shift every voice in time, in cycles (positive = later). Voices must be
   *  rebuilt to pick it up — the caller does that. */
  setPhaseOffset(cycles: number): void {
    this.phaseOffsetCycles = cycles;
  }

  get phaseOffset(): number {
    return this.phaseOffsetCycles;
  }

  now(): number {
    return this.repl?.scheduler.now() ?? 0;
  }

  isRunning(): boolean {
    return this.repl?.scheduler.started ?? false;
  }

  get isStarted(): boolean {
    return this.repl !== null;
  }

  /** True once the AudioContext is unlocked (running). It can only be unlocked by
   *  a real user gesture (click/key) — a MIDI message does not count. [SPEC-17.25] */
  get isAudioRunning(): boolean {
    try {
      return getAudioContext().state === 'running';
    } catch {
      return false;
    }
  }
}

export const engine = new StrudelEngine();
