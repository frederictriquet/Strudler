// [SPEC-4] Track library. A track is plain YAML DATA, not code ([SPEC-4.6]):
// `import.meta.glob` over the files IS the scan/manifest mechanism ([SPEC-4.3]),
// so dropping a conforming file into `library/<category>/` is picked up
// automatically with no engine or GUI change ([SPEC-4.4]) — hot-reloaded in dev.
//
// The files are globbed as RAW TEXT and parsed at runtime rather than converted
// by a build plugin, on purpose:
//   - a malformed track is reported in the UI with its file, line and column
//     ([SPEC-14.3]) while every other track still loads, instead of breaking the
//     whole build;
//   - it is the same code path a future "load tracks written by another tool"
//     feature would use — nothing here assumes the file went through the bundler.
// The price is losing compile-time checking; `library/track.schema.json` gives it
// back in the editor, and `validate()` below enforces it at load.

import { parse as parseYaml, YAMLParseError } from 'yaml';
import { fullReloadOnHmr } from '@core/persist/hmr';
import type {
  LibraryIndex,
  LoadedTrack,
  TrackDefinition,
  TrackLoadError,
  TrackManifestEntry,
} from './types';

// Raw text of every track file. Path is rooted at the Vite project root.
const modules = import.meta.glob<string>('/library/**/*.track.yaml', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const VALID_BEATS = new Set([4, 8, 16, 32, 64]);

/** Every key a track file may declare — mirrors `library/track.schema.json`.
 *  Anything else is a typo (`tag:` for `tags:`) and must not pass silently. */
const KNOWN_KEYS = ['name', 'beats', 'pattern', 'vars', 'tags', 'gain', 'key'] as const;
const KNOWN_KEY_SET: ReadonlySet<string> = new Set(KNOWN_KEYS);

/** Parse `/library/<category>/<slug>.track.yaml` → { category, slug }. */
function parsePath(path: string): { category: string; slug: string } | null {
  const match = path.match(/\/library\/([^/]+)\/([^/]+)\.track\.yaml$/);
  if (!match) return null;
  return { category: match[1], slug: match[2] };
}

/**
 * Substitute `${VAR}` in the pattern from the file's own `vars` map. [SPEC-4.7]
 *
 * This is what a `const` did in the old TypeScript tracks: write a chord
 * progression once, reuse it across the stacked layers. Scope is the file, so two
 * tracks may use the same variable name without interfering — which was NOT true
 * of module-level consts. An unresolved `${...}` is an error, never a literal
 * left in the pattern (Strudel would then fail far from the real cause).
 *
 * Returns the expanded pattern, or the list of missing variable names.
 */
function interpolate(pattern: string, vars: Record<string, string>): string | string[] {
  const missing: string[] = [];
  const out = pattern.replace(/\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      missing.push(name);
      return '';
    }
    return value;
  });
  return missing.length > 0 ? missing : out;
}

/** Validate one parsed document: the definition, or a message explaining why not. */
function validate(doc: unknown): TrackDefinition | string {
  if (doc === null || doc === undefined) return 'fichier vide';
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    return 'le fichier doit contenir un objet YAML (clé: valeur), pas une liste ni une valeur seule';
  }
  const raw = doc as Record<string, unknown>;

  const unknown = Object.keys(raw).filter((k) => !KNOWN_KEY_SET.has(k));
  if (unknown.length > 0) {
    return `clé inconnue : ${unknown.map((k) => `\`${k}\``).join(', ')} (attendu : ${KNOWN_KEYS.join(', ')})`;
  }

  if (typeof raw.name !== 'string' || raw.name.trim() === '') return 'champ `name` manquant';
  if (typeof raw.beats !== 'number' || !Number.isFinite(raw.beats) || raw.beats <= 0) {
    return 'champ `beats` invalide (nombre de beats > 0 attendu)';
  }
  if (!VALID_BEATS.has(raw.beats)) {
    // Non-standard length is allowed by [SPEC-4.2] "et arbitraire par extension";
    // not an error, just uncommon.
  }
  if (typeof raw.pattern !== 'string' || raw.pattern.trim() === '') return 'champ `pattern` manquant';
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== 'string'))) {
    return 'champ `tags` invalide (liste de chaînes attendue)';
  }
  if (raw.gain !== undefined && (typeof raw.gain !== 'number' || !Number.isFinite(raw.gain))) {
    return 'champ `gain` invalide (nombre attendu)';
  }
  if (raw.key !== undefined && (typeof raw.key !== 'string' || raw.key.trim() === '')) {
    return 'champ `key` invalide (code Camelot attendu, ex. « 8A »)';
  }

  const vars: Record<string, string> = {};
  if (raw.vars !== undefined) {
    if (typeof raw.vars !== 'object' || raw.vars === null || Array.isArray(raw.vars)) {
      return 'champ `vars` invalide (objet `nom: valeur` attendu)';
    }
    for (const [name, value] of Object.entries(raw.vars as Record<string, unknown>)) {
      if (typeof value !== 'string' && typeof value !== 'number') {
        return `variable \`${name}\` invalide (chaîne ou nombre attendu)`;
      }
      vars[name] = String(value);
    }
  }

  const pattern = interpolate(raw.pattern, vars);
  if (Array.isArray(pattern)) {
    return `variable non définie dans \`vars\` : ${pattern.map((n) => `\${${n}}`).join(', ')}`;
  }

  return {
    name: raw.name,
    beats: raw.beats,
    pattern,
    tags: raw.tags as string[] | undefined,
    gain: raw.gain as number | undefined,
    key: raw.key as string | undefined,
  };
}

