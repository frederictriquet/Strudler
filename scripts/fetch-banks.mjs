// [SPEC-12, SPEC-17.27] Import the official Strudel sample banks (the ones the
// strudel.cc REPL streams from GitHub) into the local, offline sound library.
//
// Each bank is described by a curated Strudel sample map in felixroos/dough-samples:
// sound name -> list of files (index-selected with n()) or note -> file (pitch-mapped
// instrument). Files are laid out as <soundsDir>/<bank>/<sound>/<file> so that the
// scanner in vite-plugins/soundsServer.ts rebuilds the very same map: the leaf folder
// name is the sound name, note-named files become a pitch-mapped instrument
// [SPEC-17.18], and list entries keep the map's order via a NN_ prefix (sorted scan)
// so n(i) picks the same sample as on strudel.cc.
//
// Usage:
//   node scripts/fetch-banks.mjs [bank...] [options]
//     bank             vcsl | drum-machines | mridangam (default: all)
//     --format=ogg     ogg (Opus, default) | mp3 | wav (no conversion)
//     --concurrency=6  parallel downloads
//     --force          re-download/re-encode files that already exist
//     --dry-run        plan only, no network write
//     --list           show the banks and exit
//
// Destination: $STRUDLER_SOUNDS_DIR (or ~/Music/Sounds). Re-runnable: existing files
// are skipped, so an interrupted import resumes where it stopped.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';

const DOUGH = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/';

const BANKS = {
  vcsl: {
    map: 'vcsl.json',
    label: 'VCSL — Versilian Community Sample Library (CC0), tab "samples" of strudel.cc',
    // The official map has 8 broken paths (sound "tom_mallet"): the Hornbostel-Sachs
    // class prefix is missing, so they 404 — on strudel.cc too. Repaired here.
    fixPath: (p) => (p.startsWith('Struck%20Membranophones/') ? `Membranophones/${p}` : p),
  },
  'drum-machines': {
    map: 'tidal-drum-machines.json',
    // 71 machines, EmuSP12 included — Strudel's separate EmuSP12.json is the very
    // same files under the very same EmuSP12_* names, so it is not a bank of its own.
    label: 'tidal-drum-machines — 71 machines (TR-808/909, LinnDrum, SP-12…), .bank("RolandTR909")',
  },
  mridangam: {
    map: 'mridangam.json',
    label: 'mridangam (yaxu/mrid) — indian percussion',
  },
};

const AUDIO_EXT = new Set(['.wav', '.ogg', '.mp3', '.flac', '.aif', '.aiff', '.m4a']);
const ENCODERS = {
  ogg: { ext: '.ogg', args: ['-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on'] },
  mp3: { ext: '.mp3', args: ['-c:a', 'libmp3lame', '-q:a', '2'] },
};

// ---------------------------------------------------------------- CLI arguments

function parseArgs(argv) {
  const opts = { banks: [], format: 'ogg', concurrency: 6, force: false, dryRun: false, list: false };
  for (const arg of argv) {
    if (arg === '--list') opts.list = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--format=')) opts.format = arg.slice(9);
    else if (arg.startsWith('--concurrency=')) opts.concurrency = Number(arg.slice(14));
    else if (arg.startsWith('-')) fail(`option inconnue : ${arg}`);
    else if (BANKS[arg]) opts.banks.push(arg);
    else fail(`banque inconnue : ${arg} (connues : ${Object.keys(BANKS).join(', ')})`);
  }
  if (!opts.banks.length) opts.banks = Object.keys(BANKS);
  if (!['ogg', 'mp3', 'wav'].includes(opts.format)) fail(`format inconnu : ${opts.format}`);
  if (!Number.isInteger(opts.concurrency) || opts.concurrency < 1)
    fail(`--concurrency doit être un entier ≥ 1 (reçu : ${opts.concurrency})`);
  return opts;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

// -------------------------------------------------------------------- utilities

function soundsDir() {
  return process.env.STRUDLER_SOUNDS_DIR || join(homedir(), 'Music', 'Sounds');
}

/** Sound names already in the library, so a bank never silently merges into one
 *  (the scanner keys sounds by leaf folder name and concatenates duplicates). */
function existingSoundNames(root) {
  const names = new Set();
  if (!existsSync(root)) return names;
  const scan = (dir, isRoot) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`⚠ dossier illisible, ignoré : ${dir} (${err.message})`);
      return;
    }
    if (!isRoot && entries.some((e) => e.isFile() && AUDIO_EXT.has(extname(e.name).toLowerCase())))
      names.add(basename(dir));
    for (const e of entries) if (e.isDirectory()) scan(join(dir, e.name), false);
  };
  scan(root, true);
  return names;
}

