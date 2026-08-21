// [SPEC-12, SPEC-17.55] Import the General MIDI soundfonts into the local, offline
// sound library — the `gm_*` instruments the strudel.cc REPL plays.
//
// `@strudel/soundfonts` streams its presets from felixroos.github.io at play time.
// Strudler must not depend on that: a set is played offline [SPEC-14.4], and a
// cache is not availability — it holds what happened to be played before, and
// only until the browser decides otherwise. So every preset is copied to disk
// ONCE, here, and the app is pointed at the local copy instead of the CDN.
//
// A preset is a JavaScript file (`<name>_sf2_file={…}`) carrying base64 samples;
// the loader in @strudel/soundfonts fetches it as text and parses it. Nothing is
// transformed here: the file is stored verbatim, so it stays byte-identical to
// what the REPL loads and the `n()` index picks the very same instrument variant.
//
// Usage:
//   node scripts/fetch-soundfonts.mjs [options]
//     --default-only     the first variant of each instrument only (125 files, ~10 Mo)
//     --concurrency=8    parallel downloads
//     --force            re-download files that already exist
//     --dry-run          plan only, no network write
//     --list             show the instruments and exit
//
// Destination: $STRUDLER_SOUNDS_DIR/soundfonts (or ~/Music/Sounds/soundfonts).
// Re-runnable: existing files are skipped, so an interrupted import resumes.
// Full import: 869 presets, ~94 Mo.

import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import gm from '@strudel/soundfonts/gm.mjs';

/** Where @strudel/soundfonts reads its presets from by default (fontloader.mjs). */
const BASE = 'https://felixroos.github.io/webaudiofontdata/sound';

/** Folder name under the sounds library. Holds no audio, so the sample-map scanner
 *  in vite-plugins/soundsServer.ts ignores it — it only serves the files. */
export const SOUNDFONT_DIR = 'soundfonts';

// ---------------------------------------------------------------- CLI arguments

function parseArgs(argv) {
  const opts = { defaultOnly: false, concurrency: 8, force: false, dryRun: false, list: false };
  for (const arg of argv) {
    if (arg === '--list') opts.list = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--default-only') opts.defaultOnly = true;
    else if (arg.startsWith('--concurrency=')) opts.concurrency = Number(arg.slice(14));
    else fail(`option inconnue : ${arg}`);
  }
  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1)
    fail(`--concurrency doit être un entier ≥ 1 (reçu : ${opts.concurrency})`);
  return opts;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function soundsDir() {
  return process.env.STRUDLER_SOUNDS_DIR || join(homedir(), 'Music', 'Sounds');
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} Mo`;

// ------------------------------------------------------------------- the plan

/** Every preset name to fetch, deduplicated. Instruments share variants, so the
 *  870 references collapse to 869 files. */
function planPresets(defaultOnly) {
  const names = new Set();
  for (const variants of Object.values(gm)) {
    if (defaultOnly) names.add(variants[0]);
    else for (const v of variants) names.add(v);
  }
  return [...names].sort();
}

// ---------------------------------------------------------------- downloading

async function downloadOne(dir, name, force) {
  const abs = join(dir, `${name}.js`);
  if (!force && existsSync(abs) && statSync(abs).size > 0) return { skipped: true, bytes: 0 };

  const tmp = `${abs}.part`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/${name}.js`);
      if (res.status === 404) return { missing: true, bytes: 0 };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // The loader splits on `={` and evaluates the rest; a truncated or HTML
      // response would fail at PLAY time, in the middle of a set. Refuse it now.
      if (!text.includes('={')) throw new Error('contenu inattendu (pas un preset webaudiofont)');
      writeFileSync(tmp, text, 'utf8');
      renameSync(tmp, abs); // atomic: an interrupted run never leaves a half file
      return { bytes: Buffer.byteLength(text) };
    } catch (err) {
      lastErr = err;
      rmSync(tmp, { force: true });
    }
  }
  return { failed: lastErr.message, bytes: 0 };
}

// ------------------------------------------------------------------------ main

const opts = parseArgs(process.argv.slice(2));

if (opts.list) {
  const rows = Object.entries(gm).map(([name, v]) => `  ${name.padEnd(28)} ${v.length} variante(s)`);
  console.log(`\n${Object.keys(gm).length} instruments General MIDI :\n${rows.join('\n')}\n`);
  process.exit(0);
}

const presets = planPresets(opts.defaultOnly);
const dir = join(soundsDir(), SOUNDFONT_DIR);

console.log(`\nSoundfonts General MIDI — ${Object.keys(gm).length} instruments`);
console.log(`  presets à récupérer : ${presets.length}${opts.defaultOnly ? ' (variante par défaut seulement)' : ''}`);
console.log(`  destination         : ${dir}`);
if (opts.dryRun) {
  console.log('\n--dry-run : rien n’est téléchargé.\n');
  process.exit(0);
}

mkdirSync(dir, { recursive: true });

const queue = [...presets];
const stats = { done: 0, written: 0, skipped: 0, bytes: 0, missing: [], failed: [] };

async function worker() {
  while (queue.length) {
    const name = queue.shift();
    const r = await downloadOne(dir, name, opts.force);
    stats.done += 1;
    stats.bytes += r.bytes;
    if (r.skipped) stats.skipped += 1;
    else if (r.missing) stats.missing.push(name);
    else if (r.failed) stats.failed.push(`${name} : ${r.failed}`);
    else stats.written += 1;
    if (stats.done % 50 === 0 || stats.done === presets.length) {
      process.stdout.write(`\r  ${stats.done}/${presets.length} — ${mb(stats.bytes)} téléchargés   `);
    }
  }
}

await Promise.all(Array.from({ length: opts.concurrency }, worker));
process.stdout.write('\n');

console.log(`\n✓ ${stats.written} preset(s) écrit(s), ${stats.skipped} déjà présent(s) — ${mb(stats.bytes)}`);

// Presets listed by @strudel/soundfonts but absent upstream. They are absent on
// strudel.cc too, so the variant lists are left untouched: shifting them would
// make `n()` pick a different instrument here than in the REPL. Reported, not hidden.
if (stats.missing.length) {
  console.log(`\n⚠ ${stats.missing.length} preset(s) absent(s) chez l’éditeur (identique sur strudel.cc) :`);
  for (const name of stats.missing) console.log(`    ${name}`);
  console.log('  Les variantes correspondantes de n() resteront muettes, ici comme dans le REPL.');
}

if (stats.failed.length) {
  console.error(`\n✖ ${stats.failed.length} échec(s) après 3 tentatives :`);
  for (const line of stats.failed) console.error(`    ${line}`);
  console.error('\nRelance la commande : les fichiers déjà là sont ignorés.\n');
  process.exit(1);
}

console.log(`\nLes ${Object.keys(gm).length} instruments gm_* sont maintenant sur le disque.\n`);
