# Dessiner, c’est gagné

Le jeu Render contient une collection locale de **1 000 cartes de dessin**. Chaque manche est sélectionnée et affichée par le serveur ; le jeu ne contacte pas OpenAI et n’a plus besoin de clé API OpenAI.

## Collection

La collection comprend 29 dessins SVG originaux, prioritaires pendant les premières manches, et 971 pictogrammes avec leurs noms français. Le serveur rend les images en noir et blanc, avec des contours tremblants et un léger tracé dédoublé pour évoquer un croquis enfantin, tout en gardant les sujets reconnaissables. Les thèmes incluent les animaux, la nature, les aliments, les lieux, les loisirs, les objets, les émotions, les gestes et les symboles. Les métadonnées des pictogrammes proviennent d’Emojibase 18.0.0 ; leur licence MIT est fournie dans `EMOJIBASE-LICENSE.txt`. Le navigateur du joueur dessine les emojis avec les caractères de son appareil, eux aussi désaturés et légèrement irréguliers.

La difficulté augmente d’un niveau tous les dix gagnants, jusqu’au niveau Expert. Chaque manche dure 15 secondes ; les réponses tardives sont refusées et l’image suivante se lance automatiquement. La progression est sauvegardée dans le navigateur qui pilote le jeu. Une carte n’est pas répétée dans son niveau avant que celui-ci ait été parcouru en entier. Les manches n’utilisent ni appels d’IA, ni limite journalière, ni frais par dessin.

## Déploiement Render

Le `render.yaml` à la racine configure ce service avec `dessiner-gagne` comme dossier de service. Seule l’adresse `TIKTOK_CONNECTOR_URL` est nécessaire ; `OPENAI_API_KEY` et `OPENAI_TEXT_MODEL` ne sont plus utilisés.

Une manche démarre à l’ouverture de la page. Après une bonne réponse, le gagnant est annoncé et la manche suivante démarre quatre secondes plus tard. `/api/health` indique la taille de la collection et le nombre de niveaux.

## Exécuter et tester

Lancer avec `npm start` et vérifier avec `npm test`.
