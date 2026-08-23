// [SPEC-18.10] Drum grid — step grid ↔ mini-notation.
//
// This is the ONLY genuinely bidirectional editor the workshop allows, and it is
// allowed only because the syntax it reads back is narrow enough to be recovered
// without a parser of Strudel code [SPEC-18.19]. The rule that makes it safe is
// stated in the spec and enforced here by construction:
//
//     outside the supported subset the grid goes READ-ONLY rather than rewriting
//     what it does not understand.
//
// `parseDrumGrid` returning null is therefore the NORMAL path, not a failure —
// an approximate rewrite would silently destroy the user's work.
//
// ── Supported subset ────────────────────────────────────────────────────────
// The whole pattern must be exactly one `s("…")` (or `sound("…")`) call,
// optionally followed by chained calls. Inside the string:
//   `bd`, `808sd`  sound name (letters, digits, `_`, `-`; may start with a digit)
//   `bd:4`         sample index
//   `~`, `-`       rest
//   `[a b]`        subdivision group, nestable
//   `a, b`         parallel sequences — one grid row each, also inside `[ ]`
//   `x*3`          repeat, compressed into the step (integer factor only)
//   `x!3`, `!`     repeat, taking that many steps
//
// Anything else — `<…>` alternation, `(3,8)` euclid, `@` weights, `?` chance,
// `{…}` polymeter, a `stack(…)` call, an arithmetic expression, a second
// top-level call — yields null with a reason in French, shown by the grid.
//
// ── Chained calls ───────────────────────────────────────────────────────────
// `.gain(0.95)`, `.speed(0.7)`, `.room(.2)` are frequent in the real library and
// their absence would send almost every track to read-only. They are kept
// VERBATIM as an opaque suffix, exactly as `layers.ts` keeps the suffix of a
// stack: the grid owns the string, never the chain. A chain that alters onsets
// (`.fast(2)`, `.off(…)`) is preserved untouched too — it applies to the whole
// pattern, so toggling a step still means what it looks like.
//
// ── Round-trip ──────────────────────────────────────────────────────────────
// `serializeDrumGrid(parseDrumGrid(p))` is EQUIVALENT to `p` — same hits at the
// same positions — not necessarily textually identical. The one deliberate
// difference: a nested group is flattened onto a uniform grid, so
// `"~ rs ~ [rs rs] …"` comes back as sixteen steps. Onsets are preserved
// exactly; event DURATION becomes one grid step, which is inaudible for the
// one-shot percussion this tool is for, and only ever happens once the user has
// actually edited the grid.

const MAX_STEPS = 64; // beyond this a grid is unreadable; refuse rather than draw it
const MAX_DENOMINATOR = 512; // guards the fraction arithmetic below

/** The workshop's convention, repeated here so `core/` stays self-contained. */
export const BEATS_PER_CYCLE = 4;

export interface DrumGrid {
  /** One row per sound, in order of first appearance. `bd`, `cp:1`, … */
  sounds: string[];
  /** Number of columns, spread over `cycles` cycles — so `steps / (4 × cycles)`
   *  steps per beat. */
  steps: number;
  /**
   * How many 4-beat cycles the grid spans. [SPEC-18.32]
   *
   * A mini-notation string always lasts ONE cycle, so a loop of 8 beats can only
   * be written by slowing it down: the grid owns a `.slow(n)` factor instead of
   * keeping it in the opaque suffix. Without it the editor was stuck on the first
   * four beats of a longer loop, silently — the piano roll showed eight beats and
   * the grid offered four.
   */
  cycles: number;
  /** `cells[row][step]` — true when that sound is struck on that step. */
  cells: boolean[][];
  /** `s` or `sound`, whichever the pattern used. */
  call: string;
  /** Everything chained after the call, verbatim (`.gain(0.95).room(.2)`). */
  suffix: string;
}

export type DrumGridAnalysis =
  | { grid: DrumGrid; reason: null }
  /** `reason` is user-facing French: it says WHY the grid is read-only. */
  | { grid: null; reason: string };

// ── Fractions ───────────────────────────────────────────────────────────────
// Positions are exact rationals. Floating point would put a hit at 0.30000000004
// and the grid would quietly lose it.

