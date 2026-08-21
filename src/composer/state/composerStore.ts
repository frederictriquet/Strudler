// [SPEC-18] Composition workshop state.
//
// This module is the workshop's ONLY point of contact with the engine, mirroring
// the instrument's single-dispatch discipline. It deliberately imports nothing
// from `@stores/` or `@lib/` [SPEC-18.4]: `rackStore` does work at module level
// (restores the rack from localStorage, subscribes, resizes slots), so importing
// it would boot the instrument as a side effect AND rewrite the user's session.
//
// The pattern text is the source of truth; everything displayed about a loop is
// derived from it by querying [SPEC-18.6].

import { derived, get, writable } from 'svelte/store';
import { engine } from '@core/engine/StrudelEngine';
import { areBanksRegistered, loadAllBanks, soundfontNotice } from '@core/engine/sampleBanks';
import { notify } from '@stores/logStore';
import { library } from '@core/library/Library';
import {
  expandVars,
  parseTrackDraft,
  serializeTrack,
  type TrackDraft,
} from '@core/library/serialize';
import { validateTrackText, yamlErrorMessage } from '@core/library/validate';
import {
  buildRoll,
  phraseBeatsFor,
  spanCyclesFor,
  type LayerHaps,
  type Roll,
  type RollEvent,
} from '@core/composer/roll';
import { layerAlone, layersOf, patternForEnabled } from '@core/composer/layers';
import { startPlayhead, stopPlayhead } from '@composer/state/playhead';
import {
  chooseFolder,
  isSupported,
  restoreFolder,
  trackExists,
  writeTrack,
} from '@core/composer/libraryFolder';
import { DEFAULT_CAMELOT, transposeSemitones } from '@core/music/camelot';
import { loadJson, saveJson } from '@core/persist/storage';


const DEFAULT_BPM = 120;
const BEATS_PER_CYCLE = 4;

/** A blank starting point — a bar of kick, so something is audible at once. */
function emptyDraft(): TrackDraft {
  return {
    name: 'Nouvelle piste',
    beats: 4,
    patternSource: 's("bd*4").gain(0.9)',
    vars: {},
    tags: [],
  };
}

export const draft = writable<TrackDraft>(emptyDraft());
/** Category the track will be saved into (the folder = the category). [SPEC-4.2] */
export const category = writable<string>(library.categories[0] ?? 'kick');
/** Slug = file name; drives the track id `category/slug`. [SPEC-18.15] */
export const slug = writable<string>('nouvelle-piste');

/** Audition context: what you hear while writing must match the destination. [SPEC-18.12] */
export const bpm = writable<number>(DEFAULT_BPM);
export const contextKey = writable<string>(DEFAULT_CAMELOT);
/** Transpose the audition to the context key, the way the instrument does when
 *  « Force tonalité » is on [SPEC-17.20]. Off by default so what is shown is
 *  exactly what the file says. */
export const followContextKey = writable<boolean>(false);

/** Id of the track this draft was loaded from, to detect a rename. [SPEC-18.15] */
export const sourceId = writable<string | null>(null);

// --- Work in progress, kept across reloads ([SPEC-18.28]) -------------------
//
// Saving a track writes into `library/`, the dev server's watcher sees it and the
// page RELOADS — the library index is a singleton the instrument's rack holds a
// reference to, so a hot swap would run two copies [SPEC-17.31]. Correct there,
// destructive here: the workshop lost whatever was being written, at the very
// moment of a successful save.
//
// Rather than weaken the guard, the workspace is restored. That also covers a
// stray F5 and a crash, which cost just as much and were never protected.

const WORKSPACE_KEY = 'composer:workspace';
const WORKSPACE_DEBOUNCE_MS = 400;

interface Workspace {
  draft: TrackDraft;
  category: string;
  slug: string;
  bpm: number;
  contextKey: string;
  followContextKey: boolean;
  sourceId: string | null;
  /** Whether the phrase length was typed by hand. [SPEC-18.21] */
  beatsManual: boolean;
}

/** Restore silently, and hand the entry back so stores declared further down can
 *  seed from it. A corrupted or partial entry is ignored, never repaired:
 *  starting fresh beats starting from something half-understood. */
