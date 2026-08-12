<script lang="ts">
  // [SPEC-3.4/3.5, SPEC-10.3] Transport + master clock: PLAY/STOP, tempo, launch
  // mode/window, and a live bar/beat readout driven by the clock ticker.
  import { onMount, onDestroy } from 'svelte';
  import {
    clockState,
    setBpm,
    startClockTicker,
    stopClockTicker,
    beatsPerBar,
    clock,
  } from '@stores/clockStore';
  import {
    rackError,
    startTransport,
    stopTransport,
    transportRunning,
    dispatch,
    launcherState,
    channelsState,
    persistSoon,
    windowPhase,
    advancedMode,
    toggleAdvanced,
    musicalKey,
    setMusicalKey,
    forceKey,
    setForceKey,
    phaseOffsetBeats,
    resetPhaseOffset,
    scenes,
    sceneStoreMode,
    activeScene,
  } from '@stores/rackStore';
  import { openSettings } from '@stores/uiStore';
  import { MIN_BPM, MAX_BPM } from '@core/clock/Clock';
  import { NUDGE_BEATS } from '@core/mapping/mapping';
  import { CAMELOT_WHEEL, shortNote, shortNoteFr } from '@core/music/camelot';

  // Slider covers the usual range; the number input allows the full clock range.
  const SLIDER_MIN = 80;
  const SLIDER_MAX = 160;

  const clk = clockState;
  const error = rackError;
  const launch = launcherState;
  const channels = channelsState;
  const advanced = advancedMode;
  const running = transportRunning;
  const key = musicalKey;
  const force = forceKey;
  const phase0 = phaseOffsetBeats;
  const sceneList = scenes;
  const storeMode = sceneStoreMode;
  const active = activeScene;

  // Global quantize view derived from per-channel state. [SPEC-17.17]
  $: anyQuantized = $channels.some((c) => c.quantized);
  $: allQuantized = $channels.length > 0 && $channels.every((c) => c.quantized);

  function onKey(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    setMusicalKey(value || null);
  }

  onMount(() => {
    setBpm(clock.currentBpm);
    startClockTicker();
  });
  onDestroy(() => stopClockTicker());

  async function onPlay() {
    try {
      await startTransport();
    } catch {
      // Error surfaced via rackError below. [SPEC-14.3]
    }
  }

  function onBpmInput(e: Event) {
    const value = Number((e.currentTarget as HTMLInputElement).value);
    if (!Number.isNaN(value)) {
      setBpm(value);
      persistSoon(); // persist tempo change [SPEC-13.2]
    }
  }

  // Position within the quantization window. Recomputed every tick ($clk.beat
  // changes each frame), so a window-size change is reflected within a frame.
  // [SPEC-17: readout correlated to window]
  $: phase = windowPhase($clk.beat);
  // One dot per beat of the window; elapsed beats fill, current beat lights up.
  // Every `beatsPerBar`-th dot marks a bar boundary (downbeat).
  $: beatsInWindow = phase.window;

  // Metric level of a beat index = highest power of 2 that divides it, i.e. the
  // power of 2 the bar starts on. Higher = stronger phrase boundary (bar → 2
  // bars → 4 → 8 → 16). Index 0 is the window origin (strongest). Used to
  // color-code the downbeat rings so phrase structure is readable. [SPEC-17.12]
  function metricLevel(i: number): number {
    if (i === 0) return 99; // window origin
    let k = 0;
    let n = i;
    while (n % 2 === 0) {
      n /= 2;
      k++;
    }
    return k; // i = 2^k · odd
  }

  // Legend entries relevant to the current window (2^level beats ≤ window),
  // strongest first. Origin is always shown.
  const LEGEND = [
    { lvl: 99, label: 'début', beats: 0 },
    { lvl: 6, label: '64', beats: 64 },
    { lvl: 5, label: '32', beats: 32 },
    { lvl: 4, label: '16', beats: 16 },
    { lvl: 3, label: '8', beats: 8 },
    { lvl: 2, label: '4', beats: 4 },
  ];
  $: legend = LEGEND.filter((e) => e.beats === 0 || e.beats <= beatsInWindow);