interface Frac {
  n: number;
  d: number;
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

function frac(n: number, d: number): Frac {
  const g = gcd(Math.abs(n), d) || 1;
  return { n: n / g, d: d / g };
}

function addFrac(a: Frac, b: Frac): Frac {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

// ── Mini-notation AST ───────────────────────────────────────────────────────

interface Hit {
  kind: 'hit';
  sound: string;
  repeat: number;
}
interface Rest {
  kind: 'rest';
  repeat: number;
}
interface Group {
  kind: 'group';
  /** Comma-separated parallel sequences sharing the same span. */
  parts: Node[][];
  repeat: number;
}
type Node = Hit | Rest | Group;

/** Thrown while reading; carries the French reason shown by the grid. */
class Unsupported extends Error {}

const NAME_START = /[A-Za-z0-9_]/;
const NAME_REST = /[A-Za-z0-9_-]/;
const DIGIT = /[0-9]/;

/** Copy a node with a different repeat count. Written out per variant because a
 *  spread over a discriminated union loses the discriminant. */
function withRepeat(node: Node, repeat: number): Node {
  switch (node.kind) {
    case 'hit':
      return { kind: 'hit', sound: node.sound, repeat };
    case 'rest':
      return { kind: 'rest', repeat };
    case 'group':
      return { kind: 'group', parts: node.parts, repeat };
  }
}

/**
 * Read the comma-separated parallel sequences of a mini-notation body.
 * `text` is the inside of the string (or of a `[ ]`), without the delimiters.
 */
function readParts(text: string): Node[][] {
  const parts: Node[][] = [];
  let seq: Node[] = [];
  let i = 0;

  const pushPart = () => {
    parts.push(seq);
    seq = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === ',') {
      pushPart();
      i++;
      continue;
    }

    // A lone `!` repeats the previous term one more time. Written after a term
    // it is handled with the other modifiers below.
    if (ch === '!' && !DIGIT.test(text[i + 1] ?? '')) {
      const previous = seq[seq.length - 1];
      if (!previous) throw new Unsupported('un « ! » sans terme à répéter');
      seq.push(withRepeat(previous, previous.repeat));
      i++;
      continue;
    }

    let node: Node;

    if (ch === '[') {
      const close = matchBracket(text, i);
      node = { kind: 'group', parts: readParts(text.slice(i + 1, close)), repeat: 1 };
      i = close + 1;
    } else if (ch === ']') {
      throw new Unsupported('un « ] » sans « [ » correspondant');
    } else if (ch === '~' || (ch === '-' && !NAME_START.test(text[i + 1] ?? ''))) {
      node = { kind: 'rest', repeat: 1 };
      i++;
    } else if (NAME_START.test(ch)) {
      let j = i + 1;
      while (j < text.length && NAME_REST.test(text[j])) j++;
      let sound = text.slice(i, j);
      i = j;
      if (text[i] === ':') {
        // Sample index. `:` with no digits is a typo, not a subset we support.
        let k = i + 1;
        while (k < text.length && DIGIT.test(text[k])) k++;
        if (k === i + 1) throw new Unsupported(`un « : » sans indice après « ${sound} »`);
        sound += text.slice(i, k);
        i = k;
      }
      node = { kind: 'hit', sound, repeat: 1 };
    } else {
      throw new Unsupported(describeChar(ch));
    }

    // Modifiers. `*n` compresses n copies into the term's own step; `!n` makes
    // the term take n steps, so it ends the term.
    let placed = false;
    for (;;) {
      const op = text[i];
      if (op !== '*' && op !== '!') break;
      let k = i + 1;
      while (k < text.length && DIGIT.test(text[k])) k++;
      if (k === i + 1) throw new Unsupported(`« ${op} » sans nombre entier`);
      if (text[k] === '.') throw new Unsupported(`« ${op} » avec un facteur décimal`);
      const count = Number(text.slice(i + 1, k));
      if (count < 1) throw new Unsupported(`« ${op}${count} » (facteur nul)`);
      i = k;
      if (op === '*') {
        node = withRepeat(node, node.repeat * count);
        continue;
      }
      for (let c = 0; c < count; c++) seq.push(withRepeat(node, node.repeat));
      placed = true;
      break;
    }

    if (!placed) seq.push(node);
  }

  pushPart();
  return parts;
}

/** Index of the `]` matching the `[` at `open`. */
function matchBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) return i;
  }
  throw new Unsupported('un « [ » jamais refermé');
}