function restoreWorkspace(): Partial<Workspace> | null {
  const saved = loadJson<Partial<Workspace> | null>(WORKSPACE_KEY, null);
  if (!saved || typeof saved !== 'object') return null;
  const d = saved.draft;
  if (!d || typeof d.patternSource !== 'string' || typeof d.name !== 'string') return null;
  draft.set({
    name: d.name,
    beats: typeof d.beats === 'number' && d.beats > 0 ? d.beats : 4,
    patternSource: d.patternSource,
    vars: d.vars && typeof d.vars === 'object' ? d.vars : {},
    tags: Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === 'string') : [],
    gain: typeof d.gain === 'number' ? d.gain : undefined,
    key: typeof d.key === 'string' ? d.key : undefined,
    comment: typeof d.comment === 'string' ? d.comment : undefined,
  });
  if (typeof saved.category === 'string') category.set(saved.category);
  if (typeof saved.slug === 'string') slug.set(saved.slug);
  if (typeof saved.bpm === 'number') bpm.set(saved.bpm);
  if (typeof saved.contextKey === 'string') contextKey.set(saved.contextKey);
  if (typeof saved.followContextKey === 'boolean') followContextKey.set(saved.followContextKey);
  if (typeof saved.sourceId === 'string' || saved.sourceId === null) sourceId.set(saved.sourceId);
  return saved;
}

// Before the YAML pane initializes from `draft`, so it opens on the restored text.
const restored = restoreWorkspace();

let workspaceTimer: ReturnType<typeof setTimeout> | undefined;

function saveWorkspace(): void {
  clearTimeout(workspaceTimer);
  workspaceTimer = setTimeout(() => {
    try {
      saveJson(WORKSPACE_KEY, {
        draft: get(draft),
        category: get(category),
        slug: get(slug),
        bpm: get(bpm),
        contextKey: get(contextKey),
        followContextKey: get(followContextKey),
        sourceId: get(sourceId),
        beatsManual: get(beatsIsManual),
      } satisfies Workspace);
    } catch (err) {
      // Quota or private mode: say it once rather than lose work silently.
      error.set(`Sauvegarde du brouillon impossible : ${(err as Error).message}`); // [SPEC-14.3]
    }
  }, WORKSPACE_DEBOUNCE_MS);
}

for (const store of [draft, category, slug, bpm, contextKey, followContextKey, sourceId]) {
  store.subscribe(saveWorkspace);
}
// `beatsIsManual` is declared further down (it needs `analyse`); subscribed there.

export const audioReady = writable<boolean>(false);
export const playing = writable<boolean>(false);
export const status = writable<string | null>(null);
export const error = writable<string | null>(null);

/**
 * Events of the pattern queried against the DISPLAYED text, for code highlighting.
 * [SPEC-18.27] Separate from `roll`, which queries layer by layer on rebuilt
 * strings whose character offsets mean nothing to the editor.
 * Empty when highlighting is unavailable — see `codeHighlightable`.
 */
export const codeEvents = writable<RollEvent[]>([]);
/**
 * True when the played code is the displayed text CHARACTER FOR CHARACTER, the
 * only case where the offsets designate what the user sees. Expanding `vars`
 * [SPEC-4.7], dropping a muted layer [SPEC-18.9] or wrapping a transposition
 * [SPEC-18.12] all shift them — and a highlight off by a few characters is worse
 * than none, since it points at the wrong thing with the same confidence.
 */
export const codeHighlightable = writable<boolean>(true);

/** Events of the current pattern, and the loop length measured from them. */
export const roll = writable<Roll | null>(null);
export const loopBeats = writable<number | null>(null);
/** Set when the pattern cannot be evaluated — the roll then keeps its last good state. */
export const patternError = writable<string | null>(null);

// --- The YAML pane, editable both ways ([SPEC-18.14]) ----------------------
//
// The file and the fields are two views of the same draft, and either one can be
// typed into. The rule that keeps them from fighting: only ONE of them is the
// source at a time, and the direction is decided by who was typed into last.
//
//   fields → YAML : on every `draft` change, unless that change came from a parse
//                   of the YAML itself (`fromYaml`) — re-serializing there would
//                   reformat the text under the user's caret mid-typing.
//   YAML → fields : the typed text is held verbatim (`typedYaml`) and parsed after
//                   a pause; only a SUCCESSFUL parse writes back into `draft`.
//
// Nothing typed is ever thrown away: while the text does not parse it stays on
// screen with the reason why, and `updateDraft()` commits it before applying a
// field edit on top of it.

