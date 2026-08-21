<script lang="ts">
  // [SPEC-18] Composition workshop — a SEPARATE page from the instrument
  // [SPEC-18.3]. Writing happens in text; everything shown about the loop is
  // derived from that text by querying the pattern [SPEC-18.6].
  import { onMount } from 'svelte';
  import PianoRoll from '@composer/lib/PianoRoll.svelte';
  import ChordBuilder from '@composer/lib/ChordBuilder.svelte';
  import SoundBrowser from '@composer/lib/SoundBrowser.svelte';
  import LayerStrip from '@composer/lib/LayerStrip.svelte';
  import EuclidWheel from '@composer/lib/EuclidWheel.svelte';
  import PatternHelp from '@composer/lib/PatternHelp.svelte';
  import DrumGrid from '@composer/lib/DrumGrid.svelte';
  import Toasts from '@lib/Toasts.svelte';
  import { initLogCapture } from '@stores/logStore';
  import {
    initBackup,
    mirrorStatus,
    lastSavedAt,
    formatStamp,
  } from '@stores/backupStore';
  import {
    draft,
    category,
    slug,
    bpm,
    contextKey,
    followContextKey,
    audioReady,
    playing,
    status,
    error,
    roll,
    loopBeats,
    patternError,
    codeEvents,
    codeHighlightable,
    layers,
    mutedLayers,
    soloLayer,
    toggleMute,
    toggleSolo,
    beatsIsManual,
    setBeatsManually,
    resumeAutoBeats,
    yamlText,
    yamlError,
    yamlPending,
    editYaml,
    flushYamlEdit,
    revertYaml,
    updateDraft,
    folder,
    saveCheck,
    targetExists,
    canWriteToDisk,
    pickFolder,
    folderWarning,
    unknownSounds,
    restoreSavedFolder,
    refreshTargetExists,
    save,
    download,
    armEngine,
    unlockAudio,
    play,
    stop,
    applyBpm,
    analyse,
    libraryTracks,
    loadTrack,
    newTrack,
  } from '@composer/state/composerStore';
  import PatternEditor from '@composer/lib/PatternEditor.svelte';
  import MiniNotationSheet from '@composer/lib/MiniNotationSheet.svelte';
  import { addLayer } from '@core/composer/layers';
  import { eventPhase, phaseWithin } from '@core/composer/roll';
  import { playheadBeat } from '@composer/state/playhead';
  import { startIsolate, stopIsolate } from '@core/composer/preview';
  import { library } from '@core/library/Library';
  import { CAMELOT_WHEEL, longNoteFr } from '@core/music/camelot';

  const tracks = libraryTracks();
  const categories = library.categories;

  let selectedTrack = $state('');
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let patternArea = $state<HTMLTextAreaElement | undefined>(undefined);
  /** Set when a save needs an explicit confirmation (overwrite / id change). */
  let pendingConfirm = $state(false);
  /** Caret and selection in the pattern textarea, so the contextual help can
   *  follow what is being written. [SPEC-18.13] */
  let caret = $state(0);
  let selStart = $state(0);
  let selEnd = $state(0);

  /** The assistants, shown one at a time. [SPEC-18.22] */
  const TOOLS = [
    { id: 'sounds', label: 'Sons' },
    { id: 'grid', label: 'Batterie' },
    { id: 'euclid', label: 'Euclidien' },
    { id: 'chords', label: 'Accords' },
  ] as const;
  let activeTool = $state<(typeof TOOLS)[number]['id'] | null>(null);

  /** True once the user has actually put the caret in the pattern. Never reset on
   *  blur: clicking an assistant blurs the textarea, and the last position is
   *  exactly where the insertion belongs. */
  let caretKnown = $state(false);

  /** A textarea fires no event for caret moves alone — keyup/click/select cover
   *  arrows, clicks and drag-selection, which is what the help reacts to. */
  function trackCaret(): void {
    const area = patternArea;
    if (!area) return;
    caret = area.selectionStart;
    selStart = area.selectionStart;
    selEnd = area.selectionEnd;
    caretKnown = true;
  }

  /** While the typed YAML does not parse it is the only editable view: the fields
   *  would be rewritten from a draft that no longer matches it. [SPEC-18.14] */
  const yamlBlocked = $derived($yamlError !== null);

  onMount(() => {
    armEngine(); // register the eval scope BEFORE any query, and arm the unlock
    initBackup(); // mirror the draft and the bookmarks to disk [SPEC-13.5]
    // Strudel's own warnings («sound not found», eval errors) were reaching the
    // console only on this page: silence with no explanation. [SPEC-14.3]
    initLogCapture();
    void restoreSavedFolder(); // silent: reattaches the folder authorized last time
    void analyse();
    return () => clearTimeout(debounce);
  });

  /**
   * Add a generated snippet as a NEW LAYER. [SPEC-18.23] The default gesture for
   * the assistants: they produce whole patterns, which belong side by side with
   * what is already there — appending them as raw text would just concatenate two
   * expressions into a syntax error. The text owns the result from here on
   * [SPEC-18.7].
   */
  function addAsLayer(snippet: string): void {
    flushYamlEdit(); // read the pattern only once a pending YAML edit has landed
    updateDraft((d) => ({ ...d, patternSource: addLayer(d.patternSource, snippet) }));
    void analyse();
  }

  /**
   * Insert raw text at the caret — the other gesture, for putting a fragment
   * INSIDE existing code (a sound name into an `s("…")`). Requires a caret the
   * user has actually placed: without one there is no meaningful position, and
   * falling back to the end of the text is what produced invalid code.
   */
  function insertAtCursor(snippet: string): void {
    if (!caretKnown) return;
    flushYamlEdit();
    const source = $draft.patternSource;
    const start = Math.min(selStart, source.length);
    const end = Math.min(selEnd, source.length);
    const next = source.slice(0, start) + snippet + source.slice(end);
    updateDraft((d) => ({ ...d, patternSource: next }));
    void analyse();
    // Put the caret after the insertion, once Svelte has written the value back.
    queueMicrotask(() => {
      const area = patternArea;
      if (!area) return;
      area.focus();
      const at = start + snippet.length;
      area.setSelectionRange(at, at);
      trackCaret();
    });
  }

  async function doSave(confirmed: boolean): Promise<void> {
    const done = await save(confirmed);
    pendingConfirm = !done;
  }

  async function onSave(): Promise<void> {
    await refreshTargetExists(); // the file may have appeared since the last check
    await doSave(false);
  }

  /** Re-derive after a pause in typing: querying is cheap but not free, and a
   *  roll redrawn on every keystroke flickers more than it informs. */
  function onPatternInput(event: Event): void {
    const value = (event.currentTarget as HTMLTextAreaElement).value;
    updateDraft((d) => ({ ...d, patternSource: value }));
    trackCaret();
    clearTimeout(debounce);
    debounce = setTimeout(() => void analyse(), 300);
  }

  /** Fragment currently looping on its own, or null. [SPEC-18.13] */
  let isolated = $state<string | null>(null);

  /** Hear a selected fragment alone. It runs in the audition slot, never the
   *  loop's, so isolating never destroys what is being written. Clicking the
   *  same fragment again stops it. */
  async function onIsolate(fragment: string): Promise<void> {
    try {
      if (isolated === fragment) {
        isolated = null;
        await stopIsolate();
        return;
      }
      await startIsolate(fragment);
      isolated = fragment;
    } catch (err) {
      isolated = null;
      error.set(`Isolation impossible : ${(err as Error).message}`); // [SPEC-14.3]
    }
  }

  /** A grid edit replaces the whole pattern — the grid is the one bidirectional
   *  editor, and only within the subset it fully understands. [SPEC-18.10] */
  function onGridChange(next: string): void {
    updateDraft((d) => ({ ...d, patternSource: next }));
    void analyse();
  }

  /** The YAML pane is editable both ways [SPEC-18.14]: the store holds the typed
   *  text verbatim and re-parses it after a pause, so nothing typed is lost. */
  function onYamlInput(event: Event): void {
    editYaml((event.currentTarget as HTMLTextAreaElement).value);
  }

  function onBpmInput(event: Event): void {
    applyBpm(Number((event.currentTarget as HTMLInputElement).value));
  }

  async function onToggle(): Promise<void> {
    if ($playing) {
      stop();
      return;
    }
    if (!$audioReady) await unlockAudio();
    if ($audioReady) await play();
  }

  function onTagsInput(event: Event): void {
    const raw = (event.currentTarget as HTMLInputElement).value;
    updateDraft((d) => ({
      ...d,
      tags: raw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }));
  }

  const fileName = $derived(`library/${$category}/${$slug}.track.yaml`);

  /** Character ranges of the events sounding right now. [SPEC-18.27] Both the
   *  attack and its held remainder light the code: unlike the roll, where a flash
   *  is legible, text that blinked for an eighth of a beat would be unreadable. */
  const litRanges = $derived.by(() => {
    const phase = phaseWithin($playheadBeat, $draft.beats);
    if (phase === null) return [];
    return $codeEvents.filter((ev) => eventPhase(ev, phase) !== 'idle').flatMap((ev) => ev.locations);
  });
