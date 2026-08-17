// [SPEC-18.10] Euclidean rhythms — the logic behind the circular view of
// `s("bd(3,8)")`.
//
// The notation packs a whole rhythm into two numbers: `pulses` onsets spread as
// evenly as possible over `steps` slots (Bjorklund's algorithm). Powerful, and
// illegible without a drawing — which is the point of the wheel this module
// feeds. Pure logic: no Svelte, no DOM.
//
// The output is a code fragment inserted into the pattern text and then
// forgotten [SPEC-18.7]; nothing here ever reads a pattern back.

/** Beyond this the wheel stops being readable, and so does the notation. */
export const MAX_STEPS = 32;

/**
 * Bjorklund's algorithm: distribute `pulses` onsets over `steps` slots as evenly
 * as possible.
 *
 * The pairing loop below is the usual formulation: start with `pulses` groups
 * `[x]` and `steps - pulses` groups `[.]`, then repeatedly glue each remainder
 * group onto the head of a main group. What is left when fewer than two
 * remainder groups survive is the rhythm, read left to right.
 *
 * Edge cases, chosen so the wheel can never show something Strudel would not
 * play:
 * - `steps <= 0` → empty array. There is no cycle to draw.
 * - `pulses <= 0` → every step silent (Strudel's `bd(0,8)` is silence).
 * - `pulses >= steps` → every step active. Note that Strudel THROWS on
 *   `pulses > steps` (it allocates an array of negative length), so callers must
 *   keep `pulses <= steps` in what they emit — {@link euclidSnippet} does.
 * - negative `pulses` → the complement of `|pulses|`, matching Strudel, where
 *   `bd(-3,8)` plays the five steps that `bd(3,8)` leaves empty.
 * - `rotation` is taken modulo `steps` and shifts the pattern to the RIGHT, the
 *   direction Strudel's third argument uses (`euclidRot` rotates by `-r`).
 *   Careful: Strudel does NOT wrap a rotation larger than `steps` — it silently
 *   degrades to no rotation — so emitted snippets keep it inside `0..steps-1`.
 */
export function euclid(pulses: number, steps: number, rotation = 0): boolean[] {
  const n = Math.floor(steps);
  if (!Number.isFinite(n) || n <= 0) return [];

  const wanted = Math.trunc(Number.isFinite(pulses) ? pulses : 0);
  const inverted = wanted < 0;
  const onsets = Math.min(Math.abs(wanted), n);

  let base: boolean[];
  if (onsets === 0) base = new Array<boolean>(n).fill(false);
  else if (onsets === n) base = new Array<boolean>(n).fill(true);
  else base = bjorklund(onsets, n);

  if (inverted) base = base.map((on) => !on);

  const shift = ((Math.trunc(rotation) % n) + n) % n;
  if (shift === 0) return base;
  // Step i now carries what step i - shift used to: the rhythm arrives later.
  return base.map((_, i) => base[(i - shift + n) % n]);
}

/** Core loop, called only when 0 < pulses < steps. */
function bjorklund(pulses: number, steps: number): boolean[] {
  let main: boolean[][] = Array.from({ length: pulses }, () => [true]);
  let rest: boolean[][] = Array.from({ length: steps - pulses }, () => [false]);

  while (rest.length > 1 && main.length > 0) {
    const paired = Math.min(main.length, rest.length);
    const merged: boolean[][] = [];
    for (let i = 0; i < paired; i++) merged.push([...main[i], ...rest[i]]);
    // Whichever side had leftovers becomes the new remainder.
    rest = main.length > paired ? main.slice(paired) : rest.slice(paired);
    main = merged;
  }
  return [...main, ...rest].flat();
}

/** Number of active steps, i.e. what you will actually hear. */
export function onsetCount(pattern: readonly boolean[]): number {
  return pattern.reduce((count, on) => (on ? count + 1 : count), 0);
}

/** Human-readable rendering of a pattern: `x . . x . . x .`. */
export function euclidText(pattern: readonly boolean[]): string {
  return pattern.map((on) => (on ? 'x' : '.')).join(' ');
}

/**
 * Clean a user-typed sound name into something safe to drop inside `s("…")`.
 * Quotes and backslashes would close the string literal and break the pattern.
 */
export function sanitizeSound(sound: string): string {
  return sound.replace(/["'\\]/g, '').trim();
}

/**
 * The Strudel fragment: `s("bd(3,8)")`, or `s("bd(3,8,2)")` when rotated.
 *
 * A multi-word sound is wrapped in brackets: in mini-notation the euclidean
 * operator binds to the LAST term only, so `s("bd sd(3,8)")` would leave `bd`
 * alone — almost never what was meant. Already-grouped input is left as is.
 */
export function euclidSnippet(sound: string, pulses: number, steps: number, rotation = 0): string {
  const n = Math.max(1, Math.floor(steps));
  const p = Math.min(Math.max(0, Math.trunc(pulses)), n);
  const r = ((Math.trunc(rotation) % n) + n) % n;

  const name = sanitizeSound(sound) || 'bd';
  const grouped = /\s/.test(name) && !/^[[<]/.test(name) ? `[${name}]` : name;

  const args = r === 0 ? `${p},${n}` : `${p},${n},${r}`;
  return `s("${grouped}(${args})")`;
}
