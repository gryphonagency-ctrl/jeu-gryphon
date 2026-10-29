# Standards Griffon Arcade pour tout nouveau jeu

Chaque jeu est un fichier HTML autonome servi par `serveur.js`. Pour créer un jeu, copier `modele-jeu.html`.

## Effets de live obligatoires (bibliothèque `arcade-effects.js`)
Le serveur injecte `/arcade-effects.js` dans toutes les pages de jeu ; ne pas le recopier dans un jeu.
- **Partage du live** (`type: 'share'`) : petit avion en papier discret.
- **Gros cadeau ≥ 100 pièces** (`type: 'gift'`, `coinCount`) : photo de profil dans une bulle qui monte, puis feu d'artifice.
- **Sons** : chaque explosion est accompagnée de sons festifs synthétisés (lancement, pop, boum, scintillements). Réglage : `ArcadeEffects.setSound(actif, volume)`.
- Les messages WebSocket sont écoutés automatiquement : aucun code de jeu n'est nécessaire.
- Simulateur de chaque jeu : appeler `ArcadeEffects.simulateBigGift(pseudo, pièces)` et `ArcadeEffects.simulateShare()`.
- Seuil modifiable via `ArcadeEffects.config.bigGiftCoins`.

## Règles communes
- Réponses et interface en français.
- Panneau de contrôle masquable : vitesse réglable, file d'attente détachable, connexion TikTok, simulateur, classement masquable.
- Étoiles : `ArcadeStars.award` uniquement pour de vrais gains, jamais en simulation. Évènement `arcade:wallet-run` pour le RUN (voir `ARCADE-STARS.md`).
- Capture de vitrine sans panneau dans `images-vitrine/`, carte dans `accueil.html`.

## Enregistrer un jeu dans `serveur.js`
`protectedRoutes`, `staticGameIds`, `grantGameAccessToExistingCreators`, `staticGameTitles`, `gameRouteIds`, la table des fichiers statiques, et la route de l'image `/images-vitrine/x.png`.

## Publication
Render se déploie depuis le remote `jeu-gryphon` (branche `main`) : pousser aussi sur `origin`.
