// Évalue du JavaScript DANS l'application, en une commande, et imprime la sortie.
//
// Raison d'être : vérifier un comportement qui exige Strudel et un AudioContext
// demandait jusqu'ici d'écrire une page HTML jetable, de lancer Chrome à la main,
// puis de supprimer la page — plusieurs minutes par question. Ici : une commande.
//
//   npm run probe -- 'say(detect.parseNotes("d3,a3,f4", "letters"))'
//   npm run probe -- '...' --banks     # charge les banques de sons d'abord
//   npm run probe -- '...' --store     # importe aussi composerStore
//   npm run probe -- --file chose.js   # expression trop longue pour la ligne
//
// Contexte disponible dans l'expression : say, engine (armé), notes, chords,
// camelot, detect, probe, roll, banks, library, store, get. Le corps est
// asynchrone : `await` directement.
//
// Prérequis : `npm run dev` tourne (port 5173) et Chrome est installé.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_BASE = process.env.STRUDLER_URL ?? 'http://localhost:5173';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

let source;
if (flags.has('--file')) {
  const path = positional[0];
  if (!path) fail('--file attend un chemin');
  source = readFileSync(path, 'utf8');
} else {
  source = positional.join(' ');
}
if (!source.trim()) {
  fail("rien à évaluer.\n\nExemple :\n  npm run probe -- 'say(detect.parseNotes(\"d3,a3,f4\"))'");
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const query = new URLSearchParams({ e: source });
if (flags.has('--banks')) query.set('banks', '1');
if (flags.has('--store')) query.set('store', '1');

// Profil PERSISTANT, et c'est tout l'intérêt : un profil neuf part avec un cache
// HTTP vide, donc Vite retransforme les ~250 modules à chaque appel — 90 s au lieu
// de quelques secondes. Réutiliser le profil garde les modules en cache.
const profile = join(tmpdir(), 'strudler-probe-profile');
mkdirSync(profile, { recursive: true });
let dom;
try {
  dom = execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      `--user-data-dir=${profile}`,
      // Le temps virtuel n'est pas du temps réel : il suffit qu'il couvre les
      // `await` de l'expression. 8 s est large.
      '--virtual-time-budget=8000',
      '--dump-dom',
      `${URL_BASE}/dev-probe.html?${query}`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );
} catch (err) {
  fail(`Chrome a échoué : ${err.message}\nLe serveur de dev tourne-t-il ? (npm run dev)`);
}

const match = /<pre id="out"[^>]*>([\s\S]*?)<\/pre>/.exec(dom);
if (!match) {
  fail(`page inattendue — le serveur de dev répond-il sur ${URL_BASE} ?`);
}
const text = match[1]
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&gt;/g, '>')
  .replace(/&lt;/g, '<')
  .replace(/&amp;/g, '&');
process.stdout.write(text.trim() === '…' ? '(aucune sortie)\n' : text);
