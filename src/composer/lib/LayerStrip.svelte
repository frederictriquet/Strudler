<script lang="ts">
  // [SPEC-18.9] Solo / mute per `stack()` layer. Auditioning one layer alone is
  // the console-strip solo, and the strongest way to understand what each line of
  // a pattern contributes.
  //
  // Read-only on the code: these buttons never rewrite the pattern, they only
  // decide what is heard and drawn.
  import { LAYER_COLORS } from '@core/composer/roll';

  interface Props {
    layers: string[];
    muted: Set<number>;
    solo: number | null;
    onmute: (index: number) => void;
    onsolo: (index: number) => void;
  }
  let { layers, muted, solo, onmute, onsolo }: Props = $props();

  const audible = (i: number) => (solo !== null ? i === solo : !muted.has(i));
  /** First meaningful fragment of a layer, for the label. */
  const short = (code: string) => {
    const line = code.trim().split('\n')[0];
    return line.length > 54 ? `${line.slice(0, 53)}…` : line;
  };
</script>

{#if layers.length > 1}
  <div class="strip">
    {#each layers as layer, i (i)}
      <div class="layer" class:off={!audible(i)}>
        <span class="swatch" style="background:{LAYER_COLORS[i % LAYER_COLORS.length]}"></span>
        <code title={layer}>{short(layer)}</code>
        <button class:on={solo === i} onclick={() => onsolo(i)} title="Écouter seule">S</button>
        <button class:on={muted.has(i)} onclick={() => onmute(i)} title="Couper">M</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .strip {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .layer {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
  }
  .layer.off {
    opacity: 0.4;
  }
  .swatch {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 2px;
    flex: none;
  }
  code {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, 'SF Mono', monospace;
    font-size: 0.72rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .layer button {
    padding: 0.1rem 0.4rem;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--muted);
  }
  .layer button.on {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
</style>
