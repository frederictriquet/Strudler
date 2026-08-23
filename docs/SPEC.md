# Strudler — Spécification fonctionnelle

> Statut : v1. Reprend et enrichit `needs.md`. Voir [SPEC-17] pour les ajouts rédigés rétrospectivement (features demandées en cours de réalisation), et [SPEC-18] pour l'atelier de composition (prospectif, non implémenté).
> Plateforme retenue : **application web (TypeScript) bâtie sur Strudel core (`@strudel/*`) + Web MIDI API**.
> Convention : chaque bloc est numéroté `[SPEC-N.M]` pour être référencé par le plan et le code.

---

## [SPEC-1] Vision & périmètre

**[SPEC-1.1]** Strudler est un **instrument de performance live « music as code »** : une bibliothèque de loops codées (patterns) que l'on déclenche, mixe, transforme et arrange en temps réel via un ou plusieurs contrôleurs MIDI, à travers une interface graphique.

**[SPEC-1.2]** Deux natures cohabitent :
- **Instrument de scène** (~70 %) : GUI, déclenchement de clips, associations contrôleur↔pistes configurables, quantisation, volumes/filtres, record/replay.
- **Music as code** (~30 %) : les pistes sont du code (patterns Strudel), éditables et évolutives en live (mode avancé).

**[SPEC-1.3]** Cible : usage personnel de performance. Un seul opérateur, un poste, navigateur compatible Web MIDI.

**[SPEC-1.4]** Non-objectif v1 : multi-utilisateur, collaboration réseau, export de morceau fini/mastering, notation.

---

## [SPEC-2] Terminologie

| Terme | Définition |
|---|---|
| **Beat** | La pulsation du BPM. À 120 BPM il y a 120 beats/minute. `[needs:8]` |
| **Piste (track)** | Une loop codée (pattern Strudel) autonome, d'une longueur en beats (4/8/16/32/64), rangée dans la bibliothèque. Unité de déclenchement. |
| **Catégorie** | Type de piste : kick, hats, snare, bass, lead, ou autre (extensible). `[needs:10]` |
| **Canal** | Une voie logique de mixage/pilotage, associée à une (ou plusieurs) catégories, correspondant à une colonne d'un contrôleur (fader + knob + boutons). `[needs:12]` |
| **Slot / bouton** | Un bouton physique (S/M/R…) lié à une piste précise à déclencher. `[needs:19]` |
| **Fenêtre de beats (window)** | Grille de quantisation W ∈ {4,8,16,32,64} beats pour les démarrages/arrêts. `[needs:21]` |
| **Mode de déclenchement** | Immédiat, ou quantisé sur la prochaine limite de fenêtre. `[needs:19,20]` |
| **Session** | Un enregistrement horodaté des actions de performance, rejouable. `[needs:3,14]` |
| **Mapping** | Configuration reliant les contrôles physiques d'un contrôleur aux fonctions logiques. `[needs:25]` |

---

## [SPEC-3] Moteur music-as-code

**[SPEC-3.1]** Les loops sont écrites en **patterns Strudel** (mini-notation + algèbre de patterns). `[needs:8]`

**[SPEC-3.2]** Longueurs de loop supportées : **4, 8, 16, 32, 64 beats** — et arbitraire par extension. La longueur est une métadonnée de la piste. `[needs:8]`

**[SPEC-3.3]** Le moteur expose des **fonctions de mix / transformation / arrangement** applicables en temps réel : volume, filtre, et transformations de pattern (au minimum : `slow/fast`, `every`, `off`, `jux`, `rev`, `degradeBy`, superposition). `[needs:8]`

**[SPEC-3.4]** Une **horloge maître unique** fixe le tempo (BPM) et la position courante en beats. C'est l'autorité de temps de toute l'application (audio, quantisation, GUI, record).

**[SPEC-3.5]** Le tempo est réglable et affiché. (Réglage fin via un contrôle dédié — cf. [SPEC-7].)

---

## [SPEC-4] Bibliothèque de pistes

**[SPEC-4.1]** Chaque piste est un **fichier distinct** respectant un schéma de nommage et une arborescence. `[needs:10]`

**[SPEC-4.2]** Arborescence : rangement **par catégorie**. Le schéma exact (répertoires, extension, métadonnées) est défini dans le plan (`PLAN.md`, section D) et pourra évoluer, mais DOIT :
- ranger une piste dans le dossier de sa catégorie ;
- porter un nom lisible et unique dans sa catégorie ;
- déclarer ses métadonnées : catégorie, nom affichable, longueur en beats, tags optionnels.

**[SPEC-4.3]** Un **manifeste de bibliothèque** (index) recense toutes les pistes disponibles avec leurs métadonnées, pour alimentation de la GUI.

**[SPEC-4.4]** La bibliothèque est **extensible** : ajouter une piste = ajouter un fichier conforme + réindexer ; aucune modification du moteur ni de la GUI. De nouvelles catégories sont permises. `[needs:10]`

**[SPEC-4.5]** Les pistes sont **isolées** : une piste ne dépend pas d'une autre.

**[SPEC-4.6] Une piste est une donnée, pas du code.** Le fichier de piste est un document **YAML** (`library/<catégorie>/<slug>.track.yaml`) et non un module TypeScript. Motivations : une piste écrite par un **outil tiers** (éditeur de boucles, export) ne doit pas avoir à produire du code valide compilable ; un fichier peut être déposé, lu et écrit **hors du build**. Contraintes :
- les fichiers sont chargés en **texte brut** et analysés à l'exécution — un fichier invalide est signalé avec son **chemin, sa ligne et sa colonne** `[SPEC-14.3]` **sans empêcher les autres pistes de se charger** (une bibliothèque partiellement cassée reste jouable) ;
- toute **clé inconnue** est une erreur : une faute de frappe (`tag:` pour `tags:`) ne DOIT pas passer en silence ;
- le champ `pattern` reste du **code Strudel** transporté dans une chaîne — il est évalué à l'arrivée, avec les mêmes garanties d'erreur que le mode avancé `[SPEC-9.2]` ;
- la validation à l'édition est assurée par un **schéma JSON** (`library/track.schema.json`), associé aux pistes dans `.vscode/settings.json`, qui remplace le typage à la compilation perdu.

Une piste rejetée DOIT être signalée par un **toast** au chargement, en plus de la liste du panneau bibliothèque : celui-ci se trouve sous la ligne de flottaison, et plus aucun garde-fou à la compilation n'existe depuis le passage aux données `[SPEC-17.26]`.

*Impl. : `import.meta.glob('/library/**/*.track.yaml', { query: '?raw' })` + `parse`/`validate` dans `src/core/library/Library.ts`, dépendance `yaml`, schéma `library/track.schema.json` + `yaml.schemas` dans `.vscode/settings.json`, toasts `loadErrors` au montage dans `App.svelte`.*

**[SPEC-4.7] Fragments réutilisables (`vars`).** Un fichier de piste PEUT déclarer une table `vars` de fragments de texte, substitués dans `pattern` par `${NOM}`. Cela remplace la constante locale qu'un fichier TypeScript permettait (écrire une progression d'accords **une seule fois** et la réutiliser dans plusieurs couches empilées). La **portée est le fichier** : deux pistes peuvent employer le même nom de variable sans interférer. Une variable **non définie** est une erreur de chargement explicite — jamais un `${...}` laissé tel quel dans le pattern, qui ferait échouer Strudel loin de la cause réelle. *Impl. : `interpolate()` dans `Library.ts`.*

---

## [SPEC-5] Modèle de canaux & associations

**[SPEC-5.1]** Un **canal** agrège : un volume, un filtre, et un ensemble de **slots** (boutons) chacun lié à une piste. `[needs:12,16,17,19]`

**[SPEC-5.2]** L'utilisateur **associe une catégorie à un canal** (ex. canal 1 = kicks, canal 2 = hats). Un canal peut recevoir **plusieurs catégories** (ex. canal 6 = leads + bass). `[needs:12]`

**[SPEC-5.3]** Les associations sont **modifiables à la volée** depuis la GUI, sans redémarrage. `[needs:12]`

**[SPEC-5.4]** Sur un canal, chaque **bouton physique** (S/M/R…) est lié à une **piste précise** de la (des) catégorie(s) du canal. `[needs:19]`

**[SPEC-5.5]** Rien n'est **codé en dur** : associations catégorie↔canal et bouton↔piste vivent dans une configuration éditable. `[needs:25]`

---

## [SPEC-6] Contrôleurs MIDI & mapping configurable

**[SPEC-6.1]** Support **Korg nanoKONTROL2** en v1, **Akai APC mini mk2** ajoutable ensuite, **utilisables simultanément**. `[needs:2,25]`

**[SPEC-6.2]** Le **mapping** relie, par contrôleur (identifié par nom de port), chaque contrôle physique (fader/knob/bouton par CC ou note) à une **fonction logique** (volume de canal, filtre de canal, slot de piste, mode, taille de fenêtre). `[needs:25]`

**[SPEC-6.3]** Le mapping est **déclaratif et configurable** (pas de valeurs en dur), permettant d'ajouter un contrôleur en fournissant sa description sans toucher au moteur. `[needs:25]`