const YAML_DEBOUNCE_MS = 300;

/** The YAML that would be written to disk — and an editable buffer. [SPEC-18.14] */
export const yamlText = writable<string>(serializeTrack(get(draft)));
/** Why the typed YAML cannot be applied, in full. Never silent [SPEC-14.3]. */
export const yamlError = writable<string | null>(null);
/** True between a keystroke and its parse: the fields are momentarily behind. */
export const yamlPending = writable<boolean>(false);

/** Text typed in the pane and not yet committed to `draft`, or null. */
let typedYaml: string | null = null;
let yamlTimer: ReturnType<typeof setTimeout> | undefined;
/** Set while `draft` is being written FROM the YAML, to break the feedback loop. */
let fromYaml = false;

/** Whether a re-parse changed anything the roll or the audition depends on. */
function affectsSound(a: TrackDraft, b: TrackDraft): boolean {
  return (
    a.patternSource !== b.patternSource ||
    a.beats !== b.beats ||
    a.key !== b.key ||
    JSON.stringify(a.vars) !== JSON.stringify(b.vars)
  );
}

/**
 * Parse the typed YAML and adopt it. Validated with `validateTrackText`, the very
 * check the loader runs [SPEC-18.16]: a half-typed file must not reach `draft`,
 * where `parseTrackDraft`'s defaults (empty name, 4 beats) would quietly replace
 * real values.
 */
function commitYaml(): void {
  const text = typedYaml;
  if (text === null) return;
  yamlPending.set(false);

  const validated = validateTrackText(text);
  if (typeof validated === 'string') {
    yamlError.set(validated); // the text stays on screen, untouched
    return;
  }
  let parsed: TrackDraft;
  try {
    parsed = parseTrackDraft(text);
  } catch (err) {
    yamlError.set(yamlErrorMessage(err));
    return;
  }

  yamlError.set(null);
  clearConditionError(); // the YAML parses again: any refusal it caused is moot
  typedYaml = null;
  const rerun = affectsSound(get(draft), parsed);
  fromYaml = true;
  try {
    draft.set(parsed);
  } finally {
    fromYaml = false; // must be cleared even if a subscriber throws
  }
  // The pattern changed → the roll and the voice must follow the text [SPEC-18.6].
  if (rerun) void analyse();
}

/** Called on every keystroke in the YAML pane. The pane shows exactly what was
 *  typed; the parse waits for a pause, because half-typed YAML rarely parses. */
export function editYaml(text: string): void {
  typedYaml = text;
  yamlText.set(text);
  yamlPending.set(true);
  clearTimeout(yamlTimer);
  yamlTimer = setTimeout(commitYaml, YAML_DEBOUNCE_MS);
}

/** Commit a pending edit at once — on blur, or before anything reads the draft. */
export function flushYamlEdit(): void {
  if (typedYaml === null) return;
  clearTimeout(yamlTimer);
  commitYaml();
}

/**
 * Sound names the pattern asks for that no bank provides. [SPEC-17.56]
 *
 * superdough answers an unknown name with silence, which reads exactly like a
 * pattern that plays nothing — the roll fills with notes and not a sound comes
 * out. `gm_*` instruments copied from a video are the common case. Checked
 * against the registry on every analysis, so it is known BEFORE pressing play.
 */
export const unknownSounds = writable<string[]>([]);

/** Sound names used by the queried events, minus everything that resolves.
 *  A `bank()` composes the name at play time, so those haps are left alone
 *  rather than reported on a guess. */
function unknownSoundNames(groups: LayerHaps[]): string[] {
  // Before the banks are in, only the synths are registered and every sample name
  // would be flagged. Asked of the loader, not of a local flag. [SPEC-17.56]
  if (!areBanksRegistered()) return [];
  const known = new Set(engine.registeredSounds());
  if (known.size === 0) return []; // registry unreadable: claim nothing
  const missing = new Set<string>();
  for (const group of groups) {
    for (const hap of group.haps) {
      const { s, bank } = hap.value;
      if (typeof s !== 'string' || s === '') continue;
      if (typeof bank === 'string' && bank !== '') continue;
      if (!known.has(s)) missing.add(s);
    }
  }
  return [...missing].sort();
}

