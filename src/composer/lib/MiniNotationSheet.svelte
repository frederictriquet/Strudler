<script lang="ts">
  // [SPEC-18.13] Mini-notation cheat sheet.
  //
  // Split out of `PatternHelp` so it can live in the right-hand column: the caret
  // explanation must stay next to the pattern it describes, while the sheet is
  // reference material one goes looking for — putting it under the pattern pushed
  // the roll and the metadata down for something read once in a while.
  //
  // All wording comes from `@core/composer/miniNotation`, the same source as the
  // caret explanation, so the two can never disagree about an operator.
  import {
    codeSegments,
    FUNCTIONS,
    MINI_NOTATION,
    PITFALLS,
    type SyntaxEntry,
  } from '@core/composer/miniNotation';

  const sheet: Array<{ title: string; entries: SyntaxEntry[] }> = [
    { title: 'Mini-notation (dans les guillemets)', entries: MINI_NOTATION },
    { title: 'Fonctions', entries: FUNCTIONS },
    // Last: rules one comes back to, not syntax one looks up.
    { title: 'Pièges (aucune erreur affichée)', entries: PITFALLS },
  ];
</script>

<!-- Always open: it is reference material one glances at WHILE writing, and a
     click to reveal it is a click too many. Its own scroller keeps it from
     growing the page — the column stays the height it was. -->
<section class="sheet">
  <h3>Aide-mémoire de la mini-notation</h3>
  <div class="content">
    {#each sheet as block (block.title)}
      <h4>{block.title}</h4>
      <dl>
        {#each block.entries as entry (entry.token)}
          <dt><code>{entry.token}</code></dt>
          <dd>
            <span class="label">{entry.label}</span>
            {#each codeSegments(entry.text) as seg, i (i)}
              {#if seg.code}<code>{seg.value}</code>{:else}{seg.value}{/if}
            {/each}
          </dd>
        {/each}
      </dl>
    {/each}
  </div>
</section>

<style>
  /* Claims every pixel the right column has left over: this is reference material
     one reads, so more of it visible at once is strictly better. */
  .sheet {
    display: flex;
    flex-direction: column;
    flex: 1;
    /* Yields rather than pushing the column past the viewport. */
    min-height: 0;
    font-size: 0.75rem;
    color: var(--muted);
  }
  h3 {
    margin: 0 0 0.3rem;
    padding: 0 0.2rem;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
  }
  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
  }
  /* First heading sits flush with the box's own padding. */
  .content h4:first-child {
    margin-top: 0;
  }
  h4 {
    margin: 0.6rem 0 0.25rem;
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
  }
  dt {
    color: var(--accent);
  }
  dd {
    margin: 0;
    line-height: 1.4;
    color: var(--text);
  }
  .label {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.62rem;
    color: var(--accent-dim);
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
