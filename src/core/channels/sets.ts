// [SPEC-20] Sets de pads — les 64 pads adressent UN set parmi plusieurs.
//
// Un set est un preset complet du rack [SPEC-20.2] : la grille 8×8 (piste,
// override, armement) et l'état des canaux (catégories, volume, filtre, effets,
// quantisation). Ce module ne porte que ce qui est PUR : palette, identité,
// comptages, format de clé et lecture de la forme persistée. Le comportement
// (commutation, voix, LED) vit dans `ChannelRack`, `StrudelEngine` et `rackStore`.

import type { ChannelState } from './types';

/** Une couleur de set : libellé GUI, hex (écran) et index de palette APC. */
export interface SetPaletteEntry {
  label: string;
  hex: string;
  /** Vélocité = couleur dans la palette de l'APC mini mk2 [SPEC-17.15]. */
  apc: number;
}

/**
 * Palette des sets [SPEC-20.6]. Les couleurs d'ÉTAT sont délibérément absentes —
 * vert 21 = en lecture, rouge 5 = arrêt en attente — sinon un set pourrait se
 * déguiser en état sur la grille. Chaque teinte occupe 4 index dans la palette
 * de l'APC ; on prend le premier de chaque groupe (le plus saturé).
 */
export const SET_PALETTE = {
  bleu: { label: 'Bleu', hex: '#3b82f6', apc: 45 },
  cyan: { label: 'Cyan', hex: '#22d3ee', apc: 33 },
  violet: { label: 'Violet', hex: '#a78bfa', apc: 49 },
  magenta: { label: 'Magenta', hex: '#e879f9', apc: 53 },
  rose: { label: 'Rose', hex: '#fb7185', apc: 57 },
  orange: { label: 'Orange', hex: '#fb923c', apc: 9 },
  jaune: { label: 'Jaune', hex: '#facc15', apc: 13 },
  blanc: { label: 'Blanc', hex: '#e2e8f0', apc: 3 },
} as const satisfies Record<string, SetPaletteEntry>;

export type SetColor = keyof typeof SET_PALETTE;

export const SET_COLORS = Object.keys(SET_PALETTE) as SetColor[];
export const DEFAULT_SET_COLOR: SetColor = 'bleu';

/** Plafond volontaire : au-delà, la barre dense [SPEC-20.10] cesse d'être lisible
 *  et la navigation par deux boutons [SPEC-20.3] devient un défilement à l'aveugle. */
export const MAX_SETS = 8;

/** Un set : identité stable + apparence + état complet du rack. [SPEC-20.2/20.9] */
export interface PadSet {
  /** Identifiant immuable, distinct de la position : un réordonnancement ne délie
   *  ni voix, ni bascule en attente, ni scène. [SPEC-20.9] */
  id: string;
  name: string;
  color: SetColor;
  channels: ChannelState[];
}

/**
 * Vue d'un set pour l'affichage : tout ce que la barre dense [SPEC-20.10] doit
 * montrer, déjà calculé, pour qu'aucun composant n'ait à fouiller le rack.
 */
export interface SetSummary {
  id: string;
  /** Position courante (change au réordonnancement, contrairement à `id`). */
  index: number;
  name: string;
  color: SetColor;
  /** `SET_PALETTE[color].hex`, dénormalisé pour la GUI. */
  hex: string;
  /** Ce set est-il celui que les pads adressent ? */
  active: boolean;
  /** Pads associés à une piste (0 → set vide, donc supprimable). [SPEC-20.8] */
  assigned: number;
  /** Loops armées dans ce set. [SPEC-20.5] */
  playing: number;
  /** Vide ET pas le dernier restant. [SPEC-20.8] */
  deletable: boolean;
}

export function setColorHex(color: SetColor): string {
  return SET_PALETTE[color].hex;
}

export function setColorApc(color: SetColor): number {
  return SET_PALETTE[color].apc;
}

/** Normalise une couleur persistée ; une valeur inconnue retombe sur le défaut. */
export function coerceSetColor(raw: unknown): SetColor {
  return typeof raw === 'string' && raw in SET_PALETTE ? (raw as SetColor) : DEFAULT_SET_COLOR;
}

/** Couleur suivante non utilisée, pour qu'un set créé ne naisse pas homonyme de
 *  son voisin en couleur (le seul repère à distance sur la grille). */
export function nextFreeColor(existing: readonly PadSet[]): SetColor {
  const used = new Set(existing.map((s) => s.color));
  return SET_COLORS.find((c) => !used.has(c)) ?? DEFAULT_SET_COLOR;
}

/** Un `:` dans un id casserait le format de clé `set:canal:slot` — on l'interdit
 *  à la construction plutôt que d'échapper à la lecture. */
const ID_FORBIDDEN = /:/g;

