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
    layers,
    mutedLayers,
    soloLayer,
    toggleMute,
    toggleSolo,
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

  /** A textarea fires no event for caret moves alone — keyup/click/select cover
   *  arrows, clicks and drag-selection, which is what the help reacts to. */
  function trackCaret(): void {
    const area = patternArea;
    if (!area) return;
    caret = area.selectionStart;
    selStart = area.selectionStart;
    selEnd = area.selectionEnd;
  }

  /** While the typed YAML does not parse it is the only editable view: the fields
   *  would be rewritten from a draft that no longer matches it. [SPEC-18.14] */
  const yamlBlocked = $derived($yamlError !== null);

  onMount(() => {
    armEngine(); // register the eval scope BEFORE any query, and arm the unlock
    void restoreSavedFolder(); // silent: reattaches the folder authorized last time
    void analyse();
    return () => clearTimeout(debounce);
  });

  /** Insert a generated snippet at the caret. The text owns it from here on:
   *  the assistants never read back what they wrote. [SPEC-18.7] */
  function insertAtCursor(snippet: string): void {
    flushYamlEdit(); // read the pattern only once a pending YAML edit has landed
    const area = patternArea;
    const source = $draft.patternSource;
    const start = area ? area.selectionStart : source.length;
    const end = area ? area.selectionEnd : source.length;
    const next = source.slice(0, start) + snippet + source.slice(end);
    updateDraft((d) => ({ ...d, patternSource: next }));
    void analyse();
    // Put the caret after the insertion, once Svelte has written the value back.
    queueMicrotask(() => {
      if (!area) return;
      area.focus();
      const caret = start + snippet.length;
      area.setSelectionRange(caret, caret);
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
        <!-- Diagnostic, not a bare number: what matters is whether the content
             actually fills the declared phrase. -->
        <span class="len">
          {#if $patternError}
            <span class="bad">{$patternError}</span>
          {:else if $loopBeats === null}
            <span class="warn">contenu non périodique — longueur variable</span>
          {:else if $loopBeats === $draft.beats}
            <span class="good">✓ la phrase de {$draft.beats} beats ne se répète pas avant sa fin</span
            >
          {:else if $loopBeats < $draft.beats}
            <span class="warn">
              ⚠ le contenu se répète toutes les {$loopBeats} beat{$loopBeats > 1 ? 's' : ''} — la
              phrase de {$draft.beats} bouclera comme {$loopBeats}
            </span>
          {:else}
            <span class="warn">
              ⚠ le contenu ne revient qu'après {$loopBeats} beats — phrase déclarée trop courte
            </span>
            <button
              class="adopt"
              disabled={yamlBlocked}
              onclick={() => updateDraft((d) => ({ ...d, beats: $loopBeats ?? d.beats }))}
              title="Déclarer {$loopBeats} beats comme longueur de phrase"
            >
              corriger
            </button>
          {/if}
        </span>
        <textarea
          id="pattern"
          bind:this={patternArea}
          spellcheck="false"
          rows="8"
          disabled={yamlBlocked}
          value={$draft.patternSource}
          oninput={onPatternInput}
          onkeyup={trackCaret}
          onclick={trackCaret}
          onselect={trackCaret}
        ></textarea>
      </div>

      <PianoRoll
        roll={$roll}
        phraseBeats={$draft.beats}
        periodBeats={$loopBeats}
        stale={$patternError !== null}
      />

      <LayerStrip
        layers={$layers}
        muted={$mutedLayers}
        solo={$soloLayer}
        onmute={toggleMute}
        onsolo={toggleSolo}
      />

      <!-- One-way generators: they write into the pattern and forget it. [SPEC-18.7] -->
      <details class="tool" open>
        <summary>Progression d'accords par degrés</summary>
        <ChordBuilder
          trackKey={$draft.key}
          oninsert={insertAtCursor}
          onkey={(k) => updateDraft((d) => ({ ...d, key: k }))}
        />
      </details>

      <!-- Explains the fragment under the caret, where the question arises.
           [SPEC-18.13] -->
      <PatternHelp
        text={$draft.patternSource}
        {caret}
        selectionStart={selStart}
        selectionEnd={selEnd}
        onisolate={onIsolate}
      />

      <details class="tool">
        <summary>Grille de batterie</summary>
        <DrumGrid pattern={$draft.patternSource} onchange={onGridChange} />
      </details>

      <details class="tool">
        <summary>Rythme euclidien</summary>
        <EuclidWheel oninsert={insertAtCursor} />
      </details>

      <details class="tool">
        <summary>Sons disponibles</summary>
        <SoundBrowser oninsert={insertAtCursor} />
      </details>

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
          Beats (phrase)
          <input
            type="number"
            min="1"
            disabled={yamlBlocked}
            value={$draft.beats}
            oninput={(e) => {
              updateDraft((d) => ({ ...d, beats: Number(e.currentTarget.value) }));
              void analyse(); // the view spans the declared phrase
            }}
          />
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
            <button class="adopt" onclick={revertYaml} title="Abandonner le texte saisi">
              rétablir
            </button>
          </p>
        {/if}
      </div>

      <!-- Writing to disk. Nothing invalid is ever written. [SPEC-18.15/18.16] -->
      <div class="save">
        <div class="save-row">
          {#if canWriteToDisk}
            <button onclick={pickFolder} title="Autoriser le dossier library/ (une seule fois)">
              📁 {$folder ?? 'Dossier…'}
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
    </section>
  </div>
</main>

<style>
  main {
    min-height: 100vh;
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
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 0.8rem;
    align-items: start;
  }
  .left,
  .right {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
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
  .field textarea {
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
  #yaml {
    min-height: 18rem;
  }
  #yaml.invalid {
    border-color: var(--danger);
  }
  .yaml-msg {
    grid-column: 1 / -1;
  }
  .field textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .tool {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    padding: 0.4rem 0.6rem;
  }
  .tool summary {
    cursor: pointer;
    font-size: 0.75rem;
    color: var(--muted);
    user-select: none;
  }
  .tool[open] summary {
    margin-bottom: 0.5rem;
    color: var(--accent);
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
  .adopt {
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
