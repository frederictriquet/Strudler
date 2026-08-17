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

import { parse as parseYaml } from 'yaml';
import { fullReloadOnHmr } from '@core/persist/hmr';
import { validateTrackDoc, yamlErrorMessage } from './validate';
import type { LibraryIndex, LoadedTrack, TrackLoadError, TrackManifestEntry } from './types';

// Raw text of every track file. Path is rooted at the Vite project root.
const modules = import.meta.glob<string>('/library/**/*.track.yaml', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** Parse `/library/<category>/<slug>.track.yaml` → { category, slug }. */
function parsePath(path: string): { category: string; slug: string } | null {
  const match = path.match(/\/library\/([^/]+)\/([^/]+)\.track\.yaml$/);
  if (!match) return null;
  return { category: match[1], slug: match[2] };
}

// `${VAR}` substitution lives in serialize.ts and field validation in validate.ts
// [SPEC-4.7, SPEC-4.6]: the composition workshop must expand and validate EXACTLY
// the way this loader does, otherwise it could write files the instrument rejects.

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

    const result = validateTrackDoc(doc);
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
      patternSource: result.patternSource,
      vars: result.vars,
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
    return this.index.tracks.map(
      ({ pattern: _p, patternSource: _ps, vars: _v, ...entry }) => entry,
    );
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
