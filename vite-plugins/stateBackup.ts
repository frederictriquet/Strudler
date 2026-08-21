// [SPEC-13.5→13.7] Disk mirror of the browser state.
//
// localStorage is bound to one origin and one browser profile. Clearing site
// data, storage eviction, a port change or a lost profile all wipe it, and the
// app has already lost a full pad mapping once that way. This plugin gives the
// page somewhere OUTSIDE the browser to write to: `<projet>/.state/`.
//
// Deliberately a dev/preview-server concern rather than a service: Strudler is a
// local, single-user, offline app, always launched through Vite. A `dist/` served
// by some other static server simply has no `/__state` routes, and the page then
// says so rather than pretending to be protected [SPEC-14.3].
//
// The client never supplies a path. The only name that travels is a snapshot
// filename, validated against a strict pattern before it touches `join()`.

import type { Connect, Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const ROUTE = '/__state';
const DIR = '.state';
const CURRENT = 'strudler-state.json';
const SNAP_DIR = 'snapshots';

/** localStorage tops out near 5 MB per origin; anything larger is not our state. */
const MAX_BODY = 6 * 1024 * 1024;
/** How many dated snapshots to keep. */
const KEEP = 30;
/** Minimum age of the newest snapshot before archiving another one. */
const SNAPSHOT_MIN_MS = 5 * 60 * 1000;

/** `2026-08-19T14-32-05.114Z.json` — the only shape accepted from a client. */
const SNAP_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d{3})?Z(?:~\d+)?\.json$/;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((ok, ko) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        // Keep draining instead of destroying the socket: a killed connection
        // reaches the page as an opaque network error rather than the 413 that
        // actually explains the refusal. Nothing is retained past the limit.
        over = true;
        chunks.length = 0;
        return;
      }
      if (!over) chunks.push(chunk);
    });
    req.on('end', () => (over ? ko(new Error('TOO_LARGE')) : ok(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', (err) => ko(err));
  });
}

/** Snapshot filename derived from a bundle's own `savedAt`, else from `now`. */
function snapshotName(text: string, fallback: Date): string {
  let stamp = fallback.toISOString();
  try {
    const savedAt = (JSON.parse(text) as { savedAt?: unknown }).savedAt;
    if (typeof savedAt === 'string' && !Number.isNaN(Date.parse(savedAt))) stamp = savedAt;
  } catch {
    // unparseable previous copy: the fallback timestamp still orders it correctly
  }
  return `${stamp.replace(/:/g, '-')}.json`;
}

/** Never overwrite an existing snapshot: two bundles can share a `savedAt`, and a
 *  silent overwrite would destroy the history these files exist for. */
function freeName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const stem = name.replace(/\.json$/, '');
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${stem}~${i}.json`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
  return `${stem}~${process.hrtime.bigint()}.json`;
}

function listSnapshots(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort(); // ISO names sort chronologically
}

/**
 * Archive the copy we are about to replace, so an overwriting bug leaves a
 * dated antecedent behind. Skipped when nothing changed (30 identical files
 * after 30 keystrokes would be worthless) or when the newest one is recent.
 */
function archivePrevious(stateDir: string, previous: string | null, next: string): void {
  if (previous === null || previous === next) return;
  const snapDir = join(stateDir, SNAP_DIR);
  const existing = listSnapshots(snapDir);
  const newest = existing[existing.length - 1];
  if (newest) {
    const age = Date.now() - statSync(join(snapDir, newest)).mtimeMs;
    if (age < SNAPSHOT_MIN_MS) return;
  }
  mkdirSync(snapDir, { recursive: true });
  writeFileSync(join(snapDir, freeName(snapDir, snapshotName(previous, new Date()))), previous, 'utf8');

  const all = listSnapshots(snapDir);
  for (const stale of all.slice(0, Math.max(0, all.length - KEEP))) {
    rmSync(join(snapDir, stale), { force: true });
  }
}

function savedAtOf(text: string): string | null {
  try {
    const savedAt = (JSON.parse(text) as { savedAt?: unknown }).savedAt;
    return typeof savedAt === 'string' ? savedAt : null;
  } catch {
    return null; // corrupted file: still listed, just without a date
  }
}

/** The middleware, exported on its own so it can be exercised without Vite. */
export function stateBackupMiddleware(root: string): Connect.NextHandleFunction {
  const stateDir = resolve(root, DIR);
  const currentPath = join(stateDir, CURRENT);

  const readCurrent = (): string | null =>
    existsSync(currentPath) ? readFileSync(currentPath, 'utf8') : null;

  return (req, res, next) => {
    const url = (req.url ?? '').split('?')[0];
    if (url !== ROUTE && !url.startsWith(`${ROUTE}/`)) {
      next();
      return;
    }
    const rest = url.slice(ROUTE.length);

    if (req.method === 'GET' && rest === '/index') {
      const current = readCurrent();
      const snapDir = join(stateDir, SNAP_DIR);
      sendJson(res, 200, {
        current: current === null ? null : { savedAt: savedAtOf(current), bytes: current.length },
        snapshots: listSnapshots(snapDir)
          .map((name) => {
            const text = readFileSync(join(snapDir, name), 'utf8');
            return { name, savedAt: savedAtOf(text), bytes: text.length };
          })
          .reverse(), // newest first, the order the UI wants
      });
      return;
    }

    if (req.method === 'GET' && rest === '/current') {
      const current = readCurrent();
      if (current === null) {
        sendJson(res, 404, { error: 'aucune sauvegarde' });
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(current);
      return;
    }

    if (req.method === 'GET' && rest.startsWith('/snapshot/')) {
      const name = decodeURIComponent(rest.slice('/snapshot/'.length));
      if (!SNAP_NAME_RE.test(name)) {
        sendText(res, 400, 'nom d’instantané invalide');
        return;
      }
      const file = join(stateDir, SNAP_DIR, name);
      if (!existsSync(file)) {
        sendJson(res, 404, { error: 'instantané introuvable' });
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(readFileSync(file, 'utf8'));
      return;
    }

    if (req.method === 'POST' && rest === '/current') {
      void readBody(req, MAX_BODY)
        .then((text) => {
          // Validate BEFORE touching disk: never leave a half-written state file.
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch (err) {
            sendText(res, 400, `JSON invalide : ${(err as Error).message}`);
            return;
          }
          if (!parsed || typeof parsed !== 'object' || !(parsed as { keys?: unknown }).keys) {
            sendText(res, 400, 'paquet sans bloc « keys »');
            return;
          }
          mkdirSync(stateDir, { recursive: true });
          archivePrevious(stateDir, readCurrent(), text);
          // Atomic: a crash mid-write must not truncate the only copy.
          const tmp = `${currentPath}.tmp`;
          writeFileSync(tmp, text, 'utf8');
          renameSync(tmp, currentPath);
          sendJson(res, 200, { ok: true, bytes: text.length });
        })
        .catch((err: Error) => {
          if (err.message === 'TOO_LARGE') {
            sendText(res, 413, `paquet trop volumineux (> ${MAX_BODY} octets)`);
            return;
          }
          sendText(res, 500, `écriture impossible : ${err.message}`);
        });
      return;
    }

    sendText(res, 405, 'méthode non autorisée');
  };
}

/** Vite plugin exposing the state mirror in dev and preview. */
export function stateBackup(): Plugin {
  let root = process.cwd();
  return {
    name: 'strudler-state-backup',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use(stateBackupMiddleware(root));
    },
    configurePreviewServer(server) {
      server.middlewares.use(stateBackupMiddleware(root));
    },
  };
}
