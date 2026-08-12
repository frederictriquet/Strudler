// Download the dirt-samples bank into the local sound library so Strudler can
// use it offline and you can curate it. Destination: $STRUDLER_SOUNDS_DIR (or
// ~/Music/Sounds) /dirt. Skips if already present. Requires git.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const base = process.env.STRUDLER_SOUNDS_DIR || join(homedir(), 'Music', 'Sounds');
const dest = join(base, 'dirt');
const REPO = 'https://github.com/tidalcycles/Dirt-Samples.git';

mkdirSync(base, { recursive: true });

if (existsSync(dest)) {
  console.log(`dirt-samples déjà présent : ${dest}`);
  console.log('(supprime ce dossier puis relance pour re-télécharger)');
  process.exit(0);
}

console.log(`Téléchargement de dirt-samples → ${dest}`);
try {
  execSync(`git clone --depth 1 "${REPO}" "${dest}"`, { stdio: 'inherit' });
} catch (err) {
  console.error('Échec du clonage (git installé ? réseau ?) :', err.message);
  process.exit(1);
}
console.log(`\nOK. Bibliothèque de sons : ${base}`);
console.log('Ajoute d\'autres dossiers de sons dedans ; Strudler les prend automatiquement.');
