je cherche une solution de music as code orientée live:
- possibilité d'interfacer un controleur midi (type akai) : le controleur doit piloter les sons, les pistes, les effets, ...
- possibilité d'enregistrer et rejouer les sessions live
- banque de sons disponible de base
- possibilité d'ajouter mes propres sons


au niveau "music as code", je voudrais avoir une base de loops (4, 8, 16, 32, voire 64 beats / 1 beat étant le B de BPM, donc 120 BPMs c'est bien 120 beats en une minute) que je pourrais manipuler via du code, avec des fonctions pour les mixer, les transformer, et les arranger en temps réel. L'idée serait de pouvoir coder mes propres patterns et séquences, tout en ayant la possibilité de les déclencher et de les modifier à la volée pendant une performance live.

je veux pouvoir concevoir simplement des pistes isolées (kick, hats, snare, bass, lead, ou autres) et les enregistrer séparément dans des fichiers distincts (respectant un schéma de nommage et une arborescence).

Une fois que j'ai ma bibliothèque de pistes, je veux pouvoir les charger dans une interface graphique qui les associe facilement à des boutons d'un controleur midi (par exemple : je dis que le canal 1 du korg va jouer des kicks, le canal 2 des hats, ... les canaux 5 et 6 des leads). Dans l'interface, je veux pouvoir changer ces associations : par exemple pour dire que le canal 6 maintenant c'est aussi les pistes de bass.

Un mode de fonctionnement simple consiste à utiliser les pistes telles qu'elles sont sur le disque dur, mais un mode avancé doit permettre de pouvoir coder en live sur les pistes pour les faire évoluer (je ne sais pas s'il sera possible d'enregistrer et rejouer des sessions live).

Les sliders doivent impacter le volume du canal, et avoir un effet immédiat sur le son.
Les knobs doivent impacter le filtre (grave/aigu) du canal et avoir un effet immédiat.

Les boutons (S/M/R du nanokontrol) correspondent à une piste, et doivent répondre de 2 manières différentes selon le mode choisi : démarrage/arrêt immédiat ou bien démarrage/arrêt sur la prochaine limite de fenêtre de beats.
Le mode sera choisi via le bouton CYCLE du nanokontrol.
La taille de la fenêtre de beats sera choisi via les 2 boutons TRACK du nanokontrol.

Toutes les informations doivent apparaître dans l'interface visuelle qui manque actuellement: taille de la fenêtre de beats, noms des pistes associées à chaque bouton, et autres informations à venir.

Je veux pouvoir brancher plus tard un akai apc mini mk2 et l'utiliser avec le nanokontrol, donc les associations de fonctionnalités ne doivent pas être codées en dur mais être bien configurables.
