<script lang="ts">
  // [SPEC-10.2] Library catalog: tracks grouped by category. Read-only browser
  // (the rack is the play surface). Load errors are shown, never hidden.
  import { tracksByCategory, categories, loadErrors } from '@stores/libraryStore';
  import { samplesStatus, samplesError, loadDefaultSamples } from '@stores/samplesStore';
  import { placementMode, heldTrack, togglePlacement, holdTrack } from '@stores/placementStore';

  const sstatus = samplesStatus;
  const serror = samplesError;
  const placing = placementMode;
  const held = heldTrack;

  const SAMPLE_LABEL: Record<string, string> = {
    idle: 'samples : non chargés',
    loading: 'samples : chargement…',
    ready: 'samples : prêts',
    error: 'samples : erreur',
  };
</script>

<section class="panel">
  <h2>
    Bibliothèque <span class="count">{categories.length} catégories</span>
    <button
      class="place-toggle"
      class:on={$placing}
      onclick={togglePlacement}
      title="Mode placement : cliquer une piste puis un slot d'un canal compatible"
    >
      {$placing ? '🎯 Placement actif' : '🎯 Placement'}
    </button>
    <button
      class="samples"
      data-status={$sstatus}
      onclick={() => loadDefaultSamples()}
      disabled={$sstatus === 'loading' || $sstatus === 'ready'}
      title="Banque locale (~/Music/Sounds) — servie et scannée localement"
    >
      {SAMPLE_LABEL[$sstatus]}
    </button>
  </h2>

  {#if $placing}
    <p class="place-hint">
      {#if $held}
        Tenu : <strong>{$held.category} · {$held.name}</strong> — cliquez un slot d'un canal
        <em>{$held.category}</em> (re-cliquez la piste pour lâcher).
      {:else}
        Cliquez une piste ci-dessous pour la saisir, puis un slot d'un canal compatible.
      {/if}
    </p>
  {/if}

  {#if $serror}
    <p class="errors">{$serror}</p>
  {/if}

  {#if loadErrors.length > 0}
    <ul class="errors">
      {#each loadErrors as err (err.path)}
        <li><code>{err.path}</code> — {err.message}</li>
      {/each}
    </ul>
  {/if}

  <div class="categories">
    {#each categories as category (category)}
      <div class="category">
        <h3>{category}</h3>
        <ul class="tracks">
          {#each tracksByCategory.get(category) ?? [] as track (track.id)}
            <li class:held={$held?.id === track.id}>
              {#if $placing}
                <button class="row" onclick={() => holdTrack(track.id)}>
                  <span class="name">{track.name}</span>
                  <span class="beats">{track.beats}b</span>
                  {#if track.tags.length}<span class="tags">{track.tags.join(' · ')}</span>{/if}
                </button>
              {:else}
                <span class="name">{track.name}</span>
                <span class="beats">{track.beats}b</span>
                {#if track.tags.length}<span class="tags">{track.tags.join(' · ')}</span>{/if}
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>
</section>

<style>
  .panel {
    background: var(--panel);
    /* Edge to edge: no side border or radius, no outer margin. [SPEC-17.2] */
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: var(--muted);
    font-weight: 600;
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  .count {
    font-size: 0.75rem;
    font-weight: 400;
  }
  .place-toggle {
    margin-left: auto;
    font-size: 0.72rem;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    color: var(--muted);
  }
  .place-toggle.on {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .place-hint {
    margin: 0 0 0.75rem;
    font-size: 0.82rem;
    color: var(--muted);
    padding: 0.4rem 0.6rem;
    border: 1px dashed var(--accent-dim);
    border-radius: 8px;
  }
  .place-hint strong {
    color: var(--text);
  }
  .place-hint em {
    color: var(--accent);
    font-style: normal;
  }
  .samples {
    font-size: 0.72rem;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    color: var(--muted);
  }
  .samples[data-status='ready'] {
    color: var(--ok);
    border-color: var(--accent-dim);
  }
  .samples[data-status='loading'] {
    color: #f0b429;
    border-color: #f0b429;
  }
  .samples[data-status='error'] {
    color: var(--danger);
    border-color: var(--danger);
  }
  .errors {
    list-style: none;
    padding: 0.6rem 0.75rem;
    margin: 0 0 1rem;
    border: 1px solid var(--danger);
    border-radius: 8px;
    color: var(--danger);
    font-size: 0.85rem;
  }
  .errors code {
    font-family: ui-monospace, monospace;
  }
  .categories {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
  }
  .category h3 {
    margin: 0 0 0.5rem;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
  }
  .tracks {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .tracks li {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.25rem 0.4rem;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.02);
  }
  .tracks li.held {
    border: 1px solid var(--accent);
    background: rgba(110, 231, 183, 0.15);
    box-shadow: 0 0 8px rgba(110, 231, 183, 0.3);
  }
  /* Full-row button used in placement mode (keyboard-accessible). */
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .row:hover .name {
    color: var(--accent);
  }
  .name {
    font-weight: 600;
    flex: 1;
  }
  .beats {
    font-size: 0.7rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .tags {
    font-size: 0.7rem;
    color: var(--muted);
  }
</style>
