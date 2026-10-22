# Accès aux jeux et configuration PayPal

Les pages des jeux et leur connexion WebSocket sont protégées côté serveur. Les abonnements PayPal créent automatiquement un compte après vérification par l'API PayPal. Les mots de passe des comptes créés sont stockés sous forme de hachages `scrypt`.

## Stockage durable sur Render

Pour conserver la base des comptes, les jeux importés et les autres données locales, ajoute un **Persistent Disk** à ton service Render avec le point de montage `/var/data`, puis définis :

```text
GAME_DATA_FILE=/var/data/gryphon-accounts.json
```

Sans disque persistant, les comptes et les identifiants de plans PayPal peuvent être perdus au prochain déploiement ou redémarrage. Ne place pas ce fichier dans le dépôt.

Les comptes gérés manuellement peuvent toujours être définis avec `GAME_USERS_JSON`, par exemple :

```json
{"gryphon":"choisir-un-mot-de-passe-long-et-unique"}
```

Utilise des mots de passe d'au moins 12 caractères et garde cette variable secrète.

## Comptes administrateurs et gestion des jeux

Définis `GAME_ADMIN_USERS` avec une liste séparée par des virgules d'identifiants administrateurs. Chaque identifiant doit aussi être autorisé à se connecter avec `GAME_USERS_JSON` ou être un compte actif créé après achat PayPal.

```text
GAME_ADMIN_USERS=gryphon
```

La section **Gestion des jeux** et ses commandes sont réservées aux administrateurs connectés ; le serveur bloque également les requêtes d'administration des autres comptes. Elle permet de remplacer l'image d'un jeu existant, modifier son titre et sa description, masquer/restaurer un jeu intégré, ou importer et supprimer un jeu. Les vignettes par défaut sont fournies dans `images-vitrine/` et livrées avec le site. Les images personnalisées de la vitrine sont envoyées sur Cloudinary. Le disque persistant Render reste nécessaire pour la base des comptes et les fichiers des jeux importés. Chaque jeu importé doit être un fichier HTML autonome de 2 Mo maximum et avoir une image PNG, JPG ou WebP de 2 Mo maximum.

Pour utiliser le bouton **Enregistrer l’image**, crée un compte Cloudinary puis ajoute **soit** `CLOUDINARY_URL`, **soit** les trois variables séparées dans **Render > ton service > Environment**. Avec l'URL Cloudinary complète :

```text
CLOUDINARY_URL=cloudinary://<clé_api>:<secret_api>@<nom_du_cloud>
```

Ou avec les variables séparées :

```text
CLOUDINARY_CLOUD_NAME=<nom_du_cloud>
CLOUDINARY_API_KEY=<clé_api>
CLOUDINARY_API_SECRET=<secret_api>
```

Récupère les vrais identifiants dans les paramètres de ton compte Cloudinary. Garde le secret confidentiel : l'URL ou le secret est utilisé uniquement par le serveur, ne doit jamais être placé dans le HTML ni communiqué aux joueurs, et ne doit pas être partagé dans une conversation. Après avoir enregistré la variable et redéployé le service, connecte-toi comme administrateur, sélectionne un jeu, choisis une image PNG, JPG ou WebP de 2 Mo maximum, puis clique sur **Enregistrer l’image**. Le serveur signe l’envoi à Cloudinary et la vitrine utilise l’adresse sécurisée renvoyée par le fournisseur. Si Cloudinary n'est pas configuré ou refuse l'envoi, l'application affiche une erreur et n'annonce pas l'image comme enregistrée.

Les jeux HTML importés exécutent du JavaScript dans l'origine du site. Importe uniquement du code que tu as écrit ou vérifié ; ne télécharge jamais un fichier de jeu non fiable. Les fichiers HTML importés sont actuellement autonomes ; les ressources supplémentaires qu'ils référencent doivent déjà être disponibles par URL.

## PayPal Sandbox

Dans les variables d'environnement Render, ajoute les identifiants **Sandbox** de ton application PayPal :

```text
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=<client id sandbox>
PAYPAL_CLIENT_SECRET=<secret sandbox>
PAYPAL_WEBHOOK_ID=<identifiant du webhook sandbox>
GAME_DATA_FILE=/var/data/gryphon-accounts.json
```

Ne colle jamais les secrets dans le code ou dans le navigateur. Le serveur crée automatiquement les plans récurrents suivants dans le compte PayPal sélectionné :

- Mensuel : **70,00 EUR par mois**
- Annuelle : **83,00 EUR par an**

Une version de tarification est enregistrée avec les identifiants de plans. Après une modification des tarifs, le serveur crée des plans à jour ; les anciens abonnements PayPal ne sont pas modifiés rétroactivement.

Dans le tableau de bord PayPal Developer correspondant au mode choisi, configure un webhook pointant vers `https://<ton-domaine>/api/paypal/webhook` et abonne-le au minimum aux événements suivants :

- `BILLING.SUBSCRIPTION.ACTIVATED`
- `BILLING.SUBSCRIPTION.CANCELLED`
- `BILLING.SUBSCRIPTION.EXPIRED`
- `BILLING.SUBSCRIPTION.SUSPENDED`
- `BILLING.SUBSCRIPTION.PAYMENT.FAILED`

Renseigne son identifiant dans `PAYPAL_WEBHOOK_ID`. Le paiement reste indisponible tant que les identifiants API et le webhook ne sont pas configurés.

## Passage en production

Après les tests Sandbox, configure une application et un webhook **Live**, puis remplace `PAYPAL_MODE` par `live`, le Client ID, le secret et l'identifiant du webhook par leurs valeurs Live. Ne réutilise pas les identifiants Sandbox.

Les sessions durent 12 heures, expirent au redémarrage du serveur et sont limitées aux abonnements actifs. L'accueil reste public.
