# Portefeuilles d’étoiles TikTok

Le serveur injecte automatiquement `arcade-stars.js` dans les pages de jeu Griffon Arcade, y compris les jeux importés. Les profils TikTok partagent une identité, mais les soldes sont séparés par compte de créateur : le même spectateur peut donc avoir un solde différent sur le live de chaque créateur. Ce script gère les commandes de chat `étoile`, `!étoile`, `*` et `run`. Une commande `run` débite le solde du créateur du live connecté en une fois, dans la limite de 44 000 étoiles par commande; un solde nul n’est pas débité.

Pour créditer un gain réellement attribué en étoiles dans un jeu, appelez le portefeuille au moment précis où la victoire est confirmée :

```js
if (amount > 0 && window.ArcadeStars) {
  window.ArcadeStars.award({ username, amount })
    .catch(error => console.error('Étoiles non enregistrées :', error));
}
```

N’appelez pas cette méthode pour des points, des dégâts, des pièces ou des gains de démonstration. `username` doit correspondre au pseudo TikTok vu sur le live connecté. Le serveur résout le profil stable et conserve le solde et l’avatar dans le stockage des données du compte.

Le solde peut être lu depuis un jeu avec `await window.ArcadeStars.getBalance(username)`. Les erreurs de lecture et d’attribution sont rejetées par les méthodes; les jeux doivent les signaler plutôt que présenter un crédit réussi.

Dans SQUID STORM, les étoiles d’un personnage tombé sont créditées au joueur associé au cadeau ou au `RUN` qui l’a lancé. Une étoile dépensée avec `RUN` lance un personnage; si la réserve ne permet pas de tous les jouer, les étoiles inutilisées sont remboursées. Les simulations ne créditent jamais le portefeuille. Le jeu ne présente une récompense comme créditée qu’après confirmation du serveur; les erreurs sont signalées dans le panneau de contrôle.

Dans Tower Up, un bonus d’une étoile est attribué au bâtisseur LIVE après chaque cinquième étage posé. Les actions simulées n’attribuent aucune étoile; `RUN` ajoute des étages à la file de construction et les éventuelles actions refusées sont remboursées.

Dans City Hunter, chaque cadeau TikTok déclenche une attaque dont la valeur correspond aux pièces du cadeau. Le choix « loup » ou « reine »/« renne » conserve le camp du spectateur; sans choix, l’attaque vise le camp en retard (Loup en cas d’égalité). À la fin d’une manche gagnée, le spectateur ayant le plus contribué au camp gagnant reçoit la récompense calculée dans le portefeuille du créateur connecté. La commande « étoile » affiche le solde de ce spectateur pour ce live.

Dans le Stand de tir néon, chaque étoile dépensée avec `RUN` ajoute un tir en attente; un toucher de l’écran consomme un tir. Par défaut, les cibles cachent 0 ou 1 étoile; les réglages permettent de sélectionner certaines animations pour garantir 2 étoiles. Après un impact, la cible révèle sa récompense. Une cible touchée en partie réelle crédite le portefeuille selon sa valeur; les simulations ne créditent jamais d’étoiles. Le jeu n’a ni limite de temps ni score.

Dans Coin Pusher 2000, seules les cartes et les lingots réellement récupérés créditent le portefeuille avec `ArcadeStars.award`, au joueur dont le cadeau a fait apparaître la récompense. Les anciennes cartes et lingots sans propriétaire sont retirés au chargement. Le stock initial comporte 256 cartes (100 à 1 étoile, 100 à 2, 25 à 10, 25 à 30, 5 à 100 et 1 à 300); un lingot vaut 50 étoiles et est ajouté par défaut après 10 cartes créditées. Le panneau permet de modifier les stocks, d’ajouter des valeurs de carte et de régler ou désactiver la fréquence des lingots. Les simulations n’ont pas de propriétaire LIVE et ne créditent jamais d’étoiles. Les gains non confirmés sont conservés dans le navigateur par compte et réessayés avec le même identifiant de transaction ; si le stockage local est indisponible, le panneau demande de ne pas fermer la page.

Sur Render, configurez un disque persistant monté sur `/var/data` pour conserver les profils, les étoiles et les photos après un redémarrage ou un nouveau déploiement.

Les comptes Arcade créés manuellement par l’administrateur enregistrent également leur durée d’accès et leur date d’expiration dans ce stockage. Le serveur refuse l’accès dès l’échéance, puis supprime le compte et ses droits lors de son nettoyage automatique périodique ou au prochain démarrage. Les anciens comptes manuels sans date d’expiration restent inchangés. Les profils TikTok sont communs pour reconnaître les spectateurs; leurs soldes sont stockés séparément par compte de créateur.
