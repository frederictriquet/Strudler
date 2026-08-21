<script lang="ts">
  // [SPEC-13.5→13.9] Where the user can SEE that nothing can be lost: state of the
  // disk mirror, dated snapshots to roll back to, and a single-file export for
  // moving to another machine or browser profile.
  import {
    confirmImport,
    exportAll,
    formatBytes,
    formatStamp,
    lastBytes,
    lastSavedAt,
    mirrorError,
    mirrorStatus,
    origin,
    persistentStorage,
    previewImport,
    refreshBackupIndex,
    restoreSnapshot,
    saveNow,
    snapshots,
    type ImportPreview,
  } from '@stores/backupStore';
  import type { SnapshotInfo } from '@core/persist/backup';
  import { notify } from '@stores/logStore';

  let fileInput = $state<HTMLInputElement | undefined>(undefined);
  let pending = $state<ImportPreview | null>(null);
  let busy = $state(false);

  const status = mirrorStatus;
  const saved = lastSavedAt;
  const bytes = lastBytes;
  const error = mirrorError;
  const snaps = snapshots;
  const persisted = persistentStorage;

  const LABEL: Record<string, string> = {
    unknown: 'vérification…',
    ready: '✓ actif',
    unavailable: '⚠ indisponible',
    error: '✕ en échec',
  };

  async function onSaveNow() {
    busy = true;
    try {
      await saveNow();
    } finally {
      busy = false;
    }
  }

  async function onRestore(snap: SnapshotInfo) {
    const when = formatStamp(snap.savedAt);
    if (!confirm(`Remplacer l'état actuel par l'instantané du ${when} ?\nLa page sera rechargée.`)) return;
    busy = true;
    await restoreSnapshot(snap.name);
    busy = false;
  }

  async function onFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      pending = previewImport(await file.text());
    } catch (err) {
      // Surfaced in the UI, never only in the console. [SPEC-14.3]
      notify('error', `Fichier refusé : ${(err as Error).message}`);
      pending = null;
    }
    if (fileInput) fileInput.value = '';
  }
</script>

<section class="panel">
  <h2>
    Sauvegarde
    <span class="status" data-status={$status}>{LABEL[$status]}</span>
  </h2>

  <p class="note">
    Tout l'état (pads, scènes, sessions, favoris de sons, brouillon de l'atelier) est copié dans
    <code>.state/strudler-state.json</code> à chaque modification, avec des instantanés datés.
  </p>

  <div class="grid">
    <span class="k">Dernière copie</span>
    <span class="v">{formatStamp($saved)} {$bytes ? `· ${formatBytes($bytes)}` : ''}</span>
    <span class="k">Origine</span>
    <span class="v mono">{origin}</span>
    <span class="k">Stockage persistant</span>
    <span class="v">
      {#if $persisted === true}✓ accordé — le navigateur n'évincera pas ces données
      {:else if $persisted === false}refusé par le navigateur — sans conséquence, la copie disque couvre ce risque
      {:else}non pris en charge par ce navigateur{/if}
    </span>
  </div>

  {#if $status === 'unavailable'}
    <p class="warn">
      Cette page n'est pas servie par Vite : le miroir disque est inaccessible et les données ne
      vivent que dans ce navigateur. Lance <code>npm run dev</code> ou <code>npm run preview</code>.
    </p>
  {/if}
  {#if $error}
    <p class="error">{$error}</p>
  {/if}

  <div class="row">
    <button onclick={onSaveNow} disabled={busy || $status === 'unavailable'}>
      💾 Sauvegarder maintenant
    </button>
    <button onclick={() => void refreshBackupIndex()} disabled={busy}>↻ Rafraîchir</button>
    <button onclick={exportAll}>⬇ Exporter tout (fichier)</button>
    <button onclick={() => fileInput?.click()}>⬆ Importer…</button>
    <input
      bind:this={fileInput}
      type="file"
      accept="application/json,.json"
      onchange={onFile}
      hidden
    />
  </div>

  {#if pending}
    <div class="confirm">
      <p>
        Sauvegarde du <strong>{formatStamp(pending.savedAt)}</strong> — {pending.count} entrées,
        origine <span class="mono">{pending.origin || 'inconnue'}</span>.
        {#if pending.libraryFolder}Dossier « {pending.libraryFolder} » à réautoriser après import.{/if}
      </p>
      <p class="note">L'état actuel de ce navigateur sera remplacé, puis la page rechargée.</p>
      <div class="row">
        <button class="danger" onclick={() => pending && void confirmImport(pending)}>
          Remplacer l'état
        </button>
        <button onclick={() => (pending = null)}>Annuler</button>
      </div>
    </div>
  {/if}

  {#if $snaps.length > 0}
    <ul class="snaps">
      {#each $snaps as s (s.name)}
        <li>
          <span class="sname">{formatStamp(s.savedAt)}</span>
          <span class="sinfo">{formatBytes(s.bytes)}</span>
          <button class="mini" onclick={() => void onRestore(s)} disabled={busy} title="Restaurer cet instantané">↺</button>
        </li>
      {/each}
    </ul>
    <p class="note">{$snaps.length} instantané(s) conservé(s) — les plus anciens sont recyclés.</p>
  {:else if $status === 'ready'}
    <p class="note">Aucun instantané pour l'instant : ils apparaissent dès que l'état change.</p>
  {/if}
</section>

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem 1.25rem;
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
  .status {
    font-size: 0.72rem;
    color: var(--muted);
  }
  .status[data-status='ready'] {
    color: var(--ok);
  }
  .status[data-status='unavailable'] {
    color: var(--danger);
  }
  .status[data-status='error'] {
    color: var(--danger);
  }
  .grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 0.8rem;
    font-size: 0.82rem;
    margin: 0.7rem 0;
  }
  .k {
    color: var(--muted);
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.78rem;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.78rem;
    color: var(--text);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.6rem;
  }
  .note {
    color: var(--muted);
    font-size: 0.8rem;
    margin: 0.7rem 0 0;
  }
  .warn,
  .error {
    color: var(--danger);
    font-size: 0.82rem;
    margin: 0.6rem 0 0;
  }
  .confirm {
    margin-top: 0.8rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--accent-dim);
    border-radius: 8px;
    background: var(--bg);
  }
  .confirm p {
    margin: 0;
    font-size: 0.85rem;
  }
  .danger {
    color: var(--danger);
    border-color: var(--danger);
  }
  .snaps {
    list-style: none;
    margin: 0.8rem 0 0;
    padding: 0;
    max-height: 11rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .snaps li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.82rem;
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .sname {
    flex: 1;
  }
  .sinfo {
    color: var(--muted);
    font-size: 0.75rem;
  }
  .mini {
    padding: 0.1rem 0.45rem;
    font-size: 0.8rem;
  }
</style>