/** Premier identifiant `set-N` libre. Déterministe (aucune horloge, aucun
 *  aléatoire) : un même état donne les mêmes ids, donc les tests sont stables. */
export function newSetId(existing: readonly { id: string }[]): string {
  const used = new Set(existing.map((s) => s.id));
  for (let n = 1; ; n++) {
    const id = `set-${n}`;
    if (!used.has(id)) return id;
  }
}

/** Nom par défaut d'un set créé : « Set N », N = première position libre. */
export function defaultSetName(existing: readonly { name: string }[]): string {
  const used = new Set(existing.map((s) => s.name));
  for (let n = 1; ; n++) {
    const name = `Set ${n}`;
    if (!used.has(name)) return name;
  }
}

/** Aucun pad associé → le set est vide, donc supprimable. [SPEC-20.8] */
export function isEmptySet(set: PadSet): boolean {
  return assignedCount(set) === 0;
}

export function assignedCount(set: PadSet): number {
  let n = 0;
  for (const ch of set.channels) for (const s of ch.slots) if (s.trackId) n++;
  return n;
}

/** Loops armées (donc audibles transport en lecture) dans ce set. [SPEC-20.5] */
export function playingCount(set: PadSet): number {
  let n = 0;
  for (const ch of set.channels) for (const s of ch.slots) if (s.playing && s.trackId) n++;
  return n;
}

// --- Format de clé partagé : voix, bascules en attente, scènes [SPEC-20.4/20.11] ---

/** `set:canal:slot` — une seule écriture pour les trois usages, donc aucun risque
 *  qu'ils divergent. */
export function slotRef(setId: string, channel: number, slot: number): string {
  return `${setId}:${channel}:${slot}`;
}

/** Lecture d'une clé `set:canal:slot`. Découpée par la DROITE : l'id vient en
 *  premier et n'a pas à être analysé. */
export function parseSlotRef(ref: string): { setId: string; channel: number; slot: number } | null {
  const lastColon = ref.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const prevColon = ref.lastIndexOf(':', lastColon - 1);
  if (prevColon <= 0) return null;
  const setId = ref.slice(0, prevColon);
  const channel = Number(ref.slice(prevColon + 1, lastColon));
  const slot = Number(ref.slice(lastColon + 1));
  if (!setId || !Number.isInteger(channel) || !Number.isInteger(slot)) return null;
  return { setId, channel, slot };
}

// --- Forme persistée [SPEC-20.12] ---

export const PAD_SETS_VERSION = 2;

/** Un set tel qu'il sort du stockage : les canaux ne sont PAS interprétés ici —
 *  leur résolution contre la bibliothèque (et le refus de purger, [SPEC-17.51])
 *  appartient à `rackStore`. */
export interface RawPadSet {
  id: string;
  name: string;
  color: SetColor;
  channels: unknown[];
}

/**
 * Lecture tolérante de la clé `rack`. Deux formes acceptées [SPEC-20.12] :
 * - un **tableau** de canaux = forme antérieure aux sets → un set unique ;
 * - `{ version, activeSet, sets }` = forme courante.
 * Retourne `null` quand il n'y a rien d'exploitable (premier lancement).
 */
export function readStoredSets(raw: unknown): { activeSet: number; sets: RawPadSet[] } | null {
  if (Array.isArray(raw)) {
    // Migration : tout l'état d'avant les sets devient le premier set.
    return { activeSet: 0, sets: [{ id: 'set-1', name: 'Set 1', color: DEFAULT_SET_COLOR, channels: raw }] };
  }
  if (!raw || typeof raw !== 'object') return null;
  const stored = raw as { activeSet?: unknown; sets?: unknown };
  if (!Array.isArray(stored.sets) || stored.sets.length === 0) return null;

  const sets: RawPadSet[] = [];
  for (const entry of stored.sets) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { id?: unknown; name?: unknown; color?: unknown; channels?: unknown };
    const id =
      typeof e.id === 'string' && e.id.trim() !== ''
        ? e.id.replace(ID_FORBIDDEN, '-')
        : newSetId(sets);
    sets.push({
      id,
      name: typeof e.name === 'string' && e.name.trim() !== '' ? e.name : defaultSetName(sets),
      color: coerceSetColor(e.color),
      channels: Array.isArray(e.channels) ? e.channels : [],
    });
  }
  if (sets.length === 0) return null;

  // Deux sets homonymes en identité seraient indistinguables pour les voix : on
  // renomme le doublon plutôt que de le perdre.
  const seen = new Set<string>();
  for (const s of sets) {
    if (seen.has(s.id)) s.id = newSetId(sets.filter((o) => o !== s));
    seen.add(s.id);
  }

  const index = typeof stored.activeSet === 'number' ? Math.floor(stored.activeSet) : 0;
  const activeSet = index >= 0 && index < sets.length ? index : 0;
  return { activeSet, sets };
}
