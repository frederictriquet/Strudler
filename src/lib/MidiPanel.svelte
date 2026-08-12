<script lang="ts">
  // [SPEC-6] MIDI panel: connect, list ports, and show which known controllers
  // are recognized (by port name → mapping). [SPEC-6.1]
  import { midiState, connectMidi } from '@stores/midiStore';
  import { mappingForDevice } from '@core/mapping/mapping';
  import { midiEvents, midiEventCount, clearMidiEvents } from '@stores/midiMonitorStore';

  const midiInfo = midiState;
  const events = midiEvents;
  const count = midiEventCount;

  async function onConnect() {
    try {
      await connectMidi();
    } catch {
      // Error already captured in the store. [SPEC-14.3]
    }
  }

  // Distinct recognized controllers among connected input ports.
  const recognized = $derived([
    ...new Map(
      $midiInfo.ports
        .filter((p) => p.direction === 'input' && p.state === 'connected')
        .map((p) => mappingForDevice(p.name))
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .map((m) => [m.match, m.name]),
    ).values(),
  ]);
</script>

<section class="panel">
  <h2>Contrôleurs MIDI</h2>

  {#if !$midiInfo.supported}
    <p class="error">Web MIDI indisponible dans ce navigateur — utiliser Chrome ou Edge.</p>
  {:else}
    <div class="row">
      <button onclick={onConnect} disabled={$midiInfo.status === 'requesting'}>
        🎹 Connecter le MIDI
      </button>
      <span class="status" data-status={$midiInfo.status}>{$midiInfo.status}</span>
    </div>

    {#if $midiInfo.error}
      <p class="error">{$midiInfo.error}</p>
    {/if}

    {#if $midiInfo.status === 'ready'}
      <div class="recognized">
        {#if recognized.length > 0}
          {#each recognized as name (name)}
            <span class="chip">✓ {name}</span>
          {/each}
        {:else}
          <span class="chip none">Aucun contrôleur reconnu</span>
        {/if}
      </div>

      {#if $midiInfo.ports.length === 0}
        <p class="hint">Aucun port MIDI.</p>
      {:else}
        <ul class="ports">
          {#each $midiInfo.ports as port (port.direction + ':' + port.id)}
            <li class:disconnected={port.state === 'disconnected'}>
              <span class="dir">{port.direction === 'input' ? 'IN ' : 'OUT'}</span>
              <span class="name">{port.name}</span>
              {#if port.manufacturer}<span class="mfr">{port.manufacturer}</span>{/if}
              <span class="pstate">{port.state}</span>
            </li>
          {/each}
        </ul>
      {/if}

      <!-- Live monitor: press a control and read what it actually sends. A
           controller's CC map depends on its preset/scene, so this is the only
           reliable way to bind an unknown button. [SPEC-17.35] -->
      <div class="monhead">
        <span>Moniteur MIDI · {$count} message(s)</span>
        <button onclick={clearMidiEvents}>effacer</button>
      </div>
      {#if $events.length === 0}
        <p class="hint">Presse un bouton ou bouge un fader pour voir les messages reçus.</p>
      {:else}
        <ul class="mon">
          {#each $events as e (e.id)}
            <li class:unmapped={e.intent === null}>
              <span class="mkind">{e.kind}</span>
              <span class="mcode">{e.code}</span>
              <span class="mval">{e.value}</span>
              <span class="mintent">{e.intent ?? 'non mappé'}</span>
              <span class="mtarget">{e.target}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
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
  }
  .monhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.9rem;
    color: var(--muted);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .monhead button {
    font-size: 0.72rem;
    padding: 0.15rem 0.5rem;
  }
  .mon {
    list-style: none;
    margin: 0.35rem 0 0;
    padding: 0;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
  }
  .mon li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.05rem 0;
  }
  .mon li.unmapped {
    color: #f0b429;
  }
  .mkind {
    width: 2.6rem;
    color: var(--muted);
  }
  .mcode,
  .mval {
    width: 2.2rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .mintent {
    flex: 1;
    margin-left: 0.5rem;
  }
  .mtarget {
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .status {
    margin-left: auto;
    color: var(--muted);
  }
  .recognized {
    margin-top: 0.9rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chip {
    padding: 0.3rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--accent-dim);
    color: var(--ok);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .chip.none {
    border-color: var(--border);
    color: var(--muted);
    font-weight: 400;
  }
  .ports {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .ports li {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    font-size: 0.85rem;
    padding: 0.35rem 0.5rem;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.02);
  }
  .ports li.disconnected {
    opacity: 0.45;
  }
  .dir {
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, monospace;
  }
  .name {
    font-weight: 600;
  }
  .mfr {
    color: var(--muted);
  }
  .pstate {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.75rem;
  }
  .error {
    color: var(--danger);
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
  }
  .hint {
    color: var(--muted);
    font-size: 0.8rem;
    margin: 0.75rem 0 0;
  }
</style>
