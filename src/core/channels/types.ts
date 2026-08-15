// [SPEC-5] Channel model types.

/**
 * Slots per channel. The Akai APC mini mk2 drives the sounds via its 8-pad
 * columns, so 8 is the standing value ([SPEC-17.21]); the nanoKONTROL2 is now
 * reserved for effects. The rack still takes it as a parameter.
 */
export const DEFAULT_SLOTS_PER_CHANNEL = 8;

const SMR_LABELS = ['S', 'M', 'R'] as const;

/** Human label for a slot: S/M/R for a 3-slot channel, else its 1-based index. */
export function slotLabel(index: number, total: number): string {
  if (total === SMR_LABELS.length) return SMR_LABELS[index] ?? String(index + 1);
  return String(index + 1);
}

export interface SlotState {
  /** Track assigned to this button, or null if empty. [SPEC-5.4] */
  trackId: string | null;
  /** Display name of the assigned track (denormalized for the GUI). null while
   *  the id does not resolve in the library — see `isMissingTrack`. */
  trackName: string | null;
  /** Loop length in beats of the assigned track (denormalized for the progress
   *  gauge). null when empty. [SPEC-17.10] */
  trackBeats: number | null;
  playing: boolean;
  /** A quantized toggle is scheduled and not yet applied. [SPEC-8.4] */
  pending: boolean;
  /**
   * Live-coded override of the track's pattern (advanced mode, [SPEC-9.2]).
   * null = play the track as it is on disk ([SPEC-9.1]). Never written back to
   * the library file.
   */
  codeOverride: string | null;
}

/**
 * A slot bound to a track id the library cannot resolve. [SPEC-17.51]
 *
 * The binding is DELIBERATELY kept: a library that is momentarily unreadable
 * (renamed file, broken glob, load error) must never silently erase a session —
 * restoring the file restores the pads. Such a slot is unplayable and shown as
 * such, unless a live-coded override gives it something to play ([SPEC-9.2]).
 */
export function isMissingTrack(slot: SlotState): boolean {
  return slot.trackId !== null && slot.trackName === null;
}

/**
 * Per-channel effects, browsed on the nano with S (previous) / R (next) and
 * toggled with M. Each exposes two 0..1 parameters: knob = p1, fader = p2.
 * The list is extensible — adding an entry here + its mapping in the engine is
 * enough. [SPEC-17.23, SPEC-17.28]
 */
export type FxKind =
  | 'lpf'
  | 'hpf'
  | 'delay'
  | 'reverb'
  | 'phaser'
  | 'tremolo'
  | 'lofi'
  | 'drive';
export const FX_KINDS: FxKind[] = [
  'lpf',
  'hpf',
  'delay',
  'reverb',
  'phaser',
  'tremolo',
  'lofi',
  'drive',
];

/**
 * Effects whose audio nodes are expensive (AudioWorklets created per event by
 * superdough), so they are inserted into the voice chain ONLY while active —
 * toggling them re-evaluates the channel's voices, while their parameters stay
 * live. The others are always in the chain at neutral values. [SPEC-17.28]
 */
export const FX_HEAVY: ReadonlySet<FxKind> = new Set<FxKind>(['lofi', 'drive', 'tremolo']);

/** One effect: on/off + two 0..1 parameters (p1 = knob, p2 = fader). */
export interface FxState {
  on: boolean;
  p1: number;
  p2: number;
}

export type ChannelEffects = Record<FxKind, FxState>;

/** Full name (GUI), short label (LEDs/compact surfaces) and the two parameter
 *  names (p1 = knob, p2 = fader) per effect. The channel strip shows `name`:
 *  abbreviations are unreadable at a glance on stage. [SPEC-17.53] */