</script>

<main>
  <header>
    <h1>Atelier</h1>

    <button class="play" class:on={$playing} onclick={onToggle}>
      {$playing ? '■ Stop' : '▶ Écouter'}
    </button>

    <label class="ctx">
      BPM
      <input type="number" min="40" max="220" value={$bpm} oninput={onBpmInput} />
    </label>

    <label class="ctx">
      Contexte
      <select
        value={$contextKey}
        onchange={(e) => {
          contextKey.set(e.currentTarget.value);
          if ($followContextKey) void analyse(); // the roll follows the transposition
        }}
      >
        {#each CAMELOT_WHEEL as k (k.code)}
          <option value={k.code}>{k.code} · {longNoteFr(k)}</option>
        {/each}
      </select>
    </label>

    <label
      class="ctx"
      title={$draft.key
        ? 'Transpose l’écoute ET le piano roll vers la tonalité de contexte'
        : 'Nécessite une tonalité de piste (piste mélodique)'}
    >
      <input
        type="checkbox"
        checked={$followContextKey}
        disabled={!$draft.key}
        onchange={(e) => {
          followContextKey.set(e.currentTarget.checked);
          void analyse();
        }}
      />
      transposer
    </label>

    <span class="spacer"></span>

    <label class="ctx">
      Partir de
      <select
        value={selectedTrack}
        onchange={(e) => {
          selectedTrack = e.currentTarget.value;
          if (selectedTrack) loadTrack(selectedTrack);
        }}
      >
        <option value="">— piste vierge —</option>
        {#each tracks as t (t.id)}
          <option value={t.id}>{t.label}</option>
        {/each}
      </select>
    </label>
    <button
      onclick={() => {
        selectedTrack = '';
        newTrack();
      }}>Nouvelle</button
    >
    <a class="back" href="/index.html">← Instrument</a>
  </header>

  {#if $error}
    <p class="alert error">{$error}</p>
  {/if}
  {#if $status && !$error}
    <p class="alert info">{$status}</p>
  {/if}

  <div class="cols">
    <section class="left">
      <div class="field">
        <label for="pattern">Pattern</label>
        <!-- One factual line. The phrase length is decided automatically
             [SPEC-18.21], so the old warnings about a mismatch no longer apply —
             only the internal repeat is worth stating, and it is not a fault. -->
        <span class="len">
          {#if $patternError}
            <span class="bad">{$patternError}</span>
          {:else}
            <strong>{$draft.beats} beats</strong>
            <span class="sub">
              ({$draft.beats / 4} mesure{$draft.beats > 4 ? 's' : ''}){#if $loopBeats === null}
                · non périodique{:else if $loopBeats !== $draft.beats}
                · motif de {$loopBeats} beat{$loopBeats > 1 ? 's' : ''}{/if}
            </span>
          {/if}
        </span>
        <!-- Characters light up while they sound. [SPEC-18.27] -->
        <PatternEditor
          bind:element={patternArea}
          value={$draft.patternSource}
          lit={litRanges}
          highlightable={$codeHighlightable}
          disabled={yamlBlocked}
          oninput={onPatternInput}
          oncaret={trackCaret}
        />
        {#if $unknownSounds.length > 0}
          <!-- Notes drawn, nothing audible: name the sound rather than let the
               silence look like a bug in the pattern. [SPEC-17.56] -->
          <span class="hint bad">
            son inconnu : {$unknownSounds.join(', ')} — aucune banque ne fournit ce nom, rien ne
            sera joué. Cherche-le dans « Sons ».
          </span>
        {/if}
        {#if !$codeHighlightable && $playing}
          <!-- Say WHY rather than let the absence of highlighting look like a bug. -->
          <span class="hint">
            surlignage indisponible : le code joué diffère du texte (variables, couche coupée ou
            transposition)
          </span>
        {/if}
      </div>

      <PianoRoll
        roll={$roll}
        phraseBeats={$draft.beats}
        periodBeats={$loopBeats}
        stale={$patternError !== null}
        playheadBeat={$playheadBeat}
      />

      <LayerStrip
        layers={$layers}
        muted={$mutedLayers}
        solo={$soloLayer}
        onmute={toggleMute}
        onsolo={toggleSolo}
      />

      <!-- One-way generators: they write into the pattern and forget it. [SPEC-18.7] -->
      <!-- Explains the fragment under the caret, where the question arises.
           [SPEC-18.13] Always visible: it answers a question you have WHILE
           typing, so hiding it behind a click would defeat it. -->
      <PatternHelp
        text={$draft.patternSource}
        {caret}
        selectionStart={selStart}
        selectionEnd={selEnd}
        onisolate={onIsolate}
      />

      <!-- One assistant at a time. Four stacked panels pushed the roll and the
           metadata off screen; a workshop that needs scrolling to see what it is
           drawing is not usable. [SPEC-18.22] -->
      <div class="tools">
        <div class="tabs">
          {#each TOOLS as t (t.id)}
            <button
              class:on={activeTool === t.id}
              onclick={() => (activeTool = activeTool === t.id ? null : t.id)}
            >
              {t.label}
            </button>
          {/each}
        </div>

        {#if activeTool === 'chords'}
          <ChordBuilder
            trackKey={$draft.key}
            oninsert={addAsLayer}
            onkey={(k) => updateDraft((d) => ({ ...d, key: k }))}
          />
        {:else if activeTool === 'grid'}
          <DrumGrid pattern={$draft.patternSource} onchange={onGridChange} />
        {:else if activeTool === 'euclid'}
          <EuclidWheel oninsert={addAsLayer} />
        {:else if activeTool === 'sounds'}
          <!-- Two gestures: the name adds a layer, ↳ drops the bare name at the
               caret to go inside an existing `s("…")`. [SPEC-18.23] -->
          <SoundBrowser
            oninsert={addAsLayer}
            oninsertname={insertAtCursor}
            canInsertAtCaret={caretKnown}
          />
        {/if}
      </div>

      <!-- Fields are disabled while the typed YAML is invalid: they are a view of a
           draft the pane no longer matches, and editing one would mean choosing
           between the two. Category and file name are NOT in the YAML — they come
           from the file path [SPEC-4.6] — so they stay available. -->
      <div class="meta">
        <label>
          Nom
          <input
            disabled={yamlBlocked}
            value={$draft.name}
            oninput={(e) => updateDraft((d) => ({ ...d, name: e.currentTarget.value }))}
          />
        </label>
        <label>
          Catégorie
          <select value={$category} onchange={(e) => category.set(e.currentTarget.value)}>
            {#each categories as c (c)}
              <option value={c}>{c}</option>
            {/each}
          </select>
        </label>
        <label>
          Fichier
          <input value={$slug} oninput={(e) => slug.set(e.currentTarget.value)} />
        </label>
        <label title="Longueur de phrase déclarée. Métadonnée : ne modifie pas la vitesse de lecture — c'est le code du pattern qui définit sa durée (1 cycle = 4 beats).">
          Beats {$beatsIsManual ? '(manuel)' : '(auto)'}
          <span class="beats">
            <input
              type="number"
              min="1"
              disabled={yamlBlocked}
              value={$draft.beats}
              oninput={(e) => setBeatsManually(Number(e.currentTarget.value))}
            />
            {#if $beatsIsManual}
              <!-- Typing here takes over; this gives the automatic rule back. -->
              <button onclick={resumeAutoBeats} title="Revenir à la longueur déduite du pattern"
                >auto</button
              >
            {/if}
          </span>
        </label>
        <label class="wide">
          Tags (séparés par des virgules)
          <input disabled={yamlBlocked} value={$draft.tags.join(', ')} oninput={onTagsInput} />
        </label>
        <label>
          Tonalité de la piste
          <select
            disabled={yamlBlocked}
            value={$draft.key ?? ''}
            onchange={(e) =>
              updateDraft((d) => ({ ...d, key: e.currentTarget.value || undefined }))}
          >
            <option value="">— non mélodique —</option>
            {#each CAMELOT_WHEEL as k (k.code)}
              <option value={k.code}>{k.code} · {longNoteFr(k)}</option>
            {/each}
          </select>
        </label>
      </div>
    </section>

    <section class="right">
      <!-- The file stays visible AND editable, in both directions: the workshop
           must not make hand-editing second-class. [SPEC-18.14] -->
      <div class="field">
        <label for="yaml">{fileName}</label>
        <span class="len">
          {#if $yamlPending}
            <span class="warn">analyse…</span>
          {:else if $yamlError}
            <span class="bad">✕ non appliqué</span>
          {:else}
            <span class="good">✓ champs à jour</span>
          {/if}
        </span>
        <textarea
          id="yaml"
          class:invalid={yamlBlocked}
          spellcheck="false"
          value={$yamlText}
          oninput={onYamlInput}
          onblur={flushYamlEdit}
        ></textarea>
        <!-- Shown in full, with line and column: a syntax error must never cost a
             keystroke, and never be silent. [SPEC-14.3] -->
        {#if $yamlError}
          <p class="note bad yaml-msg">
            ✕ {$yamlError}<br />
            Le texte saisi est conservé ; les champs de gauche restent figés tant qu'il n'est pas
            valide.
            <button class="inline-btn" onclick={revertYaml} title="Abandonner le texte saisi">
              rétablir
            </button>
          </p>
        {/if}
      </div>

      <!-- Writing to disk. Nothing invalid is ever written. [SPEC-18.15/18.16] -->
      <div class="save">
        <div class="save-row">
          {#if canWriteToDisk}
            <button
              onclick={pickFolder}
              title={$folder
                ? `Dossier actuel : ${$folder}. Cliquez pour en choisir un autre — ce doit être le dossier « library », pas une catégorie.`
                : 'Choisir le dossier « library » (celui qui contient les dossiers de catégories)'}
            >
              📁 {$folder ?? 'Choisir le dossier library…'}
            </button>
            <button
              class="primary"
              disabled={$saveCheck.blocking.length > 0 || !$folder}
              onclick={onSave}
            >
              Enregistrer
            </button>
          {:else}
            <button onclick={download}>⤓ Télécharger le fichier</button>
          {/if}
        </div>

        {#if !canWriteToDisk}
          <p class="note">
            Écriture directe indisponible dans ce navigateur — le fichier est téléchargé, à
            déposer dans <code>library/{$category}/</code>.
          </p>
        {/if}

        <!-- The picker gives no context, so a wrong level is easy to choose and
             invisible afterwards. [SPEC-18.15] -->
        {#if $folderWarning}
          <p class="note warn">⚠ {$folderWarning}</p>
        {/if}

        <!-- The draft and the sound bookmarks live in localStorage, which a
             cleared browser wipes. Say plainly whether the disk copy is running.
             [SPEC-13.5] Full controls sit in the instrument's Réglages panel. -->
        {#if $mirrorStatus === 'unavailable'}
          <p class="note warn">
            ⚠ Miroir disque indisponible : brouillon et favoris ne vivent que dans ce navigateur.
          </p>
        {:else if $mirrorStatus === 'error'}
          <p class="note bad">✕ Sauvegarde sur disque en échec — voir la notification.</p>
        {:else if $lastSavedAt}
          <p class="note">✓ Sauvegardé sur disque · {formatStamp($lastSavedAt)}</p>
        {/if}

        {#each $saveCheck.blocking as problem (problem)}
          <p class="note bad">✕ {problem}</p>
        {/each}

        {#if pendingConfirm}
          <div class="confirm">
            {#each $saveCheck.warnings as w (w)}
              <p class="note warn">⚠ {w}</p>
            {/each}
            {#if $targetExists}
              <p class="note warn">⚠ <code>{fileName}</code> existe déjà et sera écrasé.</p>
            {/if}
            <div class="save-row">
              <button class="primary" onclick={() => void doSave(true)}>Confirmer</button>
              <button onclick={() => (pendingConfirm = false)}>Annuler</button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Reference material: consulted now and then, so it lives beside the file
           rather than under the pattern, where it pushed the roll off screen. -->
      <MiniNotationSheet />
    </section>
  </div>
</main>

<!-- [SPEC-14.3] The workshop had no visible channel for asynchronous failures;
     backup errors must not land in the console only. -->
<Toasts />

<style>
  /* Fixed height, not a minimum: with `min-height` the page grows past the
     viewport and `flex: 1` below constrains nothing — which is exactly how the
     cheat sheet ended up overflowing behind a window scrollbar. The window never
     scrolls; what needs to scroll does so inside itself. */
  main {
    height: 100vh;
    overflow: hidden;
    padding: 0.6rem 0.8rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
  }
  h1 {
    margin: 0;
    font-size: 1rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .spacer {
    flex: 1;
  }
  .play.on {
    border-color: var(--danger);
    color: var(--danger);
  }
  .ctx {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .ctx input[type='number'] {
    width: 4rem;
  }
  .back {
    color: var(--muted);
    font-size: 0.8rem;
    text-decoration: none;
  }
  .back:hover {
    color: var(--accent);
  }
  .alert {
    margin: 0;
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
    font-size: 0.82rem;
  }
  .alert.error {
    color: var(--danger);
    border: 1px solid var(--danger);
  }
  .alert.info {
    color: var(--muted);
  }
  /* Takes the height `main` has left, and stretches both columns to it, so the
     cheat sheet can claim whatever the right column does not use. `min-height: 0`
     is what lets an inner scroller shrink instead of pushing the page taller. */
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 0.8rem;
    align-items: stretch;
    flex: 1;
    min-height: 0;
  }
  .left,
  .right {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
    min-height: 0;
  }
  /* Safety net, not a design: the left column holds the roll, the assistants and
     the metadata, which on a short window genuinely exceed the height. It scrolls
     on its own rather than making the whole page do it. */
  .left {
    overflow-y: auto;
  }
  .field {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.25rem 0.5rem;
  }
  .field label {
    font-size: 0.75rem;
    color: var(--muted);
  }
  /* The pattern editor is a COMPONENT wrapper, so it needs the span rule of its
     own — without it the editor sits in the `1fr` column only and leaves the
     `auto` column (the beats label) unused. */
  .field :global(.editor) {
    grid-column: 1 / -1;
  }
  /* Direct child only: this styles the YAML pane's textarea. Left as a descendant
     selector it also reached INSIDE PatternEditor and repainted the transparent
     textarea that must let the highlight layer show through. */
  .field > textarea {
    grid-column: 1 / -1;
    width: 100%;
    font-family: ui-monospace, 'SF Mono', monospace;
    font-size: 0.82rem;
    line-height: 1.45;
    padding: 0.5rem;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    resize: vertical;
  }
  /* A floor, not a share: the pane keeps a readable size but no longer claims a
     third of the column, leaving the height to the cheat sheet below. Still
     resizable by hand when a long file needs it. */
  #yaml {
    min-height: 9rem;
  }
  #yaml.invalid {
    border-color: var(--danger);
  }
  .yaml-msg {
    grid-column: 1 / -1;
  }
  .field > textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .tools {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .tabs {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .tabs button {
    padding: 0.25rem 0.6rem;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .tabs button.on {
    color: var(--accent);
    border-color: var(--accent-dim);
    background: rgba(110, 231, 183, 0.1);
  }
  .beats {
    display: flex;
    gap: 0.25rem;
  }
  .beats input {
    flex: 1;
    min-width: 0;
  }
  .beats button {
    flex: none;
    padding: 0.2rem 0.35rem;
    font-size: 0.65rem;
    color: var(--muted);
  }
  .len strong {
    color: var(--accent);
    font-weight: 600;
  }
  .hint {
    grid-column: 1 / -1;
    font-size: 0.7rem;
    color: var(--muted);
  }
  /* An unknown sound is not a hint about the tool, it is a fault in the pattern:
     it has to read as one. [SPEC-17.56] */
  .hint.bad {
    color: var(--danger);
    font-size: 0.75rem;
  }
  .len .sub {
    color: var(--muted);
  }
  .save {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .save-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .save-row button {
    font-size: 0.8rem;
    padding: 0.35rem 0.7rem;
  }
  .primary {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .note {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted);
    line-height: 1.4;
  }
  .note.bad {
    color: var(--danger);
  }
  .note.warn {
    color: #f0b429;
  }
  .confirm {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem;
    border: 1px solid #f0b429;
    border-radius: 8px;
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.9em;
  }
  .len {
    font-size: 0.72rem;
    color: var(--muted);
    text-align: right;
  }
  .len .bad {
    color: var(--danger);
  }
  .len .warn {
    color: #f0b429;
  }
  .len .good {
    color: var(--accent);
  }
  .inline-btn {
    margin-left: 0.35rem;
    padding: 0.05rem 0.35rem;
    font-size: 0.68rem;
    font-family: inherit;
    color: var(--muted);
  }
  .meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.5rem;
  }
  .meta label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.72rem;
    color: var(--muted);
  }
  .meta label.wide {
    grid-column: span 2;
  }
  input,
  select {
    font: inherit;
    font-size: 0.82rem;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.28rem 0.4rem;
  }
</style>
