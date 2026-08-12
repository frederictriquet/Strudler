<script lang="ts">
  // [SPEC-17.29] A range slider showing a "ghost" marker at the last observed
  // physical position of its hardware knob/fader. The gap between the thumb and
  // the ghost is exactly the jump the next hardware touch will produce.
  interface Props {
    value: number; // logical value 0..1
    ghost?: number | undefined; // last observed hardware position, or undefined
    label?: string;
    title?: string;
    oninput: (e: Event) => void;
  }
  const { value, ghost, label, title, oninput }: Props = $props();

  // Hide the ghost when it coincides with the thumb: there is no jump to warn about.
  const SHOW_THRESHOLD = 0.02;
  const showGhost = $derived(ghost !== undefined && Math.abs(ghost - value) > SHOW_THRESHOLD);
</script>

<div class="wrap" {title}>
  <input type="range" min="0" max="1" step="0.01" {value} {oninput} aria-label={label} />
  {#if showGhost}
    <!-- Inset by half a thumb width so the marker lines up with the thumb centre. -->
    <span
      class="ghost"
      style="left: calc(0.4rem + {(ghost ?? 0) * 100}% - {(ghost ?? 0) * 0.8}rem)"
      aria-hidden="true"
    ></span>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
  }
  .wrap input[type='range'] {
    flex: 1;
    accent-color: var(--accent);
  }
  /* Deliberately loud: it marks a control that is inert until it is moved back
     onto the value, so it must be impossible to miss. [SPEC-17.29/17.30] */
  .ghost {
    position: absolute;
    top: 50%;
    width: 3px;
    height: 1.15rem;
    margin-left: -1.5px;
    transform: translateY(-50%);
    background: #ffc233;
    border-radius: 2px;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.55),
      0 0 7px 1px rgba(255, 194, 51, 0.85);
    pointer-events: none;
    animation: ghost-pulse 1.1s ease-in-out infinite;
  }
  /* Pulse rather than blink: visible at a glance without flickering on stage. */
  @keyframes ghost-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }
</style>
