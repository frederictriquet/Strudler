// [SPEC-4] Track library. In a Vite app, `import.meta.glob` over the tracks IS
// the scan/manifest mechanism ([SPEC-4.3]): dropping a conforming file into
// `library/<category>/` is picked up automatically with no engine or GUI change
// ([SPEC-4.4]) — and hot-reloaded in dev. The exact schema may evolve ([SPEC-4.2]).

import type {
  LibraryIndex,
  LoadedTrack,
  TrackDefinition,
  TrackLoadError,
  TrackManifestEntry,
} from './types';

// Eagerly import every track module. Path is rooted at the Vite project root.
const modules = import.meta.glob<{ default: TrackDefinition }>('/library/**/*.track.ts', {
  eager: true,
});

const VALID_BEATS = new Set([4, 8, 16, 32, 64]);

/** Parse `/library/<category>/<slug>.track.ts` → { category, slug }. */
function parsePath(path: string): { category: string; slug: string } | null {
  const match = path.match(/\/library\/([^/]+)\/([^/]+)\.track\.ts$/);
  if (!match) return null;
  return { category: match[1], slug: match[2] };
}

function validate(def: unknown): TrackDefinition | string {
  if (!def || typeof def !== 'object') return 'export default manquant ou invalide';
  const t = def as Partial<TrackDefinition>;
  if (typeof t.name !== 'string' || t.name.trim() === '') return 'champ `name` manquant';
  if (typeof t.pattern !== 'string' || t.pattern.trim() === '') return 'champ `pattern` manquant';
  if (typeof t.beats !== 'number' || t.beats <= 0) return 'champ `beats` invalide';
  if (!VALID_BEATS.has(t.beats)) {
    // Non-standard length is allowed by [SPEC-4.2] "et arbitraire par extension";
    // not an error, just uncommon.
  }
  return t as TrackDefinition;
}

function buildIndex(): LibraryIndex {
  const tracks: LoadedTrack[] = [];
  const errors: TrackLoadError[] = [];
  const seen = new Map<string, string>(); // `category/name` → path, to catch duplicates

  for (const [path, mod] of Object.entries(modules)) {
    const parsed = parsePath(path);
    if (!parsed) {
      errors.push({ path, message: 'chemin non conforme à library/<catégorie>/<slug>.track.ts' });
      continue;
    }
    const result = validate(mod?.default);
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
