// [SPEC-18.9] Layers — the only structure the workshop reads back out of the code.
//
// Non-trivial loops are `stack(a, b, c)`. Recovering those arguments is bracket
// matching, not a JavaScript parser, which is exactly why this one structure is
// allowed while everything else stays derived-only [SPEC-18.6].
//
// The layers are used to SOLO and MUTE, never to rewrite the user's text: the
// pattern textarea remains the source of truth and keeps its formatting.
//
// Two details that are easy to get wrong and would silently change the sound:
//   - a chained suffix after the stack applies to every layer
//     (`stack(a, b).s("piano").gain(0.7)`) and must be preserved when soloing;
//   - commas and parentheses inside a mini-notation string are not syntax
//     (`s("bd, hh")`).

const STACK = 'stack';

export interface StackParts {
  /** Arguments of the top-level `stack(...)`, source text, trimmed. */
  layers: string[];
  /** Everything chained after the closing paren, e.g. `.s("piano").gain(0.7)`. */
  suffix: string;
}

/**
 * Split a top-level `stack(...)` into its arguments.
 * Returns null when the pattern is not a top-level stack — the caller then treats
 * the whole pattern as a single layer.
 */
export function splitStack(pattern: string): StackParts | null {
  const text = pattern.trim();
  if (!text.startsWith(STACK)) return null;

  // Allow whitespace between `stack` and `(`.
  let i = STACK.length;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '(') return null;
  const open = i;

  let depth = 0;
  let quote: string | null = null;
  const layers: string[] = [];
  let start = open + 1;

  for (let j = open; j < text.length; j++) {
    const ch = text[j];

    if (quote) {
      if (ch === '\\') j++; // escaped char inside a string
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        // Closing paren of the stack itself.
        layers.push(text.slice(start, j));
        return {
          layers: layers.map((l) => l.trim()).filter((l) => l !== ''),
          suffix: text.slice(j + 1).trim(),
        };
      }
      continue;
    }
    if (ch === ',' && depth === 1) {
      layers.push(text.slice(start, j));
      start = j + 1;
    }
  }
  return null; // unbalanced — leave it to the evaluator to complain
}

/** Indent every line of a layer by two spaces, so a multi-line layer stays
 *  readable inside the formatted stack. */
function indent(code: string): string {
  return code
    .trim()
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

/** A `stack(...)` written over several lines — the shape the library uses. */
function formatStack(layers: string[]): string {
  return `stack(\n${layers.map(indent).join(',\n')}\n)`;
}

/**
 * Add `snippet` as a new layer of `pattern`. [SPEC-18.23]
 *
 * Text-level, like everything else here — no evaluation, no parser. Three cases,
 * and the third is the one that matters:
 *
 *   empty pattern            → the snippet alone; a lone layer needs no stack
 *   `stack(a, b)`            → one more argument
 *   anything else            → the WHOLE existing pattern becomes one layer
 *
 * That last case covers a plain pattern, but also a stack carrying a chained
 * suffix. Appending into `stack(a, b).s("piano")` would place the new layer under
 * that `.s()` — controls set later win — silently turning an inserted drum into a
 * piano. Wrapping instead costs one level of parentheses and is the only correct
 * result.
 */
export function addLayer(pattern: string, snippet: string): string {
  const existing = pattern.trim();
  const added = snippet.trim();
  if (added === '') return pattern;
  if (existing === '') return added;

  const parts = splitStack(existing);
  if (parts && parts.suffix === '' && parts.layers.length > 0) {
    return formatStack([...parts.layers, added]);
  }
  return formatStack([existing, added]);
}

/** Rebuild a pattern from a subset of layers, keeping the chained suffix. */
export function joinStack(layers: string[], suffix: string): string {
  if (layers.length === 0) return 'silence';
  if (layers.length === 1 && suffix === '') return layers[0];
  return `stack(${layers.join(', ')})${suffix}`;
}

/**
 * The pattern to hear, given which layers are enabled.
 * All enabled (or not a stack) → the original text, untouched, so the common case
 * never goes through a rewrite.
 */
export function patternForEnabled(pattern: string, enabled: boolean[]): string {
  const parts = splitStack(pattern);
  if (!parts || parts.layers.length < 2) return pattern;
  const kept = parts.layers.filter((_, i) => enabled[i] !== false);
  if (kept.length === parts.layers.length) return pattern;
  return joinStack(kept, parts.suffix);
}

/** Layer list for display; a non-stack pattern is one layer. */
export function layersOf(pattern: string): string[] {
  const parts = splitStack(pattern);
  return parts && parts.layers.length >= 2 ? parts.layers : [pattern.trim()];
}

/** A single layer, wrapped with the stack's chained suffix so it sounds the same
 *  alone as it does inside the stack. */
export function layerAlone(pattern: string, index: number): string {
  const parts = splitStack(pattern);
  if (!parts || parts.layers.length < 2) return pattern;
  const layer = parts.layers[index];
  if (layer === undefined) return pattern;
  return joinStack([layer], parts.suffix);
}