/** Prefix of the refusal below, so it can be cleared without eating other errors. */
const FIELD_BLOCKED = 'Champ non modifié';

/**
 * Messages that describe a CONDITION, not a past event. [SPEC-18.24]
 *
 * They must vanish the moment the condition does — fixing a syntax error and
 * still reading the complaint about it teaches you that the tool is not watching.
 * Event-like failures ("Enregistrement impossible", "Dossier inaccessible") are
 * deliberately absent: they happened, and clearing them would hide what went
 * wrong before it was read.
 */
const CONDITION_PREFIXES = [
  FIELD_BLOCKED,
  'Évaluation impossible',
  'Variable non définie',
  'Lecture impossible',
  'Isolation impossible',
];

/** Drop a condition message whose condition just resolved. */
function clearConditionError(): void {
  const current = get(error);
  if (current && CONDITION_PREFIXES.some((prefix) => current.startsWith(prefix))) {
    error.set(null);
  }
}

/** Discard the typed text and show the draft again — the way out of a YAML error
 *  the user would rather abandon than fix. The only place typing is dropped, and
 *  only on an explicit click. */
export function revertYaml(): void {
  clearTimeout(yamlTimer);
  typedYaml = null;
  yamlPending.set(false);
  yamlError.set(null);
  yamlText.set(serializeTrack(get(draft)));
  if (get(error)?.startsWith(FIELD_BLOCKED)) error.set(null);
}

/**
 * Single entry point for every field edit. It arbitrates between the two views:
 * a pending YAML edit is committed FIRST so the field change applies on top of
 * what was typed, instead of being wiped by the re-serialization below.
 *
 * While the typed YAML does not parse, field edits are REFUSED and said so: of
 * the two, the typed text is the one that would be lost, and it never is.
 */
export function updateDraft(fn: (d: TrackDraft) => TrackDraft): void {
  flushYamlEdit();
  const blocking = get(yamlError);
  if (blocking !== null) {
    error.set(`${FIELD_BLOCKED} — corrigez le YAML : ${blocking}`);
    return;
  }
  // Only clear our own refusal: an audio or save error still deserves to be read.
  if (get(error)?.startsWith(FIELD_BLOCKED)) error.set(null);
  draft.update(fn);
}

// fields → YAML. Also cancels a pending parse: `loadTrack`/`newTrack` replace the
// draft wholesale, and a late commit would resurrect the previous track's text.
draft.subscribe(($d) => {
  if (fromYaml) return;
  clearTimeout(yamlTimer);
  typedYaml = null;
  yamlPending.set(false);
  yamlError.set(null);
  yamlText.set(serializeTrack($d));
});

// --- Layers ([SPEC-18.9]) --------------------------------------------------
//
// Layers are READ from the code, never written back: the pattern textarea keeps
// its formatting and stays the source of truth [SPEC-18.6]. They exist to solo,
// to mute, and to colour the roll.

/** `stack()` arguments of the current pattern; a single entry when not a stack. */
export const layers = derived(draft, ($d) => layersOf($d.patternSource));
/** Muted layer indices. */
export const mutedLayers = writable<Set<number>>(new Set());
/** Soloed layer, or null. Solo wins over mutes, as on a mixer. */
export const soloLayer = writable<number | null>(null);

/** Which layers are audible right now, with their indices. */
function enabledFlags(): boolean[] {
  const count = get(layers).length;
  const solo = get(soloLayer);
  const muted = get(mutedLayers);
  return Array.from({ length: count }, (_, i) => (solo !== null ? i === solo : !muted.has(i)));
}

/** Clear solo/mute — their indices only mean something for one pattern. */
export function resetLayerState(): void {
  mutedLayers.set(new Set());
  soloLayer.set(null);
}

export function toggleMute(index: number): void {
  mutedLayers.update((set) => {
    const next = new Set(set);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return next;
  });
  applyLayerChange();
}

export function toggleSolo(index: number): void {
  soloLayer.update((current) => (current === index ? null : index));
  applyLayerChange();
}

/** Sound first, drawing second: a solo must be audible immediately, not after the
 *  per-layer queries the redraw needs. [SPEC-18.9] */
