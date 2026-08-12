# Strudler — Spécification fonctionnelle

> Statut : v1. Reprend et enrichit `needs.md`. Voir [SPEC-17] pour les ajouts rédigés rétrospectivement (features demandées en cours de réalisation).
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
- **Sauvegarde d'une piste live-codée vers un fichier** : exporter l'override de code d'un slot (mode avancé [SPEC-9.2]) vers un `library/<catégorie>/<slug>.track.ts` (ou un dossier de pistes utilisateur), pour rendre permanente une évolution jouée en live. Aujourd'hui les éditions live sont en mémoire seulement. *(demandé — à faire plus tard)*

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

**[SPEC-17.25] Déverrouillage audio par geste (rappel MIDI).** L'`AudioContext` ne peut être déverrouillé que par un **vrai geste utilisateur** (clic/touche), jamais par un message MIDI (règle du navigateur). Au **premier** démarrage via le PLAY du Korg alors que l'audio est encore verrouillé, l'app affiche un message visible invitant à cliquer une fois (▶ Play) ; ensuite le PLAY du Korg fonctionne. *Impl. : `StrudelEngine.isAudioRunning`, notice dans `dispatch('transportStart')` (`rackStore`).*

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
