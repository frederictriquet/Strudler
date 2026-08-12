// [SPEC-17.33] Discrete effect parameters.
//
// Some effect parameters are only musical on binary steps, and continuous values
// in between are either off-grid or physically meaningless:
//   - rhythmic rates (tremolo, phaser sweep): western metre is binary, so a pulse
//     at 1/3 of a beat fights a straight groove;
//   - integer factors: `crush` bit depth and `coarse` decimation are counts.
// The knob/fader still travel continuously (so soft takeover [SPEC-17.30] stays
// easy and the ghost stays meaningful); it is the mapping to engine units that
// snaps to a step. Cutoffs, resonance, mixes, depths and drive stay continuous —
// sweeping them IS the point (and cutoffs are already exponential, i.e. by octave).

import type { FxKind } from './types';

/** Map a 0..1 knob position onto a discrete list of musical values. */
export function snapTo<T>(steps: readonly T[], p: number): T {
  const clamped = Math.min(1, Math.max(0, p));
  return steps[Math.min(steps.length - 1, Math.floor(clamped * steps.length))];
}

/** Tremolo pulses per cycle (1 cycle = 4 beats): whole note → 16ths. */
export const TREMOLO_DIVS = [1, 2, 4, 8, 16] as const;

/** Phaser sweep length in cycles (slow → fast). Tempo-synced like the tremolo. */
export const PHASER_CYCLES = [8, 4, 2, 1, 0.5, 0.25] as const;

/** Bit depth for `crush`: 16 is clean, 1 is extreme. */
export const CRUSH_BITS = [16, 8, 4, 2, 1] as const;

/** Decimation factor for `coarse`: 1 is clean. */
export const COARSE_FACTORS = [1, 2, 4, 8, 16, 32] as const;

/** Beats per tremolo pulse, for display (4 beats per cycle). */
function beatsPerPulse(div: number): string {
  const beats = 4 / div;
  return beats >= 1 ? `${beats}` : `1/${Math.round(1 / beats)}`;
}

/**
 * Short label of a parameter's effective value, for the GUI — so the step a
 * discrete knob landed on is readable. Continuous parameters show a percentage.
 */
export function fxParamLabel(kind: FxKind, param: 'p1' | 'p2', value: number): string {
  if (kind === 'tremolo' && param === 'p1') return `${beatsPerPulse(snapTo(TREMOLO_DIVS, value))}b`;
  if (kind === 'phaser' && param === 'p1') {
    const cycles = snapTo(PHASER_CYCLES, value);
    return cycles >= 1 ? `${cycles}c` : `1/${Math.round(1 / cycles)}c`;
  }
  if (kind === 'lofi') {
    return param === 'p1' ? `${snapTo(CRUSH_BITS, value)}b` : `×${snapTo(COARSE_FACTORS, value)}`;
  }
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}`;
}