/** Turn a YAML syntax error into something that points at the offending line. */
function yamlErrorMessage(error: unknown): string {
  if (error instanceof YAMLParseError) {
    const pos = error.linePos?.[0];
    const where = pos ? ` (ligne ${pos.line}, colonne ${pos.col})` : '';
    return `YAML invalide${where} : ${error.message.split('\n')[0]}`;
  }
  return `YAML invalide : ${error instanceof Error ? error.message : String(error)}`;
}

function buildIndex(): LibraryIndex {
  const tracks: LoadedTrack[] = [];
  const errors: TrackLoadError[] = [];
  const seen = new Map<string, string>(); // `category/name` → path, to catch duplicates

  for (const [path, source] of Object.entries(modules)) {
    const parsed = parsePath(path);
    if (!parsed) {
      errors.push({ path, message: 'chemin non conforme à library/<catégorie>/<slug>.track.yaml' });
      continue;
    }

    let doc: unknown;
    try {
      doc = parseYaml(source);
    } catch (err) {
      errors.push({ path, message: yamlErrorMessage(err) });
      continue;
    }

    const result = validate(doc);
    if (typeof result === 'string') {
      errors.push({ path, message: result });
      continue;
    }
    const { category, slug } = parsed;
    // Uniqueness of display name within a category. [SPEC-4.2]
    const key = `${category}/${result.name.toLowerCase()}`;
    if (seen.has(key)) {
      errors.push({
        path,
        message: `nom « ${result.name} » déjà utilisé dans la catégorie « ${category} » (${seen.get(key)})`,
      });
      continue;
    }
    seen.set(key, path);

    tracks.push({
      id: `${category}/${slug}`,
      category,
      slug,
      name: result.name,
      beats: result.beats,
      tags: result.tags ?? [],
      gain: result.gain,
      key: result.key,
      pattern: result.pattern,
      path,
    });
  }

  tracks.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return { tracks, errors };
}

export class Library {
  private index: LibraryIndex;

  constructor() {
    this.index = buildIndex();
  }

  /** All load/validation errors. Surfaced to the user, never hidden. [SPEC-14.3] */
  get errors(): TrackLoadError[] {
    return this.index.errors;
  }

  /** Manifest (metadata only). [SPEC-4.3] */
  get manifest(): TrackManifestEntry[] {
    return this.index.tracks.map(({ pattern: _pattern, ...entry }) => entry);
  }

  /** Distinct categories, sorted. */
  get categories(): string[] {
    return [...new Set(this.index.tracks.map((t) => t.category))].sort();
  }

  /** Tracks grouped by category, in display order. */
  byCategory(): Map<string, LoadedTrack[]> {
    const map = new Map<string, LoadedTrack[]>();
    for (const track of this.index.tracks) {
      const list = map.get(track.category) ?? [];
      list.push(track);
      map.set(track.category, list);
    }
    return map;
  }

  /** Full track (with pattern) by id, or undefined. */
  getTrack(id: string): LoadedTrack | undefined {
    return this.index.tracks.find((t) => t.id === id);
  }
}

export const library = new Library();

// Editing a track file invalidates this module, but the rack and the stores hold
// a reference to the PREVIOUS index: the panel would show the edited track while
// playback still used the old pattern. Reload the page instead. [SPEC-17.31]
fullReloadOnHmr(import.meta.hot);
