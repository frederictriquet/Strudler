# Strudler

Instrument de performance live **« music as code »** : Strudel (`@strudel/*`) pour l'audio,
Web MIDI + WebHID pour les contrôleurs matériels. Application web locale, mono-utilisateur,
pensée pour jouer sur scène (100 % hors-ligne).

**Stack** : Vite + Svelte 5 + TypeScript strict. Node ≥ 20. **Chrome/Edge obligatoire** (Web MIDI).

## Documents de référence — à lire AVANT de coder

| Fichier | Contenu |
|---|---|
| `docs/SPEC.md` | Spécification fonctionnelle, blocs `[SPEC-N.M]`. **Relire la section concernée avant toute implémentation.** |
| `docs/PLAN.md` | Architecture en couches (section B), phases (section E), décisions de stack (A). |
| `README.md` | Démarrage, bibliothèque de sons, contrôleurs, ajout d'une piste, arborescence détaillée. |
| `needs.md` | Besoin initial brut (historique). |
| `study/` | Expérimentations et matériel de référence (nanoKONTROL2, patches Strudel). |

Toute implémentation référence le bloc de spec correspondant (ex. `[SPEC-8.2]`) en commentaire.

## Commandes

```bash
npm run dev            # Vite sur http://localhost:5173
npm run check          # svelte-check (type-check seul)
npm run build          # type-check + build de production
npm run samples:fetch  # peuple ~/Music/Sounds/dirt (dirt-samples)
npm run samples:piano  # pack piano chromatique (tonejs-instruments)
npm run samples:banks  # banques officielles Strudel : VCSL, drum-machines, mridangam [SPEC-17.27]
```

## Architecture

```
src/core/      logique métier, ZÉRO dépendance à l'UI
  engine/      StrudelEngine — Strudel isolé derrière une interface stable
  clock/       horloge maître (BPM, beats ; 1 cycle = 4 beats)
  library/     pistes YAML scannées via import.meta.glob (?raw) + parse/validate
  channels/    ChannelRack — canaux, slots, volume, filtre, overrides de code
  launch/      Launcher — mode immédiat/quantisé, fenêtre W, pending
  midi/ mapping/ streamdeck/   contrôleurs → Intent
  intent/ session/ persist/    Intent unifié, journal de gestes, localStorage
src/stores/    état applicatif (Svelte stores) — `rackStore.dispatch()` = point d'entrée unique
src/lib/       composants Svelte
library/       pistes : library/<catégorie>/<slug>.track.yaml (données, pas de code) [SPEC-4.6]
               + track.schema.json (validation dans l'éditeur)
vite-plugins/  soundsServer.ts — sert ~/Music/Sounds sous /sounds/ + génère /sounds/strudel.json
```

**Invariants**
- `core/` n'importe jamais depuis `lib/` ou `stores/`.
- GUI, MIDI et Stream Deck produisent le **même Intent** et passent par `dispatch()` (`src/stores/rackStore.ts`) — jamais d'appel direct au moteur depuis un composant.
- **Aucune exception silencieuse** `[SPEC-14.3]` : toute erreur est remontée dans l'UI (toasts / `logStore`), pas seulement en console.
- Transport **PLAY/STOP** `[SPEC-17.9]` : activer un slot **arme** la piste (silencieuse) ; le son ne part qu'au PLAY. Interagir ne déclenche jamais de son tout seul. Le **chronomètre est le bouton PLAY/STOP** `[SPEC-17.49]`, et l'audio est déverrouillé par une **modale au démarrage** `[SPEC-17.50]` (le navigateur exige un clic ; un message MIDI ne compte pas).
- Volume et filtre sont modifiés à chaud via des `ref` Strudel (pas de ré-évaluation du pattern).
- Ajouter une piste ou un son ne demande aucune modification du moteur ni de la GUI.

## Pièges connus

- `initAudioOnFirstClick()` doit être appelé **au montage** (`engine.arm()` dans `onMount`), pas dans un handler de clic — il n'écoute que le `mousedown` *suivant*.
- `repl.evaluate()` **avale les erreurs** : passer `onEvalError` et vérifier la valeur de retour.
- `registerSynthSounds()` ne charge que les synthés ; les samples exigent la map `/sounds/strudel.json` — sinon silence.
- `@strudel/core` casse en introspection Node/`require` (résolution du champ `main`) ; il fonctionne via Vite. Ne pas en conclure à un bug.
- Modifier `vite-plugins/soundsServer.ts` n'est **pas** pris par le HMR → redémarrer `npm run dev`.
- Fermer le logiciel Elgato avant de connecter le Stream Deck (monopolise le HID).
- Les pistes sont des **données YAML** `[SPEC-4.6]` : renommer/déplacer un fichier change l'id `catégorie/slug` et **délie les pads** (l'association est conservée et signalée, jamais purgée `[SPEC-17.51]`). Le `#` d'un nom d'accord (`G#m`) n'ouvre pas de commentaire YAML tant qu'il n'est pas précédé d'une espace.

## GUI

Instrument live : la page occupe **tout l'espace** horizontal (pas de conteneur `max-width` centré)
et reste **compacte verticalement** — tout doit être visible **sans scroll**. Contrôles regroupés
sur une même ligne (flex-wrap), modales pour le secondaire (MIDI/Session/Réglages).

## État

Phases 0→10 du plan livrées, build vert. ⚠ **APC mini mk2 et Stream Deck non validés sur matériel.**
Évolutions possibles : `[SPEC-15]` (dont l'export d'une piste live-codée vers `library/`).
