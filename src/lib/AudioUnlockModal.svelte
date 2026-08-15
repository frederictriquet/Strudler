<script lang="ts">
  // [SPEC-17.50] Startup gate: the browser unlocks the AudioContext only on a real
  // user gesture, and a MIDI message is not one [SPEC-17.25]. This blocking modal
  // collects that single click, so PLAY works from the GUI, the Korg or the Stream
  // Deck right after. It does NOT start playback — arming and PLAY stay explicit.
  // Deliberately not dismissable (no backdrop click, no Escape): without the click
  // nothing can sound.
  import { unlockAudio, rackError } from '@stores/rackStore';

  const error = rackError;
  let busy = $state(false);

  async function onUnlock() {
    busy = true;
    try {
      await unlockAudio(); // closes the modal on success, sets rackError otherwise
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap" role="dialog" aria-modal="true" aria-label="Activer l'audio">
  <div class="backdrop"></div>
  <div class="modal">
    <h2>Activer l'audio</h2>
    <p>
      Le navigateur exige un clic pour autoriser le son. Un message MIDI ne suffit pas : sans ce
      clic, ni le PLAY du Korg ni celui du Stream Deck ne produiront de son.
    </p>
    <button class="unlock" onclick={onUnlock} disabled={busy}>
      {busy ? 'Activation…' : '🔊 Activer l’audio'}
    </button>
    {#if $error}
      <p class="err">{$error}</p>
    {/if}
    <p class="note">Rien ne démarre : la lecture attend toujours un ▶ Play explicite.</p>
  </div>
</div>

<style>
  .wrap {
    position: fixed;
    inset: 0;
    z-index: 100; /* above the settings modal */
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
  }
  .modal {
    position: relative;
    width: min(480px, 100%);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 1.5rem;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  h2 {
    margin: 0 0 0.6rem;
    font-size: 1.15rem;
  }
  p {
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0 0 1rem;
  }
  .unlock {
    font-size: 1.15rem;
    font-weight: 700;
    padding: 0.7rem 1.6rem;
    color: var(--accent);
    border-color: var(--accent-dim);
    cursor: pointer;
  }
  .unlock:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .unlock:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .err {
    color: var(--danger);
    font-size: 0.85rem;
    margin: 0.9rem 0 0;
  }
  .note {
    font-size: 0.78rem;
    margin: 0.9rem 0 0;
  }
</style>
