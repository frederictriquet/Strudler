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

### Sets de pads `[SPEC-20]`

Les 64 pads de l'APC portent **un set parmi plusieurs** (couplet, refrain, break…) — chacun est un
preset complet du rack : grille, volumes, filtres, effets, quantisation.

- **CLIP STOP** (note 112) = set précédent, **SOLO** (note 113) = set suivant — **sans bouclage** (sur le premier set, « précédent » ne fait rien). Les fonctions
  qui occupaient ces boutons (quantisation globale, fenêtre −/+, resync) restent sur le nano
  (CYCLE, TRACK ◄ ►, MARKER SET) et dans la GUI ; les notes 114-119 sont libres.
- Un switch **ne coupe rien** : les loops d'un set continuent quand on le quitte, et il faut y
  **revenir** pour les arrêter. Les boutons de set **clignotent** et la barre affiche `⟳N` tant que
  c'est le cas — cliquer le badge conduit au set concerné.
- Les deux boutons sont des LED **monochromes** (mesuré : la colonne de droite ignore la palette,
  seuls les 64 pads sont RGB), d'où trois états seulement : **éteint** = rien de ce côté (sur le
  premier set, CLIP STOP est éteint) · **allumé** = un set à atteindre · **clignotant** = des loops
  tournent dans un autre set. La couleur des sets se lit à l'écran, sur la barre des sets.
- La **couleur** du set est la couleur de repos de ses 64 pads (association sans lecture), à l'écran
  comme sur l'APC. Nom et couleur s'éditent dans la barre au-dessus du rack.
- Ajouter / supprimer / réordonner / renommer : **transport arrêté uniquement**. Un set ne se supprime
  que **vide**, et jamais le dernier.
- **SHIFT** bascule la luminosité des pads : **nuit** (repos à 10 %) ⇄ **jour** (repos à 75 %), pour
  qu'un pad associé mais inactif reste lisible sur une scène éclairée. Persisté, doublé d'un bouton
  ☀/🌙 dans la barre de transport. ⚠ Code de SHIFT (note 122) à confirmer sur l'appareil.
- Le **volume** d'un canal est **commun à tous les sets** `[SPEC-20.15]` : changer de set ne déplace
  aucun niveau. Filtre et effets, eux, appartiennent au set.

### Lancement par canal — trois états `[SPEC-17.60]`

Le bouton de chaque canal (⚡/⏱ à l'écran, rangée du bas de l'APC) cycle sur trois modes :

| état | LED | comportement |
|---|---|---|
| immédiat | éteinte | la loop démarre sous le doigt |
| quantisé | allumée | départ à la prochaine fenêtre |
| **fondu** | **clignotante** | départ immédiat, **montée progressive sur une fenêtre** |

Le fondu s'applique à la loop lancée, pas au canal : armer une deuxième loop ne fait pas plonger la
première. **Couper** une loop la fait descendre sur une fenêtre — son pad clignote en rouge pendant la
descente, et **un appui l'annule** en remontant depuis où elle en était. Le fondu ne joue qu'en
**lecture** : transport arrêté, armer et couper sont nets.

### Veille & lampes du transport

- **Pas de veille pendant la lecture** `[SPEC-17.58]` : le verrou *Screen Wake Lock* est pris au PLAY,
  rendu au STOP, et la barre de transport affiche « veille bloquée » tant qu'il est tenu. Le navigateur
  le relâche si l'onglet passe à l'arrière-plan (on le redemande au retour) ; il ne couvre ni la
  fermeture du capot ni une veille explicite.
- **PLAY / STOP / REC du nano s'allument selon le mode** `[SPEC-17.59]`. REC (CC 45) déclenche aussi
  l'enregistrement du journal de gestes. ⚠ Le nano n'obéit que si son préréglage est en
  **LED Mode : External** (Korg Kontrol Editor).

## Sortie scénique — VJing / lumière `[SPEC-19]`

