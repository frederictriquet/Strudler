<script lang="ts">
  // [SPEC-18.10] Browse the actual sound bank and insert a sound's name.
  // Answers the first question anyone hits with Strudel: what can I write in
  // `s("…")`, and how many variants does it have (the `:n` index)?
  import { onMount } from 'svelte';
  import { fetchSounds, soundSnippet, type SoundEntry } from '@core/composer/sounds';
  import { previewSound } from '@core/composer/preview';
  import { loadBookmarks, saveBookmarks } from '@core/composer/bookmarks';
  import { bpm } from '@composer/state/composerStore';

  interface Props {
    oninsert: (snippet: string) => void;
  }
  let { oninsert }: Props = $props();

  let all = $state<SoundEntry[]>([]);
  let loadError = $state<string | null>(null);
  let filter = $state('');
  /** Sound currently sounding, to show which one is being auditioned. [SPEC-18.10] */
  let auditioning = $state<string | null>(null);
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
    const pool = onlyBookmarks ? all.filter((s) => bookmarks.has(s.name)) : all;
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

  /** Toggle a bookmark and persist at once — a lost bookmark is never noticed
   *  until it is needed, so a write failure must be said out loud. [SPEC-14.3] */
  function toggleBookmark(name: string): void {
    const next = new Set(bookmarks);
    if (next.has(name)) next.delete(name);
    else next.add(name);
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
  async function audition(entry: SoundEntry): Promise<void> {
    previewError = null;
    auditioning = entry.name;
    try {
      await previewSound(entry, $bpm);
    } catch (err) {
      previewError = (err as Error).message; // never silent [SPEC-14.3]
    } finally {
      if (auditioning === entry.name) auditioning = null;
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
        <!-- Three actions per sound: écouter (▶), marquer (★), insérer (le nom). -->
        <li class:playing={auditioning === s.name}>
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
            aria-label={bookmarks.has(s.name) ? `Retirer ${s.name} des favoris` : `Marquer ${s.name}`}
            aria-pressed={bookmarks.has(s.name)}
          >
            {bookmarks.has(s.name) ? '★' : '☆'}
          </button>
          <button class="pick" onclick={() => oninsert(soundSnippet(s))} title={soundSnippet(s)}>
            <span class="name">{s.name}</span>
            {#if s.kind === 'pitched'}
              <span class="tag pitched">notes · {s.count}</span>
            {:else}
              <span class="tag">:0–{s.count - 1}</span>
            {/if}
          </button>
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
    <p class="more">▶ écoute · ★ favori · le nom insère dans le pattern</p>
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
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    max-height: 11rem;
    overflow-y: auto;
  }
  .list li {
    display: inline-flex;
    align-items: stretch;
    border-radius: 6px;
  }
  .list button {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
    padding: 0.15rem 0.4rem;
    font-size: 0.75rem;
    border-radius: 6px;
  }
  .hear {
    color: var(--muted);
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    padding: 0.15rem 0.3rem;
  }
  /* Middle of the three-button group: no rounding, no doubled border. */
  .star {
    border-left: none;
    border-right: none;
    border-radius: 0;
    padding: 0.15rem 0.25rem;
    color: var(--muted);
  }
  .star.on {
    color: #fcd34d;
  }
  .pick {
    border-left: none;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  /* The sound being auditioned, so ear and eye agree. [SPEC-18.10] */
  .list li.playing .hear {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .list li.playing .pick {
    border-color: var(--accent-dim);
  }
  .name {
    font-family: ui-monospace, monospace;
  }
  .tag {
    font-size: 0.62rem;
    color: var(--muted);
  }
  .tag.pitched {
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
