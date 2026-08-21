// [SPEC-18.31] Tonalité d'une suite d'accords — et surtout, le degré de certitude.
//
// On ne calcule pas une tonalité, on la déduit. Quatre indices, du plus faible au
// plus décisif :
//
//   1. les notes employées → une armure candidate (laisse toujours la paire
//      relative majeure/mineure en suspens) ;
//   2. la suite des QUALITÉS d'accords, qui ne s'aligne que d'une façon sur le
//      gabarit diatonique ;
//   3. la DOMINANTE : une septième de dominante n'appartient qu'à une tonalité,
//      son triton n'ayant qu'une résolution ;
//   4. la CADENCE et la position — le dernier accord est presque toujours la
//      tonique.
//
// Aucun de ces indices n'est sûr isolément, et une suite d'accords peut
// honnêtement n'avoir PAS de tonalité unique. Ce module rend donc toujours trois
// choses ensemble : la meilleure hypothèse, ce qui la soutient, et ce qui la
// contredit. Cacher le second groupe transformerait une déduction en affirmation.

import { get as chordTypeOf } from '@tonaljs/chord-type';
import { CAMELOT_KEYS, longNoteFr, type CamelotKey, type KeyMode } from './camelot';
import { noteNameToMidi } from './notes';
import { splitSlash } from './chordDetect';

/** Degrés de la gamme, en demi-tons au-dessus de la tonique. */
const SCALE: Record<KeyMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

/**
 * Le mineur harmonique fait partie du mineur réel : en la mineur, la dominante
 * est MI MAJEUR (avec sol♯), pas mi mineur. Sans cette note, toute cadence
 * authentique en mineur serait comptée « hors tonalité ».
 */
const RAISED_SEVENTH = 11;

/** Chiffrages romains par degré, selon le mode. */
const NUMERALS: Record<KeyMode, string[]> = {
  major: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'],
  minor: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'],
};

export interface ParsedChord {
  /** Le symbole tel qu'écrit. */
  symbol: string;
  /** Hauteur de la fondamentale (0 = do), ou null si le symbole est illisible. */
  rootPc: number | null;
  /** Hauteurs de l'accord, fondamentale comprise. */
  pcs: number[];
  /** Qualité réduite à ce qui sert au chiffrage. */
  quality: 'major' | 'minor' | 'diminished' | 'augmented' | 'other';
  /** Contient un triton depuis la fondamentale ET une tierce majeure → dominante. */
  isDominantSeventh: boolean;
}

