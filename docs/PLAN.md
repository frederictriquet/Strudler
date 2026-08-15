# Strudler — Plan d'implémentation

> Accompagne `docs/SPEC.md`. Aucun code ici : architecture, modèles de données, découpage en phases avec références `[SPEC-N.M]`.
> Principe : livraison **verticale par tranches** — chaque phase produit quelque chose de jouable.

---

## A. Stack technique & justification

| Brique | Choix | Pourquoi |
|---|---|---|
| Langage | **TypeScript** | Un seul stack, typage pour un projet qui grossit. |
| Build / dev | **Vite** | HMR rapide, ESM natif, adapté aux modules `@strudel/*`. |
| Moteur music-as-code | **`@strudel/core` + `@strudel/mini` + `@strudel/webaudio`** | Patterns, mini-notation, ordonnanceur, sortie Web Audio. Couvre [SPEC-3]. |
| Eval de code à chaud | **`@strudel/transpiler`** | Mode avancé [SPEC-9.2] : évaluer des chaînes de code Strudel. |
| MIDI | **Web MIDI API** (option : lib `webmidi` pour l'ergonomie) + **`@strudel/midi`** pour les samples/MIDI Strudel | In + out (LED), multi-device, identification par port [SPEC-6]. |
| Samples perso | **`strudel.json` / outil `sampler` Strudel** | [SPEC-12]. |
| UI | **Svelte** (recommandé) ou React | Surface réactive légère pour un affichage temps réel [SPEC-10]. À trancher en Phase 0. |
| Persistance | Fichiers de config JSON + `localStorage` pour l'état de session | [SPEC-13]. |

Décision d'engagement audio : Strudel core (et non Tone.js) car le cœur de valeur est l'**algèbre de patterns** [SPEC-3.1/3.3]. La quantisation de lancement [SPEC-8] sera construite au-dessus de l'ordonnanceur Strudel (lecture de la position de cycle).

---

## B. Architecture logicielle (couches)

Découplage strict, dans l'esprit du moteur Sonic Pi déjà écrit (moteur agnostique des pistes).

1. **Clock** — horloge maître : tempo, position en beats, émission d'un tick. Autorité de temps unique. `[SPEC-3.4]`
2. **Engine (audio)** — encapsule Strudel : instancie/joue/arrête des patterns, applique volume et filtre par canal, transformations. `[SPEC-3]`
3. **Library** — scan des fichiers de pistes → manifeste ; chargement d'une piste (pattern + métadonnées). `[SPEC-4]`
4. **Channels** — modèle logique des canaux : catégories associées, volume, filtre, slots→pistes, états de lecture. `[SPEC-5]`
5. **Launch/Quantize** — file d'actions ; applique immédiat ou à la limite de fenêtre W. `[SPEC-7.4, SPEC-8]`
6. **MIDI** — abstraction contrôleur : entrée (contrôles→intentions) et sortie (LED). Résout les périphériques par nom. `[SPEC-6]`
7. **Mapping** — config déclarative contrôle physique → fonction logique. Convertit un événement MIDI brut en intention (« volume canal 2 », « slot 1 canal 3 »). `[SPEC-6.2, SPEC-5.5]`
8. **Session** — journal d'événements horodatés ; enregistrement & rejeu. `[SPEC-11]`
9. **UI** — vue réactive de l'état + éditeur d'associations ; consomme et émet des intentions. `[SPEC-10]`
10. **Store/Config** — état applicatif central + persistance. `[SPEC-13]`

**Flux nominal** : MIDI brut → Mapping → Intention → (Channels + Launch/Quantize) → Engine → Audio ; l'état résultant → UI + retour LED. Le clavier/GUI produisent les mêmes **intentions** que le MIDI (surface d'entrée unifiée, comme le mode dégradé Sonic Pi).

**Règle d'indépendance** : le Mapping et les Channels ne connaissent aucune piste ni aucun contrôleur en dur ; tout vient de la config `[SPEC-5.5, SPEC-6.3]`.

---

## C. Modèles de données (contrats, pas d'implémentation)

### C.1 Piste (métadonnées) — `[SPEC-4.2]`
| Champ | Type | Sens |
|---|---|---|
| `category` | texte | kick, hats, … |
| `name` | texte | nom affichable, unique dans la catégorie |
| `beats` | entier | longueur (4/8/16/32/64) |
| `tags` | liste texte (opt.) | recherche/filtre |
| `pattern` | code Strudel | la loop elle-même |
| `vars` | table texte (opt.) | fragments réutilisés dans `pattern` via `${NOM}` `[SPEC-4.7]` |
| `gain` | nombre (opt.) | niveau relatif de base |
| `key` | texte (opt.) | tonalité de référence Camelot ; présent ⇒ piste transposable `[SPEC-17.19]` |

### C.2 Manifeste de bibliothèque — `[SPEC-4.3]`
Liste des pistes (catégorie, nom, beats, tags, chemin). Régénérable par scan.

### C.3 Mapping contrôleur — `[SPEC-6.2]`
Par périphérique (nom de port), une liste d'entrées : `{ type: fader|knob|button, cc|note, function, target }` où `function` ∈ {channelVolume, channelFilter, trackSlot, modeToggle, windowPrev/Next} et `target` désigne l'index de canal / le slot. Aucune valeur en dur ailleurs.

### C.4 Associations — `[SPEC-5.2/5.4]`
Par canal : catégories associées ; par slot : référence de piste. Éditable en live, persistée.

### C.5 Journal de session — `[SPEC-11.2]`
En-tête : version, tempo, état initial. Événements : `{ t (en beats), type, payload }` où `type` ∈ {button, fader, knob, mode, window, eval}. Le rejeu réémet les intentions correspondantes contre l'horloge.

