<script lang="ts">
  // [SPEC-18.27] Pattern editor that can light up the characters being played.
  //
  // A `<textarea>` cannot style ranges of its own text — the limitation is the
  // element's, not Strudel's. So the text is rendered TWICE, exactly on top of
  // itself: a `<div>` underneath carries the highlighting, and the textarea above
  // keeps the text transparent while remaining the real editing surface (caret,
  // selection, undo, spellcheck, IME — everything a hand-rolled editor loses).
  //
  // The two layers must agree to the pixel: same font, size, line height, padding,
  // border and wrapping. Any mismatch and the highlight drifts from the glyphs,
  // which is why those properties live in ONE place below and are shared.
  import type { SourceRange } from '@core/engine/StrudelEngine';

  interface Props {
    value: string;
    /** Ranges to light up now, already filtered to the sounding events. */
    lit: SourceRange[];
    /** False when the offsets cannot be trusted; the layer then renders plain text. */
    highlightable: boolean;
    disabled?: boolean;
    rows?: number;
    oninput: (event: Event) => void;
    /** Caret/selection tracking, unchanged from the plain textarea. [SPEC-18.13] */
    oncaret: () => void;
    /** Bound back so the parent keeps reading selectionStart/End. [SPEC-18.23] */
    element?: HTMLTextAreaElement;
  }
  let {
    value,
    lit,
    highlightable,
    disabled = false,
    rows = 8,
    oninput,
    oncaret,
    element = $bindable(),
  }: Props = $props();

  let layer = $state<HTMLDivElement | undefined>(undefined);

  /**
   * Cut the text into plain and lit segments. Ranges are merged first: one event
   * carries several ranges and several events overlap, so raw ranges would produce
   * nested spans and double-counted characters.
   */
  const segments = $derived.by(() => {
    if (!highlightable || lit.length === 0) return [{ text: value, on: false }];
    const bounded = lit
      .map((r) => ({ start: Math.max(0, r.start), end: Math.min(value.length, r.end) }))
      .filter((r) => r.end > r.start)
      .sort((a, b) => a.start - b.start);
    const merged: SourceRange[] = [];
    for (const r of bounded) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else merged.push({ ...r });
    }
    const out: Array<{ text: string; on: boolean }> = [];
    let at = 0;
    for (const r of merged) {
      if (r.start > at) out.push({ text: value.slice(at, r.start), on: false });
      out.push({ text: value.slice(r.start, r.end), on: true });
      at = r.end;
    }
    if (at < value.length) out.push({ text: value.slice(at), on: false });
    return out;
  });

  /** Keep the layer aligned when the textarea scrolls. */
  function syncScroll(): void {
    if (!layer || !element) return;
    layer.scrollTop = element.scrollTop;
    layer.scrollLeft = element.scrollLeft;
  }
</script>

<div class="editor">
  <!-- Highlight layer. aria-hidden: it is a duplicate of the textarea's content,
       and a screen reader must not read the pattern twice. -->
  <div class="layer" bind:this={layer} aria-hidden="true">
    {#each segments as seg, i (i)}{#if seg.on}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}<!--
      A trailing newline collapses in a div but not in a textarea; this keeps the
      last line's height in step.
    -->{'\n'}
  </div>

  <textarea
    bind:this={element}
    class:invalid={disabled}
    spellcheck="false"
    {rows}
    {disabled}
    {value}
    {oninput}
    onkeyup={oncaret}
    onclick={oncaret}
    onselect={oncaret}
    onscroll={syncScroll}
  ></textarea>
</div>

<style>
  /* The single source of the metrics both layers must share. Changing any of these
     here changes them for both — separating them is how the highlight drifts. */
  .editor {
    --pad: 0.5rem;
    --fs: 0.82rem;
    --lh: 1.45;
    --ff: ui-monospace, 'SF Mono', monospace;

    position: relative;
    display: grid;
    /* Take every pixel the container offers, and never be widened by the
       textarea's intrinsic `cols` width. */
    width: 100%;
    min-width: 0;
  }
  .layer,
  .editor textarea {
    grid-area: 1 / 1;
    margin: 0;
    padding: var(--pad);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-family: var(--ff);
    font-size: var(--fs);
    line-height: var(--lh);
    letter-spacing: normal;
    tab-size: 2;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    overflow: auto;
  }
  /* This layer draws the VISIBLE text; the textarea above it is transparent. */
  .layer {
    background: var(--panel);
    color: var(--text);
    pointer-events: none;
    user-select: none;
  }
  .editor textarea {
    /* Transparent text over the layer, but a visible caret: the textarea stays the
       editing surface. */
    background: transparent;
    color: transparent;
    caret-color: var(--text);
    resize: vertical;
    min-height: 100%;
  }
  /* The readable text lives in the layer; the selection still shows through. */
  .editor textarea::selection {
    background: rgba(110, 231, 183, 0.3);
  }
  .layer :global(mark) {
    /* Sounding characters. */
    background: var(--accent);
    color: var(--bg);
    border-radius: 2px;
  }
  .editor textarea.invalid {
    border-color: var(--danger);
  }
  /* A disabled pattern (the YAML pane does not parse, [SPEC-18.14]) must LOOK
     disabled. Dimming the textarea would show nothing — it is transparent; the
     visible text lives in the layer, so that is what dims. */
  .editor:has(textarea:disabled) .layer {
    opacity: 0.5;
  }
  .editor textarea:disabled {
    cursor: not-allowed;
  }
</style>
