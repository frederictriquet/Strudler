// [SPEC-17.58] Empêcher la mise en veille pendant la lecture.
//
// Un set dure plus longtemps que le délai de veille par défaut, et l'écran qui
// s'éteint en plein jeu coûte le retour visuel — pads, chronomètre, position —
// au moment où il sert le plus. L'API Screen Wake Lock est la seule réponse
// disponible à une page web : elle demande au système de garder l'écran allumé,
// ce qui suspend du même coup la veille d'inactivité.
//
// Ses limites sont structurelles, et il faut les dire plutôt que promettre :
// - le verrou est **relâché par le navigateur** dès que la page n'est plus
//   visible (autre onglet, fenêtre minimisée) ; on le redemande au retour ;
// - il ne couvre **ni** la fermeture du capot, **ni** une mise en veille
//   explicite, **ni** la coupure de l'écran par un raccourci ;
// - il exige un contexte sécurisé — `localhost` en est un.
//
// Aucune dépendance à l'UI ici : les échecs partent dans un rapporteur fourni
// par le store, qui les affiche [SPEC-14.3].

type Level = 'warn' | 'info';
type Reporter = (level: Level, message: string) => void;
type ChangeListener = (held: boolean) => void;

let sentinel: WakeLockSentinel | null = null;
/** Le verrou est-il SOUHAITÉ (transport en lecture) ? Distinct de « tenu ». */
let wanted = false;
let report: Reporter = () => {};
const listeners = new Set<ChangeListener>();
/** Un échec est signalé une fois par session : sur scène, un toast par tentative
 *  serait pire que le problème. */
let failureReported = false;
let listening = false;

export function setWakeLockReporter(fn: Reporter): void {
  report = fn;
}

export function onWakeLockChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  listener(isWakeLockHeld());
  return () => listeners.delete(listener);
}

function emit(): void {
  const held = isWakeLockHeld();
  for (const l of listeners) l(held);
}

export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export function isWakeLockHeld(): boolean {
  return sentinel !== null && !sentinel.released;
}

/**
 * Demander le verrou et le tenir jusqu'à `releaseWakeLock()`. Idempotent.
 * Le navigateur exige que la page soit visible : appelée sur un onglet caché, la
 * demande échoue, et c'est le retour au premier plan qui la rejoue.
 */
export async function holdWakeLock(): Promise<void> {
  wanted = true;
  startListening();
  if (!isWakeLockSupported()) {
    reportFailure("ce navigateur n'expose pas l'API Screen Wake Lock");
    return;
  }
  if (isWakeLockHeld()) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return; // le navigateur refuserait ; on retentera au retour au premier plan
  }
  try {
    const lock = await navigator.wakeLock.request('screen');
    sentinel = lock;
    // Le navigateur relâche de lui-même (onglet caché, économie d'énergie) :
    // sans cet écouteur, l'indicateur mentirait.
    lock.addEventListener('release', () => {
      emit();
      // Toujours souhaité et page visible → il a été relâché sous nos pieds.
      if (wanted && typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void holdWakeLock();
      }
    });
    failureReported = false;
    emit();
  } catch (err) {
    sentinel = null;
    emit();
    reportFailure((err as Error).message);
  }
}

/** Rendre le verrou (STOP). Ne fait rien s'il n'est pas tenu. */
export async function releaseWakeLock(): Promise<void> {
  wanted = false;
  const lock = sentinel;
  sentinel = null;
  emit();
  if (!lock || lock.released) return;
  try {
    await lock.release();
  } catch (err) {
    // Jamais silencieux, mais jamais alarmant : rendre un verrou déjà rendu par
    // le navigateur est sans conséquence.
    report('info', `Verrou de veille déjà relâché : ${(err as Error).message}`);
  }
}

function reportFailure(reason: string): void {
  if (failureReported) return;
  failureReported = true;
  report(
    'warn',
    `Veille non bloquée pendant la lecture (${reason}) — désactive la mise en veille dans Réglages › Batterie si l'écran s'éteint en plein set.`,
  );
}

/** Redemander le verrou au retour au premier plan : le navigateur l'a relâché. */
function startListening(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted && !isWakeLockHeld()) {
      void holdWakeLock();
    }
  });
}
