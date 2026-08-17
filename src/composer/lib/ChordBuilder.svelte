<script lang="ts">
  // [SPEC-18.10] Degrees → chord symbols. A one-way generator: it writes a
  // snippet into the pattern and then forgets it [SPEC-18.7], so the text stays
  // the source of truth and can be edited freely afterwards.
  import { buildProgression, progressionPattern } from '@core/music/chords';
  import { CAMELOT_WHEEL, keyByCode, longNoteFr } from '@core/music/camelot';

  interface Props {
    /** Key the track declares, used as the default tonic. */
    trackKey?: string;
    oninsert: (snippet: string) => void;
    /** Called when the builder settles on a key, so the track can adopt it. */
    onkey?: (code: string) => void;
  }
  let { trackKey, oninsert, onkey }: Props = $props();

  let code = $state('8A');
  // Adopt the track's key when it changes (loading another track), but leave a
  // key the user picked here alone until then.
  let lastTrackKey: string | undefined;
  $effect(() => {
    if (trackKey !== lastTrackKey) {
      lastTrackKey = trackKey;
      if (trackKey) code = trackKey;
    }
  });

  let degrees = $state('6-1-3-7');
  let spelling = $state<'sharp' | 'flat'>('sharp');
  /** Bass line an octave below, as both library chord tracks do. */
  let withBass = $state(true);

  const key = $derived(keyByCode(code));
  const built = $derived(
    key ? buildProgression(degrees, { tonicPc: key.pc, mode: key.mode, spelling }) : 'tonalité inconnue',
  );
  const chords = $derived(typeof built === 'string' ? null : built);
  const problem = $derived(typeof built === 'string' ? built : null);
  const progression = $derived(chords ? progressionPattern(chords) : '');

  /** Uses `vars` so the progression is written once [SPEC-4.7], and `dict("triads")`
   *  because the default (`ireal`) yields jazz voicings with sevenths. [SPEC-17.48] */
  const snippet = $derived(
    !chords
      ? ''
      : withBass
        ? `stack(\n  chord("${progression}").dict("triads").anchor("c4").voicing(),\n  chord("${progression}").rootNotes(2).note()\n).s("piano")`
        : `chord("${progression}").dict("triads").anchor("c4").voicing().s("piano")`,
  );
</script>

<div class="builder">
  <div class="controls">
    <label>
      Tonalité
      <select
        value={code}
        onchange={(e) => {
          code = e.currentTarget.value;
          onkey?.(code);
        }}
      >
        {#each CAMELOT_WHEEL as k (k.code)}
          <option value={k.code}>{k.code} · {longNoteFr(k)}</option>
        {/each}
      </select>
    </label>

    <label>
      Degrés
      <input value={degrees} oninput={(e) => (degrees = e.currentTarget.value)} placeholder="6-1-3-7" />
    </label>

    <label class="inline">
      <input type="checkbox" checked={withBass} onchange={(e) => (withBass = e.currentTarget.checked)} />
      basse
    </label>

    <div class="spelling">
      <button class:on={spelling === 'sharp'} onclick={() => (spelling = 'sharp')}>♯</button>
      <button class:on={spelling === 'flat'} onclick={() => (spelling = 'flat')}>♭</button>
    </div>
  </div>

  {#if problem}
    <p class="bad">{problem}</p>
  {:else if chords}
    <div class="result">
      <ul class="chords">
        {#each chords as c (c.degree + c.symbol)}
          <li><span class="deg">{c.degree}</span>{c.symbol}</li>
        {/each}
      </ul>
      <button class="insert" onclick={() => oninsert(snippet)}>Insérer</button>
    </div>
  {/if}
</div>

<style>
  .builder {
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
  label.inline {
    flex-direction: row;
    align-items: center;
    gap: 0.25rem;
    padding-bottom: 0.3rem;
  }
  .spelling {
    display: flex;
    gap: 0.2rem;
  }
  .spelling button {
    padding: 0.2rem 0.45rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .spelling button.on {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .result {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .chords {
    display: flex;
    gap: 0.35rem;
    list-style: none;
    margin: 0;
    padding: 0;
    flex-wrap: wrap;
  }
  .chords li {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    padding: 0.15rem 0.4rem;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    color: var(--accent);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .deg {
    font-size: 0.65rem;
    color: var(--muted);
  }
  .insert {
    font-size: 0.75rem;
    padding: 0.25rem 0.6rem;
  }
  .bad {
    margin: 0;
    font-size: 0.75rem;
    color: var(--danger);
  }
  input,
  select {
    font: inherit;
    font-size: 0.8rem;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.25rem 0.4rem;
  }
</style>