function applyLayerChange(): void {
  void pushVoice();
  void analyse();
}

/** Wrap a pattern the way playback will hear it: transposed when asked. */
function withContext(pattern: string): string {
  const d = get(draft);
  if (!get(followContextKey) || !d.key) return pattern;
  const offset = transposeSemitones(d.key, get(contextKey));
  return offset === 0 ? pattern : `(${pattern}).add(note(${offset}))`;
}

/**
 * The pattern as it will be HEARD: vars substituted [SPEC-4.7], muted layers
 * removed [SPEC-18.9], then transposed to the context key when asked
 * [SPEC-18.12]. Both the audition and the derived view go through it, so the roll
 * can never show something other than what plays [SPEC-18.6].
 */
function currentPattern(): { pattern: string } | { missing: string[] } {
  const d = get(draft);
  const expanded = expandVars(d.patternSource, d.vars);
  if ('missing' in expanded) return expanded;
  return { pattern: withContext(patternForEnabled(expanded.pattern, enabledFlags())) };
}

/** Each audible layer as standalone, evaluable code (suffix and transposition
 *  preserved), with its index in the stack. */
function audibleLayers(): Array<{ index: number; code: string }> {
  const d = get(draft);
  const expanded = expandVars(d.patternSource, d.vars);
  if ('missing' in expanded) return [];
  const flags = enabledFlags();
  const all = layersOf(expanded.pattern);
  if (all.length < 2) {
    return flags[0] === false ? [] : [{ index: 0, code: withContext(expanded.pattern) }];
  }
  return all
    .map((_, index) => ({ index, code: withContext(layerAlone(expanded.pattern, index)) }))
    .filter(({ index }) => flags[index] !== false);
}

// --- Audio -----------------------------------------------------------------

/**
 * Register the Strudel evaluation scope. MUST run at mount, before any analysis:
 * `queryEvents`/`measureLengthBeats` await `scopeReady`, and without it every
 * pattern would fail with «s is not defined». Also arms the audio unlock, which
 * only listens for the NEXT mousedown — arming it from a click handler would
 * miss that very click. [SPEC-17.50]
 */
export function armEngine(): void {
  engine.arm();
}

/**
 * Unlock audio. MUST be called synchronously from a user gesture — the workshop
 * has its own AudioContext because it is a separate document [SPEC-18.3], so it
 * needs its own unlock. Reuses the engine's resume workaround. [SPEC-17.50]
 */
export async function unlockAudio(): Promise<void> {
  error.set(null);
  try {
    const ok = await engine.unlock();
    audioReady.set(ok);
    if (!ok) {
      error.set(`Audio verrouillé (AudioContext : ${engine.audioState}). Recliquez pour activer.`);
      return;
    }
    // Same banks as the instrument AND as the REPL, so what is written here
    // sounds identical everywhere. [SPEC-17.54]
    const banks = await loadAllBanks(engine);
    status.set(`Banques de sons chargées (${banks.loaded.length})`);
    if (banks.failed.length > 0) {
      error.set(
        `Banque(s) indisponible(s) : ${banks.failed.map((f) => `${f.label} (${f.message})`).join(' · ')}`,
      ); // [SPEC-14.3]
    }
    // A toast, not `error`: a missing GM import is a standing condition of the
    // machine, not a fault of the pattern being written. [SPEC-17.55]
    const sf = soundfontNotice(banks.soundfonts);
    if (sf) notify(sf.level, sf.text);
    // Only now can an unknown name be told apart from one not yet registered.
    void analyse();
  } catch (err) {
    error.set(`Activation audio impossible : ${(err as Error).message}`);
  }
}

/**
 * Audition the current pattern. Played through the engine's channel 0 with a
 * default (neutral) channel state, so it is heard dry AND exactly as the
 * instrument would render it [SPEC-18.5]. Nothing here touches the instrument:
 * in a separate document the engine is a fresh instance. [SPEC-18.3]
 */