**[SPEC-6.4]** **MIDI bidirectionnel** : entrée (lecture des contrôles) et **sortie** (retour LED des boutons reflétant l'état réel des pistes). Le mode LED External du nanoKONTROL2 est requis pour le retour visuel matériel.

**[SPEC-6.5]** Gestion de la **collision de CC** entre contrôleurs (ex. Mute nano CC 48-55 vs faders APC CC 48-55) par identification du périphérique source.

---

## [SPEC-7] Contrôles temps réel

**[SPEC-7.1] Sliders → volume du canal.** Effet **immédiat** sur le son. `[needs:16]`

**[SPEC-7.2] Knobs → filtre du canal** (grave/aigu). Effet **immédiat**. Sémantique : un filtre balayable du passe-bas au passe-haut (à préciser en implémentation). `[needs:17]`

**[SPEC-7.3] Boutons S/M/R → démarrage/arrêt d'une piste** liée. `[needs:19]`

**[SPEC-7.4]** Deux comportements des boutons selon le mode : **immédiat**, ou **sur la prochaine limite de fenêtre de beats**. `[needs:19]`

**[SPEC-7.5] Bouton CYCLE → choix du mode** (immédiat ⇄ quantisé). L'état courant est affiché. `[needs:20]`

**[SPEC-7.6] Boutons TRACK (◄ ►) → choix de la taille de fenêtre** parmi {4,8,16,32,64,128} beats (128 ajouté rétrospectivement, cf. [SPEC-17.13]). La taille courante est affichée. `[needs:21]`

**[SPEC-7.7]** Toute action de contrôle a un retour : sonore immédiat et/ou visuel (GUI + LED).

---

## [SPEC-8] Fenêtre de beats & quantisation

**[SPEC-8.1]** La fenêtre W définit la grille de quantisation des démarrages/arrêts. `[needs:19,21]`

**[SPEC-8.2]** En mode **quantisé**, une action de bouton est mise en attente et appliquée au prochain instant `beat ≡ 0 (mod W)` relatif à l'origine de l'horloge.

**[SPEC-8.3]** En mode **immédiat**, l'action s'applique instantanément.

**[SPEC-8.4]** Une action en attente (quantisée) doit être visuellement signalée (pending) et annulable jusqu'à son application (souhaitable, à confirmer — cf. [SPEC-16]).

**[SPEC-8.5]** La longueur propre d'une piste (4/8/16/64 beats) et la fenêtre W sont **indépendantes** : la piste boucle sur sa longueur, W ne quantifie que le lancement/arrêt.

---

## [SPEC-9] Modes simple & avancé

**[SPEC-9.1] Mode simple :** utiliser les pistes **telles qu'elles sont sur le disque**, sans les modifier. `[needs:14]`

**[SPEC-9.2] Mode avancé :** **coder en live** sur les pistes pour les faire évoluer — édition et évaluation à chaud de code Strudel (le transpileur Strudel permet l'eval de chaînes de code). `[needs:14]`

**[SPEC-9.3]** Le passage simple ⇄ avancé ne doit pas interrompre la performance en cours.

---

## [SPEC-10] Interface graphique

**[SPEC-10.1]** La GUI **manque actuellement** et est centrale. `[needs:23]`

**[SPEC-10.2]** Elle **charge la bibliothèque** et permet d'**associer les pistes aux canaux/boutons** du contrôleur, et de **modifier ces associations** à la volée. `[needs:12]`

**[SPEC-10.3]** Affichage global permanent : tempo, position (beat courant), **taille de fenêtre**, **mode de déclenchement** courant. `[needs:23]`

**[SPEC-10.4]** Affichage par canal : catégorie(s) associée(s), volume, filtre, et pour chaque bouton **le nom de la piste liée** + son **état** (arrêtée / en attente / en lecture). `[needs:23]`

**[SPEC-10.5]** La GUI reflète en temps réel l'état piloté par le MIDI (et vice-versa), et est extensible pour de futures informations. `[needs:23]`

**[SPEC-10.6]** Un éditeur d'associations permet de (ré)assigner catégorie↔canal et piste↔bouton. `[needs:12]`

---

## [SPEC-11] Enregistrement & rejeu de sessions

**[SPEC-11.1]** Pouvoir **enregistrer et rejouer** une session live. Faisabilité reconnue incertaine par l'utilisateur ; traité comme objectif à valider par prototype. `[needs:3,14]`

**[SPEC-11.2]** Approche retenue : **journal d'événements horodatés** (en beats) — actions de boutons, faders, knobs, changements de mode/fenêtre, et en mode avancé les évaluations de code — plus l'état initial et le tempo. Le rejeu réémet ces événements contre l'horloge.

**[SPEC-11.3]** Repli si le rejeu par événements s'avère insuffisant : **enregistrement audio** de la sortie (secours), sans les gestes.

**[SPEC-11.4]** Une session enregistrée est persistée dans un fichier de format documenté (cf. `PLAN.md` section C).

---

## [SPEC-12] Banque de sons & sons personnels

**[SPEC-12.1]** Une **banque de sons de base** est disponible (samples Strudel/dirt-samples). `[needs:4]`
> Décision d'implémentation : banque **dirt-samples complète**, chargée **à distance** (`raw.githubusercontent.com`) puis **mise en cache** par un Service Worker pour un usage hors-ligne ultérieur. Le **1er chargement requiert le réseau** (dérogation assumée à [SPEC-14.4] « hors-ligne au chargement » — voir note ci-dessous) ; les **synthés** ([registerSynthSounds]) restent le repli 100 % hors-ligne.

**[SPEC-12.2]** L'utilisateur peut **ajouter ses propres sons** (via `strudel.json`, URL, ou l'outil `sampler` local de Strudel). `[needs:5]`

**[SPEC-12.3]** Les sons perso sont référençables par les pistes de la bibliothèque au même titre que la banque de base.

---

## [SPEC-13] Persistance & configuration

**[SPEC-13.1]** Le **mapping** des contrôleurs est persistant et éditable (fichier de config).

**[SPEC-13.2]** Les **associations** catégorie↔canal et piste↔bouton sont persistantes (rechargées au démarrage) et modifiables en live. `[needs:12]`

**[SPEC-13.3]** Le **manifeste de bibliothèque** est régénérable à partir des fichiers de pistes.

**[SPEC-13.4]** Les **sessions** enregistrées sont persistées et listables/rejouables.

### Durabilité de l'état

Tout ce qui précède vit dans le `localStorage` d'**une** origine. Trois accidents de natures
différentes le suppriment, et aucun ne se règle en changeant de technologie de stockage
(IndexedDB obéit aux mêmes règles d'effacement et d'éviction) : la dérive d'origine, l'effacement
ou l'éviction par le navigateur, et un bug applicatif qui écrase une clé — ce dernier s'est déjà
produit (`[SPEC-17.51]`). La réponse est une copie **hors du navigateur**.

**[SPEC-13.5]** L'intégralité de l'état persisté est copiée sur disque dans
`<projet>/.state/strudler-state.json` **à chaque écriture**. Le balayage est **générique** : il
énumère les clés portant le préfixe `strudler:` au lieu de les nommer. Une clé ajoutée
ultérieurement est donc sauvegardée sans intervention, ce qui est la propriété qui rend la
garantie durable. Les valeurs sont recopiées en **texte brut**, jamais réinterprétées : un
changement de schéma d'une donnée ne peut pas casser la sauvegarde, et celle-ci n'a aucun format
propre à migrer. Le déclenchement est un **point d'accroche unique** dans la couche de stockage,
non un appel chez chaque appelant.

**[SPEC-13.6]** L'origine est **verrouillée** (`strictPort`) : un port occupé provoque une erreur
au lancement au lieu d'ouvrir l'application sur une origine voisine avec un état vide. L'origine
demande en outre le **stockage persistant** au navigateur, ce qui l'exempte de l'éviction sous
pression disque.

**[SPEC-13.7]** Des **instantanés datés** conservent les états précédents (rotation à 30). Un
instantané n'est écrit que si le contenu a changé et si le précédent est assez ancien ; deux
paquets de même horodatage ne s'écrasent jamais. C'est ce qui permet de revenir en arrière après
un écrasement fautif.

**[SPEC-13.8]** Quand le navigateur est **entièrement vide** et qu'une copie disque existe, l'état
est **restauré d'office** et le fait est annoncé dans l'UI. Un navigateur contenant ne serait-ce
qu'une entrée est autoritaire : on n'y touche pas. La restauration précède l'initialisation des
stores, qui lisent leurs clés à l'évaluation de leur module.

**[SPEC-13.9]** Un **export/import** d'un fichier unique couvre le changement de machine, de
navigateur ou de profil — le seul cas qu'une copie locale ne couvre pas. L'import est présenté
(date, origine, nombre d'entrées) et confirmé avant d'écrire.

**Limite assumée** : le miroir passe par le serveur de développement/prévisualisation. Servi
autrement, un `dist/` n'a pas ces routes et l'UI l'annonce explicitement, plutôt que de laisser
croire à une protection inexistante `[SPEC-14.3]`. Le *handle* du dossier `library/` n'est pas
sérialisable : seul son **nom** est sauvegardé, pour indiquer quel dossier réautoriser.

---

## [SPEC-14] Contraintes non-fonctionnelles

**[SPEC-14.1]** Navigateur : **Chrome / Edge** (Web MIDI requis ; absent de Firefox/Safari).

**[SPEC-14.2]** Latence : déclenchements et effets slider/knob perçus comme **immédiats** ([SPEC-7.1,7.2,7.4] mode immédiat).

**[SPEC-14.3]** Robustesse : aucune exception silencieuse ; une erreur d'une piste ne doit pas arrêter les autres.

**[SPEC-14.4]** Fonctionnement **local** (pas de dépendance serveur en performance) ; les samples perso peuvent nécessiter un petit serveur local de fichiers.
> Nuance retenue : la **performance** reste hors-ligne (samples décodés en mémoire ; SW en cache). Seul le **1er chargement** de la banque de base touche le réseau. Repli synthés si le réseau manque.

**[SPEC-14.5]** Reconnexion : gérer branchement/débranchement à chaud d'un contrôleur.

---

## [SPEC-15] Hors périmètre v1 / évolutions futures

- Multi-contrôleur au-delà de nanoKONTROL2 + APC mini mk2.
- Effets avancés au-delà volume/filtre (delay, reverb pilotés — évolution).
- Séquenceur d'arrangement de morceau complet.
- Partage/export de sessions vers d'autres formats.
- Le rendu visuel « grille de carrés » façon Strudel (playhead) : souhaitable, à intégrer dans la GUI [SPEC-10] en évolution.
- **Sauvegarde d'une piste live-codée vers un fichier** : exporter l'override de code d'un slot (mode avancé [SPEC-9.2]) vers un `library/<catégorie>/<slug>.track.yaml` (ou un dossier de pistes utilisateur), pour rendre permanente une évolution jouée en live. Aujourd'hui les éditions live sont en mémoire seulement. *(demandé — à faire plus tard ; c'est le sens retour du cycle décrit en [SPEC-18.1])*
- **Atelier de composition** : spécifié en [SPEC-18], non implémenté.

---

## [SPEC-16] Questions ouvertes

1. ~~**Filtre knob [SPEC-7.2]** : un seul knob bipolaire ou deux knobs ?~~ **RÉSOLU (phase 4)** : **knob bipolaire unique** (centre = neutre, gauche = passe-bas, droite = passe-haut).
2. ~~**Annulation d'une action quantisée en attente [SPEC-8.4]** : requise ou non ?~~ **RÉSOLU (phase 5)** : **annulable** — re-presser pendant l'attente annule l'action en attente.
3. ~~**Slots par canal [SPEC-5.4]** : 3 (S/M/R) ou davantage ?~~ **RÉSOLU** : nombre de slots **configurable par contrôleur** (jamais codé en dur, cf. [SPEC-5.5]) — **3 (S/M/R)** pour le nanoKONTROL2, **jusqu'à 8** pour l'Akai APC mini mk2 (boutons de colonne) à venir.
4. ~~**Origine de la quantisation [SPEC-8.2]** : relative au démarrage de l'app, ou re-synchronisable ?~~ **RÉSOLU (phase 5)** : **re-synchronisable** (reset de phase via un contrôle).
5. ~~**Record/replay [SPEC-11]** : mode avancé rejouable dès la v1 ?~~ **RÉSOLU** : **gestes seulement** en v1 (les évaluations de code du mode avancé ne sont pas rejouées).
6. ~~**Volume/filtre par canal vs par piste**~~ **RÉSOLU** : **par canal** (aucun réglage par piste attendu en v1).

---

## [SPEC-17] Ajouts rétrospectifs (hors plan initial)

> Spécifications rédigées **après** implémentation, pour tracer des besoins exprimés en cours de réalisation. Chacune référence son implémentation.

**[SPEC-17.1] Remontée claire des erreurs à l'utilisateur.** Toute erreur/exception attrapée DOIT être remontée **très clairement dans l'interface** (message visible : bandeau, statut, notification), JAMAIS uniquement dans un log difficile d'accès (console navigateur, fichier). Étend [SPEC-14.3]. L'utilisateur doit comprendre qu'une erreur s'est produite et laquelle, sans fouiller. *Impl. : stores exposant un `error` affiché par les panneaux (`rackError`, `samplesError`, `persistError`).*

**[SPEC-17.2] Interface plein écran.** La GUI DOIT exploiter le **maximum de la largeur visible** ; pas de panneau central étroit à `max-width` qui gaspille les bords. Layout responsive (`width:100%`, `min-height:100vh`, grilles `auto-fit`/`auto-fill`). *Impl. : `src/App.svelte`.*

**[SPEC-17.3] Banque de sons : bibliothèque locale scannée.** Réalise [SPEC-12.1/12.2] et [SPEC-14.4].
- Les sons vivent dans un **dossier local possédé par l'utilisateur** (`~/Music/Sounds`, surchargeable par `STRUDLER_SOUNDS_DIR`). Le serveur de dev/preview le **sert en same-origin** sous `/sounds/` et **génère la sample-map** `/sounds/strudel.json` en le **scannant** à chaque chargement (dossier contenant des fichiers audio = un son, nommé d'après le dossier ; imbrication supportée).
- **100 % hors-ligne dès le 1er lancement** (fichiers sur le disque, aucun réseau). La curation (ajout/retrait/mise à jour de sons) se fait en modifiant le dossier ; pris en compte au rechargement, sans toucher au code ([SPEC-4.4]-like pour les sons).
- Amorçage : `npm run samples:fetch` télécharge dirt-samples dans `~/Music/Sounds/dirt`.
- La **capacité synthé** de Strudel est conservée (mode avancé) ; les pistes fournies utilisent les sons dirt.
- *Impl. : `vite-plugins/soundsServer.ts`, `scripts/fetch-samples.mjs`, `src/stores/samplesStore.ts` (`DEFAULT_SAMPLE_BANK = '/sounds/strudel.json'`).*
- Note : le Service Worker `public/sw.js` (cache d'une source distante) devient inactif dans ce mode local ; conservé pour un éventuel retour à une source réseau.

**[SPEC-17.4] Mode « placement » (assignation par clic).** La GUI DOIT offrir un mode où l'on **clique une piste** de la bibliothèque (elle est « tenue »), puis **un slot d'un canal compatible** pour l'y assigner à la volée. Un canal est **compatible** si ses catégories (les « types sélectionnés » du canal) incluent la catégorie de la piste ; les canaux incompatibles sont visuellement écartés. Complète l'éditeur d'associations [SPEC-10.6, SPEC-5.2/5.4]. *Impl. : `src/stores/placementStore.ts`, `LibraryPanel`, `ChannelRack`.*

**[SPEC-17.5] Remontée des sons introuvables.** Un son référencé mais **non chargé/introuvable** (ex. nom de sample absent) ne DOIT pas rester silencieux sans explication : l'avertissement du moteur (Strudel `sound … not found`) DOIT être **affiché dans l'interface**. Cas particulier de [SPEC-17.1]. *Impl. : `src/stores/logStore.ts` (écoute l'événement `strudel.log`), bandeau ⚠ dans `App`.*

**[SPEC-17.6] Sémantique d'arrêt du rejeu.** Précise [SPEC-11]. Un **arrêt explicite** du rejeu (bouton) DOIT à la fois cesser la ré-émission des événements **et faire taire** ce que le rejeu laissait jouer. Une **fin naturelle** (tous les événements émis) conserve l'état final sonore. Le lancement du rejeu peut débloquer l'audio si nécessaire (le clic est un geste utilisateur). *Impl. : `rackStore` (`stopReplay`/`startReplay`).*

**[SPEC-17.7] Robustesse de la persistance.** Précise [SPEC-13.2]. Au rechargement d'une configuration persistée, les **catégories et pistes qui n'existent plus** dans la bibliothèque DOIVENT être **ignorées/nettoyées** (pas de référence morte, pas d'erreur d'évaluation). *Impl. : `rackStore` (validation au chargement contre la bibliothèque).*

**[SPEC-17.9] Modèle transport PLAY/STOP (arm-then-play).** Précise/ajuste [SPEC-7]. Déclencher un slot (S/M/R, clic, MIDI, Stream Deck) **arme** la loop sans la faire sonner tant que le transport n'est pas lancé. Un unique bouton **PLAY/STOP** (GUI) — lié aux boutons **PLAY (CC 41) / STOP (CC 42)** du nanoKONTROL2 — contrôle la lecture : **PLAY** débloque l'audio (geste) et joue l'ensemble armé de façon synchronisée ; **STOP** met en **pause** en conservant l'armement (→ PLAY relance, sans refresh). L'ancien « Activer l'audio » et « Tout arrêter » sont remplacés par ce PLAY/STOP. Interagir n'entraîne jamais de son ni de replay de session — seuls PLAY (transport) et Rejouer (session) le font. En transport arrêté, l'armement est immédiat (pas de quantisation, l'horloge ne tournant pas) ; en lecture, la quantisation [SPEC-8] s'applique. *Impl. : `StrudelEngine.startTransport/stopTransport` (autostart du scheduler), `rackStore` (`transportRunning`, `startTransport`, `stopTransport`), `ClockPanel` (bouton PLAY/STOP).*

**[SPEC-17.8] Contrôleur Elgato Stream Deck (WebHID).** Le Stream Deck (non-MIDI, périphérique HID) PEUT être utilisé comme surface de jeu via **WebHID** : c'est un producteur d'`Intent` de plus ([PLAN B]), avec **retour d'état riche** (chaque touche est un LCD → couleur selon vide/assigné/lecture/pending). Layout par défaut MK.2 (5×3) : colonnes 1-4 = canaux, lignes = slots S/M/R, colonne 5 = mode / fenêtre −/+. Contraintes : Chrome/Edge, **logiciel Elgato fermé** (il monopolise le HID), connexion sur geste utilisateur, **calage matériel à valider par modèle**. *Impl. : `src/core/streamdeck/StreamDeckService.ts` (lib `@elgato-stream-deck/webhid`), `src/stores/streamdeckStore.ts`, bouton dans la modale.*

**[SPEC-17.10] Jauge de progression par slot.** Chaque bouton de slot **en lecture** PEUT afficher un indicateur **animé** de la progression dans la boucle, **relatif à la longueur de la piste** (`beats` de la piste). Position = `(beat courant mod L) / L`, alignée sur la grille de cycles Strudel (indépendante du moment d'armement). Affichage **optionnel**, activé/désactivé depuis la **modale MIDI/Session** et **conservé** (persistance). *Impl. : `SlotState.trackBeats` (dénormalisé), `showSlotProgress`/`setShowSlotProgress` dans `rackStore` (persisté avec les settings), barre animée dans `ChannelRack.svelte` pilotée par `clockState`, bascule dans `SettingsModal.svelte`.*

**[SPEC-17.11] Aide à la longueur en live-coding.** Le mode avancé PEUT afficher une **estimation de la longueur de boucle** (beats / mesures) du code saisi, mesurée en **interrogeant** le pattern (aucun son, repl de mesure dédié) et en détectant la période de répétition ; « longueur variable » si aucune période dans la fenêtre (patterns aléatoires), « code invalide » si l'évaluation échoue. *Impl. : `StrudelEngine.measureLengthBeats`, `measureLength` dans `rackStore`, badge dans `CodePanel.svelte`.*

**[SPEC-17.53] Noms complets des effets dans la tranche de canal.** Le sélecteur d'effet de chaque canal DOIT afficher le **nom complet** de l'effet (« Trémolo », « Passe-bas », « Saturation »…) et non son abréviation : sur scène, un sigle de trois lettres n'est pas lisible d'un coup d'œil. Le **label court** reste défini pour les surfaces contraintes (LED, Stream Deck). Le nom déborde en ellipse plutôt que d'élargir le canal [SPEC-17.2]. *Impl. : champ `name` dans `FX_META` (`core/channels/types.ts`), `.fxbtn` + infobulles/`aria-label` dans `ChannelRack.svelte`.*

**[SPEC-17.54] Parité sonore avec le REPL de Strudel.** Un pattern DOIT sonner **de la même façon** dans Strudler et dans le REPL officiel. L'écart ne venait pas du moteur mais de l'**inventaire** : `s("hh")` désignait le dossier dirt-samples local ici et uzu-drumkit là-bas, si bien que `n("4")` choisissait deux fichiers sans rapport.

Strudler enregistre donc, **après** sa banque locale, les mêmes banques que le prebake du REPL (piano, VCSL, tidal-drum-machines, uzu-drumkit, uzu-wavetables, mridangam). L'**ordre est la règle** : `registerSound()` fait `soundMap.setKey(nom, …)`, donc un enregistrement ultérieur **remplace** le précédent — il ne fusionne pas. Les noms partagés (`hh`, `bd`, `piano`…) prennent la version du REPL ; tout ce que l'utilisateur possède en propre et que le REPL n'a pas (`jvbass`, `arpy`, `808sd`, dossiers personnels) survit intact. Vérifié : 1043 sons locaux + 848 distants → **1070 noms distincts**, `hh` résolu vers uzu-drumkit comme dans le REPL.

Fusionner localement ne pouvait pas y suffire : le scanner de `soundsServer` **concatène** les listes de deux dossiers homonymes, donc `n(4)` serait resté le 4ᵉ fichier local.

Contraintes tenues :
- **chargement partiel assumé** — chaque banque est chargée séparément et un échec est *collecté*, jamais propagé : une CDN injoignable ne doit pas coûter ses sons locaux à l'utilisateur. Les banques manquantes sont **nommées** [SPEC-14.3], un chargement partiel silencieux étant pire que l'absence ;
- **hors-ligne préservé** [SPEC-14.4] — seules les *cartes* JSON sont récupérées ici ; les fichiers audio restent chargés à la première utilisation et mis en cache par le Service Worker ;
- **le navigateur de sons liste toutes les banques**, dans le même ordre et avec la même règle d'écrasement, sinon il annoncerait un nombre d'échantillons que l'on n'entendra pas.

⚠ La liste est celle du prebake du REPL (`website/src/repl/prebake.mjs` des sources Strudel, conservées sous `study/`) : elle vit dans le site, pas dans les paquets `@strudel/*`, donc **aucun moyen de la lire à l'exécution** — à revoir quand Strudel change ses défauts. *Impl. : `src/core/engine/sampleBanks.ts`, `loadSamples(source, base?)`, appelé par `samplesStore`, `composerStore` et `core/composer/preview.ts`.*

**[SPEC-17.53] Les réglages d'une piste ne sont plus écrasés par le canal.** Corrige [SPEC-17.23]/[SPEC-17.28]. La chaîne de voix ajoutait ses contrôles **après** le code de la piste ; or en Strudel un contrôle posé plus tard **remplace** le précédent. Un `.lpf(800)` écrit dans une piste devenait donc le cutoff neutre du canal (20 kHz), un `.room(0.25)` devenait 0, un `.gain(0.9)` disparaissait au profit du volume du canal — sans aucun signal. Constaté sur 21 des 23 pistes de la bibliothèque, dont les trois basses et les deux progressions d'accords, qui ne sonnaient donc pas comme elles étaient écrites.

Deux règles :
- **Insertion conditionnelle.** `lpf`/`lpq`, `hpf`/`hpq`, `delay` (avec son temps et sa réinjection) et `room`/`roomsize` ne sont insérés **que lorsqu'ils sont engagés** — l'effet activé, ou le filtre bipolaire écarté du neutre. Au repos la piste garde son propre son ; toucher l'effet rend la main au canal. Prolonge la règle qui existait déjà pour les effets lourds [SPEC-17.28]. Toute bascule d'effet, et tout **franchissement** du neutre par le filtre bipolaire, changent la forme de la chaîne et exigent donc une **réévaluation** des voix du canal ; un balayage à l'intérieur d'une moitié reste live via les `ref`.
- **Le volume MULTIPLIE.** Le fader de canal doit mettre à l'échelle ce que la piste déclare [SPEC-4.2], pas le jeter : `.mul(gain(chgain(n)))` au lieu de `.gain(chgain(n))`. Sur une piste sans `gain`, `mul` rend le facteur lui-même, donc le comportement antérieur est conservé.

**Exception assumée** : `djf` et le phaser restent **inconditionnels**. Ils adossent des gestes maintenus [SPEC-17.41, SPEC-17.46] qui doivent mordre sur des voix déjà en cours, ce qu'une insertion conditionnelle n'obtiendrait qu'en réévaluant en plein geste ; et `setGlobalFilter` a besoin que le nœud `djf` existe pour l'atteindre. Leur neutre est réellement inerte — profondeur 0 ne construit rien, `djf` 0,5 contourne. *Impl. : `voiceChain()` dans `StrudelEngine`, reconstruction dans `ChannelRack.toggleChannelFx`/`setFilter`.*

**[SPEC-17.52] Les scènes mémorisent la quantisation des canaux.** Étend [SPEC-17.36]. Une scène capture, en plus de l'ensemble armé, l'**état de quantisation de chaque canal** [SPEC-17.17] : contrairement à un volume ou à un paramètre d'effet, c'est un **mode discret** et non une position de potentiomètre, donc le restaurer ne « tire » aucun curseur — et une scène DOIT se relancer comme elle a été mémorisée. Au rappel, la quantisation est appliquée **avant** les bascules de slots, et seuls les canaux dont l'état diffère sont basculés (une seule mise à jour LED et une seule persistance par canal). Les scènes enregistrées au format précédent (liste de slots armés seule) sont **migrées** au chargement et laissent la quantisation inchangée. *Impl. : `ChannelRack.quantizedSnapshot()`, interface `Scene` + `coerceScene` (migration) dans `rackStore`, `storeScene`/`recallScene`.*

**[SPEC-17.51] Les associations persistées ne sont jamais purgées.** Corrige [SPEC-13.2]. À la restauration, une association slot → piste dont l'identifiant **ne se résout pas** dans la bibliothèque DOIT être **conservée**, jamais effacée : l'état restauré est resauvegardé quelques centaines de millisecondes plus tard, donc toute purge est **définitive** — une bibliothèque momentanément illisible (fichier renommé, glob cassé, erreur de chargement) suffirait à détruire la session entière. Idem pour les **catégories** de canal inconnues. Un slot non résolu est **inactif** (pas de son, LED éteinte, aucune évaluation) et **visiblement en défaut** dans la GUI : bordure rouge et affichage de l'identifiant manquant, afin que le fichier absent soit nommable. Le nombre et la liste des pistes introuvables sont signalés en **erreur visible** au chargement [SPEC-14.3], et presser un tel pad affiche la raison. Un `codeOverride` de live-coding [SPEC-9.2] rend le slot jouable malgré l'identifiant non résolu. Restaurer le fichier restaure les pads. *Impl. : `isMissingTrack` (`core/channels/types.ts`), restauration sans purge + `notify` dans `rackStore`, garde dans `ChannelRack.toggleSlot`/`rebuildActiveVoices`, LED via `slotVisual`, classe `.slot.missing` dans `ChannelRack.svelte`.*

**[SPEC-17.50] Modale d'activation audio au démarrage.** Le navigateur n'autorise le son qu'après un **vrai geste utilisateur**, et un message MIDI n'en est pas un [SPEC-17.25]. Au chargement, si l'`AudioContext` est encore verrouillé, une **modale bloquante** (non fermable : ni clic hors modale, ni Échap) demande un clic sur un bouton **« Activer l'audio »**. Ce clic **déverrouille l'audio uniquement** — il ne lance **pas** la lecture : le PLAY reste une action explicite [SPEC-17.9]. Après lui, le PLAY du Korg / du Stream Deck fonctionne directement, sans passer par le PLAY de la GUI. Un échec de déverrouillage laisse la modale ouverte **avec la raison affichée** (état réel de l'`AudioContext`) [SPEC-14.3]. Si un PLAY MIDI survient alors que l'audio est (re)verrouillé, la modale est ré-ouverte sans tenter de démarrer un transport qui serait muet. ⚠ Le déverrouillage NE PEUT PAS s'appuyer sur `initAudioOnFirstClick()` de Strudel : dans superdough 1.3.0, `initAudio()` teste `if ((!audioCtx) instanceof OfflineAudioContext)` — toujours faux — et n'appelle donc **jamais** `resume()`. L'app fait le `resume()` elle-même, **synchronement dans le geste** (tout `await` préalable perdrait l'activation transitoire) et **borné dans le temps** (hors geste, la promesse peut rester pendante indéfiniment). *Impl. : `StrudelEngine.unlock()`/`audioState` + `RESUME_TIMEOUT_MS`, `audioUnlockNeeded`/`checkAudioUnlock`/`unlockAudio` (`rackStore`), `startTransport` déverrouille aussi (le PLAY GUI est un geste), `src/lib/AudioUnlockModal.svelte`, montage + `checkAudioUnlock()` dans `App.svelte`.*

**[SPEC-17.49] Le chronomètre EST le bouton PLAY/STOP.** Le chronomètre de performance [SPEC-17.38] et le bouton de transport [SPEC-17.9] ne font plus qu'un contrôle : à l'arrêt il affiche **▶** et la durée figée du dernier passage ; cliqué, il lance la lecture, passe à **■** et le temps défile ; recliqué, il arrête (pause conservant l'armement) et se fige. Le prochain PLAY **repart de zéro**. Les boutons ▶ Play / ■ Stop séparés sont supprimés (gain de place [SPEC-17.2], cible unique en performance). *Impl. : `src/lib/TransportTimer.svelte` (bouton, `startTransport`/`stopTransport`), suppression des boutons et du handler `onPlay` dans `ClockPanel.svelte`.*

**[SPEC-17.48] Accords écrits en symboles + voicing automatique.** Les pistes d'accords sont décrites par des **symboles** (`<E G#m B F#>`) et non par des notes absolues, puis rendues avec `chord(...).dict("triads").anchor("c4").voicing()`, la fondamentale étant jouée à part par `rootNotes(2)`.

Motif : écrites en notes absolues, les progressions étaient **déplacées en bloc** par la transposition [SPEC-17.19] (`.add(note(N))`, jusqu'à ±6 demi-tons) — le registre dérivait et le voicing réglé à l'oreille perdait son équilibre. Avec `voicing()`, le renversement est **choisi** à chaque accord : `anchor` maintient la progression **dans un registre fixe** et la **conduite de voix** devient automatique, tandis que la basse reste dans son octave.

Le dictionnaire **`triads`** est imposé explicitement : le défaut (`ireal`) produit des voicings de jazz avec septièmes et tensions, là où ces progressions veulent des triades simples. Nécessite `@strudel/tonal`, ajouté au scope d'évaluation. *Impl. : `import * as strudelTonal` + `evalScope(..., strudelTonal)` (`StrudelEngine`), déclaration de module dans `src/types/strudel.d.ts`, pistes `library/chords/*.track.yaml`.*

**[SPEC-17.47] Échos calés au tempo (4 et 16 beats) + point d'insertion master unique.** Trois gestes maintenus (rangée du milieu, **ECHO 1**, **ECHO 2** et **ECHO 4**) envoient l'ensemble du mix dans une ligne de delay dont le temps vaut **1, 2 ou 4 beats**, recalculé d'après le tempo à chaque appui. Réinjection ≈ 0,55, soit des répétitions à −5 dB l'une de l'autre : quelques échos audibles puis extinction. **Un STOP DOIT faire taire les lignes d'écho.** Relâcher la touche ne ferme que l'envoi — la ligne continue de recirculer ce qu'elle contient, ce qui est l'intérêt même de l'effet, mais devient un défaut à l'arrêt : le transport est coupé et du son continue. Fermer l'envoi ne suffit pas, couper la réinjection non plus (le tampon se vide encore pendant une durée de delay, soit 2 s à 120 BPM pour un écho de 4 beats) : le **retour** doit être coupé aussi, en fondu court pour éviter le clic. Les gains nominaux ne sont pas restaurés par minuterie mais au **prochain appui**, sinon une queue résiduelle repasserait. L'état des touches maintenues est remis à zéro en même temps : les laisser allumées annoncerait un effet qui ne tourne plus.

**Le maintien ouvre le départ (send), pas le retour** : relâcher cesse d'alimenter la ligne mais **laisse la queue résonner et s'éteindre** — c'est tout l'intérêt d'un écho, et la seule exception assumée à la règle « relâchement franc » [SPEC-17.43].

Ces effets partagent désormais un **point d'insertion master unique** (`masterHub` → sends en parallèle → `masterOut` → destination), créé une seule fois. Chaque effet rebranchant la sortie de superdough pour son compte finirait tôt ou tard par un **silence complet** ; le flanger [SPEC-17.46] a été reporté sur ce hub, son signal direct étant fourni par le chemin sec du hub. *Impl. : `ECHO_BEATS`/`ECHO_FEEDBACK`/`ECHO_WET`, `StrudelEngine.ensureMasterInsert`/`ensureEcho`/`setEcho`/`echoSeconds`, `echoActive`/`setEchoHold` (`rackStore`), intent `echoHold`, touches et couleurs dans `StreamDeckService` (libellés désormais **multi-lignes et auto-ajustés**), boutons dans `ClockPanel.svelte`.*

**[SPEC-17.46] Phaser global maintenu.** Sixième geste (rangée du milieu du Stream Deck, touche **PHASER**, ambre quand actif ; miroir dans la GUI). Tenu, il applique un **phaser** à l'ensemble du mix, avec un balayage **lent et calé sur le tempo** (4 cycles = 16 beats).

Il s'appuie sur le **phaser natif de superdough**, celui-là même qui sert à l'effet PHS par canal [SPEC-17.32] — inutile de reconstruire un graphe Web Audio pour quelque chose que le moteur sait faire. Il emprunte donc **les mêmes refs de contrôle** : superdough n'accepte qu'un réglage de phaser par événement, un second `.phaserrate()` dans la chaîne écraserait simplement le premier. Le geste **prime** sur le phaser propre au canal tant qu'il est tenu, et tout revient à l'état antérieur au relâchement.

Limite assumée, commune aux effets pilotés par paramètre : le phaser s'applique **aux événements suivants**, il ne traite pas un son déjà en train de sonner. Sur du matériel rythmique dense, l'écart est imperceptible. *Impl. : `GLOBAL_PHASER_CYCLES`/`GLOBAL_PHASER_DEPTH`, `StrudelEngine.setGlobalPhaser` + prise en compte dans `fxPhaserDepthFor`/`fxPhaserRateFor`, `phaserActive`/`setPhaserHold` (`rackStore`), intent `phaserHold`, touche et couleurs dans `StreamDeckService`, bouton dans `ClockPanel.svelte`.*

**[SPEC-17.44] Gate rythmique maintenu.** Cinquième geste de la rangée (touche **GATE**) : tant qu'elle est tenue, le son de **tous les canaux** est haché sur une grille **calée au tempo** (croches, rapport cyclique 50 %) ; le relâchement rend le son plein immédiatement.

Deux points d'implémentation qui conditionnent le résultat :
- Les fronts sont **programmés à l'avance sur l'horloge audio** (fenêtre d'anticipation de 200 ms, replanifiée toutes les 25 ms) et non poussés image par image : une boucle d'animation les placerait avec jusqu'à ~8 ms d'écart, ce qui s'entend nettement sur un gate. La grille est **accrochée** à la position courante en beats au moment de l'appui.
- Le gate agit sur le **gain de sortie de l'orbit** (le bus), donc il hache aussi les **sons tenus** — un gain par événement n'aurait pu que rendre des notes entières muettes. Chaque front est adouci (~4 ms) pour éviter les clics.

**Entrée progressive** [SPEC-17.45] : la **profondeur** de la coupure augmente sur les **8 premiers beats** au lieu d'être totale dès le premier front — le niveau fermé descend progressivement jusqu'au silence. Le geste s'installe ainsi au lieu de claquer. La profondeur est calculée **au moment où chaque front est programmé**, donc elle reste juste malgré l'anticipation.

Un **DROP** tenu simultanément l'emporte : les canaux coupés le restent, le gate ne les rouvre pas. *Impl. : `GATE_STEPS_PER_BEAT`/`GATE_DUTY`/`GATE_LOOKAHEAD_S`/`GATE_EDGE_S` + `StrudelEngine.setGate`/`scheduleGate`/`orbitGainParam`, `gateActive`/`setGateHold` (`rackStore`), intent `gateHold`, touche et couleurs dans `StreamDeckService`, bouton dans `ClockPanel.svelte`.*

**[SPEC-17.43] Glissement des gestes de filtre.** Tout changement du filtre global [SPEC-17.41/17.42] est **glissé** au lieu de sauter : ~200 ms à l'enclenchement d'un passe-bas/passe-haut, mais un retour au neutre FRANC (~20 ms, juste assez pour éviter un clic) — un geste maintenu se relâche sur un temps, sa fin doit être nette, et la durée du riser pour sa montée. Le balayage part **de la valeur courante**, de sorte qu'un enchaînement de gestes (relâcher LP alors que HP est tenu, presser RISE en cours de LP…) reste continu.

Le glissement est piloté **image par image par l'application**, jamais par une automation Web Audio : chaque événement sonore réécrit le paramètre du filtre de l'orbit (`setValueAtTime`), ce qui écraserait une automation dès la note suivante et ferait sauter le balayage — c'est précisément pourquoi les filtres paraissaient abrupts malgré la rampe de 10 ms initialement posée sur le paramètre. *Impl. : `rampFilter` + `FILTER_ATTACK_S`/`FILTER_RELEASE_S` dans `rackStore` (généralisation de la boucle du riser).*

**[SPEC-17.42] Riser (montée de filtre maintenue).** Quatrième geste momentané de la rangée (touche **RISE**, violette quand active) : tant qu'elle est tenue, le filtre global **monte progressivement** du neutre vers un passe-haut aigu (≈ 6 kHz) en **8 beats** — durée calculée d'après le **tempo courant**, donc calée sur la musique. La montée **se maintient au sommet** une fois arrivée, et le relâchement fait **retomber d'un coup** : c'est le geste de tension avant un temps fort.

La rampe est linéaire en `djf`, dont la courbe de coupure est une puissance 4 : le balayage est donc **exponentiel en hertz** (≈ 23 → 375 → 1900 → 6000 Hz), ce qui correspond à la perception. Elle est pilotée image par image côté application plutôt que par une automation Web Audio, car chaque événement sonore réécrit le paramètre du filtre de l'orbit — une automation serait écrasée à la note suivante.

Le riser **prime** sur les passe-bas/passe-haut fixes [SPEC-17.41] tant qu'il est tenu, et sa montée **repart du neutre** à chaque appui. Mêmes sûretés que les autres gestes maintenus. *Impl. : `DJF_RISER_TOP`/`RISER_BEATS`/`StrudelEngine.riserSeconds`, `applyFilterValue` (boucle rAF) dans `rackStore`, mode `riser` de l'intent `filterHold`, touche et couleurs dans `StreamDeckService`, bouton dans `ClockPanel.svelte`.*

**[SPEC-17.41] Filtres maintenus (LP / HP globaux).** Deux gestes momentanés [SPEC-17.40] de transition, sur la dernière rangée du Stream Deck à côté de DROP (libellés **LP** et **HP**, bleus quand tenus) et en miroir dans la GUI : **passe-bas** (≈ 375 Hz — garde kick et basse, coupe l'aigu) et **passe-haut** (≈ 915 Hz — retire les graves) appliqués à **tous les canaux** tant que la touche est enfoncée.

Repose sur le `djf` de superdough, filtre bipolaire **de type DJ** dont le nœud vit **sur l'orbit** (0,5 neutre, en dessous passe-bas, au-dessus passe-haut) : comme il est sur le bus, un changement affecte **les sons déjà en cours**, contrairement à un paramètre lu par événement. La valeur est à la fois **poussée directement** sur les nœuds existants (effet immédiat) et portée par la ref `gdjf` dans la chaîne de voix (ce qui crée le nœud et garde le réglage pour les événements suivants).

Les deux touches peuvent être tenues ensemble : le **passe-bas l'emporte**, et le relâcher retombe sur le passe-haut s'il est encore tenu — aucun geste ne peut rester à moitié appliqué. Mêmes sûretés que [SPEC-17.40] (déconnexion, `pointerleave`/`pointercancel`). *Impl. : `DJF_NEUTRAL`/`DJF_LOWPASS`/`DJF_HIGHPASS` + `StrudelEngine.setGlobalFilter` + ref `gdjf` + `.djf(gdjf())` dans `voiceChain`, `filterHold`/`setFilterHold` (`rackStore`), intent `filterHold`, touches et couleurs dans `StreamDeckService`, boutons dans `ClockPanel.svelte`.*

**[SPEC-17.40] Gestes maintenus (momentanés) et DROP.** Une commande PEUT être **momentanée** : active tant que la touche est enfoncée, relâchée dès qu'on la lâche. Cela suppose de traiter le **relâchement**, jusque-là ignoré (les boutons n'émettaient qu'à l'appui) — le Stream Deck écoute donc `up` en plus de `down`, et l'intent porte l'état (`{ dropHold, on }`).

Premier geste : **DROP** (dernière rangée, 1ʳᵉ touche, libellée et rouge quand tenue) — **coupe tous les canaux sauf le kick** tant qu'on la maintient. Le kick est identifié par **catégorie** et non par numéro de canal, pour que le geste survive à toute réorganisation du rack ; si aucun canal ne porte la catégorie `kick`, le drop est un silence complet (effet utilisable en soi).

**Coupure réellement instantanée** : les paramètres de superdough sont lus **par événement sonore**, donc une simple mise à zéro du gain ne tairait que la note suivante, laissant sonner ce qui est en cours. Le drop agit donc **aussi sur le bus** — rampe de 5 ms (anti-clic) sur la sortie de l'orbit de chaque canal coupé, possible depuis [SPEC-17.37] — tandis que la ref de gain garde les nouveaux événements muets. L'accès au contrôleur audio est **défensif** : s'il devient indisponible, le geste continue de fonctionner par événement.

**Sûretés** : perdre le Stream Deck en plein appui relâche le geste ; dans la GUI, `pointerleave`/`pointercancel` le relâchent aussi, pour qu'il ne puisse jamais rester bloqué. *Impl. : `StrudelEngine.setDropped`/`applyOrbitGain` + `gainFor`, `dropActive`/`setDrop` + `DROP_KEEP_CATEGORY` (`rackStore`), intent `dropHold`, `controlToIntent(col,row,pressed)` + écoute de `up` + libellé/couleurs (`StreamDeckService`), bouton momentané dans `ClockPanel.svelte`.*

**[SPEC-17.39] Texte sur les touches du Stream Deck.** Les touches étant des **écrans**, une fonction globale PEUT y afficher son **libellé** plutôt qu'une simple couleur. Le rendu passe par un **canvas** (fond de la couleur d'état + texte centré) envoyé en pixels **RGBA** via `fillKeyBuffer`, à la taille exacte de la touche (`pixelSize`). La couleur du texte est choisie par **luminance perçue** du fond, pour rester lisible aussi bien sur ambre vif que sur gris sombre. Le libellé fait partie de la **clé de cache** de diff, afin qu'un changement d'état redessine le texte. Repli automatique sur un aplat de couleur si le canvas est indisponible ou si la touche n'a pas d'écran. Appliqué à **M+** ; extensible aux autres touches via `labelFor()`. *Impl. : `labelFor`/`inkFor`/`renderLabelledKey` + `render()` dans `src/core/streamdeck/StreamDeckService.ts`.*

**[SPEC-17.38] Chronomètre de performance.** Le haut de la page affiche, en gros caractères, le **temps écoulé depuis le dernier ▶ Play**. Il **repart de zéro à chaque PLAY** (jamais de reprise) et se **fige à l'arrêt**, pour que la durée du dernier passage reste lisible. Format `m:ss`, puis `h:mm:ss` au-delà de l'heure ; vert en lecture, gris à l'arrêt. Temps **mural** (`performance.now()`) et non horloge audio : il mesure la durée de jeu, pas une position musicale. Placé sur la ligne de transport existante pour ne pas coûter de hauteur [SPEC-17.2], et rafraîchi à 4 Hz par son propre minuteur (aucun coût à l'arrêt). Il **porte aussi la commande PLAY/STOP** [SPEC-17.49]. *Impl. : `transportStartedAt`/`transportFrozenMs` + `timerStart`/`timerFreeze` appelés par `startTransport`/`stopTransport`/`stopAll` (`rackStore`), composant `src/lib/TransportTimer.svelte` monté en tête de `ClockPanel.svelte`.*

**[SPEC-17.37] Un orbit par canal (sidechain ciblé, bus d'effets séparés).** Chaque voix est routée sur l'**orbit correspondant à son canal** (`.orbit(canal+1)`, numérotation identique à celle affichée dans la GUI). Deux conséquences :
- **Sidechain ciblé** : un pattern peut creuser un canal précis avec `.duck(n)` où `n` est le **numéro de canal** — auparavant impossible, toutes les voix partageant l'orbit 1 par défaut, si bien qu'un `duck` baissait **tout le mix** (y compris la piste qui l'émettait).
- **Bus d'effets par canal** : superdough construit les bus **delay** et **reverb** par orbit ; ils étaient donc mutualisés entre les 8 canaux (le dernier `roomsize`/`delaytime` reçu configurait le bus commun). Chaque canal a maintenant les siens, ce qui rend les réglages d'effets réellement indépendants.

Sans danger sur une sortie stéréo : les orbits ne sont routés vers des paires de sorties distinctes que si `multiChannelOrbits` est activé, ce qui n'est pas le cas (défaut `false`).

**Sémantique du duck, à connaître** : `duckdepth(d)` réduit le gain à `1−√d` (0,8 → 0,11, soit −19 dB, quasi une coupure) et `duckattack` est un **temps de remontée en secondes** — s'il dépasse l'intervalle entre deux déclenchements (0,5 s entre kicks à 120 BPM), le gain ne remonte jamais et le canal paraît simplement affaissé au lieu de pomper. Valeurs saines : `duckdepth(.3)`, `duckattack(.15)`. *Impl. : `.orbit(channel+1)` dans `StrudelEngine.voiceChain`, exemple documenté dans `library/kick/Dubbed kick.track.yaml`.*

**[SPEC-17.36] Scènes (Stream Deck, 1ʳᵉ rangée).** Une **scène** est l'**ensemble des slots armés**. Volumes et effets ne sont **pas** capturés : rappeler une scène ne doit jamais arracher un fader des mains — cohérent avec la reprise en main [SPEC-17.30].

Modèle d'interaction, sur la **première rangée** du Stream Deck (les lignes 2-3 restent libres, touches éteintes) :
- **touche 1 = « M+ »** : bascule le **mode mémorisation**. Un nouvel appui sur M+ en sort sans rien écrire.
- **touches 2-5 = 4 emplacements** de scène. Hors mode : l'appui **rappelle**. En mode mémorisation : l'appui **enregistre** l'état armé courant (**écrasement autorisé**) puis **quitte le mode** — de sorte qu'un appui destiné à rappeler ne puisse jamais écraser par mégarde en pleine performance.
- **Retour visuel par touche** : M+ sombre au repos / ambre vif armé ; emplacement vide presque éteint, occupé bleu, **scène rappelée en vert** ; en mode mémorisation, les emplacements passent en ambre (foncé = enregistrer ici, vif = écraser).

Le **rappel** emprunte le chemin normal des bascules de slot, donc la **quantisation propre à chaque canal** [SPEC-17.17] s'applique (un canal quantisé change sur la limite de fenêtre). Le différentiel tient compte des bascules **déjà en attente** pour ne pas émettre de commande en double, et ignore les slots sans piste. La scène active est **invalidée** dès qu'un slot est basculé à la main. Scènes **persistées**. Miroir dans la GUI (rangée `M+ 1 2 3 4` du transport), via les **mêmes intents** [PLAN B]. *Impl. : `ChannelRack.armedSnapshot`/`diffToScene`, `scenes`/`sceneStoreMode`/`activeScene`/`pressScene`/`toggleSceneStoreMode` (`rackStore`, persisté), intents `sceneModeToggle`/`scenePress`, `SceneView` + layout/couleurs dans `StreamDeckService`, `sceneView` dérivé dans `streamdeckStore`, rangée dans `ClockPanel.svelte`.*

**[SPEC-17.35] Moniteur MIDI.** La carte CC d'un contrôleur dépend de son **preset/scène** et n'est pas interrogeable : deviner ce qu'envoie un bouton est un pari. Le panneau MIDI (modale) DOIT donc afficher un **moniteur en direct** des derniers messages reçus — type (CC/NOTE), numéro, valeur, **fonction logique associée** et cible (canal/slot) — y compris pour les messages d'un **appareil non reconnu** (signalés comme tels), avec un compteur total pour voir si quelque chose arrive. Les messages **non mappés** sont mis en évidence. C'est l'outil de référence pour lier un contrôle inconnu ou diagnostiquer un bouton inerte. *Impl. : `src/stores/midiMonitorStore.ts`, `lookupEntry` (`mapping.ts`), enregistrement en tête de `initMidiDispatch` (`rackStore`), affichage dans `MidiPanel.svelte`.*

**[SPEC-17.34] Nudge de phase (alignement sur un mix externe).** En jouant par-dessus un morceau externe, le **tempo** peut concorder alors que la **phase** est décalée (les loops tombent à contretemps). [SPEC-8.2] n'offrait que **Resync**, qui recale brutalement la grille sur l'instant présent. Le nudge décale finement la phase par pas de **¼ de beat** (signé, cumulatif), sur les boutons **MARKER ◄ ►** du nanoKONTROL2 (CC 61/62, de part et d'autre de SET qui fait Resync) et en miroir dans la GUI, avec le décalage courant affiché et annulable d'un clic. Le décalage porte sur **deux choses simultanément** : ce qui est **entendu** — le scheduler Strudel n'expose aucune API de phase, donc chaque voix est décalée par `.late(cycles)`, ce qui impose une ré-évaluation des voix (geste ponctuel, coût acceptable) — et l'**origine de la grille de quantisation**, pour que les limites de lancement restent alignées sur l'audio. Non persisté : le décalage n'a de sens que face au morceau joué à cet instant. *Impl. : `StrudelEngine.setPhaseOffset`/`phaseOffset` + `.late()` dans `voiceChain`, `Launcher.nudgeOrigin`, `phaseOffsetBeats`/`nudgeGrid`/`resetPhaseOffset` (`rackStore`), intent `gridNudge`, `NUDGE_BEATS` + mapping nano CC 61/62 (`mapping.ts`), contrôle dans `ClockPanel.svelte`.*

**[SPEC-17.33] Paramètres d'effet discrets (paliers binaires).** Certains paramètres ne sont musicaux que sur des **puissances de 2**, les valeurs intermédiaires étant hors grille ou physiquement dénuées de sens :
- **cadences rythmiques** — division du trémolo (pulsations par cycle : {1, 2, 4, 8, 16}) et **vitesse du phaser**, désormais elle aussi **calée sur le tempo** (longueur de balayage en cycles : {8, 4, 2, 1, ½, ¼} ; le moteur convertit en Hz via `cps / cycles`, donc l'effet suit le BPM) ;
- **facteurs entiers** — `crush` en bits {16, 8, 4, 2, 1} et `coarse` en décimation {1, 2, 4, 8, 16, 32}.

Restent **continus** : cutoff, résonance, mix, profondeurs, taille de reverb, drive — le balayage progressif y est l'intérêt même (et les cutoffs sont déjà exponentiels, donc progressent par octaves). La **course du knob/fader reste continue** ; c'est la **conversion en unités moteur** qui est quantifiée, afin que la reprise en main [SPEC-17.30] reste praticable et le ghost significatif. La GUI affiche la **valeur effective** à droite de chaque curseur (ex. « 1/2 beat », « 8 bits », « ×4 »), sinon le palier atteint serait invisible. *Impl. : `src/core/channels/fxParams.ts` (`snapTo`, `TREMOLO_DIVS`, `PHASER_CYCLES`, `CRUSH_BITS`, `COARSE_FACTORS`, `fxParamLabel`), utilisé par `StrudelEngine` (dont `fxPhaserRateFor`) et affiché par `ChannelRack.svelte`.*

**[SPEC-17.32] Effets de modulation : phaser et trémolo synchronisé.** Étend la liste [SPEC-17.28] à **8 effets** en ajoutant **PHS** (phaser : `vitesse` = LFO 0,05→4 Hz exponentiel, `profond` = Q des filtres all-pass) et **TRM** (trémolo **calé sur le tempo** : `division` = pulsations par cycle parmi {1,2,3,4,6,8,12,16} — superdough calcule la fréquence du LFO comme `cps × sync`, donc l'effet suit le BPM comme le delay [SPEC-17.24] ; `profond` = profondeur de modulation). Le **flanger n'existe pas** dans Strudel/superdough et n'est pas réalisable par combinaison de paramètres (il exigerait un delay très court modulé en continu, alors que `delaytime` est fixé par événement) ; le phaser en est l'équivalent d'usage. Coût : le phaser reste **en permanence** dans la chaîne car superdough ne le construit que si `phaserdepth > 0` (profondeur 0 = bypass gratuit) ; le trémolo crée un LFO + un gain dès qu'il est fourni, il rejoint donc `FX_HEAVY` (inséré uniquement quand actif). *Impl. : `FX_KINDS`/`FX_HEAVY`/`FX_META`/`neutralFx` (`types.ts`), `fxPhaserRate`/`fxPhaserDepth`/`TREMOLO_DIVS`/`fxTremoloSync`/`fxTremoloDepth` + refs `fxphrate`/`fxphdepth`/`fxtrsync`/`fxtrdepth` + `voiceChain` (`StrudelEngine`).*

**[SPEC-17.31] Modules à état singleton : rechargement complet plutôt que hot-swap.** Plusieurs modules détiennent un état unique pour toute l'application (moteur audio et repl Strudel, rack de canaux, horloge maître, stores réactifs). Si l'un d'eux est **remplacé à chaud** par le HMR de Vite, la nouvelle copie repart de zéro pendant que l'ancienne continue de tourner : la GUI s'abonne aux stores neufs et paraît **figée**, alors que l'audio suit encore l'instance précédente — un faux bug très convaincant (observé : volume audible qui change, curseurs et ghost immobiles). Ces modules DOIVENT donc demander un **rechargement complet de la page** au lieu d'un hot-swap. *Impl. : `fullReloadOnHmr` (`src/core/persist/hmr.ts`, `hot.accept` → `hot.invalidate`), appelé par `StrudelEngine`, `clockStore`, `rackStore`, `physicalStore`. À rappeler pour tout nouveau module détenant un singleton.*

**[SPEC-17.30] Reprise en main (soft takeover / pickup).** Complète [SPEC-17.29] : supprime tout **saut de valeur** quand la position physique d'un fader/knob ne correspond pas au paramètre qu'il pilote. Deux régimes :
- **En main** — le paramètre porte encore la dernière valeur écrite par ce contrôle : pilotage **1:1**, quelle que soit la **vitesse** du geste. La possession est suivie **par valeur** et non par proximité : un balayage rapide envoie des messages très espacés, et comparer cet écart à une tolérance ferait décrocher le contrôle en plein geste.
- **Désynchronisé** — le paramètre a été changé ailleurs (édition GUI, changement d'effet en focus [SPEC-17.28], restauration) : les mouvements sont **ignorés**, le paramètre ne bouge pas, jusqu'à ce que le contrôle soit **amené sur la valeur**. Seul le ghost suit, montrant l'écart à combler. La reprise a lieu dans une **tolérance** (~2,5 pas MIDI) ou dès que le contrôle **franchit** la valeur (geste rapide entre deux messages).

Conséquence assumée : après un changement d'effet (S/R), le knob et le fader restent inertes jusqu'à ce qu'ils rejoignent les valeurs du nouvel effet — souvent situées aux extrémités de la course puisque les valeurs neutres y sont [SPEC-17.23]. Le rebranchement d'un contrôleur réinitialise la possession (sa position a pu changer hors de l'app). S'applique au volume, au filtre et aux deux paramètres d'effet. *Impl. : `shouldTakeOver` (possession par valeur) / `isContinuousIntent` / `resetTakeover` (`src/stores/physicalStore.ts`), `logicalValueFor` + garde dans `initMidiDispatch`, reset sur `midi.onPortsChanged` (`rackStore`).*

**[SPEC-17.29] Repère « ghost » de la position physique des faders/knobs.** Les contrôleurs MIDI ne sont **pas interrogeables** : la position réelle d'un fader/knob reste inconnue tant qu'on ne l'a pas bougé. La valeur logique dérive donc de la position physique (édition via la GUI, changement d'effet en focus [SPEC-17.28], rechargement de page), et la prochaine touche provoque un **saut**. L'app mémorise donc **toute position effectivement observée** — uniquement depuis les messages **MIDI entrants**, jamais depuis une édition GUI — et l'affiche en **repère ambre superposé** au curseur correspondant (volume, p1/knob, p2/fader). L'écart entre le curseur et le repère **est** le saut à venir. Le repère est masqué quand les deux coïncident (rien à signaler) et absent tant que le contrôle n'a jamais bougé dans la session. **Non persisté** volontairement : le matériel a pu être déplacé hors de l'app, une valeur restaurée serait une supposition présentée comme un fait. *Impl. : `src/stores/physicalStore.ts` (`physicalPositions`, `recordPhysicalIntent` appelé dans `initMidiDispatch`), composant `src/lib/GhostSlider.svelte`, usages dans `ChannelRack.svelte`.*

**[SPEC-17.28] Navigation dans les effets sur le nanoKONTROL2.** Étend [SPEC-17.23] pour dépasser la limite de 3 effets par canal imposée par les 3 boutons du strip. Par canal : **S = effet précédent**, **R = effet suivant** (la navigation ne change rien au son, seulement l'effet *en focus*), **M = active/désactive l'effet en focus** ; le **knob** (p1) et le **fader** (p2) éditent ses deux paramètres. La **liste d'effets est extensible** (`FX_KINDS`) et circulaire ; v1 : **LP** (cutoff/résonance), **HP** (cutoff/résonance), **DLY** (feedback/mix, temps calé au tempo [SPEC-17.24]), **REV** (mix/taille), **LOFI** (bits/resampling), **DRV** (drive/shape, avec postgain compensatoire). Les 8 canaux restent pilotables en permanence. **LED** : M reflète l'état de l'effet en focus ; S et R s'allument ensemble comme témoin « ce canal a des effets actifs ». **Coût audio** : les effets dont superdough crée un AudioWorklet **par événement** (`crush`, `coarse`, `distort`, `shape` → LOFI, DRV, listés dans `FX_HEAVY`) ne sont insérés dans la chaîne **que lorsqu'ils sont actifs** (leur on/off ré-évalue les voix du canal, leurs paramètres restent live) ; les autres (filtres, delay, reverb) restent en permanence à valeur neutre, donc 100 % live. Un état persisté antérieur est **complété** avec les effets ajoutés depuis (`coerceEffects`/`coerceFxFocus`). Miroir dans la GUI : `◄ NOM ►` + rangée de pastilles (pleine = actif, cerclée = en focus, cliquable). *Impl. : `FX_KINDS`/`FX_HEAVY`/`stepFx`/`coerceEffects`/`coerceFxFocus` (`types.ts`), refs `fxhcut/fxhq/fxbits/fxcoarse/fxdist/fxshape/fxpost` + `voiceChain()` conditionnelle (`StrudelEngine`), `stepChannelFxFocus`/`toggleFocusedChannelEffect`/`rebuildChannelVoices` (`ChannelRack`), intents `channelFxPrev`/`channelFxNext`/`channelFxToggle`, mapping nano CC 32/48/64 + LED (`mapping.ts`, `syncLeds`), UI `ChannelRack.svelte`.*

**[SPEC-17.27] Import des banques de sons officielles de Strudel.** La bibliothèque locale [SPEC-12] PEUT être peuplée avec les banques que le REPL de strudel.cc streame depuis GitHub, pour disposer hors-ligne du même catalogue : **VCSL** (Versilian Community Sample Library, CC0 — onglet « samples », 128 sons dont 72 instruments mélodiques), **tidal-drum-machines** (71 boîtes à rythmes, dont E-mu SP-12, adressables via `.bank("<Machine>")`) et **mridangam**. Chaque banque est décrite par une **map Strudel curée** (`felixroos/dough-samples`) ; l'import range les fichiers en `<soundsDir>/<banque>/<son>/` de sorte que le **scan existant** reconstruise la même map sans modification du moteur : nom du dossier feuille = nom du son, fichiers renommés par note pour les instruments mappés par hauteur [SPEC-17.18], **préfixe `NN_`** pour préserver l'ordre de la map (le scan trie alphabétiquement) et donc la sélection par `n(i)`. Les fichiers sont **transcodés** (défaut ogg/Opus ; `--format=mp3|wav`) pour ramener VCSL de ≈3,4 Go à quelques centaines de Mo. Une **collision de nom** avec un son déjà présent (ex. `sax` de VCSL vs `sax` de dirt) est résolue par un suffixe `_<banque>` et **signalée**, jamais fusionnée en silence. L'import est **reprenable** (fichiers existants ignorés) et sort en erreur avec la liste des échecs. *Impl. : `scripts/fetch-banks.mjs`, script `samples:banks`.*

**[SPEC-17.26] Toasts pour warn/erreur.** En plus du Journal (conservé tel quel, en bas de page), les notices de niveau **warn** et **error** apparaissent aussi en **toast** transitoire (haut-droite, superposées, auto-disparition ~6 s, bouton fermer) pour être vues sans scroller. Dédupliquées par texte. *Impl. : store `toasts` + `pushToast`/`dismissToast` dans `logStore` (déclenchés par `notify` pour warn/error), composant `Toasts.svelte` monté dans `App.svelte`.*

**[SPEC-17.25] Déverrouillage audio par geste (rappel MIDI).** L'`AudioContext` ne peut être déverrouillé que par un **vrai geste utilisateur** (clic/touche), jamais par un message MIDI (règle du navigateur). Au **premier** démarrage via le PLAY du Korg alors que l'audio est encore verrouillé, l'app affiche un message visible invitant à cliquer une fois ; ensuite le PLAY du Korg fonctionne. Ce clic est désormais demandé **d'emblée** par la modale d'activation [SPEC-17.50], qui est ré-ouverte si le cas se représente. *Impl. : `StrudelEngine.isAudioRunning`, notice + `audioUnlockNeeded` dans `dispatch('transportStart')` (`rackStore`).*

**[SPEC-17.24] Delay synchronisé au tempo.** Le temps du delay des effets par canal [SPEC-17.23] est **calé sur le tempo** (par défaut une croche = 0,125 cycle) via une ref live `fxdtime` qui recalcule les secondes selon le cps courant → l'écho suit les changements de BPM. *Impl. : `FX_DELAY_DIV`, `StrudelEngine.setCps` (mémorise le cps) + `delayTimeSeconds()` + ref `fxdtime`, `.delaytime(fxdtime())` dans la chaîne de voix.*

**[SPEC-17.23] Effets par canal pilotés par le nanoKONTROL2.** Chaque canal a **3 effets** — filtre passe-bas, delay, reverb — chacun **on/off** via les boutons **S / M / R** du strip correspondant. Presser S/M/R bascule l'effet ET le met en **focus** ; le **knob** (p1) et le **fader** (p2) du strip règlent alors les deux paramètres de l'effet en focus (LPF : cutoff/résonance ; delay : feedback/mix ; reverb : mix/taille). Tout est appliqué en **refs live** (aucune ré-évaluation) : le LPF est fusionné avec le filtre bipolaire existant (repli sur le bipolaire quand l'effet LPF est off) ; delay et reverb sont neutres (mix 0) quand off. LED des boutons S/M/R allumées selon l'état on. Reflété et pilotable aussi dans la GUI (3 boutons + 2 curseurs de l'effet en focus par canal). Persisté (`effects`/`fxFocus` dans le snapshot du rack). *Impl. : `FxKind`/`ChannelEffects`/`FX_META`/`defaultEffects` (`types.ts`), refs `fxcut/fxq/fxdmix/fxdfb/fxroom/fxsize` + `setChannelEffects` (`StrudelEngine`), `toggleChannelEffect`/`setChannelFxParam` (`ChannelRack`), intents `channelEffectToggle`/`channelFxKnob`/`channelFxFader`, mapping nano + LED (`mapping.ts`, `syncLeds`), UI dans `ChannelRack.svelte`.*

**[SPEC-17.22] Compensation du look-ahead pour la quantisation.** Le scheduler audio programme les événements d'une limite de fenêtre ~look-ahead secondes à l'avance ; appliquer un toggle quantisé exactement sur la limite le rate (les événements de ce beat sont déjà figés), d'où un démarrage/arrêt décalé d'≈ un beat. Le Launcher applique donc le toggle **légèrement avant** la limite (de `LOOKAHEAD_SECONDS × bpm/60` beats) pour que les événements de la limite soient (re)programmés avec le stack à jour → départ/arrêt **pile sur la limite**. Constante `LOOKAHEAD_SECONDS` ajustable. *Impl. : `Launcher.tick` (`beat < target − lookaheadBeats()`), `lookaheadBeats()` (`src/core/launch/Launcher.ts`).*

**[SPEC-17.21] Rôles fixes des contrôleurs : APC = sons, nano = effets.** Les deux contrôleurs étant désormais toujours branchés, le choix « slots par canal (nano 3 / APC 8) » est retiré de la modale. Les sons sont pilotés par l'**Akai APC mini mk2** avec **8 slots par canal** (valeur fixe, coercition d'un rack persisté à 3 slots au chargement). Le **nanoKONTROL2** est réservé au pilotage des **effets** (mapping à définir). *Impl. : `DEFAULT_SLOTS_PER_CHANNEL = 8` (`types.ts`), coercition `rack.setSlotsPerChannel(8)` au démarrage (`rackStore`), suppression du sélecteur dans `SettingsModal.svelte`.*

**[SPEC-17.20] Switch « Force tonalité ».** Un bouton bascule (transport, à côté du sélecteur de tonalité) **active/désactive** la transposition [SPEC-17.19]. Désactivé (défaut) : les pistes jouent dans leur tonalité d'écriture ; activé : les pistes tonales (champ `key`) sont forcées vers la tonalité sélectionnée. Réglage **persisté** ; changer l'état ré-évalue les voix en cours. *Impl. : `forceKey`/`setForceKey` (`rackStore`, persisté), `StrudelEngine.setForceKey`/`forceKey` (gate dans `ChannelRack.wrapForKey`), bouton 🔒/🔓 dans `ClockPanel.svelte`.*

**[SPEC-17.19] Transposition des loops selon la tonalité sélectionnée.** Une piste dont la `TrackDefinition` déclare un champ **`key`** (code Camelot de référence, ex. `1A`) est **transposée en direct** vers la tonalité choisie [SPEC-17.14] ; les pistes sans `key` (batterie) ne sont jamais transposées. Le décalage (en demi-tons, −5..+6) est calculé sur la **tonique mineure** de chaque tonalité (une tonalité majeure = sa relative mineure), de sorte que le résultat reste **compatible harmoniquement** au sens du Camelot wheel. Le décalage est **figé** dans le code de la voix (`.add(note(N))`) et les voix mélodiques sont **ré-évaluées** au changement de tonalité (les refs live de Strudel n'additionnent pas sur les notes). *Impl. : `TrackDefinition.key` + `LoadedTrack.key` (`types.ts`, `Library.ts`), `minorPcOf`/`transposeSemitones` (`camelot.ts`), `StrudelEngine.setSelectedKey`/`selectedKey`, `ChannelRack.wrapForKey`/`voiceCode` (enrobe `.add(note(N))`), `musicalKey.subscribe → engine.setSelectedKey + rack.rebuildActiveVoices` (`rackStore`). La piste piano déclare `key: '1A'`.*

**[SPEC-17.18] Instruments mélodiques (samples mappés par note) + pack de piano.** Un dossier de la bibliothèque de sons dont **tous les fichiers sont nommés par note** (ex. `A1.mp3`, `Gs6.mp3`) est exposé comme **instrument mappé par hauteur** (`{ "g3": [...], "f#4": [...] }`) au lieu d'une simple liste indexée, pour que `note()`/accords rejouent depuis le sample de la note (ou le plus proche). Un script `npm run samples:piano` télécharge un piano acoustique échantillonné (tonejs-instruments, MIT, chromatique octaves 1→7) dans `~/Music/Sounds/piano`, utilisable via `.s("piano")`. *Impl. : `noteKey`/détection dans `vite-plugins/soundsServer.ts` (⚠ changement de plugin Vite → redémarrer `npm run dev`), `scripts/fetch-piano.mjs`, script `samples:piano`.*

**[SPEC-17.17] Quantisation par canal.** La quantisation du lancement n'est plus globale : **chaque canal** a son propre mode (immédiat / quantisé), la **fenêtre W restant globale** [SPEC-8]. Toggle par canal via : le bouton ⚡/⏱ de la tête de canal dans la GUI, et le **bouton du bas de la colonne correspondante sur l'APC mini mk2** (le « 9ᵉ bouton » sous les 8 pads du canal, notes 100-107), avec **LED allumée** quand le canal est quantisé. Un bouton global (GUI / CYCLE du nano / touche mode du Stream Deck) bascule **tous** les canaux d'un coup et affiche `Immédiat` / `Mixte` / `Quantisé`. La valeur par canal est **persistée** (snapshot du rack) ; l'ancien mode global persisté est migré vers tous les canaux. *Impl. : `ChannelState.quantized` + méthodes rack (`toggleChannelQuantized`, `setAllQuantized`, `allQuantized`), `Launcher.requestSlotToggle` lit `rack.isChannelQuantized`, intent `channelModeToggle`, mapping APC (notes 100-107) + LED dans `syncLeds`, bouton par canal dans `ChannelRack.svelte`, bouton global dans `ClockPanel.svelte`.*

**[SPEC-17.16] Distinction démarrage/arrêt en attente (quantisé).** Quand un toggle quantisé est en attente [SPEC-8.4], le retour visuel DOIT indiquer s'il va **démarrer** ou **arrêter** le slot (déduit de l'état courant : en lecture → arrêt à venir, à l'arrêt → démarrage à venir). Rendu identique GUI et contrôleur RGB : **vert clignotant** = démarrage imminent, **rouge clignotant** = arrêt imminent. Sur LED monochrome, indistinct (allumé). *Impl. : états `pendingStart`/`pendingStop` (`slotVisual`), couleurs APC dans `buildApcMiniMk2`, classes `.slot.pending-start`/`.slot.pending-stop` dans `ChannelRack.svelte`.*

**[SPEC-17.15] LED multicolores par état de slot (APC mini mk2).** Sur un contrôleur à pads RGB, chaque bouton de slot DOIT refléter son **état visuel** par une **couleur distincte** : vide (éteint), assigné-inactif (gris faible), en lecture (vert), en attente/quantisé (ambre clignotant). Sur un contrôleur monochrome (nanoKONTROL2), les états se réduisent à allumé/éteint. Le modèle LED est déclaratif par contrôleur (couleur = vélocité de palette + canal de note pour luminosité/clignotement), aucun changement moteur. La grille 8×8 de l'APC est indexée du **bas vers le haut** matériellement ; le mapping **inverse** (`slot = 7 − row`) pour que la rangée du **haut** soit le slot 0, cohérent avec la GUI. *Impl. : `LedSpec.color`/`statusChannel`, `slotVisual`, `ledStatus(type, channel)` dans `src/core/mapping/mapping.ts` ; `syncLeds` dans `rackStore` ; mapping APC `buildApcMiniMk2`.*

**[SPEC-17.14] Sélecteur de tonalité (Camelot).** Le panneau transport DOIT offrir un **indicateur/sélecteur de tonalité** des loops, exprimé en **notation Camelot** (1A–12A mineur, 1B–12B majeur) ET en **note** (ex. « 8A · A mineur »), pour faciliter le mix harmonique avec un set externe dont la tonalité est connue. La valeur est **conservée** (persistance). Table de correspondance Camelot ↔ note ↔ pitch class fournie pour un usage ultérieur (ex. transposition des loops). *Impl. : `src/core/music/camelot.ts`, `musicalKey`/`setMusicalKey` dans `rackStore` (persisté avec les settings), sélecteur dans `ClockPanel.svelte`.*

**[SPEC-17.13] Fenêtre de quantisation de 128 beats.** Étend l'ensemble des tailles de fenêtre [SPEC-7.6] à **{4, 8, 16, 32, 64, 128}** beats, pour quantiser sur des phrases longues (32 mesures). *Impl. : `WINDOWS` dans `src/core/launch/Launcher.ts`.*

**[SPEC-17.12] Repères de structure métrique dans l'affichage de position.** Dans le lecteur de position (un point par beat de la fenêtre), l'anneau des **débuts de mesure** (downbeats) DOIT être **coloré selon la plus grande puissance de 2 qui divise l'index du beat** — c.-à-d. la puissance de 2 sur laquelle la mesure démarre. Cela révèle la hiérarchie de phrase (mesure → 2 mesures → 4 → 8 → 16) d'un coup d'œil. Code couleur croissant (froid → chaud, anneau plus épais) : 4 beats, 8, 16, 32, 64 ; l'origine de la fenêtre (beat 0) a l'anneau le plus fort. Une **légende** rappelle la correspondance couleur ↔ puissance de 2. *Impl. : `ClockPanel.svelte` (`metricLevel`, `data-lvl`, légende).*

---

### Basse d'accord et transposition

**[SPEC-17.48.1]** La couche de basse d'un accord s'écrit `chord(…).rootNotes(n)` **sans** `.note()`.
`rootNotes` pose déjà le contrôle `note` ; l'envelopper une seconde fois emboîte les valeurs dans un
objet `{note}` de plus, après quoi `.add(note(n))` — c'est-à-dire la transposition de tonalité, à la
fois celle de l'instrument (`core/channels/ChannelRack.ts`) et celle de l'atelier — ne rend **plus
rien du tout** et entraîne tout le `stack` avec elle. Les deux pistes d'accords de la bibliothèque
étaient donc muettes dès que la tonalité de contexte différait de leur référence, l'inverse exact de
ce qu'annonce `[SPEC-17.48]`. Mesuré : 16 attaques telles quelles, 0 après `.add(note(2))`.

### Sons General MIDI & noms inconnus

**[SPEC-17.55]** Les instruments **General MIDI** (`gm_*`, 125 instruments) du REPL sont
disponibles. Leurs presets sont **copiés sur le disque** (`npm run samples:soundfonts`, ~140 Mo,
une seule fois) et lus depuis la bibliothèque locale — jamais depuis un CDN. `@strudel/soundfonts`
diffuse par défaut depuis `felixroos.github.io` ; un cache navigateur ne remplace pas une
installation locale, il ne contient que ce qui a déjà été joué et seulement tant que le navigateur
le veut `[SPEC-14.4]`. Les fichiers sont stockés **tels quels** : l'index de `n()` désigne donc la
même variante d'instrument qu'ici et sur strudel.cc. Trois entrées de la liste de
`@strudel/soundfonts` sont mal orthographiées à la source (`…_sf2_fible`, `…_sf2_fil e`, chaîne
vide) : elles sont signalées par le script et laissées en place, car retirer un indice ferait
diverger `n()` du REPL.

**[SPEC-17.55.1]** La présence des presets est **vérifiée avant** d'enregistrer les instruments.
Enregistrer 125 sons dont les données manquent produirait 125 noms visibles dans le navigateur de
sons et muets au déclenchement — précisément le piège à supprimer. Absents, ils ne sont pas
enregistrés et la commande à lancer est affichée `[SPEC-14.3]`.

**[SPEC-17.55.2]** Le serveur de sons répond **404** pour un fichier absent sous `/sounds/`. Le
repli HTML de Vite répondait `200` avec `index.html`, que superdough tentait de décoder comme de
l'audio et `@strudel/soundfonts` comme un preset : échec obscur au lieu d'un « introuvable », et
sonde de présence trompée.

**[SPEC-17.56]** Un **nom de son inconnu** est signalé, jamais joué en silence. superdough répond
à un nom non enregistré par du silence, indiscernable d'un pattern qui ne joue rien — le piano roll
se remplit de notes et rien ne sort. Les noms employés par le pattern sont donc comparés au
registre à chaque analyse, dans l'atelier, et nommés sous le champ ; un rappel est émis au moment
du PLAY, là où le silence surprend. Un `bank()` composant le nom au déclenchement, ces événements
sont laissés de côté plutôt qu'accusés à tort. La vérification n'a lieu qu'une fois les banques
enregistrées, sans quoi tout nom d'échantillon paraîtrait inconnu.

**[SPEC-17.56.1] La comparaison au registre passe par la normalisation de superdough.** Corrige [SPEC-17.56]. `BossDR110_cr` — choisi dans le navigateur de sons, joué sans faute — était annoncé **inconnu**. Mesuré dans `superdough/dist/index.mjs` : `registerSound` enregistre sous `nom.toLowerCase().replace(/\s+/g, '_')` et `getSound` relit sous `nom.toLowerCase()`. Un nom qui ne diffère que par la **casse** joue donc parfaitement, alors qu'une comparaison de chaînes brutes le déclare absent : les 71 boîtes à rythmes de tidal-drum-machines, toutes en casse mixte (`RolandTR909_bd`, `AkaiMPC60_cr`…), étaient signalées à tort. Toute comparaison avec le registre DOIT passer par la même normalisation, **des deux côtés**. Une fausse alerte dans un canal d'erreur est plus grave qu'une absence d'alerte : elle apprend à ignorer le canal. *Impl. : `normalizeSoundName` dans `core/engine/sampleBanks.ts`, `unknownSoundNames` dans `composerStore`.*

**[SPEC-17.57]** L'atelier capture le **journal de Strudel** (`initLogCapture`) comme l'instrument :
ses avertissements n'arrivaient que dans la console de la page.

---

---

### Lancement par canal : un troisième état

**[SPEC-17.60] Trois modes de lancement sur le bouton du canal.** Étend [SPEC-17.17]. Le bouton de chaque canal (⚡/⏱ dans la GUI, rangée du bas de l'APC) cycle sur **trois** états au lieu de deux :

| état | LED APC | comportement |
|---|---|---|
| **immédiat** | éteinte | la loop démarre sous le doigt |
| **quantisé** | allumée | la loop est mise en attente de la prochaine fenêtre [SPEC-8] |
| **fondu** | **clignotante** | la loop démarre **tout de suite** et **monte progressivement sur la durée d'une fenêtre** |

Le troisième état est un état **du même bouton** parce que les boutons hors grille de l'APC sont des LED monochromes à trois valeurs — éteint / allumé / clignotant [SPEC-20.5] : la correspondance est exacte, et l'écran reprend le clignotement pour dire la même chose.

**Le fondu appartient à la voix, pas au canal.** Le gain de canal est partagé par toutes les loops de la colonne : y appliquer la rampe ferait plonger ce qui joue déjà quand on arme une deuxième loop. La voix armée reçoit donc **son propre `ref` de gain** (`fadeg("set:canal:slot")`), qui **multiplie** le gain de canal comme celui-ci multiplie ce que la piste déclare [SPEC-17.53]. Le facteur n'est inséré dans la chaîne que **lorsqu'un fondu est voulu** : une voix ordinaire ne porte rien de plus.

**La rampe est pilotée image par image par l'application**, jamais par une automation Web Audio, pour la même raison que le balayage de filtre [SPEC-17.43] : chaque événement réécrit son gain depuis le `ref`, donc une automation serait écrasée à la note suivante. Chaque nouvelle frappe est ainsi plus forte que la précédente et les notes déjà en cours gardent la leur — c'est précisément ce qu'est un fondu d'entrée sur de la percussion. La durée est **fixée au lancement** (fenêtre courante × tempo courant) : un changement de tempo en cours de fondu ne l'étire pas, puisque ce qui a été entendu commençait avec cette durée-là.

**Choix assumés**, à retourner d'un mot :
- le fondu **ne quantise pas** le départ. La loop part au doigt et le fondu masque le décalage ; attendre la frontière *puis* fondre sur une fenêtre repousserait le plein volume à 2 × W (32 temps à W = 16).
- l'**arrêt** reste net. Seule l'activation est un fondu, comme demandé ; un fondu de sortie serait un quatrième comportement, pas un état de plus.
- le bouton **global** (nano CYCLE / GUI) fait avancer **tous** les canaux dans le même cycle ; des canaux disparates sont d'abord **nivelés** sur « immédiat », pour que l'appui ait un résultat prévisible.

**Migration** : l'état persisté portait un booléen `quantized` par canal, et les scènes [SPEC-17.52] un tableau de booléens. Les deux sont **relus** et traduits (`true` → quantisé), jamais réinitialisés — un rack sauvegardé ne doit pas revenir tout en immédiat.

**[SPEC-17.60.2] Le fondu vaut dans les deux sens, et seulement en cours de jeu.** Complète [SPEC-17.60].

- **Fondu de sortie** : couper une loop sur un canal en mode fondu la fait **descendre sur une fenêtre** au lieu de s'arrêter net. Elle reste **audible et armée** pendant la descente, et son pad **clignote en rouge** — le code visuel existant de « va s'arrêter » [SPEC-17.16] dit exactement cela. La voix n'est réellement supprimée qu'au bout de la rampe.
- **Un appui pendant la descente l'annule** et fait remonter le niveau depuis là où il était tombé — même règle qu'un second appui sur une bascule quantisée en attente [SPEC-8.4] : le geste s'annule, il ne s'empile pas. La durée de la remontée est **proportionnelle à la distance restante**, pour qu'annuler une descente à peine commencée ne prenne pas une fenêtre entière.
- La voix est **réévaluée avec son facteur de fondu** au début de la descente : elle a pu être armée alors que le canal était dans un autre mode, et sa chaîne ne porterait alors aucun facteur sur lequel mordre. Réévaluer ne redémarre pas le motif — Strudel l'aligne sur la grille de cycles globale.
- **L'état n'est basculé qu'après** la décision de fondre : inverser `playing` d'abord aurait émis une frame de « arrêté » — pad éteint et faux cue `slot` vers la sortie scénique [SPEC-20.13] — avant de le remettre.
- **Uniquement transport en lecture.** À l'arrêt, rien n'est entendu : une rampe s'écoulerait en temps réel contre du silence et serait terminée avant le PLAY. Armer et couper y sont donc nets, et le mode fondu ne s'exprime qu'en jeu — c'est ce qui était voulu.
- **Une réassignation coupe net** : le son qui fondrait est celui qu'on remplace.

**[SPEC-17.60.1] Aucun littéral chaîne dans le code généré.** Le fondu ne faisait rien du tout : la voix était adressée par sa clé `"set:canal:slot"`, or **le transpileur de Strudel réécrit tout littéral chaîne en mini-notation**. Mesuré :

```
IN  : …mul(gain(fadeg("set-1:0:0")))
OUT : …mul(gain(fadeg(m('set-1:0:0', 57))))
```

La fonction recevait donc un **Pattern** et non la clé ; la recherche échouait, le facteur restait à 1, et la loop démarrait à plein volume — sans la moindre erreur, puisque `set-1:0:0` est de la mini-notation valide. Règle générale : **tout argument passé à une fonction du scope d'évaluation DOIT être numérique**. Le fondu s'adresse donc par un **entier** attribué à la voix (`fadeg(7)`).

Vérifié en Node, sans navigateur : le transpileur réécrit bien la chaîne et laisse l'entier intact ; deux `.mul(gain(…))` **se composent** (0,5 × 0,25 = 0,125) et le `ref` est **relu à chaque requête** — le mécanisme était bon, seule l'adresse était perdue.

*Impl. : `ChannelLaunch`/`LAUNCH_META`/`stepChannelLaunch`/`coerceChannelLaunch` dans `core/channels/types.ts`, `channelLaunch`/`stepChannelLaunch`/`setAllLaunch`/`commonLaunch`/`launchSnapshot`/`launchDiff`/`onFadeStart` dans `ChannelRack`, `fadeg` + `setVoiceFade`/`clearVoiceFade` + argument `fade` de `setVoice` dans `StrudelEngine`, `startVoiceFade` dans `rackStore`, garde `!== 'quantized'` dans `Launcher`, bouton à trois états dans `ChannelRack.svelte` et indicateur global dans `ClockPanel.svelte`.*

### Veille du système & lampes du transport

**[SPEC-17.58] Pas de veille pendant la lecture.** Un set dure plus longtemps que le délai de veille par défaut, et l'écran qui s'éteint en pleine lecture emporte le seul retour visuel disponible : pads, chronomètre [SPEC-17.38], position dans la fenêtre. Le verrou **Screen Wake Lock** est donc demandé au **PLAY** et rendu au **STOP** — jamais en permanence, la machine n'ayant aucune raison de rester éveillée transport arrêté. Ses limites sont **structurelles et doivent être dites** plutôt que promises : le navigateur **relâche le verrou dès que la page n'est plus visible** (autre onglet, fenêtre minimisée), il ne couvre **ni** la fermeture du capot, **ni** une mise en veille explicite, et il exige un contexte sécurisé (`localhost` en est un). Le retour au premier plan **redemande** le verrou, l'événement `release` du navigateur étant écouté pour que l'indicateur ne mente jamais. Un échec est signalé **une fois** — sur scène, un toast par tentative serait pire que le problème — avec la parade (désactiver la veille dans les réglages système). L'état est affiché **seulement lorsqu'il est vrai** (« veille bloquée » dans la barre de transport) : l'enjeu est de savoir que l'écran restera allumé, pas de le promettre. *Impl. : `src/core/system/wakeLock.ts`, `wakeLockHeld` + abonnement à `transportRunning` dans `rackStore`, indicateur dans `ClockPanel.svelte`.*

**[SPEC-17.59] Les lampes du transport suivent le mode.** Les boutons **PLAY (CC 41)**, **STOP (CC 42)** et **REC (CC 45)** du nanoKONTROL2 s'allument selon l'état : PLAY en lecture, STOP à l'arrêt, REC pendant l'enregistrement du journal de gestes [SPEC-11]. La surface dit donc dans quel mode elle est, au lieu de laisser cette information à l'écran seul. **REC est également mappé** en entrée (bascule du journal) : une lampe allumée sur un bouton inerte est un piège sur scène, et [PLAN B] veut de toute façon que GUI et MIDI produisent le même Intent. Un rejeu en cours **refuse** l'enregistrement plutôt que de capter sa propre ré-émission. ⚠ Les LED du nano ne répondent que si son préréglage est en **LED Mode : External** (Korg Kontrol Editor) ; sinon elles restent pilotées par l'appareil et rien de ce qui est envoyé n'a d'effet. *Impl. : `transportRecord` dans `core/mapping/mapping.ts`, intent `sessionRecordToggle`, boucle des lampes + `toggleSessionRecording` dans `rackStore`.*

## [SPEC-18] Atelier de composition (Composer)

> Spécification **prospective** : rien n'est implémenté à ce jour. Décrit une seconde page de l'application, orientée **fabrication et vérification** de boucles, dont le produit est un fichier de piste [SPEC-4.6] directement consommable par l'instrument.

### Objet & frontière

**[SPEC-18.1]** L'atelier sert à **fabriquer et vérifier** une boucle au calme ; l'instrument [SPEC-1.1] sert à la **jouer**. Les deux ne se recouvrent pas : l'atelier n'a ni canaux, ni contrôleurs de scène, ni quantisation, ni transport de performance ; l'instrument n'acquiert aucun outil d'édition assistée. Le **fichier YAML** de bibliothèque est leur unique point de rendez-vous, dans les deux sens : l'atelier écrit une piste [SPEC-18.15], l'instrument la charge [SPEC-4.4] et peut lui renvoyer un code live-codé [SPEC-15].

**[SPEC-18.2]** Objectif d'ergonomie : être **plus facile à prendre en main que le REPL de Strudel**, pour un utilisateur qui code mais ne maîtrise pas le solfège. Trois difficultés sont visées nommément — la page blanche [SPEC-18.11], la densité de la mini-notation [SPEC-18.13], et l'absence de retour visuel entre ce qu'on écrit et ce qu'on entend [SPEC-18.8].

### Hébergement & isolation

**[SPEC-18.3] Second document, pas une route.** L'atelier DOIT être un **point d'entrée HTML distinct** (`composer.html`) servi par le même projet Vite, et NON une vue supplémentaire de l'application de jeu. Motifs, par ordre d'importance :
- **le moteur audio est un singleton** — `StrudelEngine` possède l'`AudioContext`, les orbites, le hub d'insert master et les `ref` live [SPEC-17.37] ; partager le document ferait passer les auditions de l'atelier par les orbites, les effets de canal et les gestes tenus éventuellement armés, alors que la composition exige un signal **propre et sec**. Deux documents ⇒ deux `AudioContext` ⇒ isolation obtenue sans code ;
- **sécurité de scène** — un clic ne DOIT pas pouvoir faire basculer l'instrument en mode composition pendant un set ; une URL distincte impose de quitter délibérément la page de jeu ;
- **mise en page** — l'instrument doit tenir sans défilement [SPEC-17.2], l'atelier réclame de la place ; deux documents, deux feuilles de style, aucun enchevêtrement.

**[SPEC-18.4] Cloisonnement des imports.** L'atelier DOIT n'importer que depuis `src/core/` ; les imports depuis `@stores/` et `@lib/` sont **interdits**. `rackStore` exécute du travail au niveau module (restauration du rack depuis `localStorage`, abonnements, `setSlotsPerChannel`) : un simple `import` démarrerait l'instrument en effet de bord **et réécrirait la session de l'utilisateur** [SPEC-17.51]. La règle est volontairement mécanique donc vérifiable.

**[SPEC-18.5] Réutilisation sans refonte.** L'atelier réutilise `StrudelEngine`, `camelot.ts`, les types de bibliothèque et `track.schema.json` **tels quels**. Aucune refonte préalable de `StrudelEngine` n'est requise : le mécanisme dont dépend la vue dérivée [SPEC-18.6] est celui de `measureLengthBeats()`, qui crée déjà un repl jetable **indépendant du graphe audio de jeu**. Ce fichier concentre trop de connaissances acquises sur superdough pour être refactorisé par confort.

### Principe directeur : le code reste la source de vérité

**[SPEC-18.6] Vues dérivées, jamais autoritaires.** Le **texte du pattern** est la source de vérité. Tout ce que l'atelier affiche d'une boucle DOIT être **dérivé** de ce texte par **interrogation du pattern** (`queryArc`), jamais reconstruit à partir d'un modèle parallèle. Conséquence recherchée : une piste éditée à la main — dans l'atelier, dans un éditeur de texte, ou en live dans l'instrument [SPEC-9.2] — reste lisible par l'atelier sans qu'aucun parseur de code Strudel ne soit nécessaire, et aucune structure ne peut diverger silencieusement du code.

**[SPEC-18.7] Assistants générateurs à sens unique.** Les aides à l'écriture [SPEC-18.9] **produisent un fragment de code inséré dans le texte**, puis s'en désintéressent. Elles ne possèdent pas ce qu'elles ont écrit et ne cherchent pas à le relire. Cette règle, jointe à [SPEC-18.6], supprime par construction le problème de l'aller-retour.

**[SPEC-18.8] Vue par interrogation (« piano roll »).** L'atelier DOIT afficher les **événements produits** par le pattern sur N cycles : hauteur ou nom de son en ordonnée, temps en abscisse. C'est la fonctionnalité **centrale** — celle qui permet de comparer d'un coup d'œil ce qu'on a écrit à une référence externe (capture d'écran d'un tutoriel, par exemple), et de constater ce que produisent réellement les fonctions opaques comme `voicing()`. Deux corollaires en découlent gratuitement :
- la **période de répétition** devient visible (la répétition se voit) et est **affichée**, mais elle ne DOIT **pas** écraser le champ `beats` : `measureLengthBeats` renvoie la **plus petite** période, alors que `beats` déclare la **longueur de phrase** voulue par l'auteur — `s("bd*4")` se répète toutes les 1 beat et se déclare pourtant sur 4. L'atelier montre les deux et propose d'adopter la valeur mesurée en un clic. La vue s'étend sur **exactement un tour** de la phrase déclarée [SPEC-18.26], et signale les répétitions internes plus courtes qu'elle : c'est précisément l'écart qui surprend quand un pattern « joue trop vite » ;
- rappel à rendre visible dans l'interface : `beats` est une **métadonnée** [SPEC-4.2] et **ne modifie pas la vitesse de lecture** — la durée d'une boucle est définie par son code (1 cycle = 4 beats) ;
- la vue DOIT rester exacte pour les patterns non déterministes, en signalant l'absence de période plutôt qu'en inventant une longueur [SPEC-17.11].

### Structure & assistants

**[SPEC-18.9] Les couches, seule structure possédée.** L'atelier PEUT modéliser une boucle comme une **liste de couches**, chacune étant du **texte libre**, le `stack(...)` étant produit à l'export. C'est la **seule** notion structurelle que l'atelier s'autorise à posséder, parce qu'elle est mécanique et réversible : relire un `stack(` de premier niveau relève de l'appariement de parenthèses, pas d'un parseur JavaScript. Elle apporte :
- le **solo / mute par couche** — auditionner la basse seule, équivalent du solo sur une tranche de console, et principal outil d'apprentissage ;
- une vue par interrogation **par couche**, superposable.
Une piste dont le `pattern` n'est pas un `stack()` de premier niveau est traitée comme une couche unique.

**[SPEC-18.10] Assistants d'écriture.** Chacun est un générateur au sens de [SPEC-18.7] :
- **Progressions par degrés** — saisir une tonalité et des **degrés** (« 6-1-3-7 en si mineur ») produit les symboles d'accords, le fragment `chord("<...>")` et remplit le champ `key` en notation Camelot [SPEC-17.14]. Cible le flux réel : une consigne lue dans un tutoriel vidéo, sans passer par le solfège.
- **Grille de batterie** — grille de pas ↔ mini-notation. C'est le **seul** endroit où un éditeur véritablement bidirectionnel est admis : le sous-ensemble de syntaxe concerné (`~`, `*`, `[]`, `!`) est assez étroit pour être relu sans risque. Hors de ce sous-ensemble, la grille passe en lecture seule plutôt que de réécrire ce qu'elle ne comprend pas.
- **Roue euclidienne** — représentation circulaire de `s("bd(3,8)")`, notation puissante et illisible sans support visuel.
- **Navigateur de sons** — parcourt la **même banque** que l'instrument (`/sounds/strudel.json`, [SPEC-12]), permet d'**auditionner** un échantillon et d'insérer son nom.

**[SPEC-18.29] Variantes d'un son : dépliables et marquables une par une.** Un son indexé est un **dossier** : `hh` en compte treize chez l'utilisateur, dont un crash, deux kicks et un ride — `n("4")` n'y désigne donc pas « un charleston » mais un fichier précis. Le navigateur [SPEC-18.10] DOIT permettre de déplier ces variantes, d'écouter chacune, de l'insérer et de la **marquer individuellement** [SPEC-18.20].

- **Identité** : une variante s'écrit `hh:4`, la syntaxe Strudel elle-même. Un favori porte donc le texte qu'il produira, aucun encodage propre à maintenir, et un fichier de favoris antérieur (noms nus) reste valide sans migration.
- **Pas de dépliage pour les instruments mappés par note** [SPEC-17.18] : on les adresse par hauteur, pas par index — un piano n'a pas quatre-vingt-huit « variantes » à parcourir.
- **Rendu** : une cellule dépliée occupe **toute la largeur**. Dans une seule colonne, les variantes se replieraient en bloc illisible et laisseraient la rangée en dents de scie — le défaut déjà corrigé pour les sons eux-mêmes. Les variantes sont **indentées, sur un fond propre et séparées par un filet**, pour se lire comme des enfants du son et non comme ses voisins.
- **Le pliage n'appartient qu'au bouton de pliage.** Une variante marquée dépliait d'abord son son d'office, pour qu'un favori ne puisse jamais être annoncé sans être visible — mais cela **confisquait le pliage** dès qu'on marquait une variante. C'est un **indicateur** sur la ligne repliée qui porte l'information : `★ n` compte les variantes en favori, son infobulle les nomme, et le chevron de pliage passe en doré. Même information, contrôle rendu à l'utilisateur.
- Le filtre « favoris seuls » reconnaît les variantes : marquer `hh:4` puis filtrer ne doit pas faire disparaître `hh`.

⚠ Piège mesuré, à ne pas réintroduire : les cellules ne DOIVENT pas porter `overflow: hidden`. Un élément de grille dont `overflow` n'est pas `visible` reçoit une **taille minimale automatique nulle** ; la grille ayant une hauteur plafonnée (`max-height` + défilement), le navigateur a dimensionné ses 120 pistes sur ce zéro — chaque cellule s'est réduite à ses 2 px de bordure et `overflow: hidden` a découpé le contenu, ne laissant qu'une tranche horizontale des glyphes. La propriété qui masquait était aussi celle qui provoquait l'effondrement. Les angles arrondis sont obtenus en arrondissant les **enfants de bord**, pas en rognant la cellule.

*Impl. : `soundKey`/`soundNameOf`/`keyBelongsTo`/`soundSnippet(entry, index)`/`soundInsertName` dans `core/composer/sounds.ts`, `previewSound(entry, bpm, index)` dans `core/composer/preview.ts`, dépliage et rangée de variantes dans `SoundBrowser.svelte`.*

**[SPEC-18.28] Le travail en cours survit à un rechargement.** Enregistrer une piste écrit dans `library/`, le watcher du serveur de développement le voit, et la page **se recharge** — l'index de bibliothèque est un singleton dont le rack de l'instrument garde une référence, donc un échange à chaud ferait tourner deux copies [SPEC-17.31]. Correct côté instrument, destructeur côté atelier : il perdait ce qui était en train d'être écrit, au moment précis d'un enregistrement réussi.

Plutôt qu'affaiblir ce garde-fou, l'espace de travail est **restauré** : brouillon complet (`vars` comprises), catégorie, nom de fichier, BPM, tonalité de contexte, transposition, piste d'origine et mode manuel de la longueur de phrase [SPEC-18.21]. La restauration a lieu **avant** l'initialisation du panneau YAML, qui s'ouvre donc sur le texte restauré. Une entrée corrompue ou partielle est **ignorée, jamais réparée** : repartir d'un état vierge vaut mieux que d'un état à moitié compris. Un échec d'écriture est signalé [SPEC-14.3] — perdre un brouillon en silence est exactement ce qu'on cherche à éviter.

Bénéfice au-delà du symptôme : un F5 involontaire et un plantage coûtaient autant, et n'étaient pas davantage protégés. *Impl. : `Workspace`/`restoreWorkspace`/`saveWorkspace` sous la clé `composer:workspace` dans `composerStore`.*

**[SPEC-18.27] Curseur de lecture et surlignage des sons joués.** Réalise le playhead « façon Strudel » évoqué en [SPEC-15]. Pendant la lecture, l'atelier DOIT montrer **où en est la boucle** et **ce qui sonne**, dans le piano roll et dans le code :
- **Curseur** : trait vertical à la position de lecture, **bouclant sur la phrase déclarée** — soit toute la largeur dessinée, puisque la vue couvre un seul tour [SPEC-18.26]. Position obtenue par modulo de la phrase, comme la jauge de slot de l'instrument [SPEC-17.10] — les patterns Strudel étant alignés sur la grille de cycles globale, le beat absolu s'y projette directement. C'est ce mouvement qui rend la reprise perceptible, sans avoir à la dessiner deux fois.
- **Événements** : deux états, **attaque** (éclat vif, ~1/8 de beat) puis **tenue** (maintien atténué jusqu'à la fin). Un événement Strudel occupant toute sa durée [SPEC-18.25], un allumage plein temps donnerait une impression molle et un flash seul serait illisible sur une note tenue.
- **Code** : les caractères de la mini-notation s'illuminent, à partir des **positions source** que le transpileur attache déjà à chaque événement (`hap.context.locations`, offsets de caractères absolus). Deux propriétés vérifiées, fidèles au REPL officiel : un événement porte l'**ensemble** des atomes qui l'ont produit, éventuellement issus de plusieurs chaînes (`note("c e").s("piano")` → `c` et `piano`), et les arguments d'opérateur comptent (`bd*2` illumine `bd` et `2`). Contrairement au roll, l'attaque **et** la tenue illuminent le texte : un caractère clignotant un huitième de beat serait illisible.

**Le surlignage du code n'est actif que si les positions sont valides**, c'est-à-dire si le code joué est **caractère pour caractère** le texte affiché. L'expansion des `vars` [SPEC-4.7], le retrait d'une couche coupée [SPEC-18.9] et l'enveloppe de transposition [SPEC-18.12] décalent tous les offsets. Le test est une comparaison exacte, jamais une heuristique, et l'indisponibilité est **dite** : un surlignage décalé désignerait les mauvais caractères avec la même assurance, ce qui est pire que pas de surlignage.

**Synchronisation calée sur l'audible.** `scheduler.now()` retranche le tick de requête (`clock.duration`, 0,05 s) mais **pas** la `latency` du scheduler (0,1 s), alors que chaque événement est programmé à `targetTime + latency`. La position brute devance donc le son d'environ 0,1 s — un cinquième de beat à 120 BPM, nettement visible sur un kick. Cet écart DOIT être compensé. `latency` n'étant pas exposée par `repl()`, la valeur est répliquée en constante nommée, à maintenir si Strudel change. *(Écart présent aussi dans le REPL officiel et dans la jauge de l'instrument.)*

L'implémentation n'ajoute **aucune dépendance** : `@strudel/codemirror` est inutilisable sur un `<textarea>` (la limite vient de l'élément, qui ne peut pas styler des plages de caractères), et le `Drawer` de `@strudel/draw` est superflu puisque les temps des événements sont déjà connus. Le surlignage du code impose en revanche un **éditeur à deux calques** : un rendu visible sous un `<textarea>` au texte transparent mais au caret visible, les deux partageant une source unique de métriques (police, taille, interlignage, marges, retour à la ligne) — toute divergence ferait dériver le surlignage des glyphes.

*Impl. : `HapInfo.locations`/`SourceRange` dans `StrudelEngine.queryEvents`, `RollEvent.locations` + `eventPhase`/`phaseWithin`/`FLASH_BEATS` dans `core/composer/roll.ts`, `src/composer/state/playhead.ts` (ticker rAF + `SCHEDULER_LATENCY_S`), `codeEvents`/`codeHighlightable` dans `composerStore`, `.playhead`/`.attack`/`.held` dans `PianoRoll.svelte`, `src/composer/lib/PatternEditor.svelte`.*

**[SPEC-18.26] La vue montre exactement un tour de boucle.** La largeur dessinée DOIT correspondre à la **longueur réelle** de la boucle : une phrase de 4 beats occupe toute la largeur, et le bord droit **est** l'endroit où elle recommence.

Historique de la décision, parce qu'elle a été prise dans les deux sens : la vue s'étendait d'abord sur **deux tours**, pour rendre la reprise visible. Assombrir et nommer le second tour a réduit la confusion sans la supprimer — huit frappes dessinées en face d'un « 4 beats » restent huit frappes à compter, et la moitié grisée occupait la moitié de l'espace horizontal sans rien apprendre. Montrer la seule vraie longueur supprime la contradiction à la source, et le curseur de lecture [SPEC-18.27] rend la reprise **perceptible par le mouvement** plutôt que par duplication.

Restent affichés : une ligne par **beat** avec les mesures marquées [SPEC-18.25], la règle numérotée `1..N`, et les **répétitions internes** plus courtes que la phrase — c'est l'écart qui surprend quand un pattern « joue trop vite ».

Limite assumée, inchangée : la vue étant dérivée de l'interrogation du pattern [SPEC-18.6], deux écritures produisant le même flux d'événements sont indiscernables — `s("bd*8").slow(2)` et `s("bd*4")` donnent les mêmes attaques et la même période, et aucune ne peut être déclarée plus longue que l'autre sans lire le code. *Impl. : `spanCyclesFor()` dans `core/composer/roll.ts` (un tour), règle et grille dans `PianoRoll.svelte`.*

**[SPEC-18.25] Les attaques doivent rester dénombrables.** Un événement Strudel occupe toute sa durée — les quatre frappes de `s("bd*4")` durent un beat chacune et se touchent. Dessinées bord à bord, elles forment un bloc continu : un 4-temps ressemble à une nappe, et l'information qu'on cherche sur une ligne de percussion (combien de frappes, où) disparaît. La durée réelle reste dessinée, mais chaque événement DOIT porter un **repère d'attaque** sur son bord gauche et être séparé du suivant d'un filet. Un fragment sans attaque (queue d'un événement commencé avant la fenêtre) n'en porte pas — c'est ce qui le distingue d'une nouvelle frappe. Le repère de fin de phrase est dessiné **au-dessus** des événements : sous eux il devenait invisible sur une ligne chargée, précisément quand il est utile. *Impl. : `.ev` (bord d'attaque, largeur `calc(… - 2px)`) et `.loopmark` (z-index) dans `PianoRoll.svelte`.*

**[SPEC-18.24] Les messages de condition disparaissent avec leur condition.** Précise [SPEC-14.3], qui exige de tout remonter mais ne dit pas quand cesser. Deux natures de messages, à traiter différemment :
- un message de **condition** décrit un état courant (« pattern non évaluable », « variable non définie », « champ non modifié — corrigez le YAML ») et DOIT s'effacer **dès que la condition cesse** : corriger une erreur de syntaxe et continuer à lire la plainte à son sujet apprend seulement que l'outil ne regarde plus ;
- un message d'**événement** relate un fait passé (« enregistrement impossible », « dossier inaccessible ») et DOIT persister jusqu'à lecture — l'effacer masquerait ce qui s'est mal passé.

Les conditions sont donc effacées aux points où elles se résolvent : évaluation réussie du pattern, requête réussie, YAML redevenu valide, pattern vidé. Un message posé par un composant (lecture, isolation) est effacé par la réussite ailleurs, la cause étant la même. *Impl. : `CONDITION_PREFIXES`/`clearConditionError()` appelé dans `commitYaml`, `pushVoice` et `analyse` (`composerStore`).*

**[SPEC-18.23] Deux gestes d'insertion distincts.** Un assistant [SPEC-18.7] produit un **pattern entier** ; le coller comme texte brut à la fin du code existant juxtapose deux expressions et donne une **erreur de syntaxe**. Deux gestes séparés, jamais devinés :
- **ajouter une couche** (geste par défaut de tous les assistants) : le fragment devient un argument de `stack(...)`. Si le pattern est déjà un `stack(...)` **sans appel chaîné**, le fragment s'ajoute à ses arguments ; sinon le pattern existant est **enveloppé en entier**. Ce dernier cas est obligatoire quand un suffixe est présent : dans `stack(a, b).s("piano")`, ce suffixe s'applique à toutes les couches et un `.s()` postérieur gagne — un son de batterie ajouté comme argument deviendrait silencieusement du piano. L'imbrication coûte un niveau de parenthèses et est le seul résultat correct ; en contrepartie les couches du groupe enveloppé ne sont plus solistes individuellement [SPEC-18.9].
- **insérer au curseur** : texte brut à la position du curseur, pour placer un fragment **à l'intérieur** du code existant (un nom de son dans un `s("…")`). Exige un curseur que l'utilisateur a réellement posé ; à défaut l'action est **indisponible** et le dit — se replier sur la fin du texte est précisément ce qui produisait du code invalide.

*Impl. : `addLayer()` dans `core/composer/layers.ts`, `addAsLayer`/`insertAtCursor` + `caretKnown` dans `Composer.svelte`, boutons nom / ↳ dans `SoundBrowser.svelte`.*

**[SPEC-18.22] Un assistant à la fois.** Les assistants [SPEC-18.10] NE DOIVENT PAS être empilés verticalement : quatre panneaux dépliables repoussaient le piano roll et les métadonnées hors de l'écran, et un atelier qu'il faut faire défiler pour voir ce qu'il dessine ne remplit pas son office [SPEC-17.2]. Ils sont regroupés derrière une **barre d'onglets**, un seul visible à la fois, aucun par défaut. Exception : l'**aide contextuelle** [SPEC-18.13] reste toujours visible — elle répond à une question qu'on se pose *pendant* la frappe, la masquer derrière un clic la priverait de son intérêt. *Impl. : `TOOLS`/`activeTool` dans `Composer.svelte`.*

**[SPEC-18.21] Longueur de phrase automatique.** Le champ `beats` [SPEC-4.2] est **déduit du pattern** : longueur de phrase **standard la plus petite qui contienne la période mesurée** (4, 8, 16, 32, 64). Corrige [SPEC-18.8], qui interdisait d'écraser le champ : c'est la période **brute** qui ne devait pas y être écrite, pas une valeur musicalement juste. `s("bd*4")` a une période de 1 beat et se déclare sur 4 — cette règle reproduit **les 23 valeurs déclarées de la bibliothèque, sans exception** (vérifié). Un pattern non périodique ne donne aucune valeur : deviner serait pire que de le dire. La déduction a lieu **avant** le calcul de l'étendue affichée, pour que le roll soit dessiné à la longueur qui vient d'être décidée. Saisir une valeur à la main **prend le dessus** jusqu'au chargement d'une autre piste, avec un retour explicite au mode automatique. *Impl. : `phraseBeatsFor()` dans `core/composer/roll.ts`, `beatsIsManual`/`setBeatsManually`/`resumeAutoBeats` dans `composerStore`.*

**[SPEC-18.20] Sons favoris.** Le navigateur de sons [SPEC-18.10] DOIT permettre de **marquer** un son. La banque comptant plus d'un millier d'entrées et un set n'en utilisant qu'une poignée, le marquage transforme un annuaire en **palette**. L'ordre de la liste ne DOIT **pas** dépendre des favoris : remonter un son au moment où on le marque le fait fuir sous le pointeur, et le clic suivant tombe sur un autre son. L'accès rapide passe par un **basculement** qui restreint l'affichage aux seuls favoris — il ne change la liste que lorsqu'on le demande. La sélection est **persistée** entre les sessions [SPEC-13], sous une clé propre à l'atelier. Elle n'entre PAS dans le fichier de piste : un favori décrit une habitude de l'interprète, pas la boucle, et serait du bruit dans un `.track.yaml` [SPEC-4.6]. Un échec d'écriture est signalé — un favori perdu ne se remarque qu'au moment où on en a besoin [SPEC-14.3]. *Impl. : `src/core/composer/bookmarks.ts`, tri et bascule dans `src/composer/lib/SoundBrowser.svelte`.*

**[SPEC-18.11] Démarrage à partir de l'existant.** Créer une piste DOIT pouvoir se faire **à partir d'une piste de la bibliothèque**, qui sert de recette. Réponse directe au problème de la page blanche [SPEC-18.2] : la bibliothèque est déjà un jeu d'exemples fonctionnels.

**[SPEC-18.12] Contexte de jeu.** L'atelier DOIT permettre de fixer le **BPM** et la **tonalité Camelot** d'audition, afin que ce qui est entendu pendant l'écriture corresponde au contexte de destination — la finalité étant de jouer par-dessus un mix externe dont la tonalité est connue [SPEC-17.14].

**[SPEC-18.13] Aide contextuelle.** L'atelier PEUT expliquer le **fragment sous le curseur** (« `*4` : répète 4 fois dans le cycle ») et permettre d'**isoler** un fragment sélectionné pour n'entendre et ne voir que lui. Une explication qui arrive au moment où la question se pose remplace avantageusement la consultation de la documentation.

### Fichier, écriture et cycle

**[SPEC-18.14] Panneau YAML visible.** Le fichier DOIT être affiché et **éditable directement**, en cohérence avec la nature « données » des pistes [SPEC-4.6]. L'atelier ne masque pas le format : l'utilisateur doit pouvoir continuer à écrire ses pistes à la main sans l'atelier.

**[SPEC-18.15] Écriture dans la bibliothèque.** L'atelier DOIT pouvoir écrire `library/<catégorie>/<slug>.track.yaml` **directement**, via la File System Access API (Chrome, déjà requis pour Web MIDI et WebHID [SPEC-14.1]) : le dossier est autorisé une fois, les enregistrements suivants ne redemandent rien. Contraintes :
- le **nom de fichier et le dossier déterminent l'identifiant** `catégorie/slug` : renommer ou déplacer **délie les pads** de l'instrument (association conservée et signalée, jamais purgée [SPEC-17.51]). L'atelier DOIT avertir avant un renommage qui change un identifiant existant ;
- l'écrasement d'une piste existante DOIT être explicite ;
- le bouton DOIT **toujours rouvrir le sélecteur**, même quand un dossier est déjà autorisé : court-circuiter sur l'autorisation existante rendait le bouton inopérant et privait l'utilisateur du seul moyen de corriger un mauvais choix ;
- le dossier retenu DOIT être **contrôlé et le doute signalé**. Le sélecteur du navigateur n'offre aucun contexte et choisir `library/perc` au lieu de `library/` est une erreur naturelle — l'application écrirait alors `perc/<catégorie>/…`, créant un dossier dans un dossier. Deux indices suffisent : la présence de `track.schema.json` atteste la racine ; des fichiers `.track.yaml` **directement** dans le dossier trahissent une **catégorie**, soit un niveau trop bas. L'avertissement est **consultatif**, pas un refus : un dossier de pistes personnel reste une cible légitime.

**[SPEC-18.16] Validation.** Une piste DOIT être validée **avant écriture** contre `library/track.schema.json` — le même schéma que celui utilisé par l'éditeur et par le chargeur [SPEC-4.6] —, et son `pattern` DOIT être évalué au moins une fois sans erreur. Aucun fichier invalide n'est écrit dans la bibliothèque.

**[SPEC-18.17] Cycle atelier → instrument.** Les deux pages étant servies par le même serveur Vite, elles voient la même bibliothèque sur disque et la même banque de sons. Enregistrer dans l'atelier DOIT faire apparaître la piste dans l'instrument sans manipulation : le watcher détecte le fichier et l'instrument se recharge [SPEC-17.31]. Ce cycle est la principale justification du second document plutôt que d'un projet séparé.

### Tonalité d'une suite d'accords

**[SPEC-18.31]** L'outil « Accords » déduit la **tonalité** d'une suite d'accords — le sens inverse
du générateur de degrés. On ne calcule pas une tonalité, on la déduit, en croisant quatre indices du
plus faible au plus décisif : les notes employées (qui laissent toujours la paire relative en
suspens), la **suite des qualités** d'accords (qui ne s'aligne que d'une façon sur le gabarit
diatonique), la **dominante** (le triton d'une septième de dominante n'a qu'une résolution) et la
**cadence** avec la position. Le mineur harmonique est admis : en la mineur la dominante est *mi
majeur*, sans quoi toute cadence authentique en mineur serait comptée hors tonalité.

**[SPEC-18.31.1]** Le verdict porte **toujours** ce qui soutient l'hypothèse ET ce qui la contredit.
Une hypothèse sans ses réserves serait une affirmation, et c'est précisément ce qu'une déduction
n'est pas. Sont nommés, jamais résumés ni masqués : les accords qu'aucune lecture n'explique, les
symboles illisibles ignorés, l'absence de dominante, les lectures concurrentes, et le cas où
**plusieurs tonalités expliquent tous les accords** — auquel cas le message dit explicitement que
c'est l'oreille qui tranche, pas le calcul. Quatre niveaux : `certaine`, `probable`, `incertaine`,
`indéterminée`. Un seul accord, ou aucun accord lisible, donne `indéterminée` avec le motif.

**[SPEC-18.31.2]** Chaque accord reçoit son **rôle** : chiffrage romain s'il est diatonique
(`I`, `ii`, `V7`), « emprunt » nommé s'il est hors gamme mais explicable (♭III/♭VI/♭VII du mineur
parallèle, napolitaine, dominante secondaire), « hors tonalité » sinon. Un emprunt n'est pas une
contradiction : la piste `cmajor-1-4-b6-b7` est faite de ♭VI et ♭VII et reste en do majeur.

**[SPEC-18.31.3]** Deux principes de départage, sans lesquels le barème dérive :
une lecture qui n'a besoin d'**aucun emprunt** bat toute lecture qui en demande un — sans quoi les
dominantes secondaires font « expliquer tout » à presque n'importe quelle tonalité, et `C F G C`,
cas d'école, se voyait affubler de dix concurrentes ; et un **v mineur** sans dominante majeure
affaiblit le candidat, car il relève du modal et n'attire pas vers la tonique — c'est ce qui fait
lire `Dm Gm` en i–iv de ré mineur plutôt qu'en v–i de sol mineur. La suite est traitée comme une
**boucle** : le premier accord, sur lequel elle retombe à chaque tour, compte presque autant que le
dernier.

**[SPEC-18.31.4]** La **relative** est signalée mais ne compte pas comme une incertitude : elle
porte le même chiffre Camelot `[SPEC-17.19]`, donc l'ambiguïté la plus coûteuse à lever en solfège
est sans effet sur ce que l'application transpose.

---

### Reconnaissance d'accords

**[SPEC-18.30]** L'outil « Accords » fonctionne **dans les deux sens**. Le générateur transforme
des degrés en symboles ; l'inverse est ce dont une session a réellement besoin : un riff recopié
d'une vidéo arrive en **notes absolues** (`[d3,a3,f4]`), qui ne se transposent pas et que
`voicing()` ne peut pas réinfléchir `[SPEC-17.48]`. Coller les notes rend le nom (`Dm`) — donc
rend la musique déplaçable.

**[SPEC-18.30.1]** La lecture des notes accepte ce qu'on colle vraiment : `d3,a3,f4`,
`[d3,a3,f4]`, `d3 a3 f4`, `note("[…]")`, majuscules, `bb3`, `gs2`. Moins de trois notes, ou un
jeton qui n'est pas une note, sont **refusés en le disant** — jamais devinés.

**[SPEC-18.30.5]** **Trois zones de saisie**, une par notation, plutôt qu'un champ unique qui
devinerait : les musiciens ne partagent pas une seule écriture. Un pattern Strudel se lit
`d3,a3,f4`, une partition française `ré3,la3,fa4`, et un tutoriel dit « la 1, la 3 et la 5 ».
Séparer les champs rend les trois **visibles** au lieu de découvrables. Chaque champ est
**strict** — mais un nom appartenant à l'autre alphabet est reconnu comme tel et renvoie vers le
bon champ, au lieu de prétendre que la note n'existe pas. Les sept noms français sont acceptés
avec ou sans accent (`ré`/`re`), en majuscules, et l'entrée est normalisée en NFC (un `é` copié
du web peut arriver décomposé). Les altérations acceptent `#`, `♯`, `s`, `b`, `♭`, `f` : `sib3`,
`sol#`, `mib`. La sortie est **toujours** l'orthographe anglaise, seule que `chord()` accepte —
le français est une commodité d'entrée, jamais une valeur qui entre dans le pattern.

**[SPEC-18.30.11]** Chaque lecture porte un bouton **🎹 écouter**. Lire `D3 F3 A3` donne les notes ;
entendre l'accord dit s'il s'agit du bon — et deux lectures d'un même ensemble (`FM` et `Am#5` pour
fa-la-do) diffèrent par un voicing que personne ne juge sur le papier. C'est une frappe **unique**,
via le mécanisme d'audition existant `[SPEC-18.10]` : slot dédié, jamais celui de la boucle en cours
d'écriture, et voix relâchée juste après. Le bouton s'allume pendant que ça sonne, sans quoi, avec
deux lectures à un clic d'écart, on ne sait plus laquelle on vient d'entendre. Le son est
**`gm_piano`** — ses presets sont sur le disque `[SPEC-17.55]`, donc l'audition ne dépend d'aucun
réseau ; repli sur la banque `piano` si l'import GM n'a pas été fait, plutôt qu'une audition muette.

**[SPEC-18.30.10]** La lecture dépend de la **gamme**, pas seulement du texte : changer de tonalité
ou d'épellation ♯/♭ **recalcule** le résultat. Sans quoi le panneau continuait d'afficher une réponse
pour une tonalité qui n'était plus sélectionnée, et la seule issue était de retaper quelque chose
dans un champ. Selon le champ actif, l'effet diffère et les deux sont voulus : avec un champ de
notes actif, seuls les degrés miroir changent (`1,5,10` en ré mineur devient `2,6,11` en do majeur —
mêmes notes, autre gamme) ; avec le champ des degrés actif, ce sont les **notes** qui changent, donc
l'accord (`1,3,5` passe de `Dm` à `CM`).

**[SPEC-18.30.9]** Les évaluations de la sonde sont **spéculatives** : leurs échecs ne sont pas
remontés à l'utilisateur. Chercher l'orthographe qu'accepte Strudel suppose d'essayer des symboles
qui échouent — mais Strudel diffuse chaque erreur d'évaluation sur `strudel.log`, que la capture
`[SPEC-17.57]` transformait en toast. Taper `1,3,5` dans le champ des degrés faisait donc surgir
« [eval] error: Invalid argument », et un jeu de quatre candidats en produisait sept. Deux mesures :
les orthographes dont l'échec est **certain** ne sont plus essayées du tout — les accords barrés
lèvent tous, et les alias typographiques (`C°`, `CΔ`, `Cø`) sont refusés par l'analyseur de
**mini-notation**, donc ne peuvent jamais marcher (chaque type possède un alias ASCII qui, lui,
fonctionne) — et le reste est évalué en **mode silencieux**. Mesuré après correction : 0 message
émis sur les cinq cas de référence, et une vraie erreur hors sonde reste affichée.

**[SPEC-18.30.8]** Chaque lecture affiche le symbole **et son nom français** : `CM7` · « DO
majeur 7 », `Gm` · « SOL mineur », `Bb` · « SI♭ majeur ». Le symbole reste anglais — c'est le seul
que `chord()` accepte et il part tel quel dans le pattern — mais `Dm` ne dit pas à tout le monde de
quel accord il s'agit. La traduction est indexée sur le **type canonique** de tonal, pas sur le
suffixe, de sorte que tous les alias d'un même accord (`maj7`, `M7`, `Δ`, `^7`) donnent la même
lecture. Une qualité non traduite garde son suffixe **tel quel** (`Cadd9` → « DO add9 ») : une
étiquette à moitié traduite est honnête, une étiquette inventée non.

**[SPEC-18.30.7]** Une saisie dans un champ est **retranscrite dans les deux autres** : les trois
montrent la même chose, chacun dans son écriture. Retaper `ré3,la3,fa4` après `d3,a3,f4` n'apprend
rien ; voir la traduction apparaître, si. Les champs recopiés sont **grisés en pointillés** — écrits
par l'outil, pas saisis — et restent modifiables : y taper les rend simplement actifs. Une note
hors gamme est écrite en **degré altéré** (`#3` pour le fa♯ d'un ré majeur en ré mineur) ; quand
aucun degré n'approche à un demi-ton près, ou que la note sort de l'empan de deux octaves, le champ
degrés reste **vide** plutôt que de mentir. Une note chromatique se lisant des deux façons (`#2`
ou `b3`), c'est le sélecteur ♯/♭ déjà présent qui tranche.

**[SPEC-18.30.6]** Le champ **degrés** lit des chiffres dans la gamme du sélecteur de tonalité,
qui est nommée à l'écran (« degrés lus dans 7A · RÉ mineur ») : trois nombres sans contexte ne
veulent rien dire. Les degrés **montent** : `1,5,10` donne le voicing large `D3 A3 F4` du riff
d'origine au lieu d'empiler trois notes dans une octave — l'identité de l'accord survit aux deux,
ce qu'on entend non. Au-delà de 7 on continue dans l'octave suivante (8 = tonique à l'octave),
jusqu'à 14 ; `b3` et `#4` altèrent un degré, parce que c'est ainsi que s'écrivent les notes
empruntées. Un degré qui **descend** sous le précédent est refusé : il deviendrait silencieusement
la basse et changerait le nom rendu.

**[SPEC-18.30.2]** La dénomination est déléguée à `tonal` (`@tonaljs/chord-detect`), la famille
sur laquelle Strudel s'appuie déjà. **Que Strudel accepte le symbole est une autre question**, et
elle est posée à Strudel : chaque orthographe est essayée par `queryEvents` et retenue seulement
si elle sonne les hauteurs collées. Mesuré sur Strudel 1.2.6, un symbole cache quatre réponses :
les accords barrés (`Gm/D`, `C/E`) **lèvent** « Invalid argument » ; `.dict("triads")` ne produit
**rien** dès que l'accord n'est pas une triade (`Dm7`, `G7`, `C6`, `Cadd9`) ; plusieurs noms
courants ne passent que sous un **alias** (`Cmaj7` ✗ / `CM7` ✓, `Cdim` ✗ / `Co` ✓, `Csus4` ✗ /
`Csus` ✓, `Cdim7` ✗ / `Co7` ✓) ; et un dictionnaire peut **accepter un symbole en jouant autre
chose** (`Caug` sous `triads` sonne Mi♭ La♭ Do, pas Do Mi Sol♯). Une table codée en dur
vieillirait au premier changement de dictionnaire, et l'échec serait de nouveau du silence
`[SPEC-14.3]`.

**[SPEC-18.30.3]** Une orthographe est retenue si les hauteurs produites sont celles collées,
**exactement ou en sous-ensemble sans note étrangère**. Le second cas est réel et ne doit pas être
refusé : Strudel voice `Dm7` en ré-fa-do, sans la quinte, comme le ferait un pianiste. Les notes
omises sont alors **nommées** ; un voicing qui perd une note en silence est ce qu'on découvre sur
scène. Une orthographe complète l'emporte toujours sur une incomplète.

**[SPEC-18.30.4]** Un **renversement** est proposé comme l'accord de base plus une **couche de
basse** (`stack(chord(…).voicing(), note("d3"))`), seule façon de le garder dans Strudel. La basse
est un `note(...)` simple et non `rootNotes().note()` : ce dernier emboîte ses valeurs dans un
second objet `{note}`, et `.add(note(n))` — exactement ce que fait la transposition de tonalité de
Strudler — ne rend alors plus rien du tout.

---

### Grille de batterie : longueur de boucle

**[SPEC-18.32] La grille couvre la boucle entière, pas seulement le premier cycle.** Une chaîne de mini-notation dure **un cycle** (4 temps) : une boucle de 8 temps ne peut s'écrire, dans le sous-ensemble éditable [SPEC-18.10], qu'en ralentissant l'ensemble. Ce facteur `.slow(n)` **appartient donc à la grille** au lieu de rester dans le suffixe opaque — sans quoi l'éditeur restait bloqué sur les quatre premiers temps d'une boucle plus longue, en silence : le piano roll montrait huit temps et la grille en proposait quatre.

- La grille porte un nombre de **cycles** ; sa longueur affichée est `4 × cycles` temps, et la résolution se lit « n pas par temps · N temps » — plus « 4 temps par cycle », qui était faux dès que la boucle dépassait un cycle.
- **Étendre conserve la durée du pas** : passer de 4 à 8 temps **double le nombre de colonnes** et laisse les nouvelles vides, au lieu de ralentir ce qui est déjà écrit. C'est le sens de « ma boucle fait 8 temps, je veux écrire les temps 5 à 8 ».
- Le facteur est écrit **en tête de chaîne** (`s("…").slow(2).gain(0.6)`) et relu où qu'il soit dans la chaîne ; un `.slow(x)` ou `.slow(1.5)` reste **opaque**, la grille ne sachant pas le réécrire fidèlement.
- Au-delà des 64 pas affichables, l'extension est **refusée avec sa raison** [SPEC-14.3] plutôt qu'ignorée.
- La grille ne s'aligne **jamais d'elle-même** sur la longueur déclarée de la piste : ouvrir un outil ne doit pas réécrire le pattern (le code reste la source de vérité). L'écart est **énoncé** — « la piste déclare 8 temps, la grille en couvre 4 » — avec un bouton pour l'appliquer.

*Impl. : `cycles` dans `DrumGrid`, `extractCycles`/`chainCalls`/`setCycles`/`cyclesFit`/`gridBeats` et `stepsPerBeat(steps, cycles)` dans `core/composer/drumGrid.ts`, sélecteur « Temps » + rappel de l'écart dans `DrumGrid.svelte`, prop `beats` passée par `Composer.svelte`.*

### Limites

**[SPEC-18.18] Contrôleurs matériels : hors périmètre initial.** L'atelier est piloté **souris/clavier**. Si les deux pages sont ouvertes simultanément, elles ouvrent les mêmes ports MIDI : les entrées se partagent, mais les **sorties LED entreraient en conflit** (deux pages écrivant l'état des pads). Piloter la grille de batterie depuis l'APC reste envisageable, mais suppose de traiter d'abord cette exclusivité.

**[SPEC-18.19] Hors périmètre.** Ne relèvent PAS de l'atelier : un IDE Strudel généraliste ; un parseur de code Strudel arbitraire [SPEC-18.6] ; une ré-implémentation du live-coding, déjà couverte par le mode avancé de l'instrument [SPEC-9.2] ; l'arrangement d'un morceau complet [SPEC-15].

---

## [SPEC-19] Sortie scénique — diffuser le jeu vers d'autres applications

**[SPEC-19.1] Intention.** Strudler **sait** ce qu'il joue : tempo, position dans la mesure et la phrase, et chaque frappe **avant** qu'elle soit audible (le séquenceur Strudel s'engage sur les événements en avance). Un logiciel lumière ou un moteur visuel n'a donc aucun besoin d'analyse spectrale : il suffit de le lui dire. Strudler **émet** ces informations et rien de plus — le rendu (visuels, DMX) appartient aux applications réceptrices, l'instrument ne s'alourdit pas d'un moteur graphique.

**[SPEC-19.2] Contrainte structurante.** Un navigateur ne peut **ni émettre de l'UDP, ni écouter sur un port**. Les deux transports retenus s'en déduisent : **MIDI** (natif, Web MIDI) et **WebSocket en client** (le récepteur est le serveur). Sont donc hors de ce périmètre, faute d'être atteignables sans pont : OSC, Art-Net/sACN, Ableton Link. Chacun resterait un **simple puits supplémentaire** derrière le même bus, un pont UDP dans `vite-plugins/` (modèle `soundsServer.ts`) suffisant le jour où c'est utile.

**[SPEC-19.3] Architecture : un producteur, des puits.** Les événements sont normalisés en **cues** par un bus unique (`core/cues/CueBus`), auquel se branchent des **puits** indépendants, **éteints par défaut**. Sans puits actif, aucun coût : le bus abandonne l'émission et le hook du moteur rend la main immédiatement. Un puits qui échoue n'affecte ni les autres ni l'audio, et son erreur est **remontée visiblement** [SPEC-14.3]. `core/cues/` n'importe ni UI ni store ; le câblage vit dans `stores/cuesStore.ts`, qui **lit** l'état existant plutôt que d'exiger que le reste de l'app lui rende compte (aucune modification de `rackStore`).

**[SPEC-19.4] Origine des événements : le canal est déjà tagué.** Chaque voix reçoit `.orbit(canal + 1)` pour ses bus d'effets [SPEC-17.37] : l'`orbit` porté par tout événement joué **identifie donc le canal**, sans rien instrumenter, et le canal donne sa catégorie. Le point de captation est le `defaultOutput` passé au `repl()` de Strudel, **enrobé** : l'audio est déclenché d'abord et sa promesse retournée intacte, les observateurs sont notifiés ensuite, leurs exceptions attrapées et republiées. Aucun patch de Strudel, aucune dépendance ajoutée.

**[SPEC-19.5] Le temps est la valeur ajoutée.** Chaque cue porte `t` (instant d'émission) et, pour les événements datés, `at` = l'instant où l'événement **doit** se produire. Pour un `onset`, `at` est **dans le futur** : mesuré, l'écart est de l'ordre de **+300 ms** à 120 BPM. Un récepteur peut donc **attendre** `at − maintenant` pour être calé, ou **anticiper** un fondu avant la frappe. Un `beat`, lui, est **constaté** (≈ −10 ms) : il est détecté au franchissement, pas prédit.

La conversion horloge audio → temps epoch passe par `AudioContext.getOutputTimestamp()`, relue à chaque appel (les deux horloges dérivent). ⚠ L'instant d'attaque est le **5ᵉ** argument du `defaultOutput` (`targetTime`, latence incluse) : le 4ᵉ, `deadline`, est un **délai relatif** (`targetTime − phase` dans le Cyclist, conservé par compatibilité) et le prendre pour un instant absolu produit un `at` qui dérive d'un beat par beat.

Côté MIDI, la même avance est exploitée par l'horodatage de `MIDIOutput.send()` : les messages sont **programmés** à leur instant exact au lieu d'être émis au gré du minuteur JS.

**[SPEC-19.10] Onglet en arrière-plan.** Chrome ralentit `requestAnimationFrame` à ~1 Hz dans un onglet non visible, or les cues `beat` en sont dérivés. Deux parades : les beats franchis pendant un trou sont **tous** émis au retour (au plus deux mesures de rattrapage, un récepteur n'ayant rien à faire de cent beats d'un coup), et l'horloge MIDI est **programmée ~1,2 s à l'avance** — Web MIDI émet un message horodaté même si JS ne tourne pas, ce qui couvre le ralentissement sans que l'horloge ne s'interrompe.

**[SPEC-19.11] Boucle de port.** Si le port de sortie est aussi visible en **entrée** (cas du bus IAC de macOS), les cues MIDI réapparaissent dans le moniteur MIDI de Strudler. Ils y sont marqués « appareil non reconnu » et **n'y déclenchent rien** — le mapping résout les contrôleurs par nom de port [SPEC-6.5] — mais c'est utile à savoir : c'est aussi le moyen le plus simple de **vérifier** la sortie sans logiciel tiers.

**[SPEC-19.6] Cues.** `tempo` (bpm, beats/mesure) · `transport` (lecture, beat) · `beat` (beat absolu, mesure, temps dans la mesure, fenêtre de quantisation et position dedans, `at`) · `onset` (canal, catégorie, son, note, gain tel que joué, `at`) · `slot` (canal, catégorie, slot, armé, piste). Les scènes et les effets tenus (DROP, gate, filtre) suivront par le même chemin. Un beat n'est émis que transport en lecture, et son `at` est **recalculé** depuis la position fractionnaire : la frame d'animation peut avoir jusqu'à ~16 ms de retard, ce qui se voit sur une lumière.

**[SPEC-19.7] Sortie MIDI (QLC+, Resolume, VDMX…).** **Horloge MIDI à 24 ppqn** (1 beat = 1 noire) + **Start / Stop / Song Position Pointer** (SPP en doubles-croches, 14 bits), la grille de ticks étant **réancrée à chaque beat** sur l'horloge audio pour ne jamais dériver de ce qui est entendu. Une **note par catégorie** (vélocité = gain), suivant la numérotation batterie General MIDI pour rester familière en « MIDI learn » : `kick 36, snare 38, hats 42, perc/clap 39, bass 48, lead 50, chords 52, pad 53` ; catégorie inconnue → note de repli **signalée une fois**. Le **port de sortie est distinct** de celui des contrôleurs (réglage par sous-chaîne, défaut `IAC`) pour que le trafic de cues ne perturbe jamais le retour LED [SPEC-6.4]. Éteindre la sortie envoie un **Stop** : un récepteur ne doit pas rester à courir derrière une horloge morte.

**[SPEC-19.8] Sortie WebSocket (application maison).** Un objet JSON par cue, préfixé de sa version de protocole (`v`), plus un `hello` à l'ouverture portant l'état courant (tempo, transport, canaux et catégories) pour qu'un récepteur arrivé en retard soit immédiatement synchrone. **Reconnexion automatique** tant que la sortie est active — un récepteur redémarré ne doit pas coûter le reste du set — avec état et message d'erreur **affichés** ; les cues émis socket fermée sont **comptés**, pas ignorés en silence. `scripts/cue-monitor.mjs` (`npm run cues:monitor`) est le **récepteur de référence** : serveur WebSocket sans dépendance, il affiche le flux et l'avance mesurée, et sert de squelette à l'application réceptrice.

**[SPEC-19.9] Réglages.** Sortie MIDI (on/off, port, canal) et sortie WebSocket (on/off, URL) vivent dans la modale MIDI/Session — aucune page, aucun encombrement de la surface de jeu [SPEC-17.2] — et sont **persistés** (clé `cues`).

*Impl. : `src/core/cues/` (`types.ts`, `CueBus.ts`, `MidiCueOut.ts`, `WsCueOut.ts`), `src/stores/cuesStore.ts`, `StrudelEngine.onTrigger`/`onTriggerError`/`audioTimeToEpochMs` + `defaultOutput` enrobé, `MidiService.sendAt`, section « Sortie scénique » de `SettingsModal.svelte`, `scripts/cue-monitor.mjs`, script `cues:monitor`.*

---

## [SPEC-20] Sets de pads

**[SPEC-20.1] Intention.** Les 64 pads de l'APC ne portent plus une seule grille de loops mais **un set parmi plusieurs**, commutable au pied levé pendant le jeu. Un set est une configuration de jeu complète (couplet, refrain, break, autre morceau) ; passer de l'un à l'autre ne doit demander ni souris, ni arrêt, ni réassignation.

**[SPEC-20.2] Un set est un preset complet du rack.** Il porte la grille 8×8 (piste, override de live-coding, armement) **et** l'état des canaux : catégories, volume, filtre bipolaire, effets et quantisation [SPEC-17.17]. Deux conséquences sont assumées :
- à la commutation, les valeurs de canal du set entrant sont poussées dans le moteur, donc **un volume ou un effet peut sauter**. Aucun fader physique n'est « tiré » pour autant : la reprise douce [SPEC-17.30] suit la propriété *par valeur*, donc elle se ré-arme d'elle-même et le fantôme [SPEC-17.29] montre l'écart à combler ;
- il n'y a **qu'un canal audio par colonne** (un orbit, [SPEC-17.37]). Les loops d'un autre set qui continuent de tourner [SPEC-20.4] sont donc mises à l'échelle par les volumes et les effets du set **courant**. La *forme* de leur chaîne (insertion conditionnelle des effets, [SPEC-17.53]) reste en revanche celle du set qui les a lancées, jusqu'à réévaluation. Des orbits par set seraient le seul moyen de séparer les deux, au prix de 8 × N bus d'effets.

**[SPEC-20.3] Commutation depuis l'APC.** Les deux premiers boutons de la colonne de droite passent d'un set à l'autre : **CLIP STOP (note 112) = set précédent**, **SOLO (note 113) = set suivant**. La navigation **ne boucle pas** : sur le premier set « précédent » ne fait rien, sur le dernier « suivant » non plus. Une liste de sets est linéaire, et l'enroulement enverrait à l'autre extrémité — exactement le mauvais set, irrécupérable en un seul appui. Intents `setPrev` / `setNext` / `setSelect` — même surface unifiée que le reste [PLAN B]. Les fonctions qui occupaient ces notes (quantisation globale, fenêtre −) **et leurs voisines** (fenêtre +, resync) **quittent le mapping de l'APC** : elles restent sur le nanoKONTROL2 (CYCLE, TRACK ◄ ►, MARKER SET) et dans la GUI, où elles étaient déjà. Les notes 114-119 sont libres.

**[SPEC-20.4] Une commutation ne coupe jamais ce qui joue.** Elle change **uniquement l'adressage des pads** : les loops actives d'un set continuent de tourner quand on le quitte, et **il faut y revenir pour les arrêter** — c'est le geste voulu, pas une limitation. Une voix est donc identifiée par `(set, canal, slot)` et non plus par `(canal, slot)`, et une bascule quantisée en attente [SPEC-8.4] **retient le set de son appui** : elle se déclenche à la fenêtre prévue même si l'on a changé de set entre-temps.

**[SPEC-20.5] Une activité hors du set courant est signalée.** Sur le matériel, les deux boutons de commutation ne disposent que de **trois états**. ⚠ **Constaté sur l'appareil** (le bouton reste vert quelle que soit la valeur envoyée) : les boutons **hors grille** de l'APC mini mk2 (rangée du bas, colonne de droite) sont des LED **monochromes** qui acceptent uniquement **0 = éteint, 1 = allumé, 2 = clignotant**, sur le canal de note 0 ; elles ignorent la palette de couleurs **et** les canaux de luminosité, qui sont des propriétés des 64 pads RGB seuls. Envoyer un index de palette y allume le bouton dans sa couleur fixe quelle que soit la valeur — vert en continu. La **couleur du set de destination n'est donc pas affichable là** : elle vit à l'écran, portée par les vignettes voisines de la barre des sets. Ce que les boutons peuvent dire, ils le disent : **éteint** = rien de ce côté (bout de liste, l'appui ne fait rien [SPEC-20.3]) · **allumé** = un set à atteindre · **clignotant** = des loops tournent encore dans un autre set. Le badge `⟳N` à l'écran nomme ce set et y conduit. À l'écran, la vignette du set porte un badge `⟳N` (N loops actives) et **cliquer le badge y conduit** — puisque c'est le seul endroit d'où les arrêter. Sans ce signal, un son sans pad allumé serait inexplicable.

**[SPEC-20.6] Couleur et nom.** Chaque set porte un nom libre et une couleur, qui devient la **couleur de repos des 64 pads** (pad dont la loop est associée mais non active) ; les états (en lecture, départ/arrêt en attente) gardent leur code couleur [SPEC-17.15/17.16]. La palette compte 8 couleurs, chacune définie par son hex (GUI) et son index de palette APC ; les couleurs d'**état** en sont **exclues** (vert 21 = en lecture, rouge 5 = arrêt en attente), sans quoi un set pourrait se déguiser en état. La GUI reprend la même couleur sur les slots au repos, pour que l'écran et le matériel racontent la même chose.

**[SPEC-20.7] Édition réservée au transport arrêté.** Ajouter, supprimer, réordonner, renommer un set ou changer sa couleur n'est possible que **transport arrêté** — c'est-à-dire hors replay live, le chronomètre étant le bouton PLAY/STOP [SPEC-17.49]. En lecture, seule la commutation reste. Une tentative d'édition est **refusée visiblement** [SPEC-14.3], jamais ignorée en silence.

**[SPEC-20.8] Un set ne se supprime que vide.** Vide = aucun de ses 64 pads n'est associé à une piste. Le dernier set restant n'est jamais supprimable : le rack doit toujours avoir un set courant.

**[SPEC-20.9] Identité stable.** Chaque set porte un `id` immuable, distinct de sa position. Voix, bascules en attente et scènes s'y réfèrent, donc **un réordonnancement ne délie rien** — même exigence que pour les identifiants de pistes [SPEC-17.51].

**[SPEC-20.10] Barre de sets dense.** Une seule ligne au-dessus du rack : pastille de couleur, nom, badge `⟳N`, set courant encadré à sa couleur. Transport arrêté, la même ligne porte l'édition (＋, ✕, ◄ ►, renommage en place, choix de couleur) ; en lecture ces affordances sont désactivées avec leur raison en infobulle. Aucune modale, aucun scroll [SPEC-17.2].

**[SPEC-20.11] Les scènes deviennent multi-sets.** Étend [SPEC-17.36]/[SPEC-17.52] : une scène capture les slots armés **de tous les sets** (clés `set:canal:slot`), le set courant, et la quantisation des canaux de ce set. Une scène qui n'aurait connu que le set courant rappellerait une partie de ce qui sonne, ce qui est pire qu'inutile en live. Au rappel, le set capturé redevient courant. Les scènes enregistrées au format précédent sont **migrées** sur le premier set. Corollaire : l'intent `slotToggle` porte un champ `set` **optionnel** (absent = set courant), afin que le journal de gestes [SPEC-11] reste rejouable à l'identique.

**[SPEC-20.12] Persistance.** La clé `rack` devient `{ version: 2, activeSet, sets: [{ id, name, color, channels }] }` ; un **tableau** (forme antérieure) est migré en un set unique « Set 1 ». Les sessions passent en `SESSION_VERSION` 2 (`initialSets`), une session v1 étant migrée de la même façon. Le miroir disque restant **générique** sur le préfixe `strudler:` [SPEC-13.5], il n'y a rien à y déclarer.

*Impl. : `src/core/channels/sets.ts` (palette, `PadSet`, migration), sets dans `core/channels/ChannelRack.ts`, clé de voix `(set, canal, slot)` dans `StrudelEngine.setVoice`, set retenu par les bascules en attente dans `core/launch/Launcher.ts`, `setPrev`/`setNext`/`setSelect` dans `core/intent/intents.ts` + `core/mapping/mapping.ts` (notes 112/113, couleur de repos, clignotement), `padSets`/`activeSetIndex`/`foreignPlaying` + édition + scènes multi-sets dans `src/stores/rackStore.ts`, `src/lib/SetBar.svelte`, teinte des slots au repos dans `src/lib/ChannelRack.svelte`.*

**[SPEC-20.13] La sortie scénique suit tous les sets.** Corrige [SPEC-19.6] à l'arrivée des sets. Les cues `slot` étaient déduits de l'instantané du **set courant** : une commutation, qui remplace la grille entière sans rien changer d'audible, aurait donc émis une **rafale de faux** « arrêté / démarré » vers le récepteur. Ils sont désormais déduits de l'ensemble des slots **armés, tous sets confondus**, et chaque cue porte l'**id et le nom du set** (ajout compatible, la version du protocole ne change pas). Le premier instantané reste une **référence** et non une suite de changements ; le test se fait sur un drapeau explicite et non sur la taille de la table, sans quoi le tout premier armement de la session — l'état de départ étant vide — passerait à la trappe.

*Impl. : `ChannelRack.armedDetail()` + `ArmedSlot`, `armedSlots` dans `rackStore`, `subscribeSlots` dans `cuesStore`, champs `set`/`setName` du cue `slot` dans `core/cues/types.ts`.*

**[SPEC-20.14] Luminosité des pads : nuit ⇄ jour, sur SHIFT.** En pleine lumière, un pad **associé mais inactif** est illisible : sa couleur de repos [SPEC-20.6] est envoyée à **10 %** de luminosité, ce qui est le bon réglage dans une salle sombre et rien du tout sur une scène éclairée. Le bouton **SHIFT** de l'APC bascule donc entre deux profils : **nuit** (repos à 10 %) et **jour** (repos à **75 %**). Les autres états gardent leur codage — en lecture à 100 %, bascule en attente clignotante — donc le dégradé et le sens de chaque état survivent au changement. Sur l'APC mini mk2 la luminosité est portée par le **canal de note**, pas par la vélocité : le profil ne change donc que le canal, la couleur reste celle du set. Le profil est **persisté** (la lumière d'une salle ne change pas entre deux rechargements) et doublé d'un bouton **☀/🌙** dans la barre de transport, puisqu'un réglage qu'on ne peut faire que sur le matériel serait invisible pour qui règle l'écran d'abord. ⚠ Le code de SHIFT (**note 122**) reste **à confirmer sur l'appareil** ; le moniteur MIDI [SPEC-17.35] nomme le code de tout appui non mappé, donc une autre valeur ne coûte qu'une ligne.

**[SPEC-20.15] Le volume ne suit pas les sets.** Corrige [SPEC-20.2]. Un volume de canal est une **position de main**, pas un réglage de morceau : le voir sauter en changeant de set pendant un jeu est le contraire de ce qu'on veut, d'autant qu'un fader physique reste alors décalé jusqu'à sa reprise [SPEC-17.30]. Le niveau est donc **commun à tous les sets** : régler le volume l'écrit dans **chaque** set. Écrire partout plutôt que « ne pas appliquer au changement » est ce qui garde l'état **persisté d'accord avec ce qu'on entend**, quel que soit le set actif — sinon chaque set conserverait une copie périmée qui ressortirait au prochain rechargement. Un set **créé** naît au niveau courant, et un état enregistré **avant** cette règle est nivelé sur le set actif au chargement. Filtre et effets, eux, restent attachés au set [SPEC-20.2].
