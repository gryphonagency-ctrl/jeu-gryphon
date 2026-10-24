# Portefeuille global d’étoiles

Le serveur injecte automatiquement `arcade-stars.js` dans les pages de jeu Griffon Arcade, y compris les jeux importés. Ce script gère les commandes de chat `étoile`, `!étoile`, `*` et `run`. Une commande `run` débite tout le solde global disponible une seule fois; un solde nul n’est pas débité.

Pour créditer un gain réellement attribué en étoiles dans un jeu, appelez le portefeuille au moment précis où la victoire est confirmée :

```js
if (amount > 0 && window.ArcadeStars) {
  window.ArcadeStars.award({ username, amount })
    .catch(error => console.error('Étoiles non enregistrées :', error));
}
```

N’appelez pas cette méthode pour des points, des dégâts, des pièces ou des gains de démonstration. `username` doit correspondre au pseudo TikTok vu sur le live connecté. Le serveur résout le profil stable et conserve le solde et l’avatar dans le stockage des données du compte.

Le solde peut être lu depuis un jeu avec `await window.ArcadeStars.getBalance(username)`. Les erreurs de lecture et d’attribution sont rejetées par les méthodes; les jeux doivent les signaler plutôt que présenter un crédit réussi.

Sur Render, configurez un disque persistant monté sur `/var/data` pour conserver les profils, les étoiles et les photos après un redémarrage ou un nouveau déploiement.

Les comptes Arcade créés manuellement par l’administrateur enregistrent également leur durée d’accès et leur date d’expiration dans ce stockage. Le serveur refuse l’accès dès l’échéance, puis supprime le compte et ses droits lors de son nettoyage automatique périodique ou au prochain démarrage. Les anciens comptes manuels sans date d’expiration restent inchangés. Les profils TikTok et leurs scores en étoiles restent des données globales du portefeuille, indépendantes du compte Arcade utilisé pour administrer les jeux.
