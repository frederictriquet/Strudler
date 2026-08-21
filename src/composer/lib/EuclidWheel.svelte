<script lang="ts">
  // [SPEC-18.10] Euclidean wheel: `s("bd(3,8)")` drawn as a circle. Two numbers
  // describe a whole rhythm, which is exactly why the notation is unreadable —
  // the drawing is what makes «3 spread over 8» something you can check at a
  // glance. A one-way generator: it writes a fragment and never reads it back
  // [SPEC-18.7], so the pattern text stays the source of truth [SPEC-18.6].
  import { euclid, euclidSnippet, onsetCount, MAX_STEPS } from '@core/music/euclid';

  interface Props {
    /** Default sound name; the field follows it until the user types. */
    sound?: string;
    oninsert: (snippet: string) => void;
  }
  let { sound = 'bd', oninsert }: Props = $props();

  /** `null` while untouched, so a sound chosen elsewhere still reaches the
   *  field; once typed in, the field belongs to the user. */
  let typed = $state<string | null>(null);
  const name = $derived(typed ?? sound);
  let steps = $state(8);
  let pulses = $state(3);
  let rotation = $state(0);

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  /** Empty or non-numeric input must not poison the state, so it falls back. */
  const asInt = (raw: string, fallback: number) => {
    const v = Number.parseInt(raw, 10);
    return Number.isFinite(v) ? v : fallback;
  };

  /** Shrinking `steps` would otherwise leave pulses/rotation out of range —
   *  and a rotation ≥ steps is silently ignored by Strudel. */
  function setSteps(raw: string) {
    steps = clamp(asInt(raw, steps), 1, MAX_STEPS);
    pulses = clamp(pulses, 0, steps);
    rotation = clamp(rotation, 0, steps - 1);
  }

  const pattern = $derived(euclid(pulses, steps, rotation));
  const snippet = $derived(euclidSnippet(name, pulses, steps, rotation));
  const hits = $derived(onsetCount(pattern));

  // Geometry. Step 0 sits at the top and the cycle runs clockwise, like a clock.
  // The centre is pushed down inside the 140×140 viewBox to leave room for the
  // start marker above the ring.
  const R = 48;
  const CX = 70;
  const CY = 74;
  const dotR = $derived(clamp(((2 * Math.PI * R) / steps) * 0.35, 2.6, 7));
  const points = $derived(
    pattern.map((on, i) => {
      const angle = (i / steps) * 2 * Math.PI - Math.PI / 2;
      return { on, i, x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) };
    }),
  );
  /** The polygon joining the onsets: evenness becomes a shape, which is the
   *  whole reason these rhythms are drawn rather than listed. */
  const polygon = $derived(
    points
      .filter((p) => p.on)
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' '),
  );
</script>

<div class="wheel-builder">
  <div class="controls">
    <label>
      Son
      <input
        class="sound"
        value={name}
        oninput={(e) => (typed = e.currentTarget.value)}
        placeholder="bd"
      />
    </label>
    <label>
      Frappes
      <input
        type="number"
        min="0"
        max={steps}
        value={pulses}
        oninput={(e) => (pulses = clamp(asInt(e.currentTarget.value, pulses), 0, steps))}
      />
    </label>
    <label>
      Pas
      <input
        type="number"
        min="1"
        max={MAX_STEPS}
        value={steps}
        oninput={(e) => setSteps(e.currentTarget.value)}
      />
    </label>
    <label>
      Rotation
      <input
        type="number"
        min="0"
        max={steps - 1}
        value={rotation}
        oninput={(e) => (rotation = clamp(asInt(e.currentTarget.value, rotation), 0, steps - 1))}
      />
    </label>
  </div>

  <div class="result">
    <svg viewBox="0 0 140 140" role="img" aria-label="Roue euclidienne {pulses} frappes sur {steps} pas">
      <circle class="ring" cx={CX} cy={CY} r={R} />
      <!-- Start of the cycle, outside the ring: without it a rotated pattern is
           impossible to read, since every wheel looks alike. -->
      <line class="start" x1={CX} y1={CY - R - 9} x2={CX} y2={CY - R - 16} />
      <text class="start-label" x={CX} y={CY - R - 18}>0</text>
      {#if polygon && hits > 1}
        <polygon class="shape" points={polygon} />
      {/if}
      {#each points as p (p.i)}
        <circle
          class="step"
          class:on={p.on}
          class:first={p.i === 0}
          cx={p.x}
          cy={p.y}
          r={dotR}
        >
          <title>pas {p.i}{p.on ? ' — frappe' : ''}</title>
        </circle>
      {/each}
    </svg>

    <div class="readout">
      <p class="pattern">
        {#each pattern as on, i (i)}
          <span class:on class:first={i === 0}>{on ? 'x' : '.'}</span>
        {/each}
      </p>
      <p class="count">{hits} frappe{hits > 1 ? 's' : ''} sur {steps} pas</p>
      <code>{snippet}</code>
      <button class="insert" onclick={() => oninsert(snippet)}>Insérer</button>
    </div>
  </div>
</div>

<style>
  .wheel-builder {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .controls {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.7rem;
    color: var(--muted);
  }
  input {
    font: inherit;
    font-size: 0.8rem;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.25rem 0.4rem;
    width: 4.2rem;
  }
  input.sound {
    width: 7rem;
    font-family: ui-monospace, monospace;
  }
  .result {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
  }
  svg {
    width: 140px;
    height: 140px;
    flex: none;
  }
  .ring {
    fill: none;
    stroke: var(--border);
    stroke-width: 1;
  }
  .start,
  .start-label {
    stroke: var(--muted);
    fill: var(--muted);
  }
  .start {
    stroke-width: 1.5;
  }
  .start-label {
    stroke: none;
    font-size: 8px;
    text-anchor: middle;
    font-family: ui-monospace, monospace;
  }
  .shape {
    fill: var(--accent-dim);
    fill-opacity: 0.14;
    stroke: var(--accent-dim);
    stroke-width: 1;
  }
  /* Silent steps stay visible as slots — the grid is the point of comparison. */
  .step {
    fill: var(--panel);
    stroke: var(--border);
    stroke-width: 1;
  }
  .step.on {
    fill: var(--accent);
    stroke: var(--accent);
  }
  .step.first {
    stroke: var(--text);
    stroke-width: 1.6;
  }
  .readout {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
  }
  .pattern {
    display: flex;
    gap: 0.3rem;
    margin: 0;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    color: var(--muted);
    flex-wrap: wrap;
  }
  .pattern span.on {
    color: var(--accent);
    font-weight: 700;
  }
  .pattern span.first {
    text-decoration: underline;
  }
  .count {
    margin: 0;
    font-size: 0.7rem;
    color: var(--muted);
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.2rem 0.4rem;
  }
  .insert {
    font-size: 0.75rem;
    padding: 0.25rem 0.6rem;
  }
</style>