/** Strudel note key -> note-named file stem the scanner understands ("A#0" -> "As0"). */
function noteStem(note) {
  const m = /^([A-Ga-g])(#|s)?(-?\d)$/.exec(note);
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2] ? 's' : ''}${m[3]}`;
}

function padWidth(n) {
  return String(Math.max(n - 1, 0)).length;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.json();
}

// ------------------------------------------------------------------- the plan

/** Turn a bank's Strudel map into a flat list of {url, dir, file} download tasks. */
function planBank(bank, map, taken) {
  const base = map._base;
  if (typeof base !== 'string') throw new Error(`_base manquant dans la map de ${bank}`);
  const prefix = BANKS[bank].prefix ?? '';
  const fixPath = BANKS[bank].fixPath ?? ((p) => p);
  const tasks = [];
  const renamed = [];
  let pitchMapped = 0;

  for (const [rawName, value] of Object.entries(map)) {
    if (rawName === '_base') continue;
    let name = prefix + rawName;
    if (taken.has(name)) {
      // Name already used by another folder: suffix it rather than merge blindly.
      name = `${name}_${bank}`;
      renamed.push(`${prefix + rawName} → ${name}`);
    }
    taken.add(name);
    const dir = join(bank, name);

    if (Array.isArray(value)) {
      const width = padWidth(value.length);
      value.forEach((path, i) => {
        // NN_ prefix: the scanner sorts alphabetically, this keeps the map's order
        // so n(0), n(1)… select the same samples as strudel.cc.
        const stem = String(i).padStart(width, '0') + '_' + stemOf(path);
        tasks.push({ url: base + fixPath(path), dir, stem, srcExt: extname(decodeURIComponent(path)).toLowerCase() });
      });
    } else if (value && typeof value === 'object') {
      pitchMapped++;
      for (const [note, path] of Object.entries(value)) {
        const paths = Array.isArray(path) ? path : [path];
        const stem = noteStem(note);
        if (!stem) throw new Error(`note non reconnue dans ${bank}/${rawName} : ${note}`);
        if (paths.length > 1)
          console.warn(`⚠ ${bank}/${name} : ${paths.length} fichiers pour ${note}, seul le premier est gardé`);
        tasks.push({
          url: base + fixPath(paths[0]),
          dir,
          stem,
          srcExt: extname(decodeURIComponent(paths[0])).toLowerCase(),
        });
      }
    } else {
      throw new Error(`entrée inattendue ${bank}/${rawName} : ${typeof value}`);
    }
  }
  return { tasks, renamed, pitchMapped, sounds: Object.keys(map).length - 1 };
}

function stemOf(urlPath) {
  const name = decodeURIComponent(basename(urlPath));
  return name.replace(/\.[^.]+$/, '').replace(/[/\\]/g, '_');
}

// ---------------------------------------------------------------- downloading

function targetPath(root, task, format) {
  const ext = format === 'wav' || task.srcExt === ENCODERS[format]?.ext ? task.srcExt : ENCODERS[format].ext;
  return { abs: join(root, task.dir, task.stem + ext), converts: ext !== task.srcExt };
}

async function downloadOne(root, task, format, force) {
  const { abs, converts } = targetPath(root, task, format);
  if (!force && existsSync(abs) && statSync(abs).size > 0) return { skipped: true, bytes: 0 };

  mkdirSync(join(root, task.dir), { recursive: true });
  const tmp = abs + (converts ? `.src${task.srcExt}` : '.part');

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(task.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error('réponse vide');
      writeFileSync(tmp, buf);
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  if (lastErr) {
    rmSync(tmp, { force: true });
    throw new Error(`téléchargement échoué : ${lastErr.message}`);
  }

  try {
    if (converts) {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, ...ENCODERS[format].args, abs], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } else {
      renameSync(tmp, abs);
    }
  } catch (err) {
    rmSync(abs, { force: true });
    throw new Error(`conversion ffmpeg échouée : ${(err.stderr?.toString() || err.message).trim()}`);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { skipped: false, bytes: statSync(abs).size };
}

/** Run tasks with a bounded number of workers, reporting progress as it goes. */
async function runPool(root, tasks, opts, onProgress) {
  const errors = [];
  let done = 0;
  let written = 0;
  let skipped = 0;
  let bytes = 0;
  let next = 0;

  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      try {
        const r = await downloadOne(root, task, opts.format, opts.force);
        if (r.skipped) skipped++;
        else written++;
        bytes += r.bytes;
      } catch (err) {
        errors.push({ url: task.url, message: err.message });
      }
      onProgress(++done, tasks.length, written, skipped, errors.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(opts.concurrency, tasks.length) }, worker));
  return { errors, written, skipped, bytes };
}

// ---------------------------------------------------------------------- main

const opts = parseArgs(process.argv.slice(2));

if (opts.list) {
  console.log('Banques disponibles :');
  for (const [name, b] of Object.entries(BANKS)) console.log(`  ${name.padEnd(15)} ${b.label}`);
  process.exit(0);
}

if (opts.format !== 'wav') {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    fail(`ffmpeg est requis pour --format=${opts.format} (brew install ffmpeg), ou utilise --format=wav`);
  }
}

const root = soundsDir();
mkdirSync(root, { recursive: true });
const taken = existingSoundNames(root);

console.log(`Bibliothèque : ${root}`);
console.log(`Banques      : ${opts.banks.join(', ')}`);
console.log(`Format       : ${opts.format}${opts.format === 'wav' ? '' : ' (conversion ffmpeg)'}\n`);

let totalWritten = 0;
let totalSkipped = 0;
let totalBytes = 0;
const allErrors = [];

for (const bank of opts.banks) {
  // A bank re-imported keeps its own folder names: drop them from `taken` first,
  // otherwise a second run would suffix everything (vcsl/sax → sax_vcsl_vcsl).
  const bankRoot = join(root, bank);
  if (existsSync(bankRoot)) for (const n of existingSoundNames(bankRoot)) taken.delete(n);

  let map;
  try {
    map = await fetchJson(DOUGH + BANKS[bank].map);
  } catch (err) {
    allErrors.push({ url: DOUGH + BANKS[bank].map, message: err.message });
    console.error(`✖ ${bank} : map introuvable (${err.message}) — banque ignorée`);
    continue;
  }

  let plan;
  try {
    plan = planBank(bank, map, taken);
  } catch (err) {
    allErrors.push({ url: bank, message: err.message });
    console.error(`✖ ${bank} : map illisible (${err.message}) — banque ignorée`);
    continue;
  }

  console.log(
    `▶ ${bank} — ${plan.sounds} sons (${plan.pitchMapped} mappés par note), ${plan.tasks.length} fichiers`,
  );
  for (const r of plan.renamed) console.log(`  ↳ collision de nom, renommé : ${r}`);

  if (opts.dryRun) {
    console.log(`  (dry-run) exemple : ${plan.tasks[0]?.dir}/${plan.tasks[0]?.stem}\n`);
    continue;
  }

  const started = Date.now();
  const res = await runPool(root, plan.tasks, opts, (done, total, written, skipped, errs) => {
    if (done % 25 === 0 || done === total) {
      const pct = Math.round((done / total) * 100);
      process.stdout.write(`\r  ${done}/${total} (${pct}%) — ${written} écrits, ${skipped} déjà là, ${errs} erreurs   `);
    }
  });
  const secs = Math.round((Date.now() - started) / 1000);
  process.stdout.write(
    `\r  ${plan.tasks.length}/${plan.tasks.length} (100%) — ${res.written} écrits, ${res.skipped} déjà là, ${res.errors.length} erreurs — ${(res.bytes / 1e6).toFixed(0)} Mo en ${secs}s\n\n`,
  );

  totalWritten += res.written;
  totalSkipped += res.skipped;
  totalBytes += res.bytes;
  allErrors.push(...res.errors);
}

console.log(`Total : ${totalWritten} fichiers écrits, ${totalSkipped} déjà présents, ${(totalBytes / 1e6).toFixed(0)} Mo`);

if (allErrors.length) {
  console.error(`\n✖ ${allErrors.length} échec(s) — les 20 premiers :`);
  for (const e of allErrors.slice(0, 20)) console.error(`  ${e.url}\n    ${e.message}`);
  console.error('\nRelance la commande : les fichiers déjà téléchargés sont ignorés, seuls les manquants sont retentés.');
  process.exit(1);
}

console.log('\nOK. Redémarre `npm run dev` (ou recharge la page) pour que la map /sounds/strudel.json soit régénérée.');