/** Name a rejected character the way the user reads it. */
function describeChar(ch: string): string {
  const known: Record<string, string> = {
    '<': 'une alternance « <…> » (une valeur par cycle)',
    '>': 'une alternance « <…> » (une valeur par cycle)',
    '(': 'un rythme euclidien « (3,8) »',
    ')': 'un rythme euclidien « (3,8) »',
    '{': 'un polymètre « {…} »',
    '}': 'un polymètre « {…} »',
    '@': 'une durée pondérée « @ »',
    '?': 'une probabilité « ? »',
    '/': 'un ralentissement « / »',
    '%': 'un polymètre « % »',
  };
  return known[ch] ?? `le caractère « ${ch} », hors du sous-ensemble éditable`;
}

// ── Flattening ──────────────────────────────────────────────────────────────

interface Onset {
  at: Frac;
  sound: string;
}

interface Flat {
  onsets: Onset[];
  /** Denominators of every leaf's span — their LCM is the grid resolution. */
  denominators: number[];
}

/**
 * Walk the tree, placing every leaf on the [start, start+len) span it occupies.
 *
 * Every subdivision here is an EQUAL division, so a leaf's length is always
 * 1/d: collecting the `d`s and taking their LCM gives a grid on which every
 * onset falls exactly on a column. That is what makes the round-trip exact.
 */
function flatten(nodes: Node[], start: Frac, len: Frac, out: Flat): void {
  if (nodes.length === 0) return;
  const step = frac(len.n, len.d * nodes.length);
  if (step.d > MAX_DENOMINATOR) throw new Unsupported('une subdivision beaucoup trop fine');

  nodes.forEach((node, index) => {
    const at = addFrac(start, frac(step.n * index, step.d));
    const inner = frac(step.n, step.d * node.repeat);
    for (let r = 0; r < node.repeat; r++) {
      const rAt = addFrac(at, frac(inner.n * r, inner.d));
      if (node.kind === 'group') {
        for (const part of node.parts) flatten(part, rAt, inner, out);
      } else {
        out.denominators.push(inner.d);
        if (node.kind === 'hit') out.onsets.push({ at: rAt, sound: node.sound });
      }
    }
  });
}

// ── Reading the surrounding call ────────────────────────────────────────────

interface CallParts {
  call: string;
  body: string;
  suffix: string;
}

const QUOTES = '"\'`';

/**
 * Recognise `s("…")` / `sound("…")` and split off the chained suffix.
 * Deliberately strict: a pattern that is not exactly one such call is not
 * something the grid may rewrite.
 */
