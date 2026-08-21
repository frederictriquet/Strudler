// [SPEC-18.10] Audition a sound from the browser: hearing a sample before writing
// its name is the whole point of browsing 1000+ sounds.
//
// Two constraints shape the mechanism:
//
// 1. The workshop's loop is voice `0:0` [SPEC-18.5]. An audition MUST NOT touch
//    it, so it gets a slot of its own and is released right after.
// 2. A Strudel pattern is a function of time: `s("bd")` fires at EVERY cycle,
//    there is no "play once" pattern. The audition is therefore a voice that
//    lives for LESS THAN ONE CYCLE — exactly one onset gets scheduled, and the
//    voice is removed before the next one is queried. Removing a voice does not
//    cancel what superdough has already scheduled, so the sample still rings out
//    in full. Calling superdough directly for a single event would be exact, but
//    would open a second Strudel touch point outside the engine ([PLAN F]).
//
// The audition rides the same channel chain as the loop, so a sound is heard the
// way it will play [SPEC-18.5].

import { engine } from '@core/engine/StrudelEngine';
import { soundKey, type SoundEntry } from '@core/composer/sounds';
import { loadAllBanks } from '@core/engine/sampleBanks';

const PREVIEW_CHANNEL = 0;
/** Slot reserved for auditions — never 0, which carries the loop being written. */
const PREVIEW_SLOT = 7;
const BEATS_PER_CYCLE = 4;

/**
 * How far ahead the onset is placed when the transport is ALREADY running.
 * The Cyclist queries roughly 0.2 s ahead of real time (tick 0.05 s + interval
 * 0.1 s + overlap 0.1 s); an onset closer than that is simply never queried,
 * which would be silence rather than a late note.
 */
const LEAD_S = 0.3;
/**
 * Kept alive after the onset, long enough for the scheduler to have queried it.
 * Total life (LEAD_S + HOLD_S = 0.65 s) stays under one cycle — 1.09 s at 220 BPM,
 * the fastest the workshop accepts — which is what guarantees a single hit.
 */
const HOLD_S = 0.35;
/** Pitched sounds are mapped by note name: audition them in a plainly audible register. */
const PREVIEW_NOTE = 'c3';

/** Loaded once per document; `samples()` is what makes sample names resolve. */
let samplesLoaded: Promise<void> | null = null;

/** Identifies the current audition, so a new click supersedes the pending release. */
let currentToken = 0;
/** True while the transport is running only because an audition started it. */
let startedByPreview = false;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What is actually played: a single hit, on a real note for pitched instruments,
 *  on the requested variant for indexed ones. [SPEC-18.29] */
function previewCode(entry: SoundEntry, index?: number): string {
  return entry.kind === 'pitched'
    ? `note("${PREVIEW_NOTE}").s("${entry.name}")`
    : `s("${soundKey(entry.name, index)}")`;
}

/** Shift the pattern so its onset lands just ahead of the scheduler's read head. */
function nudged(code: string, cps: number): string {
  const target = engine.now() + LEAD_S * cps; // cycles
  const offset = target - Math.floor(target); // onsets move from n to n + offset
  return `(${code}).late(${offset.toFixed(4)})`;
}

/**
 * Unlock audio and load the bank. MUST be reached synchronously from a click:
 * `engine.unlock()` resumes the AudioContext, which the browser only grants
 * inside a user gesture [SPEC-17.50]. Throws a message fit for the UI [SPEC-14.3].
 */
async function ensureAudio(): Promise<void> {
  const ok = await engine.unlock();
  if (!ok) {
    throw new Error(
      `Audio verrouillé (AudioContext : ${engine.audioState}). Recliquez pour activer le son.`,
    );
  }
  if (!samplesLoaded) {
    samplesLoaded = loadAllBanks(engine)
      .then((result) => {
        if (result.loaded.length === 0) {
          samplesLoaded = null; // a failed load must not poison every later audition
          throw new Error('Aucune banque de sons chargée — les échantillons restent muets.');
        }
      })
      .catch((err: Error) => {
        samplesLoaded = null;
        throw err;
      });
  }
  await samplesLoaded;
}

/** Free the audition slot, and stop the transport only if we are the ones who
 *  started it and nothing else is playing — the workshop's `playing` state is
 *  owned by its store, never by an audition. */
async function release(): Promise<void> {
  await engine.setVoice(PREVIEW_CHANNEL, PREVIEW_SLOT, null);
  if (startedByPreview && !engine.hasVoices) {
    engine.stopTransport();
    startedByPreview = false;
  }
}

/**
 * Loop a fragment on its own until {@link stopIsolate}. [SPEC-18.13]
 *
 * Uses the audition slot, never the loop's slot 0: isolating a fragment must not
 * destroy the pattern being written — you compare the part against the whole.
 */
export async function startIsolate(code: string): Promise<void> {
  await ensureAudio();
  // Supersede any pending audition: its delayed release must not free the slot
  // under the fragment we are about to loop.
  currentToken++;
  await engine.setVoice(PREVIEW_CHANNEL, PREVIEW_SLOT, code);
  if (!engine.isTransportRunning) {
    startedByPreview = true;
    await engine.startTransport();
  }
}

/** Stop isolating and give the slot back. */
export async function stopIsolate(): Promise<void> {
  currentToken++;
  await release();
}

/**
 * Play ONE hit of an arbitrary pattern and clean up after itself. Resolves once
 * the audition is over (≈0.65 s), so the caller can light what is sounding.
 *
 * `bpm` is the workshop's audition tempo [SPEC-18.12]; it only converts the lead
 * time into cycles — the engine's tempo is never changed here, so a loop playing
 * in slot 0 keeps its own tempo and is not interrupted.
 *
 * MUST be reached synchronously from a click: `ensureAudio` resumes the
 * AudioContext, which browsers only grant inside a user gesture [SPEC-17.50].
 * Throws when audio cannot be unlocked or the bank cannot be loaded.
 */
export async function previewPattern(pattern: string, bpm: number): Promise<void> {
  await ensureAudio();

  const token = ++currentToken;
  const cps = bpm / 60 / BEATS_PER_CYCLE;
  const wasRunning = engine.isTransportRunning;
  // Transport stopped: starting it rewinds the scheduler to cycle 0, so the plain
  // pattern already fires at once. Transport running: the onset has to be placed
  // ahead of what the scheduler has queried, hence the nudge.
  const code = wasRunning ? nudged(pattern, cps) : pattern;

  await engine.setVoice(PREVIEW_CHANNEL, PREVIEW_SLOT, code);
  if (token !== currentToken) return; // superseded: the newer audition owns the slot
  if (!wasRunning) {
    startedByPreview = true;
    await engine.startTransport();
  }

  await sleep(((wasRunning ? LEAD_S : 0) + HOLD_S) * 1000);
  if (token !== currentToken) return; // a newer audition will release the slot
  await release();
}

/** Play one hit of `entry`. See {@link previewPattern}. */
export async function previewSound(entry: SoundEntry, bpm: number, index?: number): Promise<void> {
  await previewPattern(previewCode(entry, index), bpm);
}
