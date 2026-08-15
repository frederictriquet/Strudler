<script lang="ts">
  // [SPEC-17.38, SPEC-17.49] Performance timer AND transport button: the elapsed
  // readout is itself the PLAY/STOP control — ▶ while stopped, ■ while running.
  // Time restarts from zero on every PLAY and freezes on STOP, so the last take
  // stays readable. Ticks on its own (4 Hz is plenty for a seconds readout)
  // rather than on the clock's rAF, so it costs nothing while stopped.
  import { onMount, onDestroy } from 'svelte';
  import {
    transportStartedAt,
    transportFrozenMs,
    transportRunning,
    startTransport,
    stopTransport,
  } from '@stores/rackStore';

  const startedAt = transportStartedAt;
  const frozenMs = transportFrozenMs;
  const running = transportRunning;

  let now = $state(performance.now());
  let timer: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    timer = setInterval(() => (now = performance.now()), 250);
  });
  onDestroy(() => clearInterval(timer));

  const elapsed = $derived($startedAt === null ? $frozenMs : now - $startedAt);

  async function onToggle() {
    if ($running) {
      stopTransport();
      return;
    }
    try {
      await startTransport();
    } catch {
      // Surfaced through rackError in ClockPanel. [SPEC-14.3]
    }
  }

  /** m:ss, switching to h:mm:ss past the hour. */
  function format(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
</script>

<button
  class="timer"
  class:running={$running}
  onclick={onToggle}
  title={$running
    ? 'Stop — met en pause (bouton STOP du Korg). Le chrono se fige.'
    : 'Play — lance la lecture (bouton PLAY du Korg). Le chrono repart de zéro.'}
  aria-label={$running ? 'Stop' : 'Play'}
>
  <span class="icon" aria-hidden="true">{$running ? '■' : '▶'}</span>
  <span class="time">{format(elapsed)}</span>
</button>

<style>
  .timer {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.7rem;
    border: 1px solid var(--accent-dim);
    border-radius: 10px;
    color: var(--muted);
    cursor: pointer;
  }
  .timer:hover {
    border-color: var(--accent);
  }
  .icon {
    font-size: 1.1rem;
    line-height: 1;
    color: var(--accent);
  }
  .time {
    font-family: ui-monospace, 'SF Mono', monospace;
    font-variant-numeric: tabular-nums;
    font-size: 1.6rem;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.02em;
    min-width: 4.2rem;
    text-align: left;
  }
  .timer.running {
    color: var(--accent);
    border-color: var(--danger);
  }
  .timer.running .icon {
    color: var(--danger);
  }
</style>
