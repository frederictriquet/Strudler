// [SPEC-18.13] Contextual help: explain the fragment under the caret, and pick a
// fragment to isolate. Pure logic — no DOM, no Svelte.
//
// This is NOT the Strudel code parser that [SPEC-18.6]/[SPEC-18.19] rule out: it
// never decides what is played and nothing is derived from it. It only *reads*
// the text to say something about it, and is free to give up (`null`) whenever it
// does not recognise what it sees. The pattern text stays the source of truth.
//
// The one thing it must never do is be WRONG: a false explanation costs more than
// no explanation. Hence two rules followed throughout:
//   - operators whose exact semantics we are not sure of are simply absent;
//   - anything computed from context (how many events per beat, how long a step
//     lasts) is only stated when the surrounding structure makes it certain —
//     `.`, euclid and patterned factors give up instead of guessing.
//
// The beat/cycle conversion is the point of most of this file. Beginners read
// `s("bd*8")` as "8 per beat"; it is 8 per CYCLE, and a cycle is 4 beats here
// (project convention, see Clock).

import { DEFAULT_BEATS_PER_CYCLE } from '@core/clock/Clock';

const BEATS = DEFAULT_BEATS_PER_CYCLE;

/** One row of the cheat sheet. */
export interface SyntaxEntry {
  /** How it is written, e.g. `*n`. */
  token: string;
  /** Two or three words. */
  label: string;
  /** The explanation itself, in French. */
  text: string;
  /** Identifiers this entry answers to (functions only). */
  names?: string[];
}

/** What `explainAt()` found. */
export interface Explanation {
  kind: 'operator' | 'function' | 'value';
  /** Exact source text of the recognised fragment. */
  token: string;
  label: string;
  text: string;
  /** Computed from the surrounding structure — absent when it cannot be certain. */
  detail?: string;
  /** Offsets of the fragment in the analysed text. */
  start: number;
  end: number;
}

