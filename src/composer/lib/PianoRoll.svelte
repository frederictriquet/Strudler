<script lang="ts">
  // [SPEC-18.8] The workshop's centrepiece: what the pattern ACTUALLY produces,
  // obtained by querying it — never reconstructed from a parallel model, so the
  // view cannot disagree with what will be heard. [SPEC-18.6]
  //
  // Exactly ONE turn of the loop is drawn [SPEC-18.26]: the whole width is the
  // declared length, and the playhead sweeping it is what makes the repeat
  // perceptible [SPEC-18.27].
  import { eventPhase, LAYER_COLORS, phaseWithin, type Roll } from '@core/composer/roll';

  interface Props {
    roll: Roll | null;
    /** Declared phrase length — where the author says the loop turns over. */
    phraseBeats: number;
    /** Smallest period actually measured; drawn faintly when it is shorter. */
    periodBeats: number | null;
    /** Stale-marking: the roll shown no longer matches the text being typed. */
    stale?: boolean;
    /** Absolute playback position in beats, or null when stopped. [SPEC-18.27] */
    playheadBeat?: number | null;
  }
  let { roll, phraseBeats, periodBeats, stale = false, playheadBeat = null }: Props = $props();

  /** Position inside the declared phrase, which is the whole drawn width: the view
   *  spans exactly one turn, so the cursor sweeps it and wraps. [SPEC-18.26] */
  const phase = $derived(phaseWithin(playheadBeat, phraseBeats));

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
  /** Beat numbers, 1..N over the phrase. Thinned out when long, to stay legible. */
  const step = $derived(spanBeats > 32 ? 4 : 1);
  const ruler = $derived(
    gridBeats.filter((b) => b < spanBeats && b % step === 0).map((b) => ({ beat: b, label: b + 1 })),
  );
  const rowIndex = $derived(new Map((roll?.rows ?? []).map((r, i) => [r.key, i])));
</script>

<div class="roll" class:stale>
  {#if !roll || roll.rows.length === 0}
    <p class="empty">Aucun événement — le pattern est silencieux ou vide.</p>
  {:else}
    <!-- Beat ruler. The drawn width IS one turn of the loop [SPEC-18.26], so the
         numbers simply run 1..N and the right edge is where it starts over. -->
    <div class="ruler" style="height:14px">
      <div class="lanes" style="left:{LABEL_WIDTH}px">
        {#each ruler as r (r.beat)}
          <span class="tick" class:first={r.beat === 0} style="left:{pct(r.beat)}%">{r.label}</span>
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

      <!-- Bar lines and internal repeats. No loop boundary to draw: the view spans
           exactly one turn, so the right edge is it. [SPEC-18.26] -->
      <div class="lanes" style="left:{LABEL_WIDTH}px">
        {#each gridBeats as b (b)}
          <div class="bar" class:downbeat={b % 4 === 0} style="left:{pct(b)}%"></div>
        {/each}
        <!-- Playback cursor, above everything so it stays readable on a busy row. -->
        {#if phase !== null}
          <div class="playhead" style="left:{pct(phase)}%"></div>
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
          {@const state = eventPhase(ev, phase)}
          <!-- The width is the event's real duration, minus a hairline so adjacent
               events stay countable: a `bd*4` lasts a full beat each, and drawn
               edge to edge four kicks read as one drone. The bright left edge is
               the ATTACK, which is what you look for on a percussion row. -->
          <div
            class="ev"
            class:tail={!ev.hasOnset}
            class:attack={state === 'attack'}
            class:held={state === 'held'}
            style="left:{left}%; width:calc({width}% - 2px); top:{(rowIndex.get(ev.rowKey) ?? 0) *
              ROW_HEIGHT +
              3}px; height:{ROW_HEIGHT - 6}px; opacity:{0.35 +
              ev.gain * 0.65}; --ev-color:{color}"
            title="{ev.label} — beat {(ev.begin % phraseBeats) + 1} de la phrase"
          ></div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .roll {
    /* Never squeezed: inside a height-constrained column the roll is a flex item
       and would shrink below its rows, hiding them behind its own scrollbar. The
       column scrolls instead. */
    flex: none;
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
  /* Clips what the playhead sticks out. It is 2 px wide at `left: <phase>%`, so
     near the end of the loop it reached past the right edge — enough to raise a
     horizontal scrollbar, whose 15 px then squeezed the rows and raised a vertical
     one too. Both bars appeared only during playback, for that reason. */
  .lanes {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    overflow: hidden;
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
    min-width: 2px;
    border-radius: 2px;
    background: var(--ev-color, var(--accent));
    /* The attack edge: what makes four contiguous kicks look like four kicks
       rather than one sustained block. [SPEC-18.25] */
    box-shadow: inset 2px 0 0 rgba(255, 255, 255, 0.75);
  }
  /* Fragment whose attack happened earlier: drawn hollow, and with no attack
     edge — it is the tail of a note that started before this point. */
  .ev.tail {
    background: transparent;
    border: 1px solid var(--ev-color, var(--accent-dim));
    box-shadow: none;
  }
  /* Sounding now. [SPEC-18.27] Styled by class rather than recomputed inline, so a
     60 Hz playhead only toggles classes instead of rewriting style strings.
     `attack` = the bright hit, `held` = the softer remainder of its duration. */
  .ev.attack {
    background: #ffffff;
    box-shadow:
      inset 2px 0 0 rgba(255, 255, 255, 0.9),
      0 0 8px 2px var(--ev-color, var(--accent));
  }
  .ev.held {
    filter: brightness(1.45);
    box-shadow:
      inset 2px 0 0 rgba(255, 255, 255, 0.9),
      0 0 4px var(--ev-color, var(--accent));
  }
  /* Playback cursor. */
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    /* Centred on the position rather than starting at it. */
    transform: translateX(-1px);
    z-index: 2;
    background: #fff;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.7);
    pointer-events: none;
  }
</style>