Strudler sait ce qu'il joue : il **diffuse** tempo, position et frappes vers une autre application,
qui se charge du rendu (lumière, visuels). Aucune analyse audio côté récepteur, et les frappes sont
annoncées **avant** d'être audibles — le séquenceur travaille en avance — de quoi anticiper un fondu.
Réglages dans la modale MIDI/Session ; les deux sorties sont éteintes par défaut et n'émettent rien
tant qu'elles le sont.

- **MIDI** (QLC+, Resolume, VDMX…) : horloge MIDI 24 ppqn + Start/Stop/SPP, et une note par catégorie
  (vélocité = gain, numérotation batterie GM : `kick 36`, `snare 38`, `hats 42`…). Port de sortie
  reconnu par sous-chaîne, **distinct** de celui des contrôleurs pour ne pas perturber les LED — sur
  macOS, active le bus **IAC** dans « Configuration audio et MIDI ».
- **WebSocket JSON** (application maison) : un objet par cue (`tempo`, `transport`, `beat`, `onset`,
  `slot`), horodaté deux fois — `t` l'émission, `at` l'instant **visé**. Le récepteur est le serveur,
  un navigateur ne pouvant pas écouter sur un port.

```bash
npm run cues:monitor   # récepteur de référence : affiche le flux et l'avance mesurée
```

`scripts/cue-monitor.mjs` est sans dépendance et prévu pour être **copié** comme squelette du vrai
récepteur. Hors périmètre pour l'instant (mais simples puits à ajouter derrière le même bus) : OSC,
Art-Net/sACN, Ableton Link — tous en UDP, donc inaccessibles au navigateur sans un pont local.

## Démarrer

```bash
npm install
npm run dev      # serveur Vite (http://localhost:5173)
npm run build    # type-check svelte-check + build de production
npm run check    # type-check seul
```

## Deviner la tonalité d'une suite d'accords `[SPEC-18.31]`

Outil **Accords** → champ « Tonalité d'une suite d'accords ». Accepte `Dm Gm`, `C F Ab Bb`, ou
directement l'alternation d'un pattern : `<E G#m B F#>`.

| suite | proposé | certitude |
|---|---|---|
| `C F G7 C` | 8B · DO majeur | **certaine** — dominante + cadence |
| `Am Dm E7 Am` | 8A · LA mineur | **certaine** — mineur harmonique |
| `Cmaj7 Fmaj7` | 8B · DO majeur | probable — aucune dominante |
| `Dm Gm` | 7A · RÉ mineur | ⚠ incertaine — SI♭ majeur et SOL mineur aussi |
| `C F Ab Bb` | 7B · FA majeur | ⚠ incertaine — 6 lectures expliquent tout |
| `C` | — | indéterminée — un seul accord |

**Ce qui contredit l'hypothèse est toujours affiché** : accords hors tonalité, symbole illisible
ignoré, absence de dominante, lectures concurrentes. Chaque accord reçoit son chiffrage (`C=I`,
`G7=V7`) ou la mention de son emprunt (`Ab = ♭VI, emprunt au mineur parallèle`). Un bouton adopte la
tonalité proposée dans le champ `key:` de la piste.

## Reconnaître un accord `[SPEC-18.30]`

Dans l'atelier, outil **Accords** → « Reconnaître un accord », **trois champs** selon la notation
dont tu disposes :

| champ | exemple | donne |
|---|---|---|
| **Notes — A B C** | `d3,a3,f4` | `Dm` |
| **Notes — DO RÉ MI** | `ré3,la3,fa4` · `sib3` · `sol#` | `Dm` |
| **Degrés dans la gamme** | `1,5,10` (lus dans la tonalité choisie) | `Dm` |

Chaque proposition porte un bouton **🎹** qui la joue au piano (une frappe, sans toucher la boucle
en cours d'écriture) : deux lectures d'un même ensemble de notes diffèrent par un voicing qui
s'entend mieux qu'il ne se lit.

Chaque proposition affiche le symbole **et son nom français** — `CM7` · « DO majeur 7 » — parce
que le symbole part tel quel dans le pattern mais ne se lit pas de la même façon par tout le monde.

Ce que tu saisis dans un champ apparaît **traduit dans les deux autres** (grisés en pointillés,
mais modifiables). Les degrés montent : `1,5,10` donne `D3 A3 F4`, pas trois notes tassées dans une
octave. Au-delà de 7 on passe à l'octave suivante (`8` = tonique à l'octave), et `b3`/`#4` altèrent
un degré. Chaque champ est strict ; un nom de l'autre notation renvoie vers le bon champ.