/** What `fragmentAround()` chose. */
export interface Fragment {
  /** Offsets of the exact source portion. */
  start: number;
  end: number;
  /** Source text between those offsets. */
  text: string;
  /** Evaluable form: `text` plus the chained suffix of the enclosing `stack(...)`
   *  when the fragment is one of its layers, so it sounds as it did in the stack. */
  code: string;
  origin: 'selection' | 'layer' | 'expression';
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** Mini-notation, i.e. what goes INSIDE the quotes. [SPEC-18.13] */
export const MINI_NOTATION: SyntaxEntry[] = [
  {
    token: '~',
    label: 'silence',
    text: 'Un pas vide : rien n’est joué, mais la place est prise. `s("bd ~ sd ~")`. Le tiret `-` fait la même chose.',
  },
  {
    token: '*n',
    label: 'répétition serrée',
    text: 'Le fragment tient n fois dans l’emplacement qu’il occupe. `s("bd*8")` : 8 événements dans le cycle, soit 2 par beat.',
  },
  {
    token: '/n',
    label: 'étirement',
    text: 'Ralentit le fragment n fois : il occupe n fois plus de temps, donc on ne l’entend qu’une fois sur n. `s("bd/2")` : un bd un cycle sur deux.',
  },
  {
    token: '[ ]',
    label: 'sous-groupe',
    text: 'Serre plusieurs pas dans un seul emplacement. `s("bd [hh hh]")` : les deux hh se partagent le temps d’un seul pas.',
  },
  {
    token: '< >',
    label: 'alternance',
    text: 'Une valeur par cycle, dans l’ordre. `s("<bd sd>")` : bd un cycle, sd le suivant. Sert à écrire une phrase plus longue qu’un cycle.',
  },
  {
    token: ',',
    label: 'superposition',
    text: 'Sépare des couches jouées en même temps à l’intérieur d’un groupe. `s("[bd*4, hh*8]")`.',
  },
  {
    token: '|',
    label: 'choix aléatoire',
    text: 'Une des alternatives est tirée au sort à chaque cycle. `s("bd|sd|hh")`.',
  },
  {
    token: '!n',
    label: 'répétition littérale',
    text: 'Répète le pas n fois en occupant n emplacements — au contraire de `*n` qui les serre dans un seul. `s("bd!3 sd")` = `s("bd bd bd sd")`.',
  },
  {
    token: '@n',
    label: 'poids',
    text: 'Le pas occupe n emplacements au lieu d’un. `s("bd@3 sd")` : bd prend les trois quarts du cycle.',
  },
  {
    token: '_',
    label: 'allongement',
    text: 'Donne un emplacement de plus au pas précédent, qui dure d’autant. `note("c3 _ e3 _")` : deux notes de deux pas.',
  },
  {
    token: ':n',
    label: 'index d’échantillon',
    text: 'Choisit le n-ième échantillon de la banque, à partir de 0. `s("cp:1")` : le deuxième clap. Équivaut à `.n(1)`.',
  },
  {
    token: '(p,s)',
    label: 'rythme euclidien',
    text: 'Répartit p frappes aussi régulièrement que possible sur s pas. `s("bd(3,8)")`. Une troisième valeur `(p,s,r)` décale le motif de r pas.',
  },
  {
    token: '?',
    label: 'probabilité',
    text: 'L’événement a une chance sur deux d’être supprimé. `s("hh*8?")`. Un nombre change la probabilité : `hh?0.2` en supprime 20 %.',
  },
  {
    token: '.',
    label: 'découpage en groupes',
    text: 'Découpe la séquence en groupes de durée égale, comme des `[ ]` implicites. `s("bd sd . hh hh hh")` : une moitié de cycle pour chaque groupe.',
  },
];

/** Functions actually used by the project's tracks, plus the few the assistants
 *  write. Deliberately short — this is a reminder, not documentation. */
export const FUNCTIONS: SyntaxEntry[] = [
  {
    token: 's("…")',
    names: ['s', 'sound'],
    label: 'son',
    text: 'Choisit le son : un échantillon (`bd`, `hh`, `piano`) ou un synthé (`supersaw`). `s("bd*4")`.',
  },
  {
    token: 'n("…")',
    names: ['n'],
    label: 'numéro',
    text: 'Index de l’échantillon dans la banque choisie par `s` — `s("808oh").n(4)`. Sur un synthé ou une banque chromatique, c’est une hauteur en demi-tons.',
  },
  {
    token: 'note("…")',
    names: ['note'],
    label: 'hauteur',
    text: 'Hauteur nommée (`c2`, `eb2`, `g#3`) ou numéro MIDI. `note("c2 ~ eb2").s("jvbass")`.',
  },
  {
    token: 'stack(a, b)',
    names: ['stack'],
    label: 'superposition',
    text:
      'Joue plusieurs patterns en même temps. C’est la couche : un argument = une ligne du morceau. ' +
      '⚠ Un appel chaîné APRÈS le `stack` s’applique à chaque couche — voir les pièges.',
  },
  {
    token: 'cat(a, b)',
    names: ['cat', 'slowcat'],
    label: 'enchaînement',
    text: 'Joue les patterns l’un après l’autre, un par cycle.',
  },
  {
    token: '.slow(n)',
    names: ['slow'],
    label: 'ralentir',
    text: 'Étire tout le pattern sur n cycles. `.slow(2)` : la boucle dure 2 cycles, soit 8 beats.',
  },
  {
    token: '.fast(n)',
    names: ['fast'],
    label: 'accélérer',
    text: 'Joue tout le pattern n fois par cycle. Inverse de `.slow(n)`.',
  },
  {
    token: '.every(n, f)',
    names: ['every'],
    label: 'un cycle sur n',
    text: 'Applique la fonction f un cycle sur n. `.every(4, fast(2))`.',
  },
  {
    token: '.gain(v)',
    names: ['gain'],
    label: 'volume',
    text: 'Volume de chaque événement, autour de 0 à 1. Peut être un pattern : `.gain("[0.45 0.28]*8")` accentue un coup sur deux.',
  },
  {
    token: '.lpf(hz)',
    names: ['lpf', 'cutoff'],
    label: 'passe-bas',
    text: 'Filtre passe-bas : ne laisse passer que ce qui est sous la fréquence donnée, en Hz. `.lpf(800)` assourdit.',
  },
  {
    token: '.room(v)',
    names: ['room'],
    label: 'réverbération',
    text: 'Quantité de réverbération, de 0 à 1. Éloigne le son.',
  },
  {
    token: '.speed(v)',
    names: ['speed'],
    label: 'vitesse de lecture',
    text: 'Vitesse de lecture de l’échantillon : 2 = deux fois plus rapide et une octave plus haut, 0.7 = plus lent et plus grave.',
  },
  {
    token: '.delay(v)',
    names: ['delay'],
    label: 'écho',
    text: 'Quantité d’écho, de 0 à 1. Se règle avec `.delaytime()` (intervalle entre les répétitions) et `.delayfeedback()` (combien il en reste à chaque fois).',
  },
  {
    token: 'chord("…")',
    names: ['chord'],
    label: 'accords',
    text: 'Pattern de symboles d’accords (`C`, `G#m`, `F#7`). Ne produit des notes qu’une fois passé à `.voicing()`.',
  },
  {
    token: '.voicing()',
    names: ['voicing'],
    label: 'renversement',
    text: 'Transforme les accords en notes, en choisissant à chaque fois le renversement le plus proche du précédent : la progression reste dans un registre au lieu de sauter.',
  },
  {
    token: '.dict("…")',
    names: ['dict'],
    label: 'dictionnaire d’accords',
    text: 'Table d’accords utilisée par `.voicing()`. `"triads"` donne des accords à trois sons ; le défaut (`ireal`) ajoute des septièmes.',
  },
  {
    token: '.anchor("c4")',
    names: ['anchor'],
    label: 'ancrage',
    text: 'Note de référence dont `.voicing()` rapproche les accords — elle fixe le registre.',
  },
  {
    token: '.rootNotes(oct)',
    names: ['rootNotes'],
    label: 'fondamentales',
    text: 'Ne garde que la fondamentale de chaque accord, à l’octave donnée : la ligne de basse d’une progression.',
  },
  {
    token: '.add(v)',
    names: ['add'],
    label: 'décalage',
    text: 'Ajoute une valeur au contrôle en cours. `.add(note(12))` transpose d’une octave.',
  },
  {
    token: 'silence',
    names: ['silence'],
    label: 'rien',
    text: 'Le pattern vide. Utile pour couper une couche sans effacer son code.',
  },
];

const FUNCTION_INDEX = new Map<string, SyntaxEntry>();
for (const entry of FUNCTIONS) {
  for (const name of entry.names ?? [entry.token]) FUNCTION_INDEX.set(name, entry);
}

const MINI_INDEX = new Map<string, SyntaxEntry>();
for (const entry of MINI_NOTATION) MINI_INDEX.set(entry.token, entry);

/** Table lookup, so the component never duplicates a wording. */
function mini(token: string): SyntaxEntry {
  const entry = MINI_INDEX.get(token);
  // Unreachable unless a token below is renamed in the table without being
  // renamed here — surface it rather than showing an empty tooltip.
  if (!entry) throw new Error(`miniNotation: no entry for "${token}"`);
  return entry;
}

// ---------------------------------------------------------------------------
// Strings: where mini-notation lives
// ---------------------------------------------------------------------------

interface Span {
  /** First character of the content (after the quote). */
  start: number;
  /** One past the last character of the content. */
  end: number;
  /** Offset of the opening quote, to look up the function being called. */
  quote: number;
}

/** Content spans of every string literal, in order. Same quote handling as
 *  `layers.ts`: what is inside quotes is data, not syntax. */
function stringSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '"' && ch !== "'" && ch !== '`') continue;
    const open = i;
    i++;
    while (i < text.length && text[i] !== ch) {
      if (text[i] === '\\') i++;
      i++;
    }
    spans.push({ start: open + 1, end: Math.min(i, text.length), quote: open });
    // i now sits on the closing quote (or past the end); the loop increments.
  }
  return spans;
}

