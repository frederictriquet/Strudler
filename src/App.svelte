<script lang="ts">
  // Full-width layout: transport (with toolbar) + channel rack + library.
  // MIDI/Session live in a modal opened from the transport toolbar. [SPEC-10]
  import { onMount } from 'svelte';
  import ClockPanel from '@lib/ClockPanel.svelte';
  import SetBar from '@lib/SetBar.svelte';
  import ChannelRack from '@lib/ChannelRack.svelte';
  import LibraryPanel from '@lib/LibraryPanel.svelte';
  import CodePanel from '@lib/CodePanel.svelte';
  import SettingsModal from '@lib/SettingsModal.svelte';
  import AudioUnlockModal from '@lib/AudioUnlockModal.svelte';
  import Toasts from '@lib/Toasts.svelte';
  import { armEngine } from '@stores/engineStore';
  import {
    initMidiDispatch,
    advancedMode,
    persistError,
    audioUnlockNeeded,
    checkAudioUnlock,
  } from '@stores/rackStore';
  import { settingsOpen } from '@stores/uiStore';
  import { notices, clearNotices, initLogCapture, notify } from '@stores/logStore';
  import { loadErrors } from '@stores/libraryStore';
  import { loadDefaultSamples } from '@stores/samplesStore';
  import { connectMidi } from '@stores/midiStore';
  import { initCueOutputs } from '@stores/cuesStore';
  import { reconnectStreamDeck } from '@stores/streamdeckStore';
  import { initBackup } from '@stores/backupStore';

  const advanced = advancedMode;
  const persist = persistError;
  const log = notices;
  const modalOpen = settingsOpen;
  const unlockNeeded = audioUnlockNeeded;

  onMount(() => {
    armEngine(); // arm audio unlock BEFORE any click (resolves on the next mousedown)
    checkAudioUnlock(); // audio still locked → blocking unlock modal [SPEC-17.50]
    initMidiDispatch(); // route MIDI input → intents (works once MIDI connects)
    initCueOutputs(); // stage output: produce cues (sinks stay off unless enabled) [SPEC-19]
    initLogCapture(); // surface Strudel warnings (e.g. missing samples) [SPEC-14.3]
    initBackup(); // mirror every write to disk, and announce a restore [SPEC-13.5]

    // Tracks are hand-written YAML data since [SPEC-4.6]: nothing catches a typo
    // at build time any more, so a rejected track must be impossible to miss —
    // the library panel listing them sits below the fold. [SPEC-14.3, SPEC-17.26]
    for (const err of loadErrors) {
      notify('error', `Piste ignorée — ${err.path.replace('/library/', '')} : ${err.message}`);
    }
    void loadDefaultSamples(); // preload the sound bank so PLAY is ready [SPEC-12.1]

    // Auto-connect controllers. MIDI needs no user gesture (permission is
    // remembered → silent on later loads). Stream Deck reopens only devices
    // already authorized (no prompt); first-time auth still uses the modal button.
    void connectMidi().catch(() => undefined);
    void reconnectStreamDeck().catch(() => undefined);

    // Unlocking happens once, through the modal's button; playback still needs an
    // explicit PLAY, so clicking around never triggers sound/replay.
  });
</script>

<main>
  <div class="transport">
    <ClockPanel />
  </div>

  <!-- Which set the 64 pads address, on one dense line. [SPEC-20.10] -->
  <div class="setbar">
    <SetBar />
  </div>

  <div class="rack">
    <ChannelRack />
  </div>

  {#if $advanced}
    <div class="code">
      <CodePanel />
    </div>
  {/if}

  <div class="library">
    <LibraryPanel />
  </div>

  {#if $log.length > 0}
    <div class="log">
      <div class="log-head">
        <span>Journal</span>
        <button onclick={clearNotices}>effacer</button>
      </div>
      <ul>
        {#each $log as n (n.id)}
          <li class={n.level}>{n.text}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if $persist}
    <p class="persist-error">Persistance : {$persist}</p>
  {/if}
</main>

{#if $modalOpen}
  <SettingsModal />
{/if}

{#if $unlockNeeded}
  <AudioUnlockModal />
{/if}

<Toasts />

<style>
  main {
    min-height: 100vh;
    width: 100%;
    /* No side margins: panels run edge to edge. Vertical padding kept minimal so
       everything stays visible without scrolling. [SPEC-17.2] */
    padding: 0.4rem 0 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .rack {
    flex: 1;
  }
  .persist-error {
    color: var(--danger);
    font-size: 0.8rem;
    margin: 0.5rem 0 0;
  }
  .log {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
    background: rgba(255, 255, 255, 0.02);
  }
  .log-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .log-head button {
    font-size: 0.72rem;
    padding: 0.15rem 0.5rem;
  }
  .log ul {
    list-style: none;
    padding: 0;
    margin: 0.4rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .log li {
    font-size: 0.8rem;
    color: var(--text);
  }
  .log li::before {
    margin-right: 0.4rem;
  }
  .log li.success {
    color: var(--ok);
  }
  .log li.success::before {
    content: '✓';
  }
  .log li.info::before {
    content: 'ℹ';
    color: var(--muted);
  }
  .log li.warn {
    color: #f0b429;
  }
  .log li.warn::before {
    content: '⚠';
  }
  .log li.error {
    color: var(--danger);
  }
  .log li.error::before {
    content: '✕';
  }
</style>
