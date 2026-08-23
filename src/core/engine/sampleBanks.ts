// [SPEC-12, SPEC-17.54] Sample banks, and the order in which they are registered.
//
// Goal: a pattern must sound THE SAME in Strudler and in the official Strudel
// REPL. That is not a matter of engine but of inventory — `s("hh")` resolved to
// the local dirt-samples folder here and to uzu-drumkit there, so `n("4")` picked
// two unrelated files.
//
// The list below mirrors the REPL's own prebake (`website/src/repl/prebake.mjs`
// in the Strudel sources, kept under `study/`). It must be revisited when Strudel
// changes its defaults — there is no way to read it from the packages, the list
// lives in the website, not in `@strudel/*`.
//
// ORDER MATTERS. `registerSound()` does `soundMap.setKey(name, …)`, so a later
// registration REPLACES an earlier one for the same name — it does not merge.
// The local bank therefore goes FIRST and the REPL banks after: shared names
// (`hh`, `bd`, `piano`, …) end up identical to the REPL, while everything the
// user owns and the REPL does not (`jvbass`, `arpy`, `808sd`, personal folders)
// survives untouched.
//
// Cost: only the JSON maps are fetched here. Audio files are loaded lazily on
// first trigger, so this stays a handful of small requests. The performance
// itself remains offline [SPEC-14.4] — the Service Worker caches what was used.

/** The user-owned folder served by `vite-plugins/soundsServer.ts`. [SPEC-12.1] */
export const LOCAL_BANK_URL = '/sounds/strudel.json';

/**
 * Local General MIDI presets, populated by `npm run samples:soundfonts`.
 * [SPEC-17.55]
 *
 * `@strudel/soundfonts` streams from felixroos.github.io by default. Pointing it
 * here is what makes `gm_*` usable on stage: a cache holds what was played
 * before, for as long as the browser allows — that is not availability
 * [SPEC-14.4]. The folder holds no audio files, so the sample-map scanner ignores
 * it and only serves the presets.
 */
export const SOUNDFONT_URL = '/sounds/soundfonts';

/** First variant of `gm_piano` in `@strudel/soundfonts/gm.mjs`. Used only to ask
 *  «are the presets on this disk?» before registering 125 instruments that would
 *  otherwise fail one by one, at play time. */
const SOUNDFONT_PROBE = '0000_JCLive_sf2_file';

const CDN = 'https://strudel.b-cdn.net';

export interface SampleBank {
  /** Shown to the user when a bank fails to load. */
  label: string;
  url: string;
  /** Prefix for the relative paths inside the map. */
  base?: string;
}

/**
 * Exactly what the REPL preloads, in its order. Names colliding with the local
 * bank are won by these — that is the point.
 */
export const REPL_BANKS: SampleBank[] = [
  { label: 'piano', url: `${CDN}/piano.json`, base: `${CDN}/piano/` },
  { label: 'VCSL', url: `${CDN}/vcsl.json`, base: `${CDN}/VCSL/` },
  {
    label: 'tidal-drum-machines',
    url: `${CDN}/tidal-drum-machines.json`,
    base: `${CDN}/tidal-drum-machines/machines/`,
  },
  { label: 'uzu-drumkit', url: `${CDN}/uzu-drumkit.json`, base: `${CDN}/uzu-drumkit/` },
  { label: 'uzu-wavetables', url: `${CDN}/uzu-wavetables.json`, base: `${CDN}/uzu-wavetables/` },
  { label: 'mridangam', url: `${CDN}/mridangam.json`, base: `${CDN}/mrid/` },
];

/**
 * Name under which superdough actually registers — and looks up — a sound.
 * [SPEC-17.56.1]
 *
 * Measured in `superdough/dist/index.mjs`: `registerSound` stores
 * `name.toLowerCase().replace(/\s+/g, '_')`, and `getSound` reads
 * `soundMap.get()[name.toLowerCase()]`. A name differing only by case therefore
 * PLAYS PERFECTLY while a raw string comparison against the registry says it does
 * not exist — which is exactly what flagged every drum machine (`BossDR110_cr`,
 * `RolandTR909_bd`: 71 machines of camel-cased names) as unknown.
 *
 * Any comparison with the registry must go through this function, on BOTH sides.
 */
