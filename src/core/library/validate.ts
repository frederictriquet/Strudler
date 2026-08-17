// [SPEC-4.6] What makes a track file valid — the single definition of that rule.
//
// Used in two places that must never disagree: the loader, which rejects a bad
// file at startup ([SPEC-4.6]), and the composition workshop, which refuses to
// WRITE one ([SPEC-18.16]). A second copy of these checks would drift and let the
// workshop produce files the instrument then rejects.
//
// Mirrors `library/track.schema.json`, which does the same job in the editor.

import { parse as parseYaml, YAMLParseError } from 'yaml';
import { expandVars } from './serialize';
import type { TrackDefinition } from './types';

/** Loop lengths considered usual. Others are allowed. [SPEC-4.2] */
export const VALID_BEATS: ReadonlySet<number> = new Set([4, 8, 16, 32, 64]);

/** Every key a track file may declare. Anything else is a typo (`tag:` for
 *  `tags:`) and must not pass silently. */
export const KNOWN_KEYS = ['name', 'beats', 'pattern', 'vars', 'tags', 'gain', 'key'] as const;
const KNOWN_KEY_SET: ReadonlySet<string> = new Set(KNOWN_KEYS);

/** Validate one parsed document: the definition, or a message explaining why not. */
export function validateTrackDoc(doc: unknown): TrackDefinition | string {
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
  if (typeof raw.pattern !== 'string' || raw.pattern.trim() === '') return 'champ `pattern` manquant';
  if (
    raw.tags !== undefined &&
    (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== 'string'))
  ) {
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

  const expanded = expandVars(raw.pattern, vars);
  if ('missing' in expanded) {
    return `variable non définie dans \`vars\` : ${expanded.missing.map((n) => `\${${n}}`).join(', ')}`;
  }

  return {
    name: raw.name,
    beats: raw.beats,
    pattern: expanded.pattern,
    patternSource: raw.pattern,
    vars,
    tags: raw.tags as string[] | undefined,
    gain: raw.gain as number | undefined,
    key: raw.key as string | undefined,
  };
}

/** Turn a YAML syntax error into something that points at the offending line. */
export function yamlErrorMessage(error: unknown): string {
  if (error instanceof YAMLParseError) {
    const pos = error.linePos?.[0];
    const where = pos ? ` (ligne ${pos.line}, colonne ${pos.col})` : '';
    return `YAML invalide${where} : ${error.message.split('\n')[0]}`;
  }
  return `YAML invalide : ${error instanceof Error ? error.message : String(error)}`;
}

/** Parse then validate a whole file's text. Returns the definition or a message.
 *  This is exactly what the loader does to a file on disk. [SPEC-18.16] */
export function validateTrackText(text: string): TrackDefinition | string {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    return yamlErrorMessage(err);
  }
  return validateTrackDoc(doc);
}
