// [SPEC-3] Music-as-code engine — wraps Strudel core/mini/webaudio behind a
// stable interface, so the rest of the app never depends on Strudel internals
// directly ([PLAN F] "isoler l'Engine derrière une interface stable").
//
// Also acts as the Clock's TimeSource ([SPEC-3.4]): it owns the audio scheduler,
// which is the single authoritative time source of the app.

import * as strudelCore from '@strudel/core';
import * as strudelMini from '@strudel/mini';
import * as strudelWebaudio from '@strudel/webaudio';
import { transpiler } from '@strudel/transpiler';
import type { TimeSource } from '@core/clock/Clock';
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

export type EngineStatus = 'idle' | 'starting' | 'ready' | 'playing' | 'error';

type Repl = ReturnType<typeof repl>;

export const DEFAULT_CHANNEL_GAIN = 0.8;
export const NEUTRAL_FILTER = 0.5;

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
      await evalScope(strudelCore, strudelMini, strudelWebaudio);
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
    let chain =
      `${shifted}` +
      `.lpf(fxcut(${channel})).lpq(fxq(${channel}))` +
      `.hpf(fxhcut(${channel})).hpq(fxhq(${channel}))` +
      `.delay(fxdmix(${channel})).delaytime(fxdtime()).delayfeedback(fxdfb(${channel}))` +
      `.room(fxroom(${channel})).roomsize(fxsize(${channel}))` +
      `.phaserrate(fxphrate(${channel})).phaserdepth(fxphdepth(${channel}))`;
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

  private fxRoomFor(channelId: number): number {
    const fx = this.fxFor(channelId);
    return fx.reverb.on ? fxRoomMix(fx.reverb.p1) : 0;
  }

  /** Phaser depth, or 0 when off — superdough then skips building it. [SPEC-17.32] */
  private fxPhaserDepthFor(channelId: number): number {
    const fx = this.fxFor(channelId);
    return fx.phaser.on ? fxPhaserDepth(fx.phaser.p2) : 0;
  }

  /** Phaser LFO rate in Hz, from a sweep length in cycles → tempo-synced. [SPEC-17.33] */
  private fxPhaserRateFor(channelId: number): number {
    const cycles = snapTo(PHASER_CYCLES, this.fxFor(channelId).phaser.p1);
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
