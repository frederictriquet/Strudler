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
npm run samples:soundfonts  # 125 instruments General MIDI (gm_*), ~140 Mo, hors-ligne [SPEC-17.55]
npm run probe -- '<js>'      # évalue du JS DANS l'app (moteur armé) et imprime — voir ci-dessous
npm run cues:monitor   # récepteur de référence de la sortie scénique (WebSocket) [SPEC-19]
```

## Architecture

```
src/core/      logique métier, ZÉRO dépendance à l'UI
  engine/      StrudelEngine — Strudel isolé derrière une interface stable
  clock/       horloge maître (BPM, beats ; 1 cycle = 4 beats)
  library/     pistes YAML scannées via import.meta.glob (?raw) + parse/validate
  channels/    ChannelRack — sets de pads, canaux, slots, volume, filtre, overrides
  launch/      Launcher — mode immédiat/quantisé, fenêtre W, pending
  midi/ mapping/ streamdeck/   contrôleurs → Intent
  cues/        sortie scénique — bus de cues + puits MIDI / WebSocket [SPEC-19]
  intent/ session/ persist/    Intent unifié, journal de gestes, localStorage
src/stores/    état applicatif (Svelte stores) — `rackStore.dispatch()` = point d'entrée unique
src/lib/       composants Svelte
library/       pistes : library/<catégorie>/<slug>.track.yaml (données, pas de code) [SPEC-4.6]
               + track.schema.json (validation dans l'éditeur)
vite-plugins/  soundsServer.ts — sert ~/Music/Sounds sous /sounds/ + génère /sounds/strudel.json
               stateBackup.ts  — miroir de l'état sous /__state/* → .state/ [SPEC-13.5]
.state/        copie disque de tout le localStorage + instantanés datés (données, pas du code)
```

**Invariants**
- `core/` n'importe jamais depuis `lib/` ou `stores/`.
- GUI, MIDI et Stream Deck produisent le **même Intent** et passent par `dispatch()` (`src/stores/rackStore.ts`) — jamais d'appel direct au moteur depuis un composant.
- **Aucune exception silencieuse** `[SPEC-14.3]` : toute erreur est remontée dans l'UI (toasts / `logStore`), pas seulement en console.
- **Durabilité** `[SPEC-13.5]` : toute écriture passant par `core/persist/storage.ts` est miroitée
  dans `.state/`. Le balayage est **générique** (préfixe `strudler:`) — une nouvelle clé est
  sauvegardée sans rien déclarer. Ne jamais court-circuiter `saveJson()` avec un
  `localStorage.setItem()` direct : la donnée sortirait du miroir.
- Transport **PLAY/STOP** `[SPEC-17.9]` : activer un slot **arme** la piste (silencieuse) ; le son ne part qu'au PLAY. Interagir ne déclenche jamais de son tout seul. Le **chronomètre est le bouton PLAY/STOP** `[SPEC-17.49]`, et l'audio est déverrouillé par une **modale au démarrage** `[SPEC-17.50]` (le navigateur exige un clic ; un message MIDI ne compte pas).
- **Sets de pads** `[SPEC-20]` : les 64 pads adressent **un set parmi plusieurs**, commuté par
  CLIP STOP / SOLO (notes 112/113, **sans bouclage**). Un set porte la grille, le filtre, les effets
  et la quantisation — **pas le volume**, commun à tous les sets `[SPEC-20.15]` pour qu'un changement
  de set ne déplace aucun niveau. Une voix est identifiée par `(set, canal, slot)` : quitter un set
  **ne coupe pas** ses loops, il faut y revenir. L'édition des sets (ajout/suppression/réordre/nom/
  couleur) est réservée au **transport arrêté**. SHIFT bascule la luminosité des pads `[SPEC-20.14]`.
- Le bouton de lancement d'un canal a **trois** états `[SPEC-17.60]` : immédiat (LED éteinte),
  quantisé (allumée), **fondu** (clignotante) — la loop monte alors sur la durée d'une fenêtre, via un
  `ref` de gain **propre à la voix** (fondre le canal ferait plonger ce qui joue déjà). La coupure fond
  aussi ; un appui pendant la descente l'annule. Le fondu n'existe qu'**en lecture** `[SPEC-17.60.2]`.
- Volume et filtre sont modifiés à chaud via des `ref` Strudel (pas de ré-évaluation du pattern).
- Ajouter une piste ou un son ne demande aucune modification du moteur ni de la GUI.
- **Sortie scénique** `[SPEC-19]` : Strudler **émet** (MIDI clock/notes, WebSocket JSON), il ne rend ni visuels ni DMX. Le canal d'une frappe se lit dans son `orbit` (`.orbit(canal + 1)`, `[SPEC-17.37]`) — rien à instrumenter. Un navigateur ne peut ni émettre d'UDP ni écouter sur un port : OSC/Art-Net/Ableton Link exigeraient un pont Node.

## Vérifier une hypothèse

**Node d'abord.** Charger l'atelier dans Chrome headless coûte ~90 s (Vite transforme ~250
modules) ; un bundle Node en coûte moins d'une seconde :

```bash
node_modules/.bin/esbuild src/core/music/chordDetect.ts --bundle --platform=node \
  --format=cjs --alias:@core=./src/core --outfile=/tmp/m.cjs
```

Ça couvre toute la logique pure (parsing, calculs, sérialisation). Un middleware Vite se teste avec
un `http.createServer` réel. Le navigateur n'est nécessaire que pour ce qui exige Strudel ou un
AudioContext (`queryEvents`, audition, mesure de mise en page) — dans ce cas
`npm run probe -- 'say(...)'` évite d'écrire une page jetable (contexte fourni : `engine` armé,
`detect`, `probe`, `banks`, `library`, `store` avec `--store`, banques avec `--banks`). Comme
chaque appel reste lent, **une seule sonde qui répond à toutes les questions**, pas une par question.

## Pièges connus

- `initAudioOnFirstClick()` doit être appelé **au montage** (`engine.arm()` dans `onMount`), pas dans un handler de clic — il n'écoute que le `mousedown` *suivant*.
- `repl.evaluate()` **avale les erreurs** : passer `onEvalError` et vérifier la valeur de retour.
- Le transpileur réécrit **tout littéral chaîne** du code évalué en mini-notation (`fadeg("a:b")` →
  `fadeg(m('a:b', …))`). Tout argument passé à une fonction du scope (`chgain`, `fadeg`…) DOIT donc
  être **numérique** `[SPEC-17.60.1]` — sinon la fonction reçoit un Pattern et échoue sans un mot.
- `registerSynthSounds()` ne charge que les synthés ; les samples exigent la map `/sounds/strudel.json` — sinon silence.
- superdough **normalise** les noms de sons (`toLowerCase`, espaces → `_`) à l'enregistrement **et**
  à la lecture : `BossDR110_cr` vit dans le registre sous `bossdr110_cr`. Toute comparaison au
  registre passe donc par `normalizeSoundName` `[SPEC-17.56.1]`, sinon les 71 boîtes à rythmes en
  casse mixte sont déclarées inconnues alors qu'elles jouent.
- Une chaîne de mini-notation dure **un cycle** : une boucle plus longue s'écrit `.slow(n)`, facteur
  que la grille de batterie **possède** `[SPEC-18.32]` au lieu de le laisser dans le suffixe opaque.
- Un **nom de son inconnu** ne lève rien : superdough joue du silence. Le piano roll, lui, affiche
  les notes (il vient de `queryEvents`, sans audio) — d'où « ça montre les notes mais je n'entends
  rien ». L'atelier compare désormais les noms au registre `[SPEC-17.56]`.
- Les `gm_*` (General MIDI) exigent `npm run samples:soundfonts` : sans les presets sur le disque,
  ils ne sont pas enregistrés du tout `[SPEC-17.55]`.
- `chord()` est plein de pièges mesurés `[SPEC-18.30]` : les accords **barrés** (`Gm/D`) lèvent
  « Invalid argument » ; `.dict("triads")` ne produit **rien** hors triade (`Dm7`, `G7`, `C6`) ;
  certains noms ne passent que sous alias (`Cmaj7` ✗ / `CM7` ✓, `Cdim` ✗ / `Co` ✓) ; et `Caug`
  sous `triads` joue **un autre accord**. Toujours essayer le symbole via `queryEvents` plutôt que
  de se fier à une table.
- Toute évaluation **spéculative** (essayer si Strudel accepte un symbole) doit passer
  `queryEvents(code, n, { quiet: true })` `[SPEC-18.30.9]` : Strudel diffuse ses erreurs d'eval sur
  `strudel.log`, et la capture les afficherait comme des erreurs de l'utilisateur.
- `chord(...).rootNotes(n).note()` emboîte ses valeurs dans un second objet `{note}` : `.add(note(n))`
  — la transposition de tonalité — ne rend alors **plus rien**. Utiliser `rootNotes(n)` sans `.note()`,
  ou un `note("…")` simple.
- `@strudel/core` casse en introspection Node/`require` (résolution du champ `main`) ; il fonctionne via Vite. Ne pas en conclure à un bug.
- Modifier `vite-plugins/soundsServer.ts` n'est **pas** pris par le HMR → redémarrer `npm run dev`.
- Le port est **verrouillé** (`strictPort`) `[SPEC-13.6]` : un second `npm run dev` échoue au lieu
  de glisser sur `:5174`, où l'application afficherait un état vide (autre origine).
- Les notes **112/113** de l'APC ne font plus « quantisation globale / fenêtre − » mais **changent de
  set** `[SPEC-20.3]` ; ces fonctions ont quitté l'APC (nano + GUI). Les notes 114-119 sont libres.
- Les boutons **hors grille** de l'APC (rangée du bas 100-107, colonne de droite 112-119) sont des
  LED **monochromes** : 0/1/2 (éteint/allumé/clignotant) sur le canal de note 0, palette et canaux
  de luminosité **ignorés** — ce sont des propriétés des 64 pads RGB seuls `[SPEC-20.5]`. Y envoyer
  un index de couleur allume le bouton en vert continu.
- Un **switch de set** ne modifie que l'adressage des pads. Comme un set porte aussi les volumes et
  les effets `[SPEC-20.2]`, ils sont poussés dans le moteur au switch (un niveau peut sauter), et
  les loops d'un autre set qui tournent encore sont mises à l'échelle par le canal **courant** — il
  n'y a qu'un orbit par colonne `[SPEC-17.37]`.
- Les LED du **nanoKONTROL2** n'obéissent que si son préréglage est en **LED Mode : External**
  (Korg Kontrol Editor) — sinon l'appareil les pilote lui-même et tout ce qu'on envoie est ignoré
  `[SPEC-17.59]`.
- Fermer le logiciel Elgato avant de connecter le Stream Deck (monopolise le HID).
- Les pistes sont des **données YAML** `[SPEC-4.6]` : renommer/déplacer un fichier change l'id `catégorie/slug` et **délie les pads** (l'association est conservée et signalée, jamais purgée `[SPEC-17.51]`). Le `#` d'un nom d'accord (`G#m`) n'ouvre pas de commentaire YAML tant qu'il n'est pas précédé d'une espace.

## GUI

Instrument live : la page occupe **tout l'espace** horizontal (pas de conteneur `max-width` centré)
et reste **compacte verticalement** — tout doit être visible **sans scroll**. Contrôles regroupés
sur une même ligne (flex-wrap), modales pour le secondaire (MIDI/Session/Réglages).

## État

Phases 0→10 du plan livrées + sets de pads `[SPEC-20]`, build vert. ⚠ **APC mini mk2 et Stream Deck non validés sur matériel.**
Évolutions possibles : `[SPEC-15]` (dont l'export d'une piste live-codée vers `library/`).
