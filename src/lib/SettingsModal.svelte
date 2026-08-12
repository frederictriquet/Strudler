<script lang="ts">
  // Modal grouping the rarely-used MIDI and Session panels, off the main surface.
  import MidiPanel from '@lib/MidiPanel.svelte';
  import SessionPanel from '@lib/SessionPanel.svelte';
  import { closeSettings } from '@stores/uiStore';
  import { showSlotProgress, setShowSlotProgress } from '@stores/rackStore';
  import {
    streamDeckSupported,
    streamDeckStatus,
    streamDeckError,
    connectStreamDeck,
    disconnectStreamDeck,
  } from '@stores/streamdeckStore';

  const progress = showSlotProgress;
  const sdStatus = streamDeckStatus;
  const sdError = streamDeckError;

  async function onStreamDeck() {
    if ($sdStatus === 'ready') await disconnectStreamDeck();
    else await connectStreamDeck();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeSettings();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="wrap" role="dialog" aria-modal="true" aria-label="MIDI et Session">
  <button class="backdrop" onclick={closeSettings} aria-label="Fermer"></button>
  <div class="modal">
    <div class="modal-head">
      <span class="title">MIDI &amp; Session</span>
      <button class="close" onclick={closeSettings} aria-label="Fermer">✕</button>
    </div>
    <div class="modal-body">
      <section class="panel">
        <h2>Contrôleurs — configuration</h2>
        <p class="note">
          Sons pilotés par l'Akai APC mini mk2 (8 slots par canal). Le nanoKONTROL2 est réservé aux
          effets.
        </p>

        <div class="slots-row sd-row">
          <span class="slabel">Jauge de progression</span>
          <button class:on={$progress} onclick={() => setShowSlotProgress(!$progress)}>
            {$progress ? '✓ Affichée' : 'Masquée'}
          </button>
        </div>
        <p class="note">
          Une barre animée sur chaque slot en lecture montre la position dans la boucle (relative à
          la longueur de la piste). Réglage conservé.
        </p>

        {#if streamDeckSupported}
          <div class="slots-row sd-row">
            <span class="slabel">Stream Deck</span>
            <button class:on={$sdStatus === 'ready'} onclick={onStreamDeck}>
              {$sdStatus === 'ready' ? '✓ Connecté — déconnecter' : '🎛 Connecter (WebHID)'}
            </button>
            <span class="sd-status">{$sdStatus}</span>
          </div>
          {#if $sdError}<p class="sd-error">{$sdError}</p>{/if}
          <p class="note">
            MK.2 : colonnes 1-4 = canaux, lignes = slots S/M/R, colonne 5 = mode / fenêtre −/+.
            Ferme d'abord le logiciel Elgato (il monopolise le périphérique).
          </p>
        {/if}
      </section>

      <MidiPanel />
      <SessionPanel />
    </div>
  </div>
</div>

<style>
  .wrap {
    position: fixed;
    inset: 0;
    z-index: 50;
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
    width: min(760px, 100%);
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
    margin-bottom: 1rem;
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
    gap: 1rem;
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem 1.25rem;
  }
  .panel h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    color: var(--muted);
    font-weight: 600;
  }
  .slots-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .slabel {
    color: var(--muted);
    margin-right: 0.3rem;
  }
  .slots-row button.on {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .note {
    color: var(--muted);
    font-size: 0.8rem;
    margin: 0.7rem 0 0;
  }
  .sd-row {
    margin-top: 0.8rem;
  }
  .sd-row button.on {
    color: var(--ok);
    border-color: var(--accent-dim);
  }
  .sd-status {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .sd-error {
    color: var(--danger);
    font-size: 0.82rem;
    margin: 0.4rem 0 0;
  }
</style>