export function normalizeSoundName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_');
}

let registered = false;

/**
 * True once `loadAllBanks` has completed at least once. [SPEC-17.56]
 *
 * Before that the registry holds only the synth names, so every sample name would
 * look unknown. Kept HERE rather than in the caller: several paths load the banks
 * (instrument startup, workshop unlock, sound preview) and a flag owned by one of
 * them silently disables the check for the others.
 */
export function areBanksRegistered(): boolean {
  return registered;
}

/** Outcome of a full load: partial success is the normal degraded mode. */
export interface BankLoadResult {
  loaded: string[];
  failed: Array<{ label: string; message: string }>;
  soundfonts: SoundfontState;
}

/**
 * Are the GM presets on this machine? Asked once, before registering anything.
 *
 * Registering 125 instruments whose presets are missing would produce 125 sounds
 * that appear in the browser and stay silent when triggered — the exact trap this
 * whole path exists to remove.
 */
async function soundfontsPresent(): Promise<SoundfontState> {
  try {
    const res = await fetch(`${SOUNDFONT_URL}/${SOUNDFONT_PROBE}.js`, { method: 'HEAD' });
    if (res.status === 404) return { kind: 'absent' };
    if (!res.ok) return { kind: 'error', message: `HTTP ${res.status}` };
    return { kind: 'ok' };
  } catch (err) {
    return { kind: 'error', message: (err as Error).message };
  }
}

/** Minimal view of the engine this module needs, so it stays testable and does
 *  not drag the whole engine into its type surface. */
export interface BankLoader {
  loadSamples(source: string, base?: string): Promise<void>;
  registerSoundfonts(baseUrl: string): Promise<void>;
}

/** Why `gm_*` is or is not available — reported, never guessed at. [SPEC-14.3] */
export type SoundfontState =
  | { kind: 'ok' }
  /** The folder is empty: the import command has not been run. */
  | { kind: 'absent' }
  | { kind: 'error'; message: string };

/**
 * Register every bank, local first. [SPEC-17.54]
 *
 * Each bank is awaited on its own and a failure is COLLECTED rather than thrown:
 * one unreachable CDN must not cost the user their local sounds, and a silent
 * partial load would be worse — the caller reports what is missing [SPEC-14.3].
 */
export async function loadAllBanks(engine: BankLoader): Promise<BankLoadResult> {
  const banks: SampleBank[] = [{ label: 'banque locale', url: LOCAL_BANK_URL }, ...REPL_BANKS];
  const result: BankLoadResult = { loaded: [], failed: [], soundfonts: { kind: 'absent' } };
  for (const bank of banks) {
    try {
      await engine.loadSamples(bank.url, bank.base);
      result.loaded.push(bank.label);
    } catch (err) {
      result.failed.push({ label: bank.label, message: (err as Error).message });
    }
  }

  // Soundfonts last: `registerSound` overwrites by name, and `gm_*` collides with
  // nothing, so the order is free — but registering after the banks keeps the
  // reported inventory in the same order the user reads it. [SPEC-17.55]
  result.soundfonts = await soundfontsPresent();
  if (result.soundfonts.kind === 'ok') {
    try {
      await engine.registerSoundfonts(SOUNDFONT_URL);
      result.loaded.push('soundfonts GM');
    } catch (err) {
      result.soundfonts = { kind: 'error', message: (err as Error).message };
    }
  }
  registered = registered || result.loaded.length > 0;
  return result;
}

/**
 * The one sentence to show about the GM instruments, or null when there is
 * nothing to say. [SPEC-17.55]
 *
 * Lives here rather than in a store so both pages say exactly the same thing,
 * and so `core/` keeps its distance from the UI: the caller decides how to show
 * it [PLAN B].
 */
export function soundfontNotice(
  state: SoundfontState,
): { level: 'warn' | 'error'; text: string } | null {
  if (state.kind === 'ok') return null; // already counted among the loaded banks
  if (state.kind === 'absent') {
    return {
      level: 'warn',
      text:
        'Instruments General MIDI (gm_*) absents du disque — lance ' +
        '« npm run samples:soundfonts » (~140 Mo, une seule fois).',
    };
  }
  return { level: 'error', text: `Soundfonts GM indisponibles : ${state.message}` };
}
