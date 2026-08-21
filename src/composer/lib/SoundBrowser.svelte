<script lang="ts">
  // [SPEC-18.10] Browse the actual sound bank and insert a sound's name.
  // Answers the first question anyone hits with Strudel: what can I write in
  // `s("…")`, and how many variants does it have (the `:n` index)?
  import { onMount } from 'svelte';
  import {
    fetchSounds,
    keyBelongsTo,
    soundInsertName,
    soundKey,
    soundSnippet,
    type SoundEntry,
  } from '@core/composer/sounds';
  import { previewSound } from '@core/composer/preview';
  import { loadBookmarks, saveBookmarks } from '@core/composer/bookmarks';
  import { bpm } from '@composer/state/composerStore';

  interface Props {
    /** Add the sound as a new layer — the primary gesture. [SPEC-18.23] */
    oninsert: (snippet: string) => void;
    /** Drop the bare NAME at the caret, to go inside an existing `s("…")`. */
    oninsertname: (name: string) => void;
    /** False until the user has placed the caret in the pattern; without a caret
     *  there is no position to insert at. */
    canInsertAtCaret: boolean;
  }
  let { oninsert, oninsertname, canInsertAtCaret }: Props = $props();

  let all = $state<SoundEntry[]>([]);
  let loadError = $state<string | null>(null);
  let filter = $state('');
  /** Key currently sounding (`hh` or `hh:4`), to show what is being auditioned. */
  let auditioning = $state<string | null>(null);
  /** Sounds whose variants are unfolded. [SPEC-18.29] */
  let expanded = $state<Set<string>>(new Set());
  let previewError = $state<string | null>(null);
  /** Bookmarked sound names, restored from the previous session. [SPEC-18.20] */
  let bookmarks = $state<Set<string>>(loadBookmarks());
  /** Restrict the list to bookmarks — the palette rather than the directory. */
  let onlyBookmarks = $state(false);

  /** Rendering the whole bank at once would rebuild 1000+ DOM nodes on every
   *  keystroke; the list is paged instead, so everything stays reachable. */
  const PAGE_SIZE = 120;

  let page = $state(1);
  let listEl = $state<HTMLUListElement | undefined>(undefined);

  const matches = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    // A bookmarked VARIANT must keep its sound in the list, otherwise starring
    // `hh:4` then filtering would hide it. [SPEC-18.29]
    const marked = (name: string): boolean => [...bookmarks].some((k) => keyBelongsTo(k, name));
    const pool = onlyBookmarks ? all.filter((s) => marked(s.name)) : all;
    return needle === '' ? pool : pool.filter((s) => s.name.toLowerCase().includes(needle));
  });
  // Order is the bank's own and NEVER depends on the bookmarks: sorting them to
  // the top made a sound jump away from under the pointer the moment it was
  // starred — the click landing somewhere else on the next one. Reaching the
  // favourites is the `★` toggle's job, which changes the list only when asked.

  const pageCount = $derived(Math.max(1, Math.ceil(matches.length / PAGE_SIZE)));
  /** Clamped rather than trusted: the result set shrinks under the current page
   *  whenever the filter narrows, and an out-of-range page would show nothing. */
  const currentPage = $derived(Math.min(Math.max(1, page), pageCount));
  const firstIndex = $derived((currentPage - 1) * PAGE_SIZE);
  const shown = $derived(matches.slice(firstIndex, firstIndex + PAGE_SIZE));

  // Any change of result set starts the browsing over: staying on page 7 of a
  // freshly typed filter would look like an empty bank.
  $effect(() => {
    filter;
    onlyBookmarks;
    page = 1;
  });

  /** The list scrolls inside a fixed height, so a page turn must also bring the
   *  view back to the top — otherwise the new page looks like it starts midway. */
  function goToPage(next: number): void {
    page = Math.min(Math.max(1, next), pageCount);
    listEl?.scrollTo({ top: 0 });
  }

  /** Variant indices of an indexed sound. Pitched instruments are addressed by
   *  note, not by index, so they never unfold. [SPEC-18.29] */
  function variantsOf(entry: SoundEntry): number[] {
    if (entry.kind !== 'indexed' || entry.count < 2) return [];
    return Array.from({ length: entry.count }, (_, i) => i);
  }

  /** Indices of this sound's bookmarked variants. */
  function markedVariants(entry: SoundEntry): number[] {
    return variantsOf(entry).filter((i) => bookmarks.has(soundKey(entry.name, i)));
  }

  /**
   * Folding is decided by the fold button and NOTHING else. [SPEC-18.29]
   *
   * Bookmarked variants used to force their sound open, so that a mark could never
   * be announced without being visible — but that took the fold away from the user
   * the moment they starred a variant. The count on the folded row carries that
   * information instead, which says the same thing without confiscating control.
   */
  function isOpen(entry: SoundEntry): boolean {
    return expanded.has(entry.name);
  }

  function toggleExpand(name: string): void {
    const next = new Set(expanded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    expanded = next;
  }

  /** Toggle a bookmark and persist at once — a lost bookmark is never noticed
   *  until it is needed, so a write failure must be said out loud. [SPEC-14.3] */
  function toggleBookmark(key: string): void {
    const next = new Set(bookmarks);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    try {
      saveBookmarks(next);
      bookmarks = next; // only adopt what actually reached storage
    } catch (err) {
      previewError = `Favori non enregistré : ${(err as Error).message}`;
    }
  }

  onMount(async () => {
    try {
      all = await fetchSounds();
    } catch (err) {
      loadError = (err as Error).message; // never silent [SPEC-14.3]
    }
  });

  /**
   * Audition a sound. [SPEC-18.10] The click is the user gesture that unlocks
   * audio, so `previewSound` must be reached without awaiting anything first.
   */
  async function audition(entry: SoundEntry, index?: number): Promise<void> {
    const key = soundKey(entry.name, index);
    previewError = null;
    auditioning = key;
    try {
      await previewSound(entry, $bpm, index);
    } catch (err) {
      previewError = (err as Error).message; // never silent [SPEC-14.3]
    } finally {
      if (auditioning === key) auditioning = null;
    }
  }
</script>

<div class="browser">
  {#if loadError}
    <p class="bad">{loadError}</p>
  {:else}
    <div class="head">
      <input
        class="filter"
        placeholder="filtrer ({all.length} sons)"
        value={filter}
        oninput={(e) => (filter = e.currentTarget.value)}
      />
      <button
        class="only"
        class:on={onlyBookmarks}
        disabled={bookmarks.size === 0}
        onclick={() => (onlyBookmarks = !onlyBookmarks)}
        title={bookmarks.size === 0
          ? 'Aucun favori — cliquez ★ sur un son'
          : 'Afficher uniquement les favoris'}
      >
        ★ {bookmarks.size}
      </button>
    </div>
    <ul class="list" bind:this={listEl}>
      {#each shown as s (s.name)}
        {@const variants = variantsOf(s)}
        {@const open = isOpen(s)}
        <!-- One cell per sound. An unfolded cell spans the whole width: growing it
             inside a single column would leave ragged rows, and the variants need
             the room to stay countable. [SPEC-18.29] -->
        <li class:playing={auditioning === s.name} class:open>
          <div class="row">
            <button
              class="hear"
              onclick={() => void audition(s)}
              title={`Écouter ${s.name}${s.kind === 'pitched' ? ' (note c3)' : ''}`}
              aria-label={`Écouter ${s.name}`}
            >
              ▶
            </button>
            <button
              class="star"
              class:on={bookmarks.has(s.name)}
              onclick={() => toggleBookmark(s.name)}
              title={bookmarks.has(s.name) ? `Retirer ${s.name} des favoris` : `Marquer ${s.name}`}
              aria-label={bookmarks.has(s.name)
                ? `Retirer ${s.name} des favoris`
                : `Marquer ${s.name}`}
              aria-pressed={bookmarks.has(s.name)}
            >
              {bookmarks.has(s.name) ? '★' : '☆'}
            </button>
            <button
              class="pick"
              onclick={() => oninsert(soundSnippet(s))}
              title={`Ajouter une couche : ${soundSnippet(s)}`}
            >
              <span class="name">{s.name}</span>
              {#if s.kind === 'pitched'}
                <span class="tag pitched">notes · {s.count}</span>
              {:else if s.count > 1}
                {@const marked = markedVariants(s)}
                {#if marked.length > 0}
                  <!-- Says that marks live inside, without forcing the cell open. -->
                  <span
                    class="tag marked"
                    title={`Variantes en favori : ${marked.map((i) => `:${i}`).join(' ')}`}
                    >★ {marked.length}</span
                  >
                {/if}
                <span class="tag">{s.count} variantes</span>
              {/if}
            </button>
            <button
              class="caret"
              disabled={!canInsertAtCaret}
              onclick={() => oninsertname(soundInsertName(s))}
              title={canInsertAtCaret
                ? `Insérer « ${s.name} » à la position du curseur`
                : 'Placez d’abord le curseur dans le pattern'}
              aria-label={`Insérer ${s.name} au curseur`}
            >
              ↳
            </button>
            {#if variants.length > 0}
              <button
                class="fold"
                class:has-marks={markedVariants(s).length > 0}
                onclick={() => toggleExpand(s.name)}
                title={open ? `Replier les variantes de ${s.name}` : `Voir les ${variants.length} variantes de ${s.name}`}
                aria-expanded={open}
                aria-label={`${open ? 'Replier' : 'Déplier'} les variantes de ${s.name}`}
              >
                {open ? '▾' : '▸'}
              </button>
            {/if}
          </div>

          {#if open && variants.length > 0}
            <!-- Indented and rule-separated, so a variant is plainly a child of the
                 sound above it rather than a neighbour. -->
            <div class="variants">
              {#each variants as i (i)}
                {@const key = soundKey(s.name, i)}
                <span class="variant" class:playing={auditioning === key}>
                  <button
                    class="hear"
                    onclick={() => void audition(s, i)}
                    title={`Écouter ${key}`}
                    aria-label={`Écouter ${key}`}>▶</button
                  >
                  <button
                    class="pick"
                    onclick={() => oninsert(soundSnippet(s, i))}
                    title={`Ajouter une couche : ${soundSnippet(s, i)}`}
                  >
                    <span class="name">:{i}</span>
                  </button>
                  <button
                    class="star"
                    class:on={bookmarks.has(key)}
                    onclick={() => toggleBookmark(key)}
                    title={bookmarks.has(key) ? `Retirer ${key} des favoris` : `Marquer ${key}`}
                    aria-label={bookmarks.has(key) ? `Retirer ${key} des favoris` : `Marquer ${key}`}
                    aria-pressed={bookmarks.has(key)}
                  >
                    {bookmarks.has(key) ? '★' : '☆'}
                  </button>
                  <button
                    class="caret"
                    disabled={!canInsertAtCaret}
                    onclick={() => oninsertname(soundInsertName(s, i))}
                    title={canInsertAtCaret
                      ? `Insérer « ${key} » à la position du curseur`
                      : 'Placez d’abord le curseur dans le pattern'}
                    aria-label={`Insérer ${key} au curseur`}>↳</button
                  >
                </span>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if onlyBookmarks && matches.length === 0}
      <p class="more">Aucun favori ne correspond au filtre.</p>
    {/if}
    <!-- Always say where you are in the whole set: a bare list gives no clue that
         anything follows. -->
    {#if pageCount > 1}
      <div class="pager">
        <button onclick={() => goToPage(1)} disabled={currentPage === 1} title="Première page"
          >«</button
        >
        <button
          onclick={() => goToPage(currentPage - 1)}
          disabled={currentPage === 1}
          title="Page précédente">‹</button
        >
        <span class="range">
          {firstIndex + 1}–{firstIndex + shown.length} sur {matches.length}
          <span class="sep">·</span> page {currentPage}/{pageCount}
        </span>
        <button
          onclick={() => goToPage(currentPage + 1)}
          disabled={currentPage === pageCount}
          title="Page suivante">›</button
        >
        <button
          onclick={() => goToPage(pageCount)}
          disabled={currentPage === pageCount}
          title="Dernière page">»</button
        >
      </div>
    {:else if matches.length > 0}
      <p class="more">
        {matches.length} son{matches.length > 1 ? 's' : ''} affiché{matches.length > 1 ? 's' : ''}.
      </p>
    {/if}
    <p class="more">
      ▶ écoute · ★ favori · le nom ajoute une couche · ↳ insère au curseur · ▸ déplie les
      variantes, marquables une par une
    </p>
    {#if previewError}
      <p class="bad">{previewError}</p>
    {/if}
  {/if}
</div>

<style>
  .browser {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-height: 0;
  }
  .head {
    display: flex;
    gap: 0.35rem;
  }
  .filter {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 0.8rem;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.25rem 0.4rem;
  }
  .only {
    flex: none;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .only.on {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .pager {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
  }
  .pager button {
    padding: 0.1rem 0.4rem;
    font-size: 0.8rem;
    line-height: 1.2;
    color: var(--muted);
  }
  .range {
    font-size: 0.72rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .sep {
    opacity: 0.5;
  }
  /* A GRID, not wrapped inline groups: with four buttons per sound, ragged
     wrapping ran neighbouring groups together and it took effort to tell which
     button belonged to which name. Fixed cells align them into columns. */
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.35rem;
    /* Rows keep their content height. Without this, `align-content` behaves as
       `stretch` on a grid whose height is capped, and the 120 auto rows were
       squeezed to 2 px each — the cells kept their borders and clipped everything
       inside, which is exactly what made the list unreadable. Measured. */
    align-content: start;
    max-height: 26rem;
    overflow-y: auto;
  }

  /* One bordered cell per sound: the group is the visible unit, not the buttons.
     A SOLID ground, not a 2 % white veil — the veil left the buttons floating on
     the panel with nothing to read them against. */
  .list li {
    display: block;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    /* NO `overflow: hidden` here, deliberately. A grid item whose overflow is not
       `visible` gets an automatic minimum size of ZERO; this grid's height is
       capped, and Chrome then sized all 120 auto rows on that zero — every cell
       collapsed to its 2 px of border while `overflow: hidden` clipped the content
       out of sight. The property that hid the content was also the one that caused
       the collapse. Measured, twice. The rounded corners are obtained by rounding
       the edge children below instead. */
  }
  /* Unfolded: takes the full width. Inside one column the variants would wrap into
     an unreadable block and leave the row ragged. [SPEC-18.29] */
  .list li.open {
    grid-column: 1 / -1;
    border-color: var(--accent-dim);
  }

  /* The sound's own line. Named `row`, NOT `head`: that class already belongs to
     the filter line above, and sharing it silently applied its `gap` here, pulling
     the button group apart. */
  .list .row {
    display: flex;
    align-items: stretch;
    min-width: 0;
  }

  /* Every selector below is scoped with `.list` so it outweighs `.list button`
     (class+type). Unscoped, `.list button { border: none }` won on specificity and
     erased every separator — which is what made the cells unreadable. */
  .list button {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.22rem 0.4rem;
    font-size: 0.75rem;
    line-height: 1.3;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--text);
  }
  .list button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
  }
  .list button:disabled {
    opacity: 0.35;
  }

  .list .hear {
    flex: none;
    color: var(--muted);
    border-right: 1px solid var(--border);
  }
  .list .star {
    flex: none;
    padding-inline: 0.32rem;
    color: var(--muted);
    border-right: 1px solid var(--border);
  }
  .list .star.on {
    color: #fcd34d;
  }
  /* The name takes the remaining width, so every cell aligns its ↳ on the right. */
  .list .pick {
    flex: 1;
    min-width: 0;
    justify-content: space-between;
  }
  .list .caret {
    flex: none;
    color: var(--muted);
    border-left: 1px solid var(--border);
  }

  /* Rounding the edge children, since the cell no longer clips. The bottom corners
     belong to whichever element ends the cell: the sound's line when folded, the
     variants block when open. */
  .list .row > :first-child {
    border-top-left-radius: 5px;
  }
  .list .row > :last-child {
    border-top-right-radius: 5px;
  }
  .list li:not(.open) .row > :first-child {
    border-bottom-left-radius: 5px;
  }
  .list li:not(.open) .row > :last-child {
    border-bottom-right-radius: 5px;
  }
  .list li.open .variants {
    border-bottom-left-radius: 5px;
    border-bottom-right-radius: 5px;
  }
  .list .fold {
    flex: none;
    padding-inline: 0.36rem;
    color: var(--muted);
    border-left: 1px solid var(--border);
  }
  .list li.open .fold {
    color: var(--accent);
  }
  .list .fold.has-marks {
    color: #fcd34d;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, 'SF Mono', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
  .tag {
    flex: none;
    font-size: 0.62rem;
    color: var(--muted);
  }
  .tag.pitched {
    color: var(--accent);
  }
  /* Bookmarked variants hidden inside a folded cell. */
  .tag.marked {
    color: #fcd34d;
    font-variant-numeric: tabular-nums;
  }

  /* Variants, plainly children of the sound above: indented, on darker ground,
     separated by the rule the sound's line sits on. */
  .variants {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    padding: 0.35rem 0.4rem 0.4rem 1.5rem;
    border-top: 1px solid var(--border);
    background: rgba(0, 0, 0, 0.35);
  }
  .variant {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--border);
    border-radius: 5px;
    overflow: hidden;
    background: var(--panel);
  }
  .list .variant button {
    padding: 0.14rem 0.3rem;
    font-size: 0.7rem;
  }
  /* The index IS the label: fixed width, centred, so the chips line up. */
  .list .variant .pick {
    flex: none;
    justify-content: center;
    min-width: 2.1rem;
  }
  .variant .name {
    flex: none;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .variant.playing {
    border-color: var(--accent-dim);
    background: rgba(110, 231, 183, 0.14);
  }
  .variant.playing .hear {
    color: var(--accent);
  }

  /* The sound being auditioned, so ear and eye agree. [SPEC-18.10] The whole cell
     lights up: highlighting one button inside it was easy to miss. */
  .list li.playing {
    border-color: var(--accent-dim);
    background: rgba(110, 231, 183, 0.12);
  }
  .list li.playing > .row > .hear {
    color: var(--accent);
  }

  .more,
  .bad {
    margin: 0;
    font-size: 0.72rem;
    color: var(--muted);
  }
  .bad {
    color: var(--danger);
  }
</style>