export async function play(): Promise<void> {
  const expanded = currentPattern();
  if ('missing' in expanded) {
    error.set(`Variable non définie : ${expanded.missing.map((n) => `\${${n}}`).join(', ')}`);
    return;
  }
  error.set(null);
  // The moment silence would surprise: say it here, once, rather than on every
  // keystroke. [SPEC-17.56, SPEC-14.3]
  const missing = get(unknownSounds);
  if (missing.length > 0) {
    notify(
      'warn',
      `Son inconnu : ${missing.join(', ')} — rien ne sera joué pour ce nom. Vérifie le panneau « Sons ».`,
    );
  }
  try {
    engine.setCps(get(bpm) / 60 / BEATS_PER_CYCLE);
    await engine.setVoice(0, 0, expanded.pattern);
    lastPushed = expanded.pattern;
    await engine.startTransport();
    playing.set(true);
    // Follow the transport only while it runs. [SPEC-18.27]
    startPlayhead(() => get(bpm) / 60 / BEATS_PER_CYCLE);
  } catch (err) {
    playing.set(false);
    stopPlayhead();
    error.set(`Lecture impossible : ${(err as Error).message}`);
  }
}

export function stop(): void {
  engine.stopTransport();
  void engine.setVoice(0, 0, null);
  lastPushed = null;
  playing.set(false);
  stopPlayhead();
}

/** Code currently loaded in the voice, so an unchanged pattern is not re-evaluated. */
let lastPushed: string | null = null;

/**
 * Send the current pattern to the running voice. No-op while stopped.
 *
 * Called both on solo/mute — where it must be immediate, ahead of the redraw —
 * and at the end of `analyse()` for text edits, where it must wait for the code
 * to have proved it evaluates.
 */
async function pushVoice(): Promise<void> {
  if (!get(playing)) return;
  const expanded = currentPattern();
  if ('missing' in expanded) return; // keep the last good voice
  if (expanded.pattern === lastPushed) return;
  try {
    lastPushed = expanded.pattern;
    await engine.setVoice(0, 0, expanded.pattern);
    clearConditionError(); // it evaluates now [SPEC-18.24]
  } catch (err) {
    error.set(`Évaluation impossible : ${(err as Error).message}`); // never silent [SPEC-14.3]
  }
}

/** Apply a tempo change while playing, without restarting. */
export function applyBpm(value: number): void {
  bpm.set(value);
  engine.setCps(value / 60 / BEATS_PER_CYCLE);
}

// --- Derived views ---------------------------------------------------------

let analyseToken = 0;

/**
 * True once the user typed a phrase length by hand: their value then wins over the
 * automatic one, until the draft is replaced. [SPEC-18.21] Single source for that
 * state — a mirrored copy would drift.
 */
export const beatsIsManual = writable<boolean>(restored?.beatsManual === true);

beatsIsManual.subscribe(saveWorkspace);

/** Take over the phrase length manually. */
export function setBeatsManually(beats: number): void {
  beatsIsManual.set(true);
  updateDraft((d) => ({ ...d, beats }));
  void analyse(); // the view spans the declared phrase
}

/** Hand the phrase length back to the automatic rule. */
export function resumeAutoBeats(): void {
  beatsIsManual.set(false);
  void analyse();
}

/**
 * Re-derive the loop length and the roll from the pattern. [SPEC-18.8]
 * Runs on every edit; concurrent calls are ordered by token so a slow analysis
 * of stale text can never overwrite a newer result.
 */
