// [SPEC-18.14] Render a track back to the YAML text of a `.track.yaml` file.
//
// Hand-rolled rather than delegated to the `yaml` package's stringifier, because
// the file is meant to stay HAND-EDITABLE: key order must be stable and readable
// (name → beats → key → vars → pattern → tags), the pattern must always use a
// block scalar so no escaping ever appears, and a leading comment must survive.
// A generic dumper would quote and reorder to its own taste.
//
// Also serves the future "save a live-coded track" feature [SPEC-15].

import { parse as parseYaml } from 'yaml';

/** The editable content of a track file. */
export interface TrackDraft {
  name: string;
  beats: number;
  /** Pattern as written, `${VAR}` intact. */
  patternSource: string;
  vars: Record<string, string>;
  tags: string[];
  gain?: number;
  /** Camelot code, e.g. "8A". */
  key?: string;
  /** Free-form comment placed at the top of the file. */
  comment?: string;
}

/** True for a scalar that YAML would misread unquoted (number-like, or special). */
function needsQuotes(value: string): boolean {
  if (value === '') return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true; // leading indicator char
  if (/:\s|\s#/.test(value)) return true; // would start a mapping or a comment
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value); // number-like
}

function scalar(value: string): string {
  return needsQuotes(value) ? `'${value.replace(/'/g, "''")}'` : value;
}

/** Render a list inline: `[house, bass, deep]`. */
function flowList(items: string[]): string {
  return `[${items.map(scalar).join(', ')}]`;
}

/** Render a multi-line block scalar, indented by two spaces. `|-` strips the
 *  trailing newline so the value round-trips to exactly what was typed. */
function blockScalar(text: string): string {
  const body = text
    .replace(/\s+$/, '')
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `|-\n${body}`;
}

/** Serialize a draft to the text of a `.track.yaml` file. [SPEC-4.6] */
export function serializeTrack(draft: TrackDraft): string {
  const lines: string[] = [];

  const comment = draft.comment?.trim();
  if (comment) {
    for (const line of comment.split('\n')) lines.push(line === '' ? '#' : `# ${line}`);
  }

  lines.push(`name: ${scalar(draft.name)}`);
  lines.push(`beats: ${draft.beats}`);
  if (draft.key) lines.push(`key: ${scalar(draft.key)}`);
  if (draft.gain !== undefined) lines.push(`gain: ${draft.gain}`);

  const varNames = Object.keys(draft.vars);
  if (varNames.length > 0) {
    lines.push('vars:');
    for (const name of varNames) lines.push(`  ${name}: ${scalar(draft.vars[name])}`);
  }

  lines.push(`pattern: ${blockScalar(draft.patternSource)}`);
  if (draft.tags.length > 0) lines.push(`tags: ${flowList(draft.tags)}`);

  return `${lines.join('\n')}\n`;
}

/** Read a `.track.yaml` text back into a draft, keeping the leading comment.
 *  Throws on invalid YAML; field-level validation stays in `Library`. */
export function parseTrackDraft(text: string): TrackDraft {
  const doc = parseYaml(text) as Record<string, unknown> | null;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('le fichier doit contenir un objet YAML (clé: valeur)');
  }
  // Leading `#` lines are the file's comment; `yaml` drops them on parse.
  const comment = text
    .split('\n')
    .slice(
      0,
      text.split('\n').findIndex((l) => !l.startsWith('#') && l.trim() !== ''),
    )
    .filter((l) => l.startsWith('#'))
    .map((l) => l.replace(/^#\s?/, ''))
    .join('\n');

  const rawVars = (doc.vars ?? {}) as Record<string, unknown>;
  return {
    name: typeof doc.name === 'string' ? doc.name : '',
    beats: typeof doc.beats === 'number' ? doc.beats : 4,
    patternSource: typeof doc.pattern === 'string' ? doc.pattern : '',
    vars: Object.fromEntries(Object.entries(rawVars).map(([k, v]) => [k, String(v)])),
    tags: Array.isArray(doc.tags) ? doc.tags.map(String) : [],
    gain: typeof doc.gain === 'number' ? doc.gain : undefined,
    key: typeof doc.key === 'string' ? doc.key : undefined,
    comment: comment || undefined,
  };
}

/** Substitute `${VAR}` the same way the loader does, for preview. [SPEC-4.7]
 *  Returns the expanded pattern, or the list of missing variable names. */
export function expandVars(
  patternSource: string,
  vars: Record<string, string>,
): { pattern: string } | { missing: string[] } {
  const missing: string[] = [];
  const pattern = patternSource.replace(
    /\$\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g,
    (_match, name: string) => {
      const value = vars[name];
      if (value === undefined) {
        missing.push(name);
        return '';
      }
      return value;
    },
  );
  return missing.length > 0 ? { missing } : { pattern };
}
