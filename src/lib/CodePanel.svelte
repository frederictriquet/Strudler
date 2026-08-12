<script lang="ts">
  // [SPEC-9.2] Advanced mode: edit and hot-eval the Strudel code of a slot to
  // evolve it live. Edits are an in-memory override — the library file on disk is
  // never touched ([SPEC-9.1]). Errors surface here, never swallowed [SPEC-14.3].
  import {
    channelsState,
    slotCode,
    evalSlotCode,
    resetSlotCode,
    measureLength,
    rackError,
  } from '@stores/rackStore';
  import { slotLabel } from '@core/channels/types';

  const channels = channelsState;
  const error = rackError;

  let selChannel = $state<number>(-1);
  let selSlot = $state<number>(-1);
  let code = $state('');

  // Assigned slots, flattened for the picker.
  const slots = $derived(
    $channels.flatMap((ch) =>
      ch.slots
        .map((s, i) => ({ channelId: ch.id, slotIndex: i, slot: s, total: ch.slots.length }))
        .filter((x) => x.slot.trackId),
    ),
  );

  // The currently selected slot (or undefined).
  const current = $derived(
    slots.find((x) => x.channelId === selChannel && x.slotIndex === selSlot),
  );

  // Auto-select the first assigned slot once available.
  $effect(() => {
    if (!current && slots.length > 0) {
      selChannel = slots[0].channelId;
      selSlot = slots[0].slotIndex;
      code = slotCode(selChannel, selSlot);
    }
  });

  function onSelect(e: Event) {
    const [c, s] = (e.currentTarget as HTMLSelectElement).value.split(':').map(Number);
    selChannel = c;
    selSlot = s;
    code = slotCode(c, s);
  }

  function onEval() {
    if (selChannel < 0) return;
    void evalSlotCode(selChannel, selSlot, code);
  }

  function onReset() {
    if (selChannel < 0) return;
    resetSlotCode(selChannel, selSlot);
    code = slotCode(selChannel, selSlot);
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onEval();
    }
  }

  // Live length hint: query the pattern (no audio) and show its loop length in
  // beats/bars. Debounced so it doesn't run on every keystroke. [SPEC-9.2]
  let lengthLabel = $state('');
  let lengthKind = $state<'ok' | 'variable' | 'error' | ''>('');
  let lengthTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const c = code; // track edits
    clearTimeout(lengthTimer);
    if (!c.trim()) {
      lengthLabel = '';
      lengthKind = '';
      return;
    }
    lengthTimer = setTimeout(async () => {
      const { beats, error } = await measureLength(c);
      if (error) {
        lengthLabel = 'code invalide';
        lengthKind = 'error';
      } else if (beats === null) {
        lengthLabel = 'longueur variable';
        lengthKind = 'variable';
      } else {
        const bars = beats / 4;
        const barTxt = Number.isInteger(bars)
          ? `${bars} mesure${bars > 1 ? 's' : ''}`
          : `${bars.toFixed(2)} mesure`;
        lengthLabel = `≈ ${beats} beat${beats > 1 ? 's' : ''} · ${barTxt}`;
        lengthKind = 'ok';
      }
    }, 350);
    return () => clearTimeout(lengthTimer);
  });
</script>

<section class="panel">
  <h2>
    Mode avancé — live-coding
    {#if current && current.slot.codeOverride !== null}
      <span class="badge">modifié</span>
    {/if}
  </h2>

  {#if slots.length === 0}
    <p class="hint">Aucun slot assigné. Assigne une piste à un slot (✎) pour l'éditer.</p>
  {:else}
    <div class="row">
      <select value={`${selChannel}:${selSlot}`} onchange={onSelect}>
        {#each slots as x (x.channelId + ':' + x.slotIndex)}
          <option value={`${x.channelId}:${x.slotIndex}`}>
            Canal {x.channelId + 1} · {slotLabel(x.slotIndex, x.total)} · {x.slot.trackName}
            {x.slot.playing ? '▶' : ''}
          </option>
        {/each}
      </select>
    </div>

    <textarea
      bind:value={code}
      onkeydown={onKeydown}
      spellcheck="false"
      rows="5"
      placeholder="Code Strudel — ex: s(&quot;sbd*4&quot;).gain(0.9)"
    ></textarea>

    <div class="actions">
      <button class="eval" onclick={onEval}>▶ Évaluer <kbd>Ctrl+↵</kbd></button>
      <button onclick={onReset} title="Revenir au pattern du disque">⟲ Disque</button>
      {#if lengthLabel}
        <span class="length {lengthKind}">Longueur {lengthLabel}</span>
      {/if}
      <span class="note">Évaluer arme le slot et lance le son.</span>
    </div>

    {#if $error}
      <p class="error">{$error}</p>
    {/if}
  {/if}
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
    align-items: center;
    gap: 0.6rem;
  }
  .badge {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #f0b429;
    border: 1px solid #f0b429;
    border-radius: 4px;
    padding: 0.05rem 0.35rem;
  }
  .row {
    margin-bottom: 0.6rem;
  }
  select {
    width: 100%;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.35rem 0.4rem;
    font: inherit;
    font-size: 0.85rem;
  }
  textarea {
    width: 100%;
    resize: vertical;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.6rem 0.7rem;
    font-family: ui-monospace, 'SF Mono', monospace;
    font-size: 0.85rem;
    line-height: 1.5;
  }
  textarea:focus {
    outline: none;
    border-color: var(--accent-dim);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.6rem;
    flex-wrap: wrap;
  }
  .eval {
    border-color: var(--accent-dim);
    color: var(--accent);
  }
  kbd {
    font-family: ui-monospace, monospace;
    font-size: 0.7rem;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 0.25rem;
  }
  .note {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .length {
    font-size: 0.8rem;
    font-family: ui-monospace, monospace;
    white-space: nowrap;
  }
  .length.ok {
    color: var(--accent);
  }
  .length.variable {
    color: #f0b429;
  }
  .length.error {
    color: var(--danger);
  }
  .error {
    color: var(--danger);
    margin: 0.6rem 0 0;
    font-size: 0.9rem;
    font-family: ui-monospace, monospace;
  }
  .hint {
    color: var(--muted);
    font-size: 0.82rem;
    margin: 0;
  }
</style>
