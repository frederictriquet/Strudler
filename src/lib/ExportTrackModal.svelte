<script lang="ts">
  // [SPEC-15] Export the live-coded code of a slot to a library file.
  //
  // In a modal on purpose: the instrument must stay visible without scrolling
  // [SPEC-17.2], and this is a between-two-tracks action, not a playing gesture.
  // Everything that could destroy work — overwriting a file, changing the
  // identifier pads are bound to [SPEC-17.51] — is stated before it happens and
  // needs a second, explicit click.
  import {
    adoptMeasuredBeats,
    canWriteToDisk,
    closeTrackExport,
    downloadTrackExport,
    exportBeats,
    exportCategory,
    exportCheck,
    exportError,
    exportFolder,
    exportName,
    exportSlug,
    exportStatus,
    exportTags,
    exportYaml,
    exportBusy,
    knownCategories,
    measuredBeats,
    patternError,
    pickExportFolder,
    refreshTargetExists,
    saveTrackExport,
    targetId,
  } from '@stores/trackExportStore';

  const check = exportCheck;
  const busy = exportBusy;
  const error = exportError;
  const status = exportStatus;
  const folder = exportFolder;
  const yaml = exportYaml;
  const id = targetId;
  const measured = measuredBeats;
  const patternErr = patternError;

  /** True once the warnings have been shown and the user asked to proceed anyway. */
  let armed = $state(false);

  // Re-check the destination after the category/slug settle, and disarm: the
  // confirmation the user gave was for the PREVIOUS target.
  let existsTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void $id; // track category + slug
    armed = false;
    clearTimeout(existsTimer);
    existsTimer = setTimeout(() => void refreshTargetExists(), 250);
    return () => clearTimeout(existsTimer);
  });

  async function onSave() {
    const ok = await saveTrackExport(armed);
    if (ok) {
      armed = false;
      return;
    }
    // Refused only because of warnings → ask for the explicit confirmation.
    if ($check.blocking.length === 0) armed = true;
  }

  function onBeats(e: Event) {
    const value = Number((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) exportBeats.set(value);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeTrackExport();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="wrap" role="dialog" aria-modal="true" aria-label="Enregistrer la piste">
  <button class="backdrop" onclick={closeTrackExport} aria-label="Fermer"></button>
  <div class="modal">
    <div class="modal-head">
      <span class="title">Enregistrer dans la bibliothèque</span>
      <button class="close" onclick={closeTrackExport} aria-label="Fermer">✕</button>
    </div>

    <div class="modal-body">
      <p class="note">
        Écrit le code du slot dans <code>library/{$exportCategory}/{$exportSlug}.track.yaml</code> —
        l'édition live devient une piste permanente.
      </p>

      <div class="grid">
        <label for="ex-cat">Catégorie</label>
        <input
          id="ex-cat"
          list="ex-cats"
          bind:value={$exportCategory}
          spellcheck="false"
          placeholder="bass"
        />
        <datalist id="ex-cats">
          {#each knownCategories as c (c)}<option value={c}></option>{/each}
        </datalist>

        <label for="ex-slug">Fichier</label>
        <div class="inline">
          <input id="ex-slug" bind:value={$exportSlug} spellcheck="false" />
          <span class="unit">.track.yaml</span>
        </div>

        <label for="ex-name">Nom affiché</label>
        <input id="ex-name" bind:value={$exportName} />

        <label for="ex-beats">Longueur</label>
        <div class="inline">
          <input
            id="ex-beats"
            type="number"
            min="1"
            step="1"
            value={$exportBeats}
            oninput={onBeats}
          />
          <span class="unit">beats</span>
          {#if $measured !== null && $measured !== $exportBeats}
            <button class="link" onclick={adoptMeasuredBeats}>
              mesuré : {$measured} beats — adopter
            </button>
          {:else if $measured === null && !$patternErr}
            <span class="unit">longueur variable — valeur à choisir</span>
          {/if}
        </div>

        <label for="ex-tags">Tags</label>
        <input id="ex-tags" bind:value={$exportTags} spellcheck="false" placeholder="house, deep" />
      </div>

      <details class="preview">
        <summary>Fichier produit ({$id})</summary>
        <pre>{$yaml}</pre>
      </details>

      <div class="folder">
        <button onclick={() => void pickExportFolder()} disabled={!canWriteToDisk}>
          📁 Dossier…
        </button>
        <span class="unit">
          {#if !canWriteToDisk}
            Écriture directe indisponible (Chrome ou Edge requis) — utilise le téléchargement.
          {:else if $folder}
            Dossier autorisé : <strong>{$folder}</strong>
          {:else}
            Aucun dossier autorisé — choisis le dossier <code>library/</code> du projet.
          {/if}
        </span>
      </div>

      {#each $check.blocking as message (message)}
        <p class="blocking">✕ {message}</p>
      {/each}
      {#each $check.warnings as message (message)}
        <p class="warning">⚠ {message}</p>
      {/each}

      <p class="note">
        Le serveur de dev voit le nouveau fichier et recharge la page [SPEC-18.17] : la lecture
        s'arrête. À faire entre deux morceaux, pas en plein set.
      </p>

      {#if $error}<p class="blocking">{$error}</p>{/if}
      {#if $status}<p class="ok">{$status}</p>{/if}

      <div class="actions">
        <button
          class="save"
          class:armed
          onclick={() => void onSave()}
          disabled={$busy || $check.blocking.length > 0}
        >
          {#if $busy}
            Enregistrement…
          {:else if armed}
            ⚠ Confirmer l'enregistrement
          {:else}
            💾 Enregistrer
          {/if}
        </button>
        <button onclick={downloadTrackExport} disabled={$check.blocking.length > 0}>
          ⬇ Télécharger le fichier
        </button>
        <button class="cancel" onclick={closeTrackExport}>Annuler</button>
      </div>
    </div>
  </div>
</div>

<style>
  .wrap {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 4vh 1rem;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .modal {
    position: relative;
    width: min(680px, 100%);
    max-height: 92vh;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 1rem 1.25rem 1.25rem;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.8rem;
  }
  .title {
    font-weight: 700;
    font-size: 1.05rem;
  }
  .close {
    padding: 0.2rem 0.55rem;
    color: var(--muted);
  }
  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .grid {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 0.5rem 0.7rem;
  }
  label {
    color: var(--muted);
    font-size: 0.85rem;
  }
  input {
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.3rem 0.45rem;
    font: inherit;
    font-size: 0.88rem;
    min-width: 0;
  }
  input:focus {
    outline: none;
    border-color: var(--accent-dim);
  }
  input[type='number'] {
    width: 6rem;
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .inline input:not([type='number']) {
    flex: 1;
  }
  .unit,
  .note {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .note {
    margin: 0;
  }
  code {
    font-family: ui-monospace, monospace;
    color: var(--text);
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--accent);
    font-size: 0.78rem;
    cursor: pointer;
    text-decoration: underline;
  }
  .preview summary {
    color: var(--muted);
    font-size: 0.82rem;
    cursor: pointer;
  }
  .preview pre {
    margin: 0.4rem 0 0;
    padding: 0.5rem 0.6rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-family: ui-monospace, 'SF Mono', monospace;
    font-size: 0.78rem;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 30vh;
    overflow-y: auto;
  }
  .folder {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .blocking {
    color: var(--danger);
    font-size: 0.82rem;
    margin: 0;
  }
  .warning {
    color: #f0b429;
    font-size: 0.82rem;
    margin: 0;
  }
  .ok {
    color: var(--ok);
    font-size: 0.82rem;
    margin: 0;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.2rem;
  }
  .save {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .save.armed {
    color: #f0b429;
    border-color: #f0b429;
  }
  .save:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .cancel {
    color: var(--muted);
  }
</style>