function spanAt(spans: Span[], pos: number): Span | null {
  for (const s of spans) if (pos >= s.start && pos < s.end) return s;
  return null;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Identifier ending just before `pos` (skipping spaces), e.g. the callee of a
 *  `(`. Empty when there is none. */
function identBefore(text: string, pos: number): string {
  let i = pos - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  const end = i + 1;
  while (i >= 0 && /[A-Za-z0-9_$]/.test(text[i])) i--;
  const name = text.slice(i + 1, end);
  return IDENT.test(name) ? name : '';
}

/** Name of the function whose argument list this string opens, e.g. `dict` for
 *  the `"triads"` of `.dict("triads")`. Empty when the string is not a first
 *  argument. Only looks back over `(`, so `f(1, "x")` yields nothing. */
function calleeOfString(text: string, quote: number): { name: string; start: number } | null {
  let i = quote - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  if (text[i] !== '(') return null;
  i--;
  while (i >= 0 && /\s/.test(text[i])) i--;
  const end = i + 1;
  while (i >= 0 && /[A-Za-z0-9_$]/.test(text[i])) i--;
  const name = text.slice(i + 1, end);
  return IDENT.test(name) ? { name, start: i + 1 } : null;
}

// ---------------------------------------------------------------------------
// Mini-notation parsing
// ---------------------------------------------------------------------------

type ModKind = '*' | '/' | '!' | '@' | '?' | ':' | 'euclid';

interface Mod {
  kind: ModKind;
  start: number;
  end: number;
  /** Numeric argument when there is one and it is a plain number. */
  value: number | null;
  /** Euclid arguments, source text. */
  args?: string[];
}

interface Primary {
  kind: 'word' | 'rest' | 'hold' | 'group';
  start: number;
  end: number;
  group?: Group;
}

interface Step {
  start: number;
  end: number;
  primary: Primary;
  mods: Mod[];
  /** Slots this step takes in its sequence (`@n`, or `_` following it). */
  weight: number;
  /** Copies it is repeated into (`!n`), each of them one slot wide. */
  repeat: number;
}

interface Separator {
  pos: number;
  kind: ',' | '|' | '.';
}

interface Branch {
  steps: Step[];
  /** A `.` was used: slot widths are no longer uniform in a way we model. */
  feet: boolean;
}

interface Group {
  kind: 'seq' | 'alt' | 'poly';
  /** Includes the delimiters when there are any. */
  start: number;
  end: number;
  /** Whether `start`/`end` sit on a delimiter character. */
  delimited: boolean;
  branches: Branch[];
  separators: Separator[];
}

function isWordChar(text: string, i: number): boolean {
  const c = text[i];
  if (c === undefined) return false;
  if (/[A-Za-z0-9#'^]/.test(c)) return true;
  // A dot is a decimal point only when a digit follows; otherwise it is the
  // group separator. Same idea for a minus sign, which is otherwise a rest.
  if (c === '.') return /[0-9]/.test(text[i + 1] ?? '');
  if (c === '-') return /[0-9.]/.test(text[i + 1] ?? '');
  return false;
}

const CLOSERS: Record<string, string> = { '[': ']', '<': '>', '{': '}' };

interface Cursor {
  text: string;
  i: number;
  limit: number;
}

function skipSpace(c: Cursor): void {
  while (c.i < c.limit && /\s/.test(c.text[c.i])) c.i++;
}

function readNumber(c: Cursor): number | null {
  const start = c.i;
  if (c.text[c.i] === '-') c.i++;
  while (c.i < c.limit && /[0-9.]/.test(c.text[c.i])) c.i++;
  if (c.i === start) return null;
  const n = Number(c.text.slice(start, c.i));
  return Number.isFinite(n) ? n : null;
}

function parsePrimary(c: Cursor): Primary | null {
  const start = c.i;
  const ch = c.text[c.i];
  if (ch === undefined) return null;

  // `${VAR}` is a library-level substitution [SPEC-4.7], not a polymeter.
  if (ch === '$' && c.text[c.i + 1] === '{') {
    c.i += 2;
    while (c.i < c.limit && c.text[c.i] !== '}') c.i++;
    if (c.i < c.limit) c.i++;
    return { kind: 'word', start, end: c.i };
  }
  if (ch === '~' || (ch === '-' && !isWordChar(c.text, c.i))) {
    c.i++;
    return { kind: 'rest', start, end: c.i };
  }
  if (ch === '_' && !isWordChar(c.text, c.i + 1)) {
    c.i++;
    return { kind: 'hold', start, end: c.i };
  }
  if (ch === '[' || ch === '<' || ch === '{') {
    const group = parseGroup(c, ch);
    return { kind: 'group', start, end: group.end, group };
  }
  if (isWordChar(c.text, c.i) || ch === '_') {
    while (c.i < c.limit && (isWordChar(c.text, c.i) || c.text[c.i] === '_')) c.i++;
    return { kind: 'word', start, end: c.i };
  }
  return null;
}

function parseMods(c: Cursor): Mod[] {
  const mods: Mod[] = [];
  for (;;) {
    const start = c.i;
    const ch = c.text[c.i];
    if (ch === '*' || ch === '/') {
      c.i++;
      // The factor may itself be a pattern (`bd*<2 3>`): parse it so we do not
      // stop mid-step, but report no value — the timing then stays unknown.
      let value: number | null;
      if (c.text[c.i] === '[' || c.text[c.i] === '<' || c.text[c.i] === '{') {
        parsePrimary(c);
        value = null;
      } else value = readNumber(c);
      mods.push({ kind: ch, start, end: c.i, value });
      continue;
    }
    if (ch === '!' || ch === '@' || ch === ':' || ch === '?') {
      c.i++;
      const value = readNumber(c);
      const fallback = ch === '!' ? 2 : ch === '?' ? 0.5 : null;
      mods.push({ kind: ch, start, end: c.i, value: value ?? fallback });
      continue;
    }
    if (ch === '(') {
      c.i++;
      const args: string[] = [];
      let arg = '';
      let depth = 1;
      while (c.i < c.limit && depth > 0) {
        const k = c.text[c.i];
        if (k === '(') depth++;
        if (k === ')') {
          depth--;
          if (depth === 0) break;
        }
        if (k === ',' && depth === 1) {
          args.push(arg.trim());
          arg = '';
        } else arg += k;
        c.i++;
      }
      args.push(arg.trim());
      if (c.i < c.limit) c.i++; // closing paren
      mods.push({ kind: 'euclid', start, end: c.i, value: null, args });
      continue;
    }
    return mods;
  }
}

function parseGroup(c: Cursor, opener?: string): Group {
  const start = c.i;
  if (opener) c.i++; // consume the opening delimiter
  const closer = opener ? CLOSERS[opener] : undefined;
  const kind: Group['kind'] = opener === '<' ? 'alt' : opener === '{' ? 'poly' : 'seq';

  const branches: Branch[] = [];
  const separators: Separator[] = [];
  let branch: Branch = { steps: [], feet: false };
  let previous: Step | null = null;

  for (;;) {
    skipSpace(c);
    if (c.i >= c.limit) break;
    const ch = c.text[c.i];
    if (closer && ch === closer) {
      c.i++;
      break;
    }
    if (ch === ',' || ch === '|') {
      separators.push({ pos: c.i, kind: ch });
      branches.push(branch);
      branch = { steps: [], feet: false };
      previous = null;
      c.i++;
      continue;
    }
    if (ch === '.' && !isWordChar(c.text, c.i)) {
      separators.push({ pos: c.i, kind: '.' });
      branch.feet = true;
      c.i++;
      continue;
    }

    const before = c.i;
    const primary = parsePrimary(c);
    if (!primary) {
      c.i++; // unknown character: skip it rather than loop forever
      continue;
    }
    const mods = parseMods(c);
    const at = (k: ModKind): number | null => mods.find((m) => m.kind === k)?.value ?? null;
    const step: Step = {
      start: before,
      end: c.i,
      primary,
      mods,
      weight: at('@') ?? 1,
      repeat: at('!') ?? 1,
    };
    // `_` is not a step of its own: it lengthens the previous one. It is kept in
    // the list (with weight 0) so the caret can still land on it.
    if (primary.kind === 'hold') {
      step.weight = 0;
      if (previous) previous.weight += 1;
    } else previous = step;
    branch.steps.push(step);
  }

  branches.push(branch);
  return {
    kind,
    start,
    end: c.i,
    delimited: opener !== undefined,
    branches,
    separators,
  };
}

// ---------------------------------------------------------------------------
// Locating the caret inside the parsed tree, with the timing that goes with it
// ---------------------------------------------------------------------------

interface Hit {
  target: 'mod' | 'primary' | 'delimiter' | 'separator';
  step?: Step;
  mod?: Mod;
  group?: Group;
  separator?: Separator;
  /** Duration in cycles of ONE occurrence of the step's slot; null when the
   *  structure makes it uncertain (feet, euclid, patterned factor…). */
  slot: number | null;
}

/** Total slots of a branch — `x@3` takes 3, `x!3` takes 3, `_` gave its slot to
 *  the step before it. */
function branchSlots(branch: Branch): number {
  let total = 0;
  for (const s of branch.steps) total += s.weight * s.repeat;
  return total;
}

function stepSlot(
  group: Group,
  branch: Branch,
  step: Step,
  groupDur: number | null,
): number | null {
  if (groupDur === null || branch.feet || step.weight === 0) return null;
  const total = branchSlots(branch);
  if (total <= 0) return null;
  // In `<a b>` every value fills the whole slot, one per cycle: `<a b>` is
  // `[a b]/2`, so an occurrence lasts the group's own duration (times its weight).
  if (group.kind === 'alt') return groupDur * step.weight;
  if (group.kind === 'poly') return null; // polymeter: not modelled
  return (groupDur * step.weight) / total;
}

/** Duration of the content inside a step's group, once its own modifiers are
 *  applied. Null as soon as one of them makes it uncertain. */
function innerDur(step: Step, slot: number | null): number | null {
  if (slot === null) return null;
  let dur = slot;
  for (const m of step.mods) {
    if (m.kind === 'euclid') return null;
    if (m.kind === '*' || m.kind === '/') {
      if (m.value === null || m.value <= 0) return null;
      dur = m.kind === '*' ? dur / m.value : dur * m.value;
    }
  }
  return dur;
}

function locate(group: Group, pos: number, groupDur: number | null): Hit | null {
  if (pos < group.start || pos >= group.end) return null;

  for (const branch of group.branches) {
    for (const step of branch.steps) {
      if (pos < step.start || pos >= step.end) continue;
      const slot = stepSlot(group, branch, step, groupDur);
      const { primary } = step;
      if (primary.kind === 'group' && primary.group && pos < primary.end) {
        const deeper = locate(primary.group, pos, innerDur(step, slot));
        if (deeper) return deeper;
      }
      for (const mod of step.mods) {
        if (pos >= mod.start && pos < mod.end) return { target: 'mod', step, mod, slot };
      }
      return { target: 'primary', step, slot };
    }
  }

  for (const sep of group.separators) {
    if (pos === sep.pos) return { target: 'separator', separator: sep, group, slot: groupDur };
  }
  // Only the delimiters themselves are worth explaining; whitespace is not.
  if (group.delimited && (pos === group.start || pos === group.end - 1)) {
    return { target: 'delimiter', group, slot: groupDur };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wording the numbers
// ---------------------------------------------------------------------------

/** Beats as a readable fraction; null when it is not a simple one. */
function formatBeats(beats: number): string | null {
  if (!Number.isFinite(beats) || beats <= 0) return null;
  const denom = 1920; // 2^7·3·5 — halves, thirds, fifths and their combinations
  const scaled = beats * denom;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6 || rounded <= 0) return null;
  const g = gcd(rounded, denom);
  const num = rounded / g;
  const den = denom / g;
  if (den > 64) return null; // exact, but no longer readable — say nothing
  if (den === 1) return num === 1 ? '1 beat' : `${num} beats`;
  return `${num}/${den} de beat`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** "8 événements dans le cycle, soit 2 par beat". The sentence the whole file
 *  exists for: it converts a count into the beat the user is counting. */
function rateSentence(count: number, slotCycles: number, unit: string): string | null {
  const beats = slotCycles * BEATS;
  if (!Number.isFinite(beats) || beats <= 0 || count <= 0) return null;
  let where: string;
  if (beats === BEATS) where = 'dans le cycle';
  else {
    const span = formatBeats(beats);
    if (!span) return null;
    where = `dans un emplacement de ${span}`;
  }
  const perBeat = count / beats;
  let rate: string;
  if (Number.isInteger(perBeat)) {
    rate = perBeat === 1 ? 'soit un par beat' : `soit ${perBeat} par beat`;
  } else {
    const every = formatBeats(1 / perBeat);
    if (!every) return null;
    rate = `soit un toutes les ${every}`;
  }
  return `${count} ${unit} ${where}, ${rate} — 1 cycle = ${BEATS} beats.`;
}

function slotSentence(slot: number | null): string | undefined {
  if (slot === null) return undefined;
  if (slot === 1) return `Ce pas occupe tout le cycle (${BEATS} beats).`;
  const beats = formatBeats(slot * BEATS);
  return beats ? `Ce pas dure ${beats}.` : undefined;
}

// ---------------------------------------------------------------------------
// explainAt
// ---------------------------------------------------------------------------

function fromEntry(
  entry: SyntaxEntry,
  kind: Explanation['kind'],
  token: string,
  start: number,
  end: number,
  detail?: string,
): Explanation {
  return { kind, token, label: entry.label, text: entry.text, detail, start, end };
}

/** The unit `*n` and friends repeat: a bare word gives events, a group gives
 *  repetitions of that group. */
function repeatUnit(step: Step, plural: boolean): string {
  const one = step.primary.kind === 'group' ? 'répétition' : 'événement';
  return plural ? `${one}s` : one;
}

function explainHit(text: string, hit: Hit): Explanation | null {
  const slice = (a: number, b: number) => text.slice(a, b);

  if (hit.target === 'mod' && hit.mod && hit.step) {
    const { mod, step, slot } = hit;
    const token = slice(mod.start, mod.end);
    switch (mod.kind) {
      case '*': {
        const detail =
          mod.value !== null && slot !== null
            ? (rateSentence(mod.value, slot, repeatUnit(step, mod.value > 1)) ?? undefined)
            : undefined;
        return fromEntry(mini('*n'), 'operator', token, mod.start, mod.end, detail);
      }
      case '/': {
        const beats =
          mod.value !== null && slot !== null ? formatBeats(mod.value * slot * BEATS) : null;
        return fromEntry(
          mini('/n'),
          'operator',
          token,
          mod.start,
          mod.end,
          beats ? `Ici : une fois toutes les ${beats}.` : undefined,
        );
      }
      case '!': {
        const beats = slot !== null ? formatBeats(slot * BEATS) : null;
        return fromEntry(
          mini('!n'),
          'operator',
          token,
          mod.start,
          mod.end,
          beats && mod.value !== null ? `Ici : ${mod.value} copies de ${beats} chacune.` : undefined,
        );
      }
      case '@':
        return fromEntry(mini('@n'), 'operator', token, mod.start, mod.end, slotSentence(slot));
      case ':':
        return fromEntry(mini(':n'), 'operator', token, mod.start, mod.end);
      case '?':
        return fromEntry(mini('?'), 'operator', token, mod.start, mod.end);
      case 'euclid': {
        const [pulses, steps] = mod.args ?? [];
        const beats = slot !== null ? formatBeats(slot * BEATS) : null;
        const detail =
          beats && pulses && steps
            ? `Ici : ${pulses} frappes réparties sur ${steps} pas occupant ${beats}.`
            : undefined;
        return fromEntry(mini('(p,s)'), 'operator', token, mod.start, mod.end, detail);
      }
    }
  }

  if (hit.target === 'primary' && hit.step) {
    const { step, slot } = hit;
    const p = step.primary;
    const token = slice(p.start, p.end);
    if (p.kind === 'rest') {
      return fromEntry(mini('~'), 'operator', token, p.start, p.end, slotSentence(slot));
    }
    if (p.kind === 'hold') {
      return fromEntry(mini('_'), 'operator', token, p.start, p.end);
    }
    if (p.kind === 'word') {
      const numeric = /^-?[0-9.]+$/.test(token);
      return {
        kind: 'value',
        token,
        label: numeric ? 'nombre' : 'valeur',
        text: numeric
          ? 'Un nombre : son sens dépend du contrôle autour de la chaîne (index d’échantillon, hauteur, volume…).'
          : 'Un nom : son, note ou accord selon le contrôle autour de la chaîne. Sa position dans la séquence fixe son moment.',
        detail: slotSentence(slot),
        start: p.start,
        end: p.end,
      };
    }
  }

  if (hit.target === 'delimiter' && hit.group) {
    const g = hit.group;
    const token = slice(g.start, Math.min(g.end, g.start + 1));
    if (g.kind === 'alt') return fromEntry(mini('< >'), 'operator', token, g.start, g.end);
    if (g.kind === 'seq') return fromEntry(mini('[ ]'), 'operator', token, g.start, g.end);
    return null; // polymeter `{ }`: not explained, see header
  }

  if (hit.target === 'separator' && hit.separator) {
    const s = hit.separator;
    const token = s.kind;
    const entry = s.kind === ',' ? mini(',') : s.kind === '|' ? mini('|') : mini('.');
    return fromEntry(entry, 'operator', token, s.pos, s.pos + 1);
  }

  return null;
}

function explainExact(text: string, pos: number, spans: Span[]): Explanation | null {
  if (pos < 0 || pos >= text.length) return null;

  const span = spanAt(spans, pos);
  if (span) {
    const content = text.slice(span.start, span.end);
    // A string holding a single bare word is usually an argument, not a rhythm
    // (`.dict("triads")`, `.s("piano")`): explaining the function teaches more.
    if (/^[A-Za-z][A-Za-z0-9#'^_.-]*$/.test(content.trim())) {
      const callee = calleeOfString(text, span.quote);
      const entry = callee ? FUNCTION_INDEX.get(callee.name) : undefined;
      if (entry && callee) {
        const end = callee.start + callee.name.length;
        return fromEntry(entry, 'function', callee.name, callee.start, end);
      }
    }
    const cursor: Cursor = { text, i: span.start, limit: span.end };
    const group = parseGroup(cursor);
    const hit = locate(group, pos, 1);
    return hit ? explainHit(text, hit) : null;
  }

  // Outside strings: only identifiers we know about.
  if (!/[A-Za-z0-9_$]/.test(text[pos])) return null;
  let start = pos;
  while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1])) start--;
  let end = pos;
  while (end < text.length && /[A-Za-z0-9_$]/.test(text[end])) end++;
  const name = text.slice(start, end);
  const entry = FUNCTION_INDEX.get(name);
  return entry ? fromEntry(entry, 'function', name, start, end) : null;
}

/**
 * Explain the fragment under the caret. [SPEC-18.13]
 *
 * The caret sits BETWEEN two characters: the one on its right is tried first,
 * then the one on its left — so an operator just typed is explained immediately
 * even though the caret is now past it.
 *
 * Never throws: returns null whenever nothing is recognised (which includes
 * half-typed text, and is the normal case while typing).
 */
/**
 * Rules that bite rather than tokens to look up. [SPEC-18.13]
 *
 * Each one is a mistake that produces NO error message — the pattern evaluates and
 * something plays, just not what was meant. That silence is exactly why they belong
 * in the sheet: a beginner has no way to discover them from a failure.
 *
 * No `names`, so `explainAt()` never matches them: they are reference material, not
 * things one puts a caret on.
 */
export const PITFALLS: SyntaxEntry[] = [
  {
    token: 'stack(…).s()',
    label: 'suffixe global',
    text:
      'Un appel chaîné après un `stack` s’applique à toutes ses couches, et un contrôle posé plus tard gagne. ' +
      'Sur une couche déjà complète (`n(…).sound("sawtooth")`), le `.s()` final emballe sa valeur au lieu de la compléter : ' +
      'elle devient muette, sans erreur. Mettez `s(…)` sur chaque couche, ou n’appliquez le suffixe qu’à un sous-`stack`.',
  },
  {
    token: '*n contre !n',
    label: 'serrer ou occuper',
    text:
      '`*n` répète dans l’emplacement occupé : `"bd*7 hh"` entasse 7 kicks dans la première moitié du cycle. ' +
      '`!n` répète en prenant n pas : `"bd!7 hh"` donne 8 pas réguliers. Même nombre de frappes, rythme opposé.',
  },
  {
    token: '.late(n)',
    label: 'décalage en cycles',
    text:
      'Décale en cycles, pas en beats. Un cycle = 4 beats, donc un demi-beat s’écrit `.late(1/8)`. ' +
      '`.late(0.5)` décale de 2 beats — sur un motif régulier, cela retombe sur le temps et rien ne change à l’oreille.',
  },
  {
    token: '.slow(n)',
    label: 'étire, ne rallonge pas',
    text:
      'Étire le contenu ; cela ne crée pas une phrase plus longue. `s("bd*8").slow(2)` redevient un kick par beat, ' +
      'identique à `s("bd*4")`. Une phrase de 8 beats exige que les deux mesures diffèrent : `<…>` ou `cat(…)`.',
  },
];

/**
 * Split help text on its backtick-delimited code spans. [SPEC-18.13]
 *
 * The tables mark code with backticks; a view must render those as code rather
 * than print the character. Splitting — never injecting HTML — keeps the help
 * text data, so an entry can never smuggle markup into the page.
 *
 * Shared by the caret explanation and the cheat sheet, which render the same
 * entries in two different places.
 */
export function codeSegments(source: string): Array<{ code: boolean; value: string }> {
  return source
    .split('`')
    .map((value, i) => ({ code: i % 2 === 1, value }))
    .filter((segment) => segment.value !== '');
}

export function explainAt(text: string, caret: number): Explanation | null {
  try {
    if (typeof text !== 'string' || text === '') return null;
    const pos = Math.max(0, Math.min(text.length, Math.trunc(caret) || 0));
    const spans = stringSpans(text);
    return explainExact(text, pos, spans) ?? explainExact(text, pos - 1, spans);
  } catch (err) {
    // A bug here must not take the workshop down, but must not be silent either
    // [SPEC-14.3]. Not a user-facing error: the text is simply not explained.
    console.warn('explainAt failed', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// fragmentAround
// ---------------------------------------------------------------------------

/** Offsets of the enclosing `(`/`[`/`{`, outermost first, ignoring strings. */
function openerStack(text: string, pos: number): number[] {
  const stack: number[] = [];
  let quote: string | null = null;
  for (let i = 0; i < pos && i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') stack.push(i);
    else if (ch === ')' || ch === ']' || ch === '}') stack.pop();
  }
  return stack;
}

interface Args {
  /** Top-level argument ranges, including surrounding whitespace. */
  ranges: Array<{ start: number; end: number }>;
  /** Offset of the matching closing paren, or -1 when unbalanced. */
  close: number;
}

/** Split the argument list opened at `open` on its top-level commas. */
function splitArgs(text: string, open: number): Args {
  const ranges: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let quote: string | null = null;
  let start = open + 1;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        ranges.push({ start, end: i });
        return { ranges, close: i };
      }
    } else if (ch === ',' && depth === 1) {
      ranges.push({ start, end: i });
      start = i + 1;
    }
  }
  return { ranges, close: -1 };
}

/** The `.foo(...)` chain that follows `from`, e.g. `.s("piano").gain(0.7)`. */
function chainedSuffix(text: string, from: number): string {
  let i = from;
  let end = from;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '.') return text.slice(from, end).trim();
    i++;
    while (i < text.length && /[A-Za-z0-9_$]/.test(text[i])) i++;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '(') return text.slice(from, end).trim();
    const { close } = splitArgs(text, i);
    if (close < 0) return text.slice(from, end).trim();
    i = close + 1;
    end = i;
  }
}

