<script lang="ts">
  // [SPEC-11] Record / replay of gestures. Record taps the intent stream; replay
  // restores the initial state and re-emits the gestures on the clock. Sessions
  // save/load as JSON files ([SPEC-11.4]). Replay needs the clock running, i.e.
  // audio enabled.
  import {
    sessionStatus,
    lastSession,
    startRecording,
    stopRecording,
    startReplay,
    stopReplay,
    loadSessionJson,
    serializeCurrentSession,
    rackError,
    audioEnabled,
    savedSessions,
    saveSessionToBrowser,
    deleteSavedSession,
    selectSavedSession,
  } from '@stores/rackStore';

  const status = sessionStatus;
  const session = lastSession;
  const enabled = audioEnabled;
  const error = rackError;
  const saved = savedSessions;

  let fileInput = $state<HTMLInputElement | undefined>();
  let sessionName = $state('');

  function onSaveToBrowser() {
    saveSessionToBrowser(sessionName);
    sessionName = '';
  }

  async function onReplaySaved(id: string) {
    selectSavedSession(id);
    await startReplay();
  }

  function onRecord() {
    if ($status === 'recording') stopRecording();
    else startRecording();
  }

  async function onReplay() {
    if ($status === 'replaying') stopReplay();
    else await startReplay();
  }

  function onSave() {
    const json = serializeCurrentSession();
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strudler-session.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      loadSessionJson(await file.text());
    } catch (err) {
      rackError.set((err as Error).message); // surfaced below [SPEC-14.3]
    }
    if (fileInput) fileInput.value = '';
  }
</script>

<section class="panel">
  <h2>Session <span class="status" data-status={$status}>{$status}</span></h2>

  <div class="row">
    <button class="rec" class:on={$status === 'recording'} onclick={onRecord} disabled={$status === 'replaying'}>
      {$status === 'recording' ? '⏹ Arrêter' : '⏺ Enregistrer'}
    </button>

    <button
      onclick={onReplay}
      disabled={$status === 'recording' || !$session}
      title={$enabled ? 'Rejouer la session' : "Rejouer (active l'audio au besoin)"}
    >
      {$status === 'replaying' ? '⏹ Stop rejeu' : '▶ Rejouer'}
    </button>

    <button onclick={onSave} disabled={!$session}>💾 Enregistrer (fichier)</button>
    <button onclick={() => fileInput?.click()}>📂 Charger</button>
    <input
      bind:this={fileInput}
      type="file"
      accept="application/json,.json"
      onchange={onFile}
      hidden
    />
  </div>

  {#if $session}
    <p class="meta">
      {$session.events.length} gestes · {$session.bpm} BPM · fenêtre {$session.window} · {$session.mode}
    </p>
    <div class="savebar">
      <input
        type="text"
        placeholder="Nom de la session"
        bind:value={sessionName}
        onkeydown={(e) => e.key === 'Enter' && onSaveToBrowser()}
      />
      <button onclick={onSaveToBrowser}>➕ Garder dans le navigateur</button>
    </div>
  {:else}
    <p class="meta muted">Aucune session en mémoire.</p>
  {/if}

  {#if $saved.length > 0}
    <ul class="saved">
      {#each $saved as s (s.id)}
        <li>
          <span class="sname">{s.name}</span>
          <span class="sinfo">{s.session.events.length} gestes</span>
          <button
            class="mini"
            onclick={() => onReplaySaved(s.id)}
            disabled={$status !== 'idle'}
            title="Rejouer">▶</button
          >
          <button class="mini" onclick={() => deleteSavedSession(s.id)} title="Supprimer">🗑</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if $error}
    <p class="error">{$error}</p>
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
  .status[data-status='recording'] {
    color: var(--danger);
  }
  .status[data-status='replaying'] {
    color: var(--accent);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .rec.on {
    color: var(--danger);
    border-color: var(--danger);
  }
  .meta {
    margin: 0.7rem 0 0;
    font-size: 0.8rem;
    color: var(--text);
  }
  .meta.muted {
    color: var(--muted);
  }
  .savebar {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }
  .savebar input {
    flex: 1;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.3rem 0.5rem;
    font: inherit;
    font-size: 0.85rem;
  }
  .saved {
    list-style: none;
    padding: 0;
    margin: 0.7rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .saved li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.45rem;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.02);
  }
  .sname {
    font-weight: 600;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sinfo {
    font-size: 0.72rem;
    color: var(--muted);
  }
  .mini {
    padding: 0.15rem 0.45rem;
  }
  .error {
    color: var(--danger);
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
  }
</style>
