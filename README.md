# Strudler

Instrument de performance live **« music as code »** bâti sur **Strudel** (`@strudel/*`)
et la **Web MIDI API**. Voir la spec (`docs/SPEC.md`) et le plan (`docs/PLAN.md`).

## Prérequis

- **Chrome ou Edge** (Web MIDI requis, absent de Firefox/Safari — `[SPEC-14.1]`).
- Node ≥ 20.

## Sons — bibliothèque locale `[SPEC-12, SPEC-14.4]`

Les sons vivent dans un **dossier local que tu possèdes** : `~/Music/Sounds` (surchargeable via la
variable d'env `STRUDLER_SOUNDS_DIR`). Le serveur de dev/preview le **sert en same-origin** sous
`/sounds/` et **génère `/sounds/strudel.json`** en le scannant à chaque chargement
(`vite-plugins/soundsServer.ts`). Strudler charge cette map automatiquement → **100 % hors-ligne**,
dès le premier lancement.

- **Peupler la banque** : `npm run samples:fetch` télécharge dirt-samples dans `~/Music/Sounds/dirt`.
- **Banques officielles de Strudel** `[SPEC-17.27]` : `npm run samples:banks` importe hors-ligne le
  catalogue que le REPL de strudel.cc streame depuis GitHub —
  **VCSL** (onglet « samples » : 128 sons acoustiques, dont 72 instruments mélodiques jouables à la
  note), **tidal-drum-machines** (71 boîtes à rythmes, `.bank("RolandTR909")`, SP-12 incluse) et
  **mridangam**. Les fichiers sont transcodés en ogg/Opus par défaut (VCSL : ≈3,4 Go de wav → quelques
  centaines de Mo) ; `--format=wav` conserve l'original, `--format=mp3` encode en mp3.

  ```bash
  npm run samples:banks                       # les 3 banques, en ogg
  npm run samples:banks -- --list             # liste les banques
  npm run samples:banks -- vcsl --format=wav  # une seule banque, sans transcodage
  ```

  L'import est reprenable (les fichiers déjà présents sont ignorés) et s'arrête en erreur en listant
  les échecs. Une collision de nom avec un son existant (ex. `sax` de VCSL vs `sax` de dirt) est
  renommée `sax_vcsl` et signalée dans la sortie.
- **Ajouter / curer** : dépose ou retire des dossiers de sons dans `~/Music/Sounds` (un dossier
  contenant des fichiers audio = un son, nommé d'après le dossier ; l'imbrication est supportée).
  Rafraîchis Strudler, c'est pris en compte — aucun code à toucher.
- **Formats** : `.wav .ogg .mp3 .flac .aif .aiff .m4a`. `n("0 1 …").s("<dossier>")` sélectionne le
  fichier par index (ordre alphabétique).
- Statut de chargement affiché dans l'en-tête de la Bibliothèque.
- Le moteur garde la capacité **synthé** de Strudel (utilisable en live-coding) ; les pistes fournies
  utilisent les sons dirt.

## Contrôleurs

- **nanoKONTROL2** / **APC mini mk2** : MIDI (Web MIDI), mapping déclaratif `src/core/mapping/`.
- **Elgato Stream Deck** : **WebHID** (bouton « Connecter » dans la modale MIDI/Session). Fermer d'abord
  le logiciel Elgato. MK.2 : colonnes 1-4 = canaux, lignes = slots S/M/R, colonne 5 = mode/fenêtre.
  Chaque touche s'éclaire selon l'état de la piste. ⚠ Matériel non validé (calage par modèle).

## Démarrer

```bash
npm install
npm run dev      # serveur Vite (http://localhost:5173)
npm run build    # type-check svelte-check + build de production
npm run check    # type-check seul
```

## État d'avancement

Suivi par phases (`docs/PLAN.md` section E).

- [x] **Phase 0 — Fondations** : Vite + Svelte + TS ; Strudel joue un son ; Web MIDI
  détecte le nanoKONTROL2. Jalon « ça sonne + le nano est vu ».
- [x] **Phase 1 — Clock + Engine** : horloge maître (BPM/beats, 1 cycle = 4 beats),
  play/stop d'une loop, volume par canal (effet immédiat via `ref`). Jalon « une loop
  tourne à 120 BPM ».
- [x] **Phase 2 — Bibliothèque + mode simple** : schéma `library/<catégorie>/<slug>.track.ts`,
  manifeste via `import.meta.glob` (= scan, HMR, zéro rebuild), chargement et lecture d'une
  piste du disque. Jalon « charger et jouer une piste du disque ».
- [x] **Phase 3 — Canaux + MIDI in/out (MVP)** : modèle de canaux (catégories, slots S/M/R→pistes,
  volume), mapping nanoKONTROL2 déclaratif, faders→volume immédiat, S/M/R→start/stop immédiat,
  retour LED, surface d'intentions unifiée GUI/MIDI. Jalon **MVP** « instrument jouable au nano ».
- [x] **Phase 4 — Knobs → filtre** : filtre **bipolaire unique** par canal (centre = neutre, gauche
  = passe-bas, droite = passe-haut), effet immédiat via `ref` (LPF/HPF balayés exponentiellement).
  Jalon « filtrage live ».
- [x] **Phase 5 — Fenêtre + quantisation** : mode immédiat/quantisé (CYCLE), fenêtre W∈{4,8,16,32,64}
  (TRACK ◄►), lancement calé sur `beat ≡ 0 (mod W)` depuis une origine **re-synchronisable** (resync /
  Marker Set), pending **annulable** (re-clic) signalé en clignotant. Slots par canal **configurables**
  (3 nano, jusqu'à 8 APC). Jalon « lancement calé sur la fenêtre ».
- [x] **Phase 6 — GUI complète** : éditeur d'associations live par canal (catégories multi-select,
  piste→slot), affichage complet par canal (catégorie, volume, filtre, piste/slot, état). Jalon
  « tout est visible et réassignable ».
- [x] **Phase 7 — Mode avancé (live-coding)** : override de code par slot, édition + éval à chaud
  (Ctrl+↵) mettant à jour la voix en direct, retour au pattern du disque, bascule simple ⇄ avancé
  sans couper la perf. Jalon « faire évoluer une piste en live ».
- [x] **Phase 8 — Record / replay (gestes)** : journal d'événements (Intent horodaté en beats) capté
  sur le dispatch, état initial + tempo, rejeu ré-émis sur l'horloge, save/load JSON. Jalon
  « rejouer une session ».
- [x] **Phase 9 — 2e contrôleur (APC mini mk2)** : messages Note gérés, mapping APC par config (faders
  CC48-55→volume, grille note→slot col/row, jusqu'à 8 slots), usage simultané avec le nano, collision
  CC résolue par nom de port, LED multi-contrôleur (CC nano / Note APC). ⚠ Matériel APC non validé.
  Jalon « nano + APC ensemble ».
- [x] **Phase 10 — Persistance** : associations + volume/filtre + tempo/mode/fenêtre sauvés (localStorage,
  debounce) et rechargés au démarrage ; sessions gardées dans le navigateur (liste, rejeu, suppression) ;
  erreurs de stockage remontées. Jalon « état retrouvé au démarrage ».

**Toutes les phases du plan (0→10) sont livrées.**

## Arborescence

Alignée sur les couches du plan (`docs/PLAN.md` section B). Les dossiers vides
seront remplis aux phases correspondantes.

```
src/
  core/                 # logique métier, sans dépendance à l'UI
    engine/             # [SPEC-3]  moteur music-as-code (wrap Strudel) + TimeSource
    midi/               # [SPEC-6]  abstraction Web MIDI (in + out/LED)
    clock/              # [SPEC-3.4] horloge maître (BPM/beats)
    library/            # [SPEC-4]   manifeste via import.meta.glob + chargement piste
    channels/           # [SPEC-5]   canaux, catégories, slots→pistes, volume/filtre
    intent/             # [PLAN B]   Intent unifié (GUI + MIDI)
    mapping/            # [SPEC-6.2] contrôle physique → intention (nanoKONTROL2)
    launch/             # [SPEC-8]   Launcher : mode, fenêtre W, quantisation, pending
                        # live-coding [SPEC-9.2] : override de code par slot (ChannelRack)
    session/            # [SPEC-11]  format de session (journal de gestes) + (dé)sérialisation
    persist/            # [SPEC-13]  localStorage sûr (associations, réglages, sessions)
  stores/               # [SPEC-13] état applicatif (Svelte stores)
  lib/                  # composants Svelte (UI) [SPEC-10]
  types/                # déclarations ambiantes (@strudel/*)
  App.svelte
  main.ts
  app.css
library/                # [SPEC-4] pistes : library/<catégorie>/<slug>.track.ts
  kick/ hats/ snare/ bass/ lead/ pad/
docs/                   # SPEC.md, PLAN.md
study/                  # matériel de référence (expérimentations, nanoKONTROL2…)
```

### Ajouter une piste [SPEC-4.4]

Déposer un fichier `library/<catégorie>/<slug>.track.ts` exportant par défaut un
`TrackDefinition` (`name`, `beats`, `pattern` Strudel, `tags?`, `gain?`). La catégorie
est le dossier. Il est pris en compte automatiquement (HMR en dev), sans toucher au
moteur ni à la GUI. Une nouvelle catégorie = un nouveau dossier.

## Conventions

- TypeScript strict ; le `core/` ne dépend jamais de l'UI.
- L'Engine isole Strudel derrière une interface stable (`[PLAN F]`).
- Aucune exception silencieuse (`[SPEC-14.3]`).