Le symbole rendu est utilisable directement :

| collé | proposé | pourquoi |
|---|---|---|
| `d3,a3,f4` | `Dm` | — |
| `d3,bb3,g4` | `Gm` + basse `D` | Strudel refuse les accords barrés (`Gm/D`) |
| `c,e,g,b` | `CM7` | `Cmaj7` n'est pas reconnu, `CM7` oui |
| `c,eb,gb` | `Co` | idem pour `Cdim` |
| `d,f,a,c` | `Dm7` | le voicing de Strudel omet le `A`, c'est signalé |
| `c,d,e` | — | aucun accord connu ne correspond |

Chaque proposition est **essayée dans Strudel** avant d'être offerte : seule une orthographe qui
sonne les hauteurs collées est retenue. Le bouton insère le `chord(…).voicing()` correspondant,
avec la couche de basse quand il s'agit d'un renversement.

## Instruments General MIDI `[SPEC-17.55]`

Les 125 instruments `gm_*` du REPL (`gm_piano`, `gm_electric_guitar_muted`, `gm_flute`…) sont
disponibles, **entièrement depuis le disque** :

```bash
npm run samples:soundfonts              # 866 presets, ~140 Mo, une seule fois
npm run samples:soundfonts --  --list   # les 125 instruments et leurs variantes
npm run samples:soundfonts --  --default-only   # 1re variante seulement (~10 Mo)
```

Destination : `~/Music/Sounds/soundfonts` (ou `$STRUDLER_SOUNDS_DIR/soundfonts`). Re-lançable :
les fichiers déjà là sont ignorés, un import interrompu reprend où il s'est arrêté.

`@strudel/soundfonts` diffuse ses presets depuis `felixroos.github.io` ; Strudler le fait pointer
sur la copie locale. Aucune requête réseau au déclenchement d'un `gm_*` — un cache navigateur ne
contient que ce qui a déjà été joué, ce n'est pas de la disponibilité. Tant que les presets ne
sont pas là, les instruments **ne sont pas enregistrés** et l'application affiche la commande à
lancer, au lieu de proposer 125 sons muets.

`.n(i)` choisit la variante d'instrument, avec le même index que sur strudel.cc.

## Sauvegarde — rien ne peut être perdu `[SPEC-13.5→13.9]`

Tout l'état saisi (associations piste↔pad, scènes, sessions, favoris de sons, brouillon de
l'atelier) vit dans le `localStorage` du navigateur. Un « effacer les données de navigation »,
une éviction sous pression disque ou un changement de port suffiraient à le faire disparaître.
Il est donc **copié sur disque à chaque modification** :

```
.state/
  strudler-state.json          copie courante (tout le localStorage, en texte brut)
  snapshots/2026-…Z.json       états précédents, rotation à 30
```

- La copie est écrite par le serveur Vite (`vite-plugins/stateBackup.ts`), donc **hors-ligne** et
  sans service tiers. Servi autrement qu'avec `npm run dev` / `npm run preview`, la page annonce
  clairement que le miroir est indisponible.
- Si le navigateur est retrouvé **vide** alors qu'une copie existe, l'état est **restauré au
  chargement** et l'application le signale.
- **Réglages ▸ Sauvegarde** montre la dernière copie, la liste des instantanés (avec restauration
  en un clic) et propose un **export/import** d'un fichier unique — la seule voie pour passer sur
  une autre machine, un autre navigateur ou un autre profil.
- Le port est verrouillé sur `5173` : un second `npm run dev` échoue au lieu de glisser sur
  `:5174`, où l'application afficherait un état vide (autre origine).