function readCall(pattern: string): CallParts {
  const text = pattern.trim();
  const match = /^(s|sound)\s*\(/.exec(text);
  if (!match) {
    throw new Unsupported(
      text.startsWith('stack')
        ? 'plusieurs couches empilées avec stack(…)'
        : 'ce n’est pas un simple s("…")',
    );
  }

  let i = match[0].length;
  while (i < text.length && /\s/.test(text[i])) i++;

  const quote = text[i];
  if (!QUOTES.includes(quote)) throw new Unsupported('un argument qui n’est pas une chaîne');

  let j = i + 1;
  let body = '';
  for (; j < text.length; j++) {
    if (text[j] === '\\') {
      body += text[j + 1] ?? '';
      j++;
      continue;
    }
    if (text[j] === quote) break;
    body += text[j];
  }
  if (j >= text.length) throw new Unsupported('une chaîne jamais refermée');

  j++; // past the closing quote
  while (j < text.length && /\s/.test(text[j])) j++;
  if (j >= text.length) throw new Unsupported('une parenthèse jamais refermée');
  if (text[j] !== ')') throw new Unsupported('plusieurs arguments passés à s(…)');

  const suffix = text.slice(j + 1).trim();
  // Only a chained call may follow. `s("bd") + s("hh")` is not ours to rewrite.
  if (suffix !== '' && !suffix.startsWith('.')) {
    throw new Unsupported('une expression après s(…) qui n’est pas un appel chaîné');
  }
  return { call: match[1], body, suffix };
}

// ── Loop length: the `.slow(n)` the grid owns [SPEC-18.32] ──────────────────
//
// A mini-notation string lasts one cycle. The only way to write a longer loop
// inside the supported subset is to slow the whole thing down, so that factor
// belongs to the grid — kept in the opaque suffix, it left the editor blind to
// everything past beat 4.

/** Beyond this the grid is unreadable anyway (64 steps over 16 beats). */
const MAX_CYCLES = 4;

/** Split a chained suffix into its top-level `.name(args)` calls, quotes and
 *  nested parentheses respected. Returns null when it is not a plain chain. */
function chainCalls(suffix: string): string[] | null {
  const parts: string[] = [];
  let i = 0;
  while (i < suffix.length) {
    if (suffix[i] !== '.') return null;
    const start = i;
    i++;
    while (i < suffix.length && /[A-Za-z0-9_$]/.test(suffix[i])) i++;
    if (i >= suffix.length || suffix[i] !== '(') return null; // `.foo` without call
    let depth = 0;
    let quote = '';
    for (; i < suffix.length; i++) {
      const ch = suffix[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = '';
        continue;
      }
      if (QUOTES.includes(ch)) quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    if (depth !== 0) return null;
    parts.push(suffix.slice(start, i));
    while (i < suffix.length && /\s/.test(suffix[i])) i++;
  }
  return parts;
}

/**
 * Pull the loop length out of the chain: `.slow(2)` means the grid spans two
 * cycles. Only an integer literal is taken — `.slow(x)` or `.slow(1.5)` stays
 * opaque, since the grid could not write it back faithfully.
 */
function extractCycles(suffix: string): { cycles: number; suffix: string } {
  if (suffix === '') return { cycles: 1, suffix };
  const calls = chainCalls(suffix);
  if (!calls) return { cycles: 1, suffix }; // not a plain chain: leave it alone
  for (let i = 0; i < calls.length; i++) {
    const match = /^\.slow\(\s*(\d+)\s*\)$/.exec(calls[i]);
    if (!match) continue;
    const cycles = Number(match[1]);
    if (cycles < 1 || cycles > MAX_CYCLES) return { cycles: 1, suffix };
    return { cycles, suffix: [...calls.slice(0, i), ...calls.slice(i + 1)].join('') };
  }
  return { cycles: 1, suffix };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Read a pattern into a grid, or explain why it cannot be read.
 * Prefer this over `parseDrumGrid` when you can show the reason to the user
 * [SPEC-14.3] — a silent read-only mode is a mystery, a named one is a lesson.
 */
export function analyzeDrumGrid(pattern: string): DrumGridAnalysis {
  if (pattern.trim() === '') return { grid: null, reason: 'le pattern est vide' };
  try {
    const { call, body, suffix: rawSuffix } = readCall(pattern);
    // The loop length is the grid's business, not an opaque effect. [SPEC-18.32]
    const { cycles, suffix } = extractCycles(rawSuffix);
    const parts = readParts(body);

    const flat: Flat = { onsets: [], denominators: [] };
    for (const part of parts) flatten(part, frac(0, 1), frac(1, 1), flat);
    if (flat.denominators.length === 0) {
      return { grid: null, reason: 'la chaîne de mini-notation est vide' };
    }

    const steps = flat.denominators.reduce(lcm, 1);
    if (steps > MAX_STEPS) {
      return {
        grid: null,
        reason: `ce pattern demande ${steps} pas, au-delà des ${MAX_STEPS} pas affichables`,
      };
    }

    const sounds: string[] = [];
    const cells: boolean[][] = [];
    for (const onset of flat.onsets) {
      let row = sounds.indexOf(onset.sound);
      if (row === -1) {
        row = sounds.length;
        sounds.push(onset.sound);
        cells.push(new Array<boolean>(steps).fill(false));
      }
      cells[row][(onset.at.n * steps) / onset.at.d] = true;
    }

    return { grid: { sounds, steps, cycles, cells, call, suffix }, reason: null };
  } catch (error) {
    if (error instanceof Unsupported) return { grid: null, reason: error.message };
    throw error; // a real bug — never swallowed [SPEC-14.3]
  }
}

/**
 * The grid a pattern describes, or null when it leaves the supported subset.
 * Null is the normal read-only path, not an error [SPEC-18.10].
 */
export function parseDrumGrid(pattern: string): DrumGrid | null {
  return analyzeDrumGrid(pattern).grid;
}

/**
 * Write a grid back as mini-notation.
 *
 * Each row becomes one comma-separated sequence — the mini-notation's own
 * parallel form, so the result stays a single `s("…")` and can be read back by
 * `parseDrumGrid`. Producing a `stack(…)` here would make the grid unable to
 * re-read its own output.
 *
 * Each row is written at its OWN resolution (a kick on every beat of a 16-step
 * grid comes out as `bd*4`, not sixteen tokens), which is why the common
 * library patterns survive the round-trip character for character.
 *
 * One row is then forced back to full width when the compacted rows no longer
 * imply the grid's step count: `s("bd ~")` must not come back as `s("bd")`, or
 * the grid would shrink under the user between two clicks.
 *
 * A row with no hit at all is written `~`; it carries no sound name, so re-reading
 * the text drops that row. The view keeps its own state, so an empty row the user
 * just added stays on screen — but it does not survive a reload.
 */
export function serializeDrumGrid(grid: DrumGrid): string {
  const body = grid.sounds.length === 0 ? restRow(grid.steps) : serializeRows(grid);
  // The loop-length factor goes first, so re-reading finds it whatever the rest
  // of the chain looks like. [SPEC-18.32]
  const slow = grid.cycles > 1 ? `.slow(${grid.cycles})` : '';
  return `${grid.call}("${body}")${slow}${grid.suffix}`;
}

function restRow(steps: number): string {
  return new Array<string>(steps).fill('~').join(' ');
}

function serializeRows(grid: DrumGrid): string {
  const rows = grid.sounds.map((sound, i) => compactRow(sound, grid.cells[i], grid.steps));
  const implied = rows.reduce((acc, row) => lcm(acc, row.width), 1);
  if (implied !== grid.steps) {
    // Widest row first: it is the one whose flat form costs the least.
    let widest = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i].width > rows[widest].width) widest = i;
    rows[widest] = {
      width: grid.steps,
      text: flatRow(grid.sounds[widest], grid.cells[widest], grid.steps),
    };
  }
  return rows.map((r) => r.text).join(', ');
}

interface Row {
  /** Number of steps the written text occupies. */
  width: number;
  text: string;
}

function compactRow(sound: string, cells: boolean[], steps: number): Row {
  const hits: number[] = [];
  for (let i = 0; i < steps; i++) if (cells[i]) hits.push(i);
  if (hits.length === 0) return { width: 1, text: '~' };

  // Coarsest division that still lands every hit on a step of its own.
  const divisor = hits.reduce(gcd, steps);
  const width = steps / divisor;
  if (hits.length === width) return { width, text: width === 1 ? sound : `${sound}*${width}` };

  const positions = new Set(hits.map((h) => h / divisor));
  const tokens: string[] = [];
  for (let i = 0; i < width; i++) tokens.push(positions.has(i) ? sound : '~');
  return { width, text: tokens.join(' ') };
}

function flatRow(sound: string, cells: boolean[], steps: number): string {
  const tokens: string[] = [];
  for (let i = 0; i < steps; i++) tokens.push(cells[i] ? sound : '~');
  return tokens.join(' ');
}

// ── Grid edits (pure; the component owns no logic) ──────────────────────────

function cloneCells(cells: boolean[][]): boolean[][] {
  return cells.map((row) => [...row]);
}

export function toggleCell(grid: DrumGrid, row: number, step: number): DrumGrid {
  const cells = cloneCells(grid.cells);
  cells[row][step] = !cells[row][step];
  return { ...grid, cells };
}

/**
 * A row name the grid can write back and read again: a sound name and an
 * optional sample index. Anything else (a space, a `*`, a `~`) would be
 * re-parsed as syntax and turn the row into something else entirely, so the
 * view must reject it up front rather than serialize it.
 */
const SOUND_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*(:\d+)?$/;

export function isValidSound(sound: string): boolean {
  return SOUND_RE.test(sound.trim());
}

export function addSound(grid: DrumGrid, sound: string): DrumGrid {
  const name = sound.trim();
  if (!isValidSound(name) || grid.sounds.includes(name)) return grid;
  return {
    ...grid,
    sounds: [...grid.sounds, name],
    cells: [...cloneCells(grid.cells), new Array<boolean>(grid.steps).fill(false)],
  };
}

export function removeSound(grid: DrumGrid, row: number): DrumGrid {
  return {
    ...grid,
    sounds: grid.sounds.filter((_, i) => i !== row),
    cells: grid.cells.filter((_, i) => i !== row).map((r) => [...r]),
  };
}

/** Renaming onto another row's sound is refused: the two rows would merge on the
 *  next read, silently pooling their hits. */
export function renameSound(grid: DrumGrid, row: number, sound: string): DrumGrid {
  const name = sound.trim();
  if (!isValidSound(name) || grid.sounds.some((s, i) => s === name && i !== row)) return grid;
  return { ...grid, sounds: grid.sounds.map((s, i) => (i === row ? name : s)) };
}

/**
 * Change the number of steps.
 *
 * Hits keep their POSITION IN THE CYCLE, so halving a grid whose hits sit on odd
 * steps loses some of them: `willLoseHits` lets the view warn first rather than
 * discard silently.
 */
export function setSteps(grid: DrumGrid, steps: number): DrumGrid {
  const target = Math.max(1, Math.min(MAX_STEPS, Math.round(steps)));
  if (target === grid.steps) return grid;
  const cells = grid.cells.map((row) => {
    const next = new Array<boolean>(target).fill(false);
    for (let i = 0; i < grid.steps; i++) {
      if (!row[i]) continue;
      const at = (i * target) / grid.steps;
      if (Number.isInteger(at)) next[at] = true;
    }
    return next;
  });
  return { ...grid, steps: target, cells };
}

/** True when `setSteps` would drop a hit that no longer falls on a step. */
export function willLoseHits(grid: DrumGrid, steps: number): boolean {
  const target = Math.max(1, Math.min(MAX_STEPS, Math.round(steps)));
  return grid.cells.some((row) =>
    row.some((on, i) => on && !Number.isInteger((i * target) / grid.steps)),
  );
}

/** Steps per beat, or null when the grid does not divide into 4 beats evenly —
 *  a 6-step cycle has no beat lines to draw. [SPEC-18.10] */
/** Steps per beat, or null when the columns do not divide into whole beats.
 *  The loop is `cycles × 4` beats long. [SPEC-18.32] */
export function stepsPerBeat(steps: number, cycles = 1): number | null {
  const beats = BEATS_PER_CYCLE * Math.max(1, cycles);
  return steps % beats === 0 ? steps / beats : null;
}

/** Beats the grid covers. [SPEC-18.32] */
export function gridBeats(grid: DrumGrid): number {
  return BEATS_PER_CYCLE * Math.max(1, grid.cycles);
}

export const MAX_GRID_CYCLES = MAX_CYCLES;

/**
 * Stretch or shrink the grid to `cycles` cycles KEEPING each step's duration:
 * going from 4 to 8 beats doubles the number of columns and leaves the new ones
 * empty, instead of slowing the existing pattern down. That is what « my loop is
 * 8 beats, let me write beats 5 to 8 » means. Returns the grid untouched when the
 * result would exceed the displayable width. [SPEC-18.32]
 */
export function setCycles(grid: DrumGrid, cycles: number): DrumGrid {
  const target = Math.max(1, Math.min(MAX_CYCLES, Math.round(cycles)));
  if (target === grid.cycles) return grid;
  const steps = Math.round((grid.steps * target) / grid.cycles);
  if (steps < 1 || steps > MAX_STEPS) return grid;
  const cells = grid.cells.map((row) => {
    const next = new Array<boolean>(steps).fill(false);
    for (let i = 0; i < Math.min(steps, row.length); i++) next[i] = row[i];
    return next;
  });
  return { ...grid, cycles: target, steps, cells };
}

/** Would `setCycles` fit on screen? Lets the caller explain instead of ignoring. */
export function cyclesFit(grid: DrumGrid, cycles: number): boolean {
  const target = Math.max(1, Math.min(MAX_CYCLES, Math.round(cycles)));
  const steps = Math.round((grid.steps * target) / grid.cycles);
  return steps >= 1 && steps <= MAX_STEPS;
}

export const MAX_GRID_STEPS = MAX_STEPS;
