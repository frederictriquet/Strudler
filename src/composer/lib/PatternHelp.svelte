<script lang="ts">
  // [SPEC-18.13] Contextual help: what is under the caret, and what to isolate.
  //
  // Read-only on the pattern — it never rewrites the text, in line with the
  // one-way rule the assistants follow [SPEC-18.7]. All wording comes from
  // `@core/composer/miniNotation`, so the cheat sheet and the caret explanation
  // can never say two different things about the same operator.
  //
  // The panel keeps a fixed height and shows a placeholder rather than
  // disappearing: an explanation that pops in and out on every keystroke is read
  // as a glitch and gets ignored.
  import {
    explainAt,
    fragmentAround,
    FUNCTIONS,
    MINI_NOTATION,
    type SyntaxEntry,
  } from '@core/composer/miniNotation';

  interface Props {
    text: string;
    caret: number;
    selectionStart: number;
    selectionEnd: number;
    /** Receives the evaluable fragment — the layer's chained suffix included. */
    onisolate: (fragment: string) => void;
  }
  let { text, caret, selectionStart, selectionEnd, onisolate }: Props = $props();

  const explanation = $derived(explainAt(text, caret));
  const fragment = $derived(fragmentAround(text, selectionStart, selectionEnd));

  /** Backticks in the tables mark code: render them as such instead of showing
   *  the character. Split, never inject HTML. */
  function segments(source: string): Array<{ code: boolean; value: string }> {
    return source
      .split('`')
      .map((value, i) => ({ code: i % 2 === 1, value }))
      .filter((s) => s.value !== '');
  }

  function preview(source: string): string {
    const flat = source.replace(/\s+/g, ' ').trim();
    return flat.length > 46 ? `${flat.slice(0, 45)}…` : flat;
  }

  const originLabel: Record<string, string> = {
    selection: 'la sélection',
    layer: 'la couche',
    expression: 'tout le pattern',
  };

  const sheet: Array<{ title: string; entries: SyntaxEntry[] }> = [
    { title: 'Mini-notation (dans les guillemets)', entries: MINI_NOTATION },
    { title: 'Fonctions', entries: FUNCTIONS },
  ];
</script>

<div class="help">
  <div class="current">
    {#if explanation}
      <span class="label">{explanation.label}</span>
      <code class="token">{explanation.token}</code>
      <p class="text">
        {#each segments(explanation.text) as seg, i (i)}
          {#if seg.code}<code>{seg.value}</code>{:else}{seg.value}{/if}
        {/each}
        {#if explanation.detail}
          <span class="detail">{explanation.detail}</span>
        {/if}
      </p>
    {:else}
      <p class="idle">Place le curseur sur un opérateur ou une fonction pour l’expliquer.</p>
    {/if}

    <button
      class="isolate"
      disabled={!fragment}
      title={fragment
        ? `Écouter ${originLabel[fragment.origin]} seule : ${preview(fragment.code)}`
        : 'Rien à isoler'}
      onclick={() => {
        if (fragment) onisolate(fragment.code);
      }}
    >
      Isoler
    </button>
  </div>

  {#if fragment}
    <p class="target">
      <span class="origin">{originLabel[fragment.origin]}</span>
      <code>{preview(fragment.text)}</code>
    </p>
  {/if}

  <details>
    <summary>Aide-mémoire de la mini-notation</summary>
    {#each sheet as block (block.title)}
      <h4>{block.title}</h4>
      <dl>
        {#each block.entries as entry (entry.token)}
          <dt><code>{entry.token}</code></dt>
          <dd>
            <span class="label">{entry.label}</span>
            {#each segments(entry.text) as seg, i (i)}
              {#if seg.code}<code>{seg.value}</code>{:else}{seg.value}{/if}
            {/each}
          </dd>
        {/each}
      </dl>
    {/each}
  </details>
</div>

<style>
  .help {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .current {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    /* Fixed height: the panel must not push the layout around while typing. */
    min-height: 2.6rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
  }
  .label {
    flex: none;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.62rem;
    padding-top: 0.12rem;
    color: var(--accent-dim);
  }
  .token {
    flex: none;
    padding: 0.02rem 0.3rem;
    border: 1px solid var(--accent-dim);
    border-radius: 4px;
    color: var(--accent);
  }
  .text,
  .idle {
    flex: 1;
    min-width: 0;
    margin: 0;
    line-height: 1.4;
    color: var(--text);
  }
  .idle {
    color: var(--muted);
    opacity: 0.7;
  }
  .detail {
    display: block;
    color: var(--accent);
  }
  .isolate {
    flex: none;
    font-size: 0.72rem;
    padding: 0.2rem 0.55rem;
    color: var(--muted);
  }
  .isolate:not(:disabled):hover {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .isolate:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .target {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    margin: 0;
    padding: 0 0.2rem;
    font-size: 0.7rem;
    overflow: hidden;
  }
  .origin {
    flex: none;
    opacity: 0.8;
  }
  .target code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  summary {
    cursor: pointer;
    user-select: none;
    padding: 0 0.2rem;
  }
  summary:hover {
    color: var(--accent);
  }
  h4 {
    margin: 0.5rem 0 0.25rem;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent-dim);
  }
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.22rem 0.6rem;
    margin: 0;
    max-height: 16rem;
    overflow-y: auto;
  }
  dt {
    color: var(--accent);
  }
  dd {
    margin: 0;
    line-height: 1.4;
    color: var(--text);
  }
  dd .label {
    margin-right: 0.3rem;
  }
  code {
    font-family: ui-monospace, 'SF Mono', monospace;
    font-size: 0.92em;
  }
  dd code {
    color: var(--muted);
  }
</style>