- Le dossier `library/` autorisé ne peut pas être sauvegardé (le navigateur n'expose pas de
  chemin) : seul son **nom** est conservé, pour indiquer lequel réautoriser après un import.

`.state/` est dans le dépôt : le versionner donne un historique gratuit. Pour l'ignorer,
une ligne dans `.gitignore` suffit.

## État d'avancement

Suivi par phases (`docs/PLAN.md` section E).

- [x] **Phase 0 — Fondations** : Vite + Svelte + TS ; Strudel joue un son ; Web MIDI
  détecte le nanoKONTROL2. Jalon « ça sonne + le nano est vu ».
- [x] **Phase 1 — Clock + Engine** : horloge maître (BPM/beats, 1 cycle = 4 beats),
  play/stop d'une loop, volume par canal (effet immédiat via `ref`). Jalon « une loop
  tourne à 120 BPM ».
- [x] **Phase 2 — Bibliothèque + mode simple** : schéma `library/<catégorie>/<slug>.track.yaml`,
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
    persist/            # [SPEC-13]  localStorage sûr + miroir disque (backup.ts) [SPEC-13.5]
    composer/           # [SPEC-18]  atelier : sons, favoris, couches, dossier library
  stores/               # [SPEC-13] état applicatif (Svelte stores)
  lib/                  # composants Svelte (UI) [SPEC-10]
  types/                # déclarations ambiantes (@strudel/*)
  App.svelte
  main.ts
  app.css
library/                # [SPEC-4] pistes : library/<catégorie>/<slug>.track.yaml
  track.schema.json     #           schéma JSON des pistes (validation dans l'éditeur)
  kick/ hats/ snare/ bass/ lead/ pad/
vite-plugins/           # soundsServer.ts (sons locaux) + stateBackup.ts (miroir d'état)
.state/                 # [SPEC-13.5] copie disque du localStorage + instantanés datés
docs/                   # SPEC.md, PLAN.md
study/                  # matériel de référence (expérimentations, nanoKONTROL2…)
```

### Ajouter une piste [SPEC-4.4]

Déposer un fichier `library/<catégorie>/<slug>.track.yaml`. La catégorie est le dossier.
Il est pris en compte automatiquement (HMR en dev), sans toucher au moteur ni à la GUI.
Une nouvelle catégorie = un nouveau dossier.

```yaml
# Commentaire libre : d'où vient la boucle, comment elle est construite…
name: Snare 808          # obligatoire — unique dans la catégorie
beats: 4                 # obligatoire — 1 cycle Strudel = 4 beats
pattern: |-              # obligatoire — le code Strudel ; « |- » = bloc multi-lignes
  s("~ 808sd:4 ~ 808sd:4").gain(0.75).room(0.15)
tags: [house, snare, 808]
gain: 0.9                # optionnel — niveau relatif de base
key: 8A                  # optionnel — tonalité Camelot ; présent ⇒ piste transposable
```

Un fragment répété (progression d'accords…) s'écrit **une seule fois** dans `vars` et
se substitue dans `pattern` via `${NOM}` `[SPEC-4.7]` — la portée est le fichier :

```yaml
vars:
  PROGRESSION: <E G#m B F#>
pattern: |-
  stack(
    chord("${PROGRESSION}").dict("triads").anchor("c4").voicing(),
    chord("${PROGRESSION}").rootNotes(2).note()
  ).s("piano")
```

**Validation** : `library/track.schema.json` est associé aux pistes dans
`.vscode/settings.json` — avec l'extension **YAML** de Red Hat, VS Code complète les
champs et signale les erreurs pendant la frappe. Au chargement, un fichier invalide
n'empêche **pas** les autres de se charger : il est signalé dans l'UI avec sa ligne
et sa colonne `[SPEC-14.3]`.

## Conventions

- TypeScript strict ; le `core/` ne dépend jamais de l'UI.
- L'Engine isole Strudel derrière une interface stable (`[PLAN F]`).
- Aucune exception silencieuse (`[SPEC-14.3]`).
