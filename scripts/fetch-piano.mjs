// Download a note-sampled acoustic piano into the local sound library so Strudler
// can play pitched chords/melodies offline. Source: nbrosowsky/tonejs-instruments
// (MIT), samples/piano — note-named mp3s (A0, C1, Ds1, …). Destination:
// $STRUDLER_SOUNDS_DIR (or ~/Music/Sounds)/piano. Skips if already present.
// Requires git (sparse checkout).

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.env.STRUDLER_SOUNDS_DIR || join(homedir(), 'Music', 'Sounds');
const dest = join(base, 'piano');
const REPO = 'https://github.com/nbrosowsky/tonejs-instruments.git';

mkdirSync(base, { recursive: true });

if (existsSync(dest)) {
  console.log(`piano déjà présent : ${dest}`);
  console.log('(supprime ce dossier puis relance pour re-télécharger)');
  process.exit(0);
}

console.log(`Téléchargement du piano → ${dest}`);
const tmp = mkdtempSync(join(tmpdir(), 'strudler-piano-'));
try {
  // Sparse checkout: only samples/piano, no working tree until we ask for it.
  execSync(`git clone --depth 1 --filter=blob:none --sparse "${REPO}" "${tmp}"`, {
    stdio: 'inherit',
  });
  execSync(`git -C "${tmp}" sparse-checkout set samples/piano`, { stdio: 'inherit' });

  const src = join(tmp, 'samples', 'piano');
  if (!existsSync(src)) throw new Error(`dossier introuvable après checkout : ${src}`);
  cpSync(src, dest, { recursive: true });

  const files = readdirSync(dest).filter((f) => /\.(mp3|wav|ogg)$/i.test(f));
  console.log(`\nOK. ${files.length} échantillons de piano → ${dest}`);
  console.log('Strudler les mappe par note automatiquement (utiliser .s("piano")).');
} catch (err) {
  console.error('Échec du téléchargement (git installé ? réseau ?) :', err.message);
  process.exit(1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
