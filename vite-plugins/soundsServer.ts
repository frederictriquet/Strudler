// [SPEC-12, SPEC-14.4] Local sample library server. Serves a user-owned folder
// (default ~/Music/Sounds) same-origin under /sounds/, and generates a Strudel
// sample map at /sounds/strudel.json by scanning it on each request. Drop sound
// folders in there (dirt-samples, personal sounds, curated sets) and Strudler
// picks them up automatically — fully offline, files on your own disk.

import type { Connect, Plugin } from 'vite';
import type { ServerResponse } from 'node:http';
import type { Dirent } from 'node:fs';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, resolve, sep } from 'node:path';

const AUDIO_EXT = new Set(['.wav', '.ogg', '.mp3', '.flac', '.aif', '.aiff', '.m4a']);
const MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.m4a': 'audio/mp4',
};

export function soundsDir(): string {
  return process.env.STRUDLER_SOUNDS_DIR || join(homedir(), 'Music', 'Sounds');
}

// Note-named file, e.g. "A1", "Gs6" (s = sharp). Used to build pitch-mapped
// instruments so note()/chords repitch from the nearest sample. [SPEC-17.18]
const NOTE_FILE_RE = /^([A-Ga-g])(s|#)?(-?\d)$/;

/** Convert a note-named filename to a Strudel note key ("Gs6" → "g#6"), or null. */
function noteKey(file: string): string | null {
  const stem = file.replace(/\.[^.]+$/, '');
  const m = NOTE_FILE_RE.exec(stem);
  if (!m) return null;
  const [, letter, sharp, octave] = m;
  return `${letter.toLowerCase()}${sharp ? '#' : ''}${octave}`;
}

/** Recursively map every folder that directly holds audio files → its samples.
 *  Sound name = the folder's own name (leaf). A folder whose files are ALL
 *  note-named becomes a pitch-mapped instrument ({ "c4": [...], … }) so note()
 *  repitches from the nearest sample; otherwise it stays an index list. */
function buildSampleMap(root: string): Record<string, unknown> {
  const map: Record<string, unknown> = { _base: '/sounds/' };
  if (!existsSync(root)) return map;

  const scan = (absDir: string, relDir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    const audio = entries
      .filter((e: Dirent) => e.isFile() && AUDIO_EXT.has(extname(e.name).toLowerCase()))
      .map((e: Dirent) => e.name)
      .sort();
    if (audio.length && relDir) {
      const name = relDir.split('/').filter(Boolean).pop() as string;
      const notes = audio.map((f) => ({ f, note: noteKey(f) }));
      if (notes.every((n) => n.note !== null)) {
        // Pitch-mapped instrument: key each sample by its note. [SPEC-17.18]
        const obj = (map[name] as Record<string, string[]> | undefined) ?? {};
        for (const { f, note } of notes) {
          (obj[note as string] ??= []).push(relDir + f);
        }
        map[name] = obj;
      } else {
        const list = audio.map((f: string) => relDir + f);
        const existing = (map[name] as string[] | undefined) ?? [];
        map[name] = existing.concat(list);
      }
    }
    for (const e of entries) {
      if (e.isDirectory()) scan(join(absDir, e.name), `${relDir}${e.name}/`);
    }
  };

  scan(root, '');
  return map;
}

function serveFile(root: string, urlPath: string, res: ServerResponse): boolean {
  // Strip the /sounds/ prefix and decode; guard against path traversal.
  const rel = decodeURIComponent(urlPath.replace(/^\/sounds\//, ''));
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) {
    res.statusCode = 403;
    res.end('forbidden');
    return true;
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) return false;
  res.setHeader('Content-Type', MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Access-Control-Allow-Origin', '*');
  createReadStream(abs).pipe(res);
  return true;
}

function middleware(root: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = (req.url ?? '').split('?')[0];
    if (url === '/sounds/strudel.json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store'); // always reflect the current folder
      res.end(JSON.stringify(buildSampleMap(root)));
      return;
    }
    if (url.startsWith('/sounds/')) {
      if (serveFile(root, url, res)) return;
    }
    next();
  };
}

/** Vite plugin exposing the local sound library in dev and preview. */
export function soundsServer(): Plugin {
  const root = soundsDir();
  return {
    name: 'strudler-sounds-server',
    configureServer(server) {
      server.middlewares.use(middleware(root));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(root));
    },
  };
}
