<script lang="ts">
  // [SPEC-18.8] The workshop's centrepiece: what the pattern ACTUALLY produces,
  // obtained by querying it — never reconstructed from a parallel model, so the
  // view cannot disagree with what will be heard. [SPEC-18.6]
  //
  // Two loop turns are drawn, with the repeat marked, so the loop length is a
  // visible fact rather than something to be guessed.
  import { LAYER_COLORS, type Roll } from '@core/composer/roll';

  interface Props {
    roll: Roll | null;
    /** Declared phrase length — where the author says the loop turns over. */
    phraseBeats: number;
    /** Smallest period actually measured; drawn faintly when it is shorter. */
    periodBeats: number | null;
    /** Stale-marking: the roll shown no longer matches the text being typed. */
    stale?: boolean;
  }
  let { roll, phraseBeats, periodBeats, stale = false }: Props = $props();

  const ROW_HEIGHT = 18;
  const LABEL_WIDTH = 62;

  const spanBeats = $derived(roll?.spanBeats ?? 0);
  const pct = (beats: number) => (spanBeats > 0 ? (beats / spanBeats) * 100 : 0);

  /** One line per BEAT, thicker on bars. Without these you cannot tell whether a
   *  hit lands on every beat or twice per beat — the whole «it plays too fast»
   *  question. */
  const gridBeats = $derived(
    spanBeats > 0 ? Array.from({ length: Math.floor(spanBeats) + 1 }, (_, i) => i) : [],
  );
  /** Beat numbers, restarting at each declared phrase so the phrase is readable.
   *  Thinned out when the span is long, to stay legible. */
  const step = $derived(spanBeats > 32 ? 4 : 1);
  const ruler = $derived(
    gridBeats
      .filter((b) => b < spanBeats && b % step === 0)
      .map((b) => ({ beat: b, label: phraseBeats > 0 ? (b % phraseBeats) + 1 : b + 1 })),
  );
  const rowIndex = $derived(new Map((roll?.rows ?? []).map((r, i) => [r.key, i])));
</script>

<div class="roll" class:stale>
  {#if !roll || roll.rows.length === 0}
    <p class="empty">Aucun événement — le pattern est silencieux ou vide.</p>
  {:else}
    <!-- Beat ruler: numbers restart at every phrase, so «beat 3 of the phrase» is
         readable straight off the drawing. -->
    <div class="ruler" style="height:14px">
      <div class="lanes" style="left:{LABEL_WIDTH}px">
        {#each ruler as r (r.beat)}
          <span
            class="tick"
            class:first={phraseBeats > 0 && r.beat % phraseBeats === 0}
            style="left:{pct(r.beat)}%">{r.label}</span
          >
        {/each}
      </div>
    </div>

    <div class="grid" style="height:{roll.rows.length * ROW_HEIGHT}px">
      <!-- Row backgrounds + labels -->
      {#each roll.rows as row, i (row.key)}
        <div
          class="row"
          class:accidental={row.accidental}
          style="top:{i * ROW_HEIGHT}px; height:{ROW_HEIGHT}px"
        ></div>
        <div class="label" style="top:{i * ROW_HEIGHT}px; height:{ROW_HEIGHT}px">{row.label}</div>
      {/each}

      <!-- Bar lines, and the loop boundary if a period was found -->
      <div class="lanes" style="left:{LABEL_WIDTH}px">
        {#each gridBeats as b (b)}
          <div class="bar" class:downbeat={b % 4 === 0} style="left:{pct(b)}%"></div>
        {/each}
        <!-- Where the declared phrase turns over. -->
        {#if phraseBeats > 0 && phraseBeats < spanBeats}
          <div class="loopmark" style="left:{pct(phraseBeats)}%"></div>
        {/if}
        <!-- Every repeat of the measured period, when the content actually
             repeats sooner than the declared phrase — that gap is exactly what
             surprises you when a pattern «plays too fast». -->
        {#if periodBeats && periodBeats < phraseBeats}
          {#each Array.from( { length: Math.floor(spanBeats / periodBeats) }, (_, i) => (i + 1) * periodBeats, ) as p (p)}
            {#if p % phraseBeats !== 0}
              <div class="periodmark" style="left:{pct(p)}%"></div>
            {/if}
          {/each}
        {/if}

        {#each roll.events as ev, i (i)}
          {@const left = pct(ev.begin)}
          {@const width = Math.max(0.6, pct(ev.end - ev.begin))}
          {@const color = LAYER_COLORS[ev.layer % LAYER_COLORS.length]}
          <div
            class="ev"
            class:tail={!ev.hasOnset}
            style="left:{left}%; width:{width}%; top:{(rowIndex.get(ev.rowKey) ?? 0) *
              ROW_HEIGHT +
              3}px; height:{ROW_HEIGHT - 6}px; opacity:{0.35 +
              ev.gain * 0.65}; --ev-color:{color}"
            title="{ev.label} — beat {ev.begin.toFixed(2)}"
          ></div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .roll {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    overflow: auto;
    transition: opacity 0.15s ease;
  }
  /* Being explicit that the drawing lags the text beats silently showing a lie. */
  .roll.stale {
    opacity: 0.45;
  }
  .empty {
    margin: 0;
    padding: 1.2rem;
    color: var(--muted);
    font-size: 0.85rem;
  }
  .grid {
    position: relative;
    min-width: 100%;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }
  .row.accidental {
    background: rgba(255, 255, 255, 0.035);
  }
  .label {
    position: absolute;
    left: 0;
    width: 62px;
    display: flex;
    align-items: center;
    padding-left: 0.4rem;
    font-family: ui-monospace, 'SF Mono', monospace;
    font-size: 0.66rem;
    color: var(--muted);
    border-right: 1px solid var(--border);
    background: var(--panel);
    z-index: 2;
    overflow: hidden;
    white-space: nowrap;
  }
  .lanes {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
  }
  .ruler {
    position: relative;
    border-bottom: 1px solid var(--border);
  }
  .tick {
    position: absolute;
    top: 1px;
    transform: translateX(2px);
    font-family: ui-monospace, monospace;
    font-size: 0.6rem;
    color: var(--muted);
    line-height: 1;
  }
  .tick.first {
    color: var(--accent);
    font-weight: 700;
  }
  /* One line per beat, stronger on bar lines. */
  .bar {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255, 255, 255, 0.05);
  }
  .bar.downbeat {
    background: rgba(255, 255, 255, 0.16);
  }
  /* Where the declared phrase starts over — the loop length, made visible. */
  .loopmark {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
    box-shadow: 0 0 6px rgba(110, 231, 183, 0.5);
  }
  /* Internal repeat: the content already came back before the phrase ended. */
  .periodmark {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: repeating-linear-gradient(
      to bottom,
      var(--accent-dim) 0 3px,
      transparent 3px 6px
    );
  }
  /* Colour = the stack() layer that produced the event. [SPEC-18.9] */
  .ev {
    position: absolute;
    border-radius: 3px;
    background: var(--ev-color, var(--accent));
  }
  /* Fragment whose attack happened earlier: drawn hollow, not as a new hit. */
  .ev.tail {
    background: transparent;
    border: 1px solid var(--ev-color, var(--accent-dim));
  }
</style>