---

## D. Schéma de nommage & arborescence — `[SPEC-4.1/4.2/4.4]`

```
library/
  track.schema.json     # schéma JSON des pistes (validation dans l'éditeur)
  kick/
    haus.track.yaml
    tek.track.yaml
  hats/
    offbeat.track.yaml
  snare/
  bass/
  lead/
  <catégorie>/
    <slug>.track.yaml
```

- **Dossier = catégorie** ; **fichier = `<slug>.track.yaml`**.
- Chaque fichier **déclare** ses métadonnées + son pattern (champs de C.1) sous forme de **données**, pas de code `[SPEC-4.6]`. La longueur en beats est une **métadonnée déclarée** (pas encodée dans le nom, pour rester lisible et modifiable).
- Un script de **scan** produit le manifeste (C.2). Ajouter une piste = déposer un fichier conforme + réindexer `[SPEC-4.4]`.
- Nouvelle catégorie = nouveau dossier ; aucune modification du moteur/GUI.

---

## E. Feuille de route par phases

Chaque phase est une tranche jouable. Réf. spec entre crochets.

| Phase | Contenu | Réf. SPEC | Jalon |
|---|---|---|---|
| **0. Fondations** | Projet Vite+TS ; choix UI (Svelte/React) ; Strudel core joue un son ; Web MIDI détecte le nanoKONTROL2. | 1, 14.1 | « ça sonne + le nano est vu » |
| **1. Clock + Engine** | Horloge maître (tempo, beats) ; jouer/arrêter un pattern ; volume par canal. | 3, 3.4 | une loop tourne à 120 BPM |
| **2. Bibliothèque + mode simple** | Schéma D + manifeste + chargement d'une piste disque ; jouer une piste de la biblio. | 4, 9.1 | charger et jouer une piste du disque |
| **3. Canaux + MIDI in/out (MVP)** | Modèle de canaux ; mapping nanoKONTROL2 ; sliders→volume ; S/M/R→start/stop **immédiat** ; retour **LED**. | 5, 6, 7.1/7.3, 6.4 | **MVP** : instrument jouable au nano |
| **4. Knobs → filtre** | Knob→filtre de canal, effet immédiat. | 7.2 | filtrage live |
| **5. Fenêtre + quantisation** | Fenêtre W (boutons TRACK) ; mode (bouton CYCLE) ; lancement immédiat/quantisé ; signalement « pending ». | 7.4/7.5/7.6, 8 | lancement calé sur la fenêtre |
| **6. GUI complète** | Affichage global (tempo, beat, fenêtre, mode) + par canal (catégorie, volume, filtre, piste/slot, état) ; **éditeur d'associations** live. | 10, 5.2/5.3 | tout est visible et réassignable |
| **7. Mode avancé (live-coding)** | Édition + eval à chaud de code Strudel sur une piste. | 9.2 | faire évoluer une piste en live |
| **8. Record / replay** | Journal d'événements (C.5) ; enregistrement + rejeu ; repli audio si besoin. | 11 | rejouer une session |
| **9. 2e contrôleur (APC mini mk2)** | Ajout par config du mapping APC ; usage simultané ; gestion collision CC. | 6.1/6.5, 25 | nano + APC ensemble |
| **10. Persistance** | Config mapping/associations + sessions persistées et rechargées. | 13 | état retrouvé au démarrage |

**MVP = phases 0→3** : un instrument réellement jouable au nanoKONTROL2 avec des pistes du disque, volumes et LED. Le reste enrichit.

---

## F. Risques & mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Rejeu par événements insuffisant [SPEC-11.1] | perte d'une feature | Prototyper tôt (Phase 8) ; repli enregistrement audio [SPEC-11.3]. |
| Latence Web Audio / Web MIDI | jeu peu réactif | Mesurer dès Phase 3 ; ordonnancement au tick, lookahead. |
| API Strudel mouvante | casse à l'update | Épingler les versions `@strudel/*` ; isoler l'Engine derrière une interface stable. |
| Web MIDI limité à Chrome/Edge [SPEC-14.1] | portabilité | Assumé (usage perso) ; documenté. |
| Samples perso servis localement [SPEC-14.4] | friction setup | Utiliser l'outil `sampler` Strudel ; documenter. |
| Collision CC nano/APC [SPEC-6.5] | mauvais routage | Routage par nom de périphérique dès le Mapping. |

---

## G. Stratégie de vérification

- **Par phase** : critère de jalon jouable (colonne « Jalon » de E) validé à la main (audio réel + contrôleur).
- **Clock/Quantize** : tests unitaires sur le calcul des limites de fenêtre et la file d'actions [SPEC-8].
- **Mapping** : tests unitaires MIDI brut → intention, y compris collision de périphériques [SPEC-6.5].
- **Library scan** : test de génération du manifeste à partir d'une arborescence d'exemple [SPEC-4.3].
- **Session** : test enregistrement → rejeu déterministe produit la même suite d'intentions [SPEC-11.2].
- **Non-régression d'indépendance** : ajouter une piste / une catégorie / un contrôleur ne doit toucher que la config/les fichiers, pas le moteur [SPEC-4.4, SPEC-6.3].

---

## H. Dépendances vers les questions ouvertes

Certaines phases attendent une réponse de `[SPEC-16]` :
- Phase 4 ← Q1 (filtre knob bipolaire vs deux knobs).
- Phase 5 ← Q2 (annulation pending), Q4 (origine de quantisation).
- Phase 3 ← Q3 (nombre de slots par canal), Q6 (volume/filtre par canal confirmé).
- Phase 8 ← Q5 (rejeu du mode avancé dès v1 ?).

À trancher avant d'entamer la phase concernée.