/** Trim whitespace by moving the bounds, so offsets stay meaningful. */
function trimRange(text: string, start: number, end: number): { start: number; end: number } {
  let a = start;
  let b = end;
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  return { start: a, end: b };
}

/**
 * The fragment to isolate. [SPEC-18.13]
 *
 * A non-empty selection is taken as-is (whitespace trimmed off its ends): the
 * user said what they meant.
 *
 * With an empty selection the "reasonable" fragment is the smallest thing around
 * the caret that can be PLAYED on its own — isolating must produce something
 * evaluable, so a bare `bd*8` taken out of `s("bd*8 sd")` would be useless:
 *   1. the layer of the enclosing `stack(...)`/`cat(...)` the caret is in — that
 *      is one line of the piece, the unit the layer strip already works with;
 *      the stack's chained suffix (`.s("piano").gain(0.7)`) is appended to `code`
 *      so the layer sounds as it did inside the stack;
 *   2. otherwise the whole pattern (a pattern is a single expression, so being
 *      anywhere in it — including inside a `.gain(…)` chained onto it — means the
 *      whole thing is the enclosing playable expression).
 * Being inside a string changes nothing: the enclosing call is what gets picked.
 *
 * Never throws; returns null when there is nothing but whitespace.
 */
export function fragmentAround(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): Fragment | null {
  try {
    if (typeof text !== 'string' || text.trim() === '') return null;
    const len = text.length;
    const clamp = (n: number) => Math.max(0, Math.min(len, Math.trunc(n) || 0));
    let a = clamp(selectionStart);
    let b = clamp(selectionEnd);
    if (a > b) [a, b] = [b, a];

    if (a !== b) {
      const r = trimRange(text, a, b);
      if (r.start >= r.end) return null;
      const picked = text.slice(r.start, r.end);
      return { start: r.start, end: r.end, text: picked, code: picked, origin: 'selection' };
    }

    for (const open of openerStack(text, a).reverse()) {
      if (text[open] !== '(') continue;
      const callee = identBefore(text, open);
      if (callee !== 'stack' && callee !== 'cat' && callee !== 'slowcat') continue;
      const { ranges, close } = splitArgs(text, open);
      const range = ranges.find((r) => a >= r.start && a <= r.end);
      if (!range) continue;
      const r = trimRange(text, range.start, range.end);
      if (r.start >= r.end) continue;
      const layer = text.slice(r.start, r.end);
      const suffix = close >= 0 ? chainedSuffix(text, close + 1) : '';
      return {
        start: r.start,
        end: r.end,
        text: layer,
        code: layer + suffix,
        origin: 'layer',
      };
    }

    const whole = trimRange(text, 0, len);
    if (whole.start >= whole.end) return null;
    const picked = text.slice(whole.start, whole.end);
    return {
      start: whole.start,
      end: whole.end,
      text: picked,
      code: picked,
      origin: 'expression',
    };
  } catch (err) {
    console.warn('fragmentAround failed', err); // see explainAt
    return null;
  }
}
