<script lang="ts">
  // Modal grouping the rarely-used MIDI and Session panels, off the main surface.
  import MidiPanel from '@lib/MidiPanel.svelte';
  import SessionPanel from '@lib/SessionPanel.svelte';
  import BackupPanel from '@lib/BackupPanel.svelte';
  import { closeSettings } from '@stores/uiStore';
  import { showSlotProgress, setShowSlotProgress } from '@stores/rackStore';
  import {
    cueMidiEnabled,
    cueWsEnabled,
    cuePortMatch,
    cueMidiChannel,
    cueWsUrl,
    cueWsState,
    cueWsError,
    cueCount,
    setCueMidiEnabled,
    setCueWsEnabled,
    setCuePortMatch,
    setCueMidiChannel,
    setCueWsUrl,
  } from '@stores/cuesStore';
  import { CATEGORY_NOTES, PPQN } from '@core/cues/MidiCueOut';
  import {
    streamDeckSupported,
    streamDeckStatus,
    streamDeckError,
    connectStreamDeck,
    disconnectStreamDeck,
  } from '@stores/streamdeckStore';

  const progress = showSlotProgress;
  const cueMidi = cueMidiEnabled;
  const cueWs = cueWsEnabled;
  const cuePort = cuePortMatch;
  const cueChannel = cueMidiChannel;
  const cueUrl = cueWsUrl;
  const cueState = cueWsState;
  const cueError = cueWsError;
  const cueSent = cueCount;

  const CUE_NOTES = Object.entries(CATEGORY_NOTES);

  const WS_LABELS: Record<string, string> = {
    idle: 'éteint',
    connecting: 'connexion…',
    open: 'connecté',
    error: 'erreur',
  };
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

<div class="wrap" role="dialog" aria-modal="true" aria-label="MIDI, Session et Sauvegarde">
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

      <!-- Stage output: Strudler tells another app what it plays. [SPEC-19] -->
      <section class="panel">
        <h2>Sortie scénique — tempo &amp; frappes</h2>
        <p class="note">
          Strudler sait ce qu'il joue : aucune analyse audio n'est nécessaire côté récepteur, et les
          frappes sont annoncées <strong>avant</strong> d'être audibles (le séquenceur travaille en
          avance), de quoi anticiper un fondu. Les deux sorties sont indépendantes et n'émettent rien
          tant qu'elles sont éteintes.
        </p>

        <div class="slots-row sd-row">
          <span class="slabel">MIDI (QLC+, Resolume…)</span>
          <button class:on={$cueMidi} onclick={() => setCueMidiEnabled(!$cueMidi)}>
            {$cueMidi ? '✓ Activée' : 'Éteinte'}
          </button>
          <label class="cue-field">
            port
            <input
              type="text"
              value={$cuePort}
              oninput={(e) => setCuePortMatch((e.currentTarget as HTMLInputElement).value)}
              size="10"
              aria-label="Port MIDI de sortie (sous-chaîne du nom)"
            />
          </label>
          <label class="cue-field">
            canal
            <input
              type="number"
              min="1"
              max="16"
              value={$cueChannel}
              oninput={(e) => setCueMidiChannel(Number((e.currentTarget as HTMLInputElement).value))}
              aria-label="Canal MIDI des notes de frappe"
            />
          </label>
        </div>
        <p class="note">
          Horloge MIDI à {PPQN} ppqn + Start/Stop/SPP, et une note par catégorie (vélocité = gain) :
          {#each CUE_NOTES as [category, note], i (category)}{i > 0 ? ' · ' : ''}{category}
            {note}{/each}. Le port est reconnu par <em>sous-chaîne</em> de son nom, distinct de celui
          des contrôleurs pour ne pas perturber les LED — sur macOS, active le bus IAC dans
          « Configuration audio et MIDI ».
        </p>

        <div class="slots-row sd-row">
          <span class="slabel">WebSocket (application maison)</span>
          <button class:on={$cueWs} onclick={() => setCueWsEnabled(!$cueWs)}>
            {$cueWs ? '✓ Activée' : 'Éteinte'}
          </button>
          <label class="cue-field">
            URL
            <input
              type="text"
              value={$cueUrl}
              onchange={(e) => setCueWsUrl((e.currentTarget as HTMLInputElement).value)}
              size="22"
              aria-label="URL du récepteur WebSocket"
            />
          </label>
          <span class="sd-status">{WS_LABELS[$cueState] ?? $cueState}</span>
        </div>
        {#if $cueError}<p class="sd-error">{$cueError}</p>{/if}
        <p class="note">
          Le récepteur est le serveur (un navigateur ne peut pas écouter sur un port).
          <code>npm run cues:monitor</code> lance un récepteur de référence qui affiche le flux et
          sert de squelette. Cues émis depuis le démarrage : {$cueSent}.
        </p>
      </section>

      <MidiPanel />
      <SessionPanel />
      <BackupPanel />
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
  .cue-field {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--muted);
    font-size: 0.8rem;
  }
  .cue-field input[type='number'] {
    width: 3.5rem;
  }
  .note code {
    font-size: 0.78rem;
  }
  .sd-error {
    color: var(--danger);
    font-size: 0.82rem;
    margin: 0.4rem 0 0;
  }
</style>