/** Découpe une suite d'accords écrite à la main ou copiée d'un pattern Strudel. */
export function parseChordList(text: string): string[] {
  return text
    .replace(/\$\{[^}]*\}/g, ' ') // une variable non résolue n'est pas un accord
    .replace(/[<>[\]"'()]/g, ' ') // `<Dm Gm>` d'une alternation, guillemets, crochets
    .split(/[\s,;|]+/)
    .filter((t) => t !== '' && t !== '~' && t !== '-');
}

/** Lit un symbole d'accord. Un renversement est ramené à son accord de base : la
 *  basse ne change pas l'ensemble des hauteurs, donc rien pour la tonalité. */
export function parseChord(symbol: string): ParsedChord {
  const { base } = splitSlash(symbol);
  const m = /^([A-Ga-g](?:#|b)*)(.*)$/.exec(base);
  const fail: ParsedChord = {
    symbol,
    rootPc: null,
    pcs: [],
    quality: 'other',
    isDominantSeventh: false,
  };
  if (!m) return fail;
  const midi = noteNameToMidi(m[1]);
  if (midi === null) return fail;
  const rootPc = ((midi % 12) + 12) % 12;

  const type = chordTypeOf(m[2]);
  if (type.empty || !type.chroma) return { ...fail, rootPc, pcs: [rootPc] };

  const intervals: number[] = [];
  for (let i = 0; i < type.chroma.length; i += 1) {
    if (type.chroma[i] === '1') intervals.push(i);
  }
  const has = (semitones: number): boolean => intervals.includes(semitones);
  const quality: ParsedChord['quality'] = has(4)
    ? has(8) && !has(7)
      ? 'augmented'
      : 'major'
    : has(3)
      ? has(6) && !has(7)
        ? 'diminished'
        : 'minor'
      : 'other';

  return {
    symbol,
    rootPc,
    pcs: intervals.map((i) => (rootPc + i) % 12),
    quality,
    // Tierce majeure + septième mineure = le triton qui ne résout que d'une façon.
    isDominantSeventh: has(4) && has(10),
  };
}

/** Rôle d'un accord dans une tonalité, ou pourquoi il n'en a pas. */
export interface ChordRole {
  symbol: string;
  /** Chiffrage romain (`I`, `ii`, `V7`, `♭VI`), ou null hors tonalité. */
  numeral: string | null;
  /** Diatonique, emprunt reconnu, ou étranger. */
  status: 'diatonic' | 'borrowed' | 'foreign' | 'unreadable';
  /** Précision destinée à l'utilisateur (nature de l'emprunt, note fautive). */
  note?: string;
}

export type Confidence = 'certaine' | 'probable' | 'incertaine' | 'indéterminée';

export interface KeyVerdict {
  /** Meilleure hypothèse, ou null si rien ne se dégage. */
  key: CamelotKey | null;
  confidence: Confidence;
  /** Ce qui SOUTIENT l'hypothèse. */
  evidence: string[];
  /** Ce qui la CONTREDIT ou la limite. Jamais masqué, même quand la confiance est
   *  haute — c'est la seule façon de distinguer une déduction d'une affirmation. */
  problems: string[];
  /** Tonalités qui expliquent les accords aussi bien, ou presque. */
  rivals: CamelotKey[];
  /** Rôle de chaque accord dans l'hypothèse retenue. */
  roles: ChordRole[];
}

/** Hauteurs admises par une tonalité (mineur harmonique inclus). */
function allowedPcs(tonicPc: number, mode: KeyMode): Set<number> {
  const set = new Set(SCALE[mode].map((s) => (tonicPc + s) % 12));
  if (mode === 'minor') set.add((tonicPc + RAISED_SEVENTH) % 12);
  return set;
}

/** Index de degré (0..6) de `pc` dans la tonalité, ou null s'il n'en est pas. */
function degreeOf(pc: number, tonicPc: number, mode: KeyMode): number | null {
  const interval = ((pc - tonicPc) % 12 + 12) % 12;
  const index = SCALE[mode].indexOf(interval);
  if (index !== -1) return index;
  if (mode === 'minor' && interval === RAISED_SEVENTH) return 6;
  return null;
}

/** Chiffrage : majuscule pour majeur, minuscule pour mineur, `°` pour diminué. */
function numeralFor(degree: number, chord: ParsedChord, mode: KeyMode): string {
  const base = NUMERALS[mode][degree];
  const roman =
    chord.quality === 'minor' || chord.quality === 'diminished' ? base.toLowerCase() : base;
  const mark =
    chord.quality === 'diminished' ? '°' : chord.quality === 'augmented' ? '+' : '';
  return `${roman}${mark}${chord.isDominantSeventh ? '7' : ''}`;
}

/**
 * Emprunts reconnus, nommés plutôt que comptés comme des contradictions.
 *
 * En majeur, ♭III ♭VI ♭VII viennent du mineur parallèle — c'est l'emprunt le plus
 * courant, et la piste `cmajor-1-4-b6-b7` de la bibliothèque en est faite. Une
 * dominante secondaire (accord majeur ou de septième dont la fondamentale est une
 * quinte au-dessus d'un autre accord de la suite) est l'autre cas fréquent.
 */
function borrowing(
  chord: ParsedChord,
  tonicPc: number,
  mode: KeyMode,
  others: ParsedChord[],
): string | null {
  if (chord.rootPc === null) return null;
  const interval = ((chord.rootPc - tonicPc) % 12 + 12) % 12;
  if (mode === 'major' && chord.quality === 'major') {
    if (interval === 3) return '♭III, emprunt au mineur parallèle';
    if (interval === 8) return '♭VI, emprunt au mineur parallèle';
    if (interval === 10) return '♭VII, emprunt au mineur parallèle';
  }
  if (interval === 1 && chord.quality === 'major') return '♭II, napolitaine';
  if (chord.quality === 'major' || chord.isDominantSeventh) {
    const target = others.find(
      (o) => o !== chord && o.rootPc !== null && (o.rootPc - chord.rootPc! + 12) % 12 === 5,
    );
    if (target) return `dominante secondaire de ${target.symbol}`;
  }
  return null;
}

interface Scored {
  key: CamelotKey;
  diatonic: number;
  borrowed: number;
  foreign: number;
  /** Une dominante (majeure ou de septième) sur le Ve degré. */
  dominant: 'seventh' | 'triad' | null;
  lastIsTonic: boolean;
  firstIsTonic: boolean;
  /** Le Ve degré n'apparaît qu'en MINEUR : la fonction dominante est contredite. */
  minorFifth: boolean;
  /** Tous les accords sont expliqués, emprunts compris. */
  explainsAll: boolean;
}

function score(key: CamelotKey, chords: ParsedChord[]): Scored {
  const allowed = allowedPcs(key.pc, key.mode);
  let diatonic = 0;
  let borrowed = 0;
  let foreign = 0;
  let dominant: Scored['dominant'] = null;
  let minorFifth = false;

  for (const chord of chords) {
    if (chord.rootPc === null) continue;
    const inKey = chord.pcs.length > 0 && chord.pcs.every((pc) => allowed.has(pc));
    if (inKey) {
      diatonic += 1;
      const degree = degreeOf(chord.rootPc, key.pc, key.mode);
      if (degree === 4) {
        if (chord.quality === 'major' || chord.isDominantSeventh) {
          // La septième est plus décisive que la triade : son triton ne résout que d'une façon.
          if (chord.isDominantSeventh) dominant = 'seventh';
          else dominant ??= 'triad';
        } else if (chord.quality === 'minor') {
          // Un v mineur relève du modal, pas du tonal : il n'attire pas vers la
          // tonique. `Dm Gm` se lit i–iv en ré mineur, pas v–i en sol mineur.
          minorFifth = true;
        }
      }
    } else if (borrowing(chord, key.pc, key.mode, chords)) borrowed += 1;
    else foreign += 1;
  }

  const tonicLike = (c: ParsedChord | undefined): boolean =>
    !!c &&
    c.rootPc === key.pc &&
    (key.mode === 'major' ? c.quality === 'major' : c.quality === 'minor');

  return {
    key,
    diatonic,
    borrowed,
    foreign,
    dominant,
    lastIsTonic: tonicLike(chords[chords.length - 1]),
    firstIsTonic: tonicLike(chords[0]),
    minorFifth,
    explainsAll: foreign === 0,
  };
}

/** Poids d'un candidat. Les indices sont ordonnés comme en solfège : le nombre
 *  d'accords expliqués d'abord, puis la dominante, puis la cadence. */
function weight(s: Scored): number {
  return (
    s.diatonic * 100 +
    s.borrowed * 40 -
    s.foreign * 60 +
    (s.dominant === 'seventh' ? 45 : s.dominant === 'triad' ? 20 : 0) +
    // Une suite d'accords est ici une BOUCLE : le premier accord est celui sur
    // lequel elle retombe à chaque tour, presque aussi parlant que le dernier.
    (s.lastIsTonic ? 30 : 0) +
    (s.firstIsTonic ? 25 : 0) +
    (s.minorFifth && s.dominant === null ? -35 : 0)
  );
}

/** Deux tonalités relatives (do majeur / la mineur) : mêmes notes, même chiffre
 *  Camelot, et l'ambiguïté la plus coûteuse à lever en solfège. */
function areRelatives(a: CamelotKey, b: CamelotKey): boolean {
  if (a.mode === b.mode) return false;
  const major = a.mode === 'major' ? a : b;
  const minor = a.mode === 'major' ? b : a;
  return (major.pc + 9) % 12 === minor.pc;
}

/**
 * Déduit la tonalité d'une suite d'accords. [SPEC-18.31]
 *
 * Rend toujours `evidence` ET `problems` : une hypothèse sans ses réserves serait
 * une affirmation, et c'est précisément ce qu'une déduction n'est pas.
 */
export function detectKey(symbols: string[]): KeyVerdict {
  const chords = symbols.map(parseChord);
  const readable = chords.filter((c) => c.rootPc !== null);
  const unreadable = chords.filter((c) => c.rootPc === null);

  const empty: KeyVerdict = {
    key: null,
    confidence: 'indéterminée',
    evidence: [],
    problems: [],
    rivals: [],
    roles: chords.map((c) => ({
      symbol: c.symbol,
      numeral: null,
      status: c.rootPc === null ? 'unreadable' : 'foreign',
    })),
  };

  if (readable.length === 0) {
    return { ...empty, problems: ['aucun accord lisible'] };
  }
  if (readable.length < 2) {
    return {
      ...empty,
      problems: [
        'un seul accord : il appartient à plusieurs tonalités, rien ne permet de trancher',
      ],
    };
  }

  const ranked = CAMELOT_KEYS.map((key) => score(key, readable)).sort(
    (a, b) => weight(b) - weight(a),
  );
  const best = ranked[0];
  const bestWeight = weight(best);
  // Deux critères, réunis : l'écart de poids (départage serré) ET « explique tous
  // les accords ». Le second est musical et ne dépend d'aucun barème : une lecture
  // qui rend compte de la totalité de la suite mérite d'être nommée même si le
  // barème la classe loin — c'est exactement le cas de `C F Ab Bb`, que l'auteur
  // lit en do majeur et le barème en fa majeur.
  // « Explique tous les accords » ne suffit pas : avec les dominantes secondaires,
  // presque toute tonalité y arrive. La rivale doit AUSSI rendre compte d'à peu
  // près autant d'accords sans emprunt — sinon `C F G C`, cas d'école, se voyait
  // affubler de dix lectures concurrentes.
  // Principe : une lecture qui n'a besoin d'AUCUN emprunt bat toute lecture qui en
  // demande un. Donc si l'hypothèse retenue est purement diatonique, seules les
  // rivales purement diatoniques comptent — sans quoi les dominantes secondaires
  // faisaient « expliquer tout » à presque n'importe quelle tonalité, et `C F G C`,
  // cas d'école, se voyait affubler de dix concurrentes. Si l'hypothèse retenue
  // s'appuie déjà sur des emprunts, les rivales qui en demandent d'autres
  // redeviennent légitimes : c'est le cas de `C F Ab Bb`.
  const rivalOk = (s: Scored): boolean =>
    s.explainsAll &&
    s.diatonic >= best.diatonic - 1 &&
    (best.borrowed === 0 ? s.borrowed === 0 : true);
  const rivals = ranked.slice(1).filter((s) => bestWeight - weight(s) <= 30 || rivalOk(s));

  const evidence: string[] = [];
  const problems: string[] = [];

  evidence.push(
    `${best.diatonic}/${readable.length} accord(s) diatonique(s) en ${longNoteFr(best.key)}`,
  );
  if (best.dominant === 'seventh') {
    evidence.push('une septième de dominante, dont le triton ne résout que d’une façon');
  } else if (best.dominant === 'triad') {
    evidence.push('un accord de dominante (Ve degré majeur)');
  }
  if (best.lastIsTonic) evidence.push('la suite finit sur la tonique');
  if (best.firstIsTonic) evidence.push('la suite commence sur la tonique');

  if (best.borrowed > 0) {
    problems.push(
      `${best.borrowed} accord(s) hors gamme mais explicable(s) comme emprunt — voir les rôles`,
    );
  }
  if (best.foreign > 0) {
    problems.push(
      `${best.foreign} accord(s) qu’aucune lecture de cette tonalité n’explique : la suite ` +
        `change peut-être de ton, ou n’est pas tonale`,
    );
  }
  if (unreadable.length > 0) {
    problems.push(
      `${unreadable.length} symbole(s) non reconnu(s), ignoré(s) : ${unreadable
        .map((c) => `« ${c.symbol} »`)
        .join(', ')}`,
    );
  }
  if (best.dominant === null) {
    problems.push('aucune dominante : l’indice le plus décisif manque');
  }

  // La relative est signalée, jamais comptée comme une incertitude : elle porte le
  // même chiffre Camelot, donc elle ne change rien à ce qui sera transposé.
  const relativeRival = rivals.find((r) => areRelatives(r.key, best.key));
  const decisiveRivals = rivals.filter((r) => r !== relativeRival);
  if (relativeRival) {
    problems.push(
      `${longNoteFr(relativeRival.key)} explique la suite aussi bien (relative) — même chiffre ` +
        `Camelot, donc sans effet sur la transposition`,
    );
  }
  const otherRivals = decisiveRivals;
  if (otherRivals.length > 0) {
    const shown = otherRivals.slice(0, 4).map((r) => longNoteFr(r.key)).join(', ');
    const rest = otherRivals.length - 4;
    problems.push(
      `autres lectures possibles : ${shown}${rest > 0 ? ` et ${rest} autre(s)` : ''}`,
    );
  }

  // Plusieurs lectures complètes et un vainqueur qui s'appuie sur des emprunts :
  // c'est l'oreille qui tranche, pas le calcul. Le dire, plutôt que choisir en
  // silence.
  const completeRivals = rivals.filter((r) => r.explainsAll && !areRelatives(r.key, best.key));
  if (completeRivals.length > 0 && best.borrowed > 0) {
    problems.push(
      `${completeRivals.length + 1} lectures expliquent TOUS les accords (${[best, ...completeRivals]
        .map((r) => longNoteFr(r.key))
        .join(', ')}) : ici l’oreille tranche, pas le calcul`,
    );
  }

  const confidence: Confidence =
    best.foreign > 0 ||
    decisiveRivals.length > 1 ||
    (completeRivals.length > 0 && best.borrowed > 0)
      ? 'incertaine'
      : decisiveRivals.length === 1 ||
          best.dominant === null ||
          best.borrowed > 0 ||
          unreadable.length > 0
        ? 'probable'
        : 'certaine';

  const roles: ChordRole[] = chords.map((chord) => {
    if (chord.rootPc === null) {
      return { symbol: chord.symbol, numeral: null, status: 'unreadable', note: 'symbole inconnu' };
    }
    const allowed = allowedPcs(best.key.pc, best.key.mode);
    const degree = degreeOf(chord.rootPc, best.key.pc, best.key.mode);
    if (chord.pcs.every((pc) => allowed.has(pc)) && degree !== null) {
      return {
        symbol: chord.symbol,
        numeral: numeralFor(degree, chord, best.key.mode),
        status: 'diatonic',
      };
    }
    const loan = borrowing(chord, best.key.pc, best.key.mode, readable);
    if (loan) return { symbol: chord.symbol, numeral: null, status: 'borrowed', note: loan };
    const outside = chord.pcs.filter((pc) => !allowed.has(pc));
    return {
      symbol: chord.symbol,
      numeral: null,
      status: 'foreign',
      note: `${outside.length} note(s) hors tonalité`,
    };
  });

  return { key: best.key, confidence, evidence, problems, rivals: rivals.map((r) => r.key), roles };
}