</script>

<section class="panel">
  <!-- Transport + launch controls on one line. [SPEC-7.5/7.6, SPEC-8] -->
  <div class="row">
    {#if $running}
      <button class="stop" onclick={stopTransport} title="Bouton STOP du Korg">■ Stop</button>
    {:else}
      <button class="play" onclick={onPlay} title="Bouton PLAY du Korg — lance la lecture">
        ▶ Play
      </button>
    {/if}

    <button
      class="mode"
      class:quantized={allQuantized}
      class:mixed={anyQuantized && !allQuantized}
      onclick={() => dispatch({ type: 'modeToggle' })}
      title="Quantisation de TOUS les canaux (par canal : bouton ⚡/⏱ de chaque canal, ou bouton du bas de l'APC)"
    >
      {allQuantized ? '⏱ Quantisé' : anyQuantized ? '⏱ Mixte' : '⚡ Immédiat'}
    </button>

    <div class="window">
      <span class="wlabel">Fenêtre</span>
      <button onclick={() => dispatch({ type: 'windowPrev' })} title="TRACK ◄" aria-label="Fenêtre −"
        >◄</button
      >
      <span class="wval">{$launch.window}</span>
      <button onclick={() => dispatch({ type: 'windowNext' })} title="TRACK ►" aria-label="Fenêtre +"
        >►</button
      >
      <span class="wunit">beats</span>
    </div>

    <button
      class="resync"
      onclick={() => dispatch({ type: 'resync' })}
      title="Recaler la grille de quantisation sur l'instant présent"
    >
      ⟲ Resync
    </button>

    <!-- Phase nudge, mirroring the nano MARKER ◄ ► buttons. [SPEC-17.34] -->
    <div class="nudge" title="Décaler la phase pour s'aligner sur un mix externe (nano MARKER ◄ ►)">
      <button
        onclick={() => dispatch({ type: 'gridNudge', beats: -NUDGE_BEATS })}
        aria-label="Reculer la phase">◄</button
      >
      <button
        class="nval"
        class:off={$phase0 === 0}
        onclick={resetPhaseOffset}
        title="Décalage courant — clic pour annuler"
      >
        {$phase0 === 0 ? 'phase' : `${$phase0 > 0 ? '+' : ''}${$phase0.toFixed(2)}b`}
      </button>
      <button
        onclick={() => dispatch({ type: 'gridNudge', beats: NUDGE_BEATS })}
        aria-label="Avancer la phase">►</button
      >
    </div>

    <div class="key" title="Tonalité (Camelot) des loops — pour mixer avec un set externe">
      <span class="klabel">Tonalité</span>
      <select
        value={$key ?? ''}
        onchange={onKey}
        class:forced={$force}
        aria-label="Tonalité (Camelot)"
      >
        {#each CAMELOT_WHEEL as k (k.code)}
          <option value={k.code}>{k.code} · {shortNote(k)} · {shortNoteFr(k)}</option>
        {/each}
      </select>
      <button
        class="forcekey"
        class:on={$force}
        onclick={() => setForceKey(!$force)}
        title="Forcer la transposition des pistes tonales vers la tonalité choisie"
      >
        {$force ? '🔒 Forcé' : '🔓 Libre'}
      </button>
    </div>

    <!-- Scenes, mirroring the Stream Deck's first row: M+ then 4 slots. [SPEC-17.36] -->
    <div class="scenes">
      <button
        class="mplus"
        class:armed={$storeMode}
        onclick={() => dispatch({ type: 'sceneModeToggle' })}
        title="M+ : le prochain appui sur une scène mémorise l'état armé (rappuyer pour annuler)"
      >
        M+
      </button>
      {#each $sceneList as scene, i (i)}
        <button
          class="scene"
          class:filled={scene !== null}
          class:active={$active === i && !$storeMode}
          class:store={$storeMode}
          onclick={() => dispatch({ type: 'scenePress', index: i })}
          title={$storeMode
            ? scene !== null
              ? `Écraser la scène ${i + 1}`
              : `Mémoriser dans la scène ${i + 1}`
            : scene !== null
              ? `Rappeler la scène ${i + 1} (${scene.length} loop(s))`
              : `Scène ${i + 1} vide`}
        >
          {i + 1}
        </button>
      {/each}
    </div>

    <div class="row-right">
      <button
        class="adv"
        class:on={$advanced}
        onclick={toggleAdvanced}
        title="Mode avancé : live-coding sur les pistes"
      >
        {$advanced ? '✓ Avancé' : 'Avancé'}
      </button>
      <button class="settings" onclick={openSettings} title="Contrôleurs MIDI & sessions">
        🎛 MIDI / Session
      </button>
    </div>
  </div>

  {#if $error}
    <p class="error">{$error}</p>
  {/if}

  <div class="tempo">
    <label for="bpm">Tempo</label>
    <input
      id="bpm"
      type="range"
      min={SLIDER_MIN}
      max={SLIDER_MAX}
      step="1"
      value={Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, $clk.bpm))}
      oninput={onBpmInput}
    />
    <input
      class="bpm-num"
      type="number"
      min={MIN_BPM}
      max={MAX_BPM}
      value={$clk.bpm}
      oninput={onBpmInput}
    />
    <span class="unit">BPM</span>
  </div>

  <!-- One dot per beat of the quantization window; dots fill as we approach the
       next launch boundary, downbeats marked. [SPEC-8, readout correlated to W] -->
  <div class="position" data-running={$clk.running}>
    <!-- Counter and colour key share one line to save vertical space. -->
    <div class="posrow">
      <div class="counter">
        <span>{phase.index + 1}</span><span class="sep">/</span><span class="w">{phase.window}</span>
        <span class="label">beat / fenêtre</span>
      </div>
      <!-- Color key: which power of 2 (in beats) a bar starts on. [SPEC-17.12] -->
      <div class="legend">
        <span class="lkey">Départ de mesure sur</span>
        {#each legend as e (e.lvl)}
          <span class="litem">
            <span class="lswatch" data-lvl={e.lvl}></span>
            {e.label}
          </span>
        {/each}
      </div>
    </div>
    <div class="dots">
      {#each Array(beatsInWindow) as _, i (i)}
        {@const down = i % beatsPerBar === 0}
        <span
          class="dot"
          class:downbeat={down}
          data-lvl={down ? metricLevel(i) : ''}
          class:filled={i < phase.index}
          class:on={$clk.running && i === phase.index}
        ></span>
      {/each}
    </div>
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
  .row-right {
    margin-left: auto;
    display: flex;
    gap: 0.5rem;
  }
  .row-right button {
    font-size: 0.8rem;
    padding: 0.3rem 0.7rem;
  }
  .adv.on,
  .settings:hover {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .play {
    border-color: var(--accent-dim);
    color: var(--accent);
    font-weight: 600;
  }
  .stop {
    border-color: var(--danger);
    color: var(--danger);
    font-weight: 600;
  }
  .tempo {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
  }
  .tempo label {
    color: var(--muted);
    min-width: 3.5rem;
  }
  .tempo input[type='range'] {
    flex: 1;
    accent-color: var(--accent);
  }
  .bpm-num {
    width: 4.5rem;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.3rem 0.4rem;
    font-variant-numeric: tabular-nums;
  }
  .unit {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .position {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-top: 0.5rem;
    opacity: 0.6;
    transition: opacity 0.2s ease;
  }
  /* Counter on the left, colour key on the right, on the same line. */
  .posrow {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .position[data-running='true'] {
    opacity: 1;
  }
  .dots {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--border);
    transition: background 0.05s linear;
  }
  /* Downbeat (first beat of each bar) gets a ring; its color encodes the power
     of 2 the bar starts on, so phrase structure is readable at a glance. The
     stronger the boundary, the warmer/thicker the ring. [SPEC-17.12] */
  .dot.downbeat {
    outline: 1px solid var(--muted);
    outline-offset: 2px;
  }
  .dot[data-lvl='2'] {
    outline-color: #64748b; /* every bar (4 beats) */
  }
  .dot[data-lvl='3'] {
    outline-color: var(--accent); /* every 2 bars (8) */
  }
  .dot[data-lvl='4'] {
    outline-color: #f0b429; /* every 4 bars (16) */
    outline-width: 2px;
  }
  .dot[data-lvl='5'] {
    outline-color: #f97316; /* every 8 bars (32) */
    outline-width: 2px;
  }
  .dot[data-lvl='6'] {
    outline-color: #ef4444; /* every 16 bars (64) */
    outline-width: 2px;
  }
  .dot[data-lvl='99'] {
    outline-color: #ffffff; /* window origin (phrase start) */
    outline-width: 2px;
  }
  .dot.filled {
    background: var(--accent-dim);
  }
  .dot.on {
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
  }
  .legend {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 0.7rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .lkey {
    margin-right: 0.1rem;
  }
  .litem {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .lswatch {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: transparent;
    outline: 1px solid var(--muted);
    outline-offset: 1px;
  }
  .lswatch[data-lvl='2'] {
    outline-color: #64748b;
  }
  .lswatch[data-lvl='3'] {
    outline-color: var(--accent);
  }
  .lswatch[data-lvl='4'] {
    outline-color: #f0b429;
    outline-width: 2px;
  }
  .lswatch[data-lvl='5'] {
    outline-color: #f97316;
    outline-width: 2px;
  }
  .lswatch[data-lvl='6'] {
    outline-color: #ef4444;
    outline-width: 2px;
  }
  .lswatch[data-lvl='99'] {
    outline-color: #ffffff;
    outline-width: 2px;
  }
  .counter {
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, monospace;
    font-size: 1.3rem;
  }
  .counter .sep {
    color: var(--muted);
    margin: 0 0.15rem;
  }
  .counter .w {
    color: var(--accent);
  }
  .counter .label {
    font-family: inherit;
    font-size: 0.7rem;
    color: var(--muted);
    margin-left: 0.6rem;
  }
  .error {
    color: var(--danger);
    margin: 0.5rem 0 0;
    font-size: 0.9rem;
  }
  .mode.quantized {
    border-color: #f0b429;
    color: #f0b429;
  }
  .mode.mixed {
    border-color: #f0b429;
    color: var(--muted);
  }
  .key {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .klabel {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .key select {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.3rem 0.4rem;
    font: inherit;
    font-size: 0.82rem;
    font-family: ui-monospace, monospace;
  }
  /* Forced-key mode: the selector turns green, like other active controls. */
  .key select.forced {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .forcekey {
    font-size: 0.8rem;
    padding: 0.3rem 0.6rem;
  }
  .forcekey.on {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  /* Scene row, same semantics as the Stream Deck keys. [SPEC-17.36] */
  .scenes {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .scenes button {
    padding: 0.3rem 0.55rem;
    font-size: 0.78rem;
    font-family: ui-monospace, monospace;
    color: var(--muted);
  }
  .mplus.armed {
    color: #ffbe28;
    border-color: #ffbe28;
    background: rgba(255, 190, 40, 0.15);
  }
  .scene.filled {
    color: var(--text);
    border-color: var(--accent-dim);
  }
  .scene.active {
    color: var(--accent);
    border-color: var(--accent);
    background: rgba(110, 231, 183, 0.15);
  }
  /* While storing, slots show that a press writes here. */
  .scene.store {
    border-color: #ffbe28;
    color: #ffbe28;
  }
  .nudge {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .nudge button {
    padding: 0.3rem 0.5rem;
    font-size: 0.78rem;
  }
  .nval {
    font-family: ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    min-width: 3.4rem;
    color: #f0b429;
    border-color: #f0b429;
  }
  /* Neutral look while the phase is unshifted. */
  .nval.off {
    color: var(--muted);
    border-color: var(--border);
  }
  .window {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .window button {
    padding: 0.3rem 0.55rem;
  }
  .wlabel {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .wval {
    font-family: ui-monospace, monospace;
    font-weight: 700;
    min-width: 1.6rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .wunit {
    color: var(--muted);
    font-size: 0.78rem;
  }
</style>
