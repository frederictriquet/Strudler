<script lang="ts">
  import { untrack } from 'svelte';
  // [SPEC-18.10] Degrees → chord symbols. A one-way generator: it writes a
  // snippet into the pattern and then forgets it [SPEC-18.7], so the text stays
  // the source of truth and can be edited freely afterwards.
  import { buildProgression, progressionPattern } from '@core/music/chords';
  import { CAMELOT_WHEEL, keyByCode, longNoteFr } from '@core/music/camelot';
  import { detectKey, parseChordList } from '@core/music/keyDetect';
  import {
    detectCandidates,
    frenchChordName,
    parseDegrees,
    parseNotes,
    writeDegrees,
    writeNotes,
    type Candidate,
    type Dialect,
  } from '@core/music/chordDetect';
  import {
    chordPreviewCode,
    chordSnippet,
    isSolved,
    solveChord,
    type ChordSolution,
  } from '@core/composer/chordProbe';
  import { previewPattern } from '@core/composer/preview';
  import { bpm } from '@composer/state/composerStore';

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

  /**
   * Uses `vars` so the progression is written once [SPEC-4.7], and `dict("triads")`
   * because the default (`ireal`) yields jazz voicings with sevenths. [SPEC-17.48]
   *
   * The bass layer is `rootNotes(2)` WITHOUT `.note()`: `rootNotes` already sets
   * the note control, and wrapping it again nests the values in a second `{note}`
   * object — after which `.add(note(n))`, i.e. the key transposition of both the
   * instrument (`ChannelRack.ts`) and the workshop, returns nothing at all and
   * takes the whole stack down with it. [SPEC-17.48]
   */
  const snippet = $derived(
    !chords
      ? ''
      : withBass
        ? `stack(\n  chord("${progression}").dict("triads").anchor("c4").voicing(),\n  chord("${progression}").rootNotes(2)\n).s("piano")`
        : `chord("${progression}").dict("triads").anchor("c4").voicing().s("piano")`,
  );

  // --- Reconnaissance : un ensemble de notes → son nom [SPEC-18.30] ------------
  //
  // The reverse of the generator above, and the one a real session needs: a riff
  // copied from a video arrives as absolute notes, which cannot be transposed.

  /**
   * Three ways in, one result. [SPEC-18.30.5/18.30.6] Musicians do not share one
   * notation: a Strudel pattern reads `d3,a3,f4`, a French score reads
   * `ré3,la3,fa4`, and a tutorial says «the 1, the 3 and the 5». Separate fields
   * make all three visible instead of relying on a single box to guess.
   */
  type Source = 'letters' | 'french' | 'degrees';

  const FIELDS: Array<{ id: Source; label: string; placeholder: string }> = [
    { id: 'letters', label: 'Notes — A B C', placeholder: 'd3,a3,f4' },
    { id: 'french', label: 'Notes — DO RÉ MI', placeholder: 'ré3,la3,fa4' },
    { id: 'degrees', label: 'Degrés dans la gamme', placeholder: '1,5,10' },
  ];

  /** Text of each field, kept independently: switching notation must not erase
   *  what was typed in the other. */
  let typed = $state<Record<Source, string>>({ letters: '', french: '', degrees: '' });
  /** The field the result belongs to — the last one edited. */
  let active = $state<Source | null>(null);
  let recognising = $state(false);
  /** One row per candidate reading. `solution` and `problem` are exclusive; kept
   *  as two fields rather than a union so the template needs no narrowing. */
  interface Reading {
    candidate: Candidate;
    solution: ChordSolution | null;
    problem: string | null;
  }
  let readings = $state<Reading[]>([]);
  let noteProblem = $state<string | null>(null);
  let echoed = $state<string[]>([]);

  /** Orders concurrent runs: solving queries the engine, so a fast typist can
   *  have two in flight and the older one must not win. */
  let token = 0;

  // --- Tonalité d'une suite d'accords [SPEC-18.31] -----------------------------
  //
  // Le sens inverse du générateur en haut : lui part d'une tonalité, celui-ci la
  // déduit. La déduction n'est jamais sûre, donc le verdict porte toujours ce qui
  // la soutient ET ce qui la contredit.

  let progressionText = $state('');
  const CONFIDENCE_LABEL: Record<string, string> = {
    certaine: 'certaine',
    probable: 'probable',
    incertaine: '⚠ incertaine',
    'indéterminée': 'indéterminée',
  };
  const verdict = $derived(
    progressionText.trim() === '' ? null : detectKey(parseChordList(progressionText)),
  );

  /** Symbol currently sounding, so ear and eye agree. [SPEC-18.30.11] */
  let auditioning = $state<string | null>(null);
  let playError = $state<string | null>(null);

  /**
   * Audition one reading. MUST reach `previewPattern` without awaiting anything
   * first: unlocking the AudioContext only works inside the user gesture
   * [SPEC-17.50].
   */
  async function hear(sol: ChordSolution): Promise<void> {
    playError = null;
    auditioning = sol.symbol;
    try {
      await previewPattern(chordPreviewCode(sol), $bpm);
    } catch (err) {
      // Surfaced next to the button, never only in the console. [SPEC-14.3]
      playError = (err as Error).message;
    } finally {
      if (auditioning === sol.symbol) auditioning = null;
    }
  }

  /** Read one field into notes, each notation with its own rules. */
  function readField(source: Source, text: string): string[] | string {
    if (source === 'degrees') {
      if (!key) return 'choisis une tonalité au-dessus';
      return parseDegrees(text, { tonicPc: key.pc, mode: key.mode, spelling });
    }
    return parseNotes(text, source as Dialect);
  }

  /**
   * Show the same notes in the two fields the user is NOT typing in.
   * [SPEC-18.30.7] Retyping `ré3,la3,fa4` after `d3,a3,f4` teaches nobody
   * anything; watching the translation appear does.
   *
   * The degree field stays empty when the chord is not in the current key — a
   * degree that does not exist there would be a lie, and the emptiness is itself
   * the information.
   */
  function mirror(source: Source, notes: string[]): void {
    if (source !== 'letters') typed.letters = writeNotes(notes, 'letters');
    if (source !== 'french') typed.french = writeNotes(notes, 'french');
    if (source !== 'degrees') {
      typed.degrees = key
        ? (writeDegrees(notes, { tonicPc: key.pc, mode: key.mode, spelling }) ?? '')
        : '';
    }
  }

  /**
   * The reading depends on the SCALE, not only on the text. [SPEC-18.30.10]
   *
   * Changing the key (or the ♯/♭ spelling) changes what `1,3,5` means and how the
   * mirrored degrees are written, so the result has to be recomputed — otherwise
   * the panel keeps showing an answer for a key that is no longer selected, and
   * the only way out is to retype something in a field.
   *
   * `code` and `spelling` are the ONLY dependencies: `active` and `typed` are read
   * through `untrack`, because `recognise` writes `typed` itself and reading it
   * reactively here would make this effect re-enter its own output.
   */
  $effect(() => {
    const scale = `${code}|${spelling}`; // the read that makes this effect depend on them
    void scale;
    const source = untrack(() => active);
    if (source === null) return;
    void recognise(source, untrack(() => typed[source]));
  });

  async function recognise(source: Source, text: string): Promise<void> {
    const mine = ++token;
    active = source;
    const parsed = readField(source, text);
    if (typeof parsed === 'string') {
      noteProblem = text.trim() === '' ? null : parsed;
      readings = [];
      echoed = [];
      // Nothing readable: clear the mirrors rather than leave a stale translation
      // of an older, valid input sitting next to a broken one.
      if (text.trim() === '') mirror(source, []);
      return;
    }
    noteProblem = null;
    echoed = parsed;
    mirror(source, parsed);
    const candidates = detectCandidates(parsed);
    readings = [];
    if (candidates.length === 0) return;

    recognising = true;
    // The pasted notes are the reference: a spelling is kept only when Strudel
    // voices these pitch classes and no others. [SPEC-18.30]
    const rows: Reading[] = [];
    for (const candidate of candidates) {
      const verdict = await solveChord(candidate, parsed);
      if (mine !== token) return; // a newer paste won
      rows.push(
        isSolved(verdict)
          ? { candidate, solution: verdict, problem: null }
          : { candidate, solution: null, problem: verdict.problem },
      );
      readings = [...rows]; // show each reading as it lands
    }
    recognising = false;
  }
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

  <!-- [SPEC-18.30] Notes → nom d'accord. Le sens inverse du générateur ci-dessus. -->
  <div class="recognise">
    <span class="title">Reconnaître un accord</span>
    <div class="fields">
      {#each FIELDS as field (field.id)}
        <label class:active={active === field.id}>
          {field.label}
          <input
            class:mirrored={active !== null && active !== field.id && typed[field.id] !== ''}
            value={typed[field.id]}
            oninput={(e) => {
              typed[field.id] = e.currentTarget.value;
              void recognise(field.id, typed[field.id]);
            }}
            placeholder={field.placeholder}
            spellcheck="false"
          />
        </label>
      {/each}
    </div>
    {#if active === 'degrees' && key}
      <!-- Which scale the numbers are read against is not obvious; say it. -->
      <p class="echo">degrés lus dans {code} · {longNoteFr(key)}</p>
    {/if}

    {#if noteProblem}
      <p class="bad">{noteProblem}</p>
    {:else if echoed.length > 0}
      <p class="echo">{echoed.join(' ')}{recognising ? ' — analyse…' : ''}</p>
      {#if readings.length === 0 && !recognising}
        <p class="bad">Aucun accord connu ne correspond à ces notes.</p>
      {/if}
      <ul class="readings">
        {#each readings as row (row.candidate.symbol)}
          <li>
            {#if row.solution}
              {@const sol = row.solution}
              <button
                class="hear"
                class:playing={auditioning === sol.symbol}
                onclick={() => void hear(sol)}
                title="Écouter cet accord au piano"
                aria-label="Écouter {sol.symbol} au piano">🎹</button
              >
              <span class="sym">{sol.symbol}</span>
              <!-- Le symbole reste anglais (Strudel n'accepte que celui-là) ; le
                   nom français dit de quel accord il s'agit. [SPEC-18.30.8] -->
              <span class="fr">{frenchChordName(sol.symbol)}</span>
              <!-- One expression, not markup around whitespace: Svelte collapses the
                   latter and the separator ends up glued to the last note. -->
              <span class="notes">{sol.notes.join(' ') + (sol.bass ? ` · basse ${sol.bass}` : '')}</span>
              <button class="mini" onclick={() => oninsert(chordSnippet(sol))}>
                {sol.bass ? 'Insérer + basse' : 'Insérer'}
              </button>
              {#if sol.dropped.length > 0}
                <!-- A voicing that quietly loses a note is what you discover on
                     stage. Name it. [SPEC-18.30] -->
                <span class="why">
                  {sol.renamed ? `lu « ${row.candidate.symbol} », écrit « ${sol.symbol} » — ` : ''}la
                  voicing de Strudel omet {sol.dropped.join(', ')}{#if sol.bass}, et la basse
                    {sol.bass} devient une couche{/if}.
                </span>
              {:else if sol.renamed}
                <!-- Say WHY the name changed: reading a symbol you did not ask for,
                     with no explanation, reads as a bug. [SPEC-18.30] -->
                <span class="why">
                  lu « {row.candidate.symbol} », écrit « {sol.symbol} » — Strudel ne connaît cet
                  accord que sous ce nom{#if sol.bass}, et sa basse {sol.bass} devient une
                    couche{/if}.
                </span>
              {:else if sol.bass}
                <span class="why">
                  Strudel refuse les accords barrés : la basse {sol.bass} devient une couche.
                </span>
              {/if}
            {:else}
              <span class="sym off">{row.candidate.symbol}</span>
              <span class="fr off">{frenchChordName(row.candidate.symbol)}</span>
              <span class="why">{row.problem}</span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if playError}
        <p class="bad">{playError}</p>
      {/if}
    {/if}
  </div>

  <!-- [SPEC-18.31] Suite d'accords → tonalité, avec son degré de certitude. -->
  <div class="recognise">
    <label>
      Tonalité d'une suite d'accords
      <input
        value={progressionText}
        oninput={(e) => (progressionText = e.currentTarget.value)}
        placeholder="Dm Gm   ou   C F Ab Bb   ou   <E G#m B F#>"
        spellcheck="false"
      />
    </label>

    {#if verdict}
      <div class="verdict">
        {#if verdict.key}
          <span class="sym">{verdict.key.code}</span>
          <span class="fr">{longNoteFr(verdict.key)}</span>
        {:else}
          <span class="sym off">—</span>
        {/if}
        <span class="conf" data-c={verdict.confidence}>{CONFIDENCE_LABEL[verdict.confidence]}</span>
        {#if verdict.key}
          {@const found = verdict.key}
          <button class="mini" onclick={() => onkey?.(found.code)}>
            Adopter comme tonalité
          </button>
        {/if}
      </div>

      {#if verdict.roles.length > 0}
        <p class="roles">
          {#each verdict.roles as r (r.symbol + r.status)}
            <span class="role" data-s={r.status} title={r.note ?? ''}>
              {r.symbol}{r.numeral ? ` = ${r.numeral}` : ''}
            </span>
          {/each}
        </p>
      {/if}

      <!-- Les réserves d'abord quand il y en a : une hypothèse sans elles serait
           une affirmation, et c'est ce qu'une déduction n'est pas. -->
      {#each verdict.problems as p (p)}
        <p class="note warn">⚠ {p}</p>
      {/each}
      {#each verdict.evidence as e (e)}
        <p class="note">+ {e}</p>
      {/each}
    {/if}
  </div>
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
  .recognise {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--border);
  }
  .recognise .title {
    font-size: 0.7rem;
    color: var(--muted);
  }
  .fields {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .fields label {
    flex: 1 1 9rem;
    min-width: 0;
  }
  /* The field the result came from: without it, three inputs and one answer
     leave you guessing which one spoke. */
  .fields label.active {
    color: var(--accent);
  }
  .recognise input {
    font-family: ui-monospace, monospace;
    width: 100%;
  }
  /* Written by the app, not typed: dimmed so the field you are driving stays
     obvious. Still editable — taking it over just makes it the active field. */
  .recognise input.mirrored {
    color: var(--muted);
    border-style: dashed;
  }
  .echo {
    margin: 0;
    font-size: 0.72rem;
    color: var(--muted);
    font-family: ui-monospace, monospace;
  }
  .readings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .readings li {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    font-size: 0.78rem;
  }
  .sym {
    font-family: ui-monospace, monospace;
    color: var(--accent);
    padding: 0.1rem 0.4rem;
    border: 1px solid var(--accent-dim);
    border-radius: 6px;
  }
  /* A reading Strudel cannot play at all: shown, never offered. */
  .sym.off {
    color: var(--muted);
    border-color: var(--border);
    text-decoration: line-through;
  }
  .hear {
    flex: none;
    padding: 0.1rem 0.35rem;
    font-size: 0.85rem;
    line-height: 1.1;
  }
  /* Lit while it sounds: with two readings a click apart, you need to know which
     one you just heard. */
  .hear.playing {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .fr {
    font-size: 0.75rem;
    color: var(--text);
  }
  .verdict {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .conf {
    font-size: 0.7rem;
    color: var(--muted);
  }
  .conf[data-c='certaine'] {
    color: var(--ok);
  }
  .conf[data-c='incertaine'] {
    color: var(--danger);
  }
  .roles {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    margin: 0.15rem 0 0;
  }
  .role {
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    padding: 0.05rem 0.3rem;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--muted);
  }
  .role[data-s='diatonic'] {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  /* Emprunt : hors gamme mais nommé — pas la même chose qu'une contradiction. */
  .role[data-s='borrowed'] {
    color: #f0b429;
    border-color: #f0b429;
  }
  .role[data-s='foreign'],
  .role[data-s='unreadable'] {
    color: var(--danger);
    border-color: var(--danger);
  }
  .note.warn {
    color: #f0b429;
  }
  .fr.off {
    color: var(--muted);
    text-decoration: line-through;
  }
  .notes {
    font-family: ui-monospace, monospace;
    font-size: 0.72rem;
    color: var(--muted);
  }
  .why {
    font-size: 0.68rem;
    color: var(--muted);
    flex: 1 1 100%;
  }
  .mini {
    font-size: 0.7rem;
    padding: 0.15rem 0.45rem;
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