export async function analyse(): Promise<void> {
  const token = ++analyseToken;
  const expanded = currentPattern();
  if ('missing' in expanded) {
    patternError.set(`Variable non définie : ${expanded.missing.map((n) => `\${${n}}`).join(', ')}`);
    return;
  }
  const code = expanded.pattern;
  if (code.trim() === '') {
    patternError.set(null);
    clearConditionError(); // nothing left to complain about [SPEC-18.24]
    roll.set(null);
    loopBeats.set(null);
    unknownSounds.set([]);
    return;
  }

  try {
    const beats = await engine.measureLengthBeats(code, BEATS_PER_CYCLE);
    if (token !== analyseToken) return;
    loopBeats.set(beats);

    // Declare the phrase automatically [SPEC-18.21], BEFORE spanning the view so
    // the roll is drawn at the length that was just decided. A value the user
    // typed themselves is never overwritten.
    const auto = phraseBeatsFor(beats);
    if (!get(beatsIsManual) && auto !== null && auto !== get(draft).beats) {
      draft.update((d) => ({ ...d, beats: auto }));
    }

    // The view spans the DECLARED phrase, twice, so the repeat is visible at the
    // length the author intends — not at the minimal period, which for `bd*8`
    // would show two beats and explain nothing.
    const span = spanCyclesFor(get(draft).beats);
    // Query each audible layer on its own so every event can be attributed to the
    // layer that produced it — that attribution is what makes solo/mute teach
    // anything. Superposition means a layer alone yields exactly the events it
    // contributes to the stack. [SPEC-18.9]
    const groups: LayerHaps[] = [];
    for (const { index, code: layerCode } of audibleLayers()) {
      groups.push({ layer: index, haps: await engine.queryEvents(layerCode, span) });
      if (token !== analyseToken) return;
    }
    roll.set(buildRoll(groups, span));
    // Notes on screen with no sound behind them is the confusion to prevent.
    unknownSounds.set(unknownSoundNames(groups));

    // Code highlighting needs events tied to the DISPLAYED text, so it takes its
    // own query — and only when the played code is that very text. [SPEC-18.27]
    const source = get(draft).patternSource;
    const highlightable = code === source;
    codeHighlightable.set(highlightable);
    if (highlightable) {
      const haps = await engine.queryEvents(source, span);
      if (token !== analyseToken) return;
      codeEvents.set(buildRoll([{ layer: 0, haps }], span).events);
    } else {
      codeEvents.set([]);
    }

    patternError.set(null);
    // The pattern evaluates and queries: every complaint about it is now stale,
    // including those raised elsewhere (playback, isolation). [SPEC-18.24]
    clearConditionError();

    // The measured period is NOT the declared `beats` and must never overwrite it.
    // `measureLengthBeats` finds the SMALLEST period: `s("bd*4")` repeats every
    // beat, yet the library declares it as a 4-beat track because `beats` states
    // the musical PHRASE length — what the instrument's progress gauge counts
    // [SPEC-17.10]. Both are shown; adopting the measured value is a click.
    // [SPEC-18.8]

    // What is HEARD must follow the text too [SPEC-18.6]. Pushed here, once the
    // code has proved it evaluates: a pattern broken mid-typing leaves the last
    // good voice playing instead of cutting the sound.
    await pushVoice();
  } catch (err) {
    if (token !== analyseToken) return;
    patternError.set((err as Error).message);
  }
}

// --- Library ---------------------------------------------------------------

/** Tracks available as starting points, grouped for the picker. [SPEC-18.11] */
export function libraryTracks(): Array<{ id: string; label: string }> {
  return library.manifest.map((t) => ({ id: t.id, label: `${t.category} · ${t.name}` }));
}

/** Load an existing track as the starting point. Keeps `vars` and the pattern as
 *  WRITTEN, so re-saving does not inline the reusable fragments. [SPEC-4.7] */
export function loadTrack(id: string): void {
  const track = library.getTrack(id);
  if (!track) {
    error.set(`Piste introuvable : ${id}`);
    return;
  }
  draft.set({
    name: track.name,
    beats: track.beats,
    patternSource: track.patternSource,
    vars: { ...track.vars },
    tags: [...track.tags],
    gain: track.gain,
    key: track.key,
  });
  category.set(track.category);
  slug.set(track.slug);
  sourceId.set(track.id); // remembered so a rename can be flagged [SPEC-18.15]
  resetLayerState(); // layer indices belonged to the previous pattern
  beatsIsManual.set(false); // the loaded file declares its own phrase [SPEC-18.21]
  status.set(`Chargé : ${track.category} · ${track.name}`);
  void refreshTargetExists();
  void analyse();
}

/** Start from scratch. */
export function newTrack(): void {
  draft.set(emptyDraft());
  slug.set('nouvelle-piste');
  status.set(null);
  sourceId.set(null);
  resetLayerState();
  beatsIsManual.set(false);
  void analyse();
}

// --- Writing to the library ------------------------------------------------

/** Name of the authorized folder, or null while saving is not possible yet. */
export const folder = writable<string | null>(null);
export const canWriteToDisk = isSupported();

/** Target id, `category/slug` — the identity the instrument binds pads to. */
export const targetId = derived([category, slug], ([$c, $s]) => `${$c}/${$s}`);