export const FX_META: Record<FxKind, { name: string; label: string; p1: string; p2: string }> = {
  lpf: { name: 'Passe-bas', label: 'LP', p1: 'cutoff', p2: 'réson.' },
  hpf: { name: 'Passe-haut', label: 'HP', p1: 'cutoff', p2: 'réson.' },
  delay: { name: 'Delay', label: 'DLY', p1: 'fdbk', p2: 'mix' },
  reverb: { name: 'Réverbe', label: 'REV', p1: 'mix', p2: 'taille' },
  phaser: { name: 'Phaser', label: 'PHS', p1: 'vitesse', p2: 'profond' },
  tremolo: { name: 'Trémolo', label: 'TRM', p1: 'division', p2: 'profond' },
  lofi: { name: 'Lo-fi', label: 'LOFI', p1: 'bits', p2: 'resamp' },
  drive: { name: 'Saturation', label: 'DRV', p1: 'drive', p2: 'shape' },
};

/** Neutral parameters for an effect: present but inaudible, so activating it does
 *  not jump — the knob/fader dial it in from there. [SPEC-17.23] */
export function neutralFx(kind: FxKind): { p1: number; p2: number } {
  switch (kind) {
    case 'lpf':
      return { p1: 1, p2: 0 }; // cutoff fully open, no resonance
    case 'hpf':
      return { p1: 0, p2: 0 }; // cutoff fully down, no resonance
    case 'delay':
      return { p1: 0, p2: 0 }; // no feedback, no mix
    case 'reverb':
      return { p1: 0, p2: 0.5 }; // no mix, mid size
    case 'phaser':
      return { p1: 0.35, p2: 0 }; // mid sweep rate, no depth (bypassed)
    case 'tremolo':
      return { p1: 0.45, p2: 0 }; // mid rhythmic division, no depth
    case 'lofi':
      return { p1: 0, p2: 0 }; // full bit depth, no resampling
    case 'drive':
      return { p1: 0, p2: 0 }; // no distortion, no shaping
  }
}

export function defaultEffects(): ChannelEffects {
  return Object.fromEntries(
    FX_KINDS.map((k) => [k, { on: false, ...neutralFx(k) }]),
  ) as ChannelEffects;
}

/** Normalize a persisted/partial effect map: fills in effects added since. */
export function coerceEffects(raw: unknown): ChannelEffects {
  const src = (raw ?? {}) as Partial<Record<FxKind, Partial<FxState>>>;
  const out = defaultEffects();
  for (const k of FX_KINDS) {
    const e = src[k];
    if (!e) continue;
    if (typeof e.on === 'boolean') out[k].on = e.on;
    if (typeof e.p1 === 'number') out[k].p1 = e.p1;
    if (typeof e.p2 === 'number') out[k].p2 = e.p2;
  }
  return out;
}

export function coerceFxFocus(raw: unknown): FxKind {
  return FX_KINDS.includes(raw as FxKind) ? (raw as FxKind) : FX_KINDS[0];
}

/** Neighbour effect in the browsing order, wrapping around. [SPEC-17.28] */
export function stepFx(current: FxKind, delta: 1 | -1): FxKind {
  const i = FX_KINDS.indexOf(current);
  const n = FX_KINDS.length;
  return FX_KINDS[(((i < 0 ? 0 : i) + delta) % n + n) % n];
}

export interface ChannelState {
  id: number;
  /** Categories associated with this channel (0..n). [SPEC-5.2] */
  categories: string[];
  /** Volume 0..1. [SPEC-7.1] */
  volume: number;
  /** Bipolar filter 0..1, neutral at 0.5. [SPEC-7.2] */
  filter: number;
  /** Per-channel launch quantization: false = immediate, true = quantized on the
   *  global window. Toggled per channel (APC bottom button). [SPEC-17.17] */
  quantized: boolean;
  /** Per-channel effects (LPF / delay / reverb) driven by the nano. [SPEC-17.23] */
  effects: ChannelEffects;
  /** Which effect the knob/fader currently edit (last S/M/R pressed). [SPEC-17.23] */
  fxFocus: FxKind;
  slots: SlotState[];
}