/**
 * Everything that must be settled before writing. [SPEC-18.16]
 * `blocking` prevents the write; `warnings` only require a confirmation.
 */
export const saveCheck = derived(
  [yamlText, category, slug, sourceId, targetId, patternError, yamlPending],
  ([$yaml, $category, $slug, $sourceId, $targetId, $patternError, $yamlPending]) => {
    const blocking: string[] = [];
    const warnings: string[] = [];

    // A YAML edit still waiting to be parsed means `patternError` describes the
    // PREVIOUS pattern; writing now could ship a pattern never evaluated once,
    // which [SPEC-18.16] forbids. It clears on its own after the debounce.
    if ($yamlPending) blocking.push('Édition YAML en cours d’analyse…');

    if (!/^[A-Za-z0-9](?:[A-Za-z0-9 _-]*[A-Za-z0-9])?$/.test($slug)) {
      blocking.push('Nom de fichier invalide (lettres, chiffres, espace, tiret, souligné).');
    }
    if (!/^[a-z0-9-]+$/.test($category)) {
      blocking.push('Catégorie invalide (minuscules, chiffres, tirets).');
    }
    // The same check the loader runs, so the workshop can never write a file the
    // instrument would then reject. [SPEC-4.6]
    const validated = validateTrackText($yaml);
    if (typeof validated === 'string') blocking.push(validated);
    // The pattern must have evaluated at least once.
    if ($patternError) blocking.push(`Pattern non évaluable : ${$patternError}`);

    if ($sourceId && $sourceId !== $targetId) {
      warnings.push(
        `L'identifiant change (${$sourceId} → ${$targetId}) : les pads associés à l'ancienne piste seront déliés.`,
      );
    }
    return { blocking, warnings };
  },
);

/** True when the target file already exists — refreshed on demand (an async
 *  check cannot live inside a derived store). */
export const targetExists = writable<boolean>(false);

export async function refreshTargetExists(): Promise<void> {
  targetExists.set(await trackExists(get(category), get(slug)));
}

/** Warning about the folder just chosen — wrong level, most often. [SPEC-18.15] */
export const folderWarning = writable<string | null>(null);

/** Choose the library folder. MUST be called from a user gesture. Always reopens
 *  the picker, so a wrong choice can be corrected. */
export async function pickFolder(): Promise<void> {
  error.set(null);
  try {
    const chosen = await chooseFolder();
    folder.set(chosen.name);
    folderWarning.set(chosen.problem);
    await refreshTargetExists();
    status.set(`Dossier : ${chosen.name}`);
  } catch (err) {
    // A cancelled picker is a choice, not a failure worth shouting about.
    const message = (err as Error).message;
    if ((err as Error).name !== 'AbortError') error.set(`Dossier inaccessible : ${message}`);
  }
}

/** Reattach a previously authorized folder, silently. Call at mount. */
export async function restoreSavedFolder(): Promise<void> {
  folder.set(await restoreFolder());
  if (get(folder)) await refreshTargetExists();
}

/**
 * Write the track to `library/<category>/<slug>.track.yaml`. [SPEC-18.15]
 * Refuses on any blocking check; `confirmed` acknowledges the warnings and the
 * overwrite. The dev server's watcher then picks the file up and the instrument
 * reloads with it. [SPEC-18.17]
 */
export async function save(confirmed: boolean): Promise<boolean> {
  error.set(null);
  flushYamlEdit(); // adopt a just-typed YAML before checking it, never write behind
  const check = get(saveCheck);
  if (check.blocking.length > 0) {
    error.set(check.blocking.join(' · '));
    return false;
  }
  if (!confirmed && (check.warnings.length > 0 || get(targetExists))) return false;

  try {
    const path = await writeTrack(get(category), get(slug), get(yamlText));
    sourceId.set(get(targetId));
    await refreshTargetExists();
    status.set(`Enregistré : ${path}`);
    return true;
  } catch (err) {
    error.set(`Enregistrement impossible : ${(err as Error).message}`);
    return false;
  }
}

/** Fallback when the browser cannot write to a folder: download the file. */
export function download(): void {
  const blob = new Blob([get(yamlText)], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${get(slug)}.track.yaml`;
  a.click();
  URL.revokeObjectURL(url);
  status.set(`Téléchargé — à déposer dans library/${get(category)}/`);
}
