# Accès aux jeux et configuration PayPal

Les pages des jeux et leur connexion WebSocket sont protégées côté serveur. Les abonnements PayPal créent automatiquement un compte après vérification par l'API PayPal. Les mots de passe des comptes créés sont stockés sous forme de hachages `scrypt`.

## Stockage durable sur Render

Pour conserver la base des comptes, les jeux importés et les autres données locales, ajoute un **Persistent Disk** à ton service Render avec le point de montage `/var/data`, puis définis :

```text
GAME_DATA_FILE=/var/data/gryphon-accounts.json
```

Sans disque persistant, les comptes et les identifiants de plans PayPal peuvent être perdus au prochain déploiement ou redémarrage. Ne place pas ce fichier dans le dépôt.

Le compte administrateur unique est `gryphon.agency`. Il doit être défini avec `GAME_USERS_JSON` si le compte n'a pas encore été créé par un abonnement PayPal :

```json
{"gryphon.agency":"choisir-un-mot-de-passe-long-et-unique"}
```

Utilise un mot de passe d'au moins 12 caractères et garde cette variable secrète. Les autres comptes configurés ou abonnés n'ont aucun droit d'administration. `GAME_ADMIN_USERS` ne permet pas d'ajouter d'autres administrateurs.

## Comptes administrateurs et gestion des jeux

Seul le compte `gryphon.agency` voit le tableau de bord et peut appeler les API d'administration; les autres comptes restent sur les pages publiques et leur espace membre autorisé. Cette restriction est vérifiée côté serveur, pas seulement par masquage de l'interface. Le compte unique peut remplacer l'image d'un jeu, modifier son titre et sa description, masquer/restaurer un jeu intégré, ou importer et supprimer un jeu. Il peut également ajouter ou retirer un lien PayPal HTTPS (`paypal.com` ou `paypal.me`) depuis le panneau. Le bouton correspondant n'apparaît sur la page publique que lorsqu'un lien est enregistré; le champ vide le retire. Les vignettes par défaut sont fournies dans `images-vitrine/` et livrées avec le site. Les images personnalisées de la vitrine sont envoyées sur Cloudinary. Le disque persistant Render reste nécessaire pour la base des comptes et les fichiers des jeux importés. Chaque jeu importé doit être un fichier HTML autonome de 2 Mo maximum et avoir une image PNG, JPG ou WebP de 2 Mo maximum.

### Créateurs, TTS, accès et salons

Le panneau **Créateurs, accès, TTS et salons** réunit les comptes PayPal enregistrés et les comptes définis dans `GAME_USERS_JSON`. Les jeux restent réservés aux abonnements PayPal actifs. L'administrateur dispose d'un accès TTS lié à son rôle, même sans abonnement, et peut générer son lien depuis **Mon TTS personnel** ou le panneau. Les autres comptes doivent avoir un abonnement PayPal actif et l'autorisation TTS pour créer leur propre lien. L'administrateur peut retirer ou rétablir séparément l'accès TTS d'un abonné actif dans le panneau, mais ne peut pas accorder cet accès à un compte sans abonnement actif. Pour donner un jeu, utilise le bloc **Donner un jeu à un abonné** en haut du panneau Créateurs : choisis l'abonné actif, clique **Choisir ses jeux**, coche les jeux souhaités et enregistre. Cette action active aussi l'accès aux jeux pour le compte. Le même sélecteur est disponible dans la colonne **Jeux autorisés** du tableau. Chaque page de jeu est contrôlée côté serveur. Les abonnements déjà présents sans sélection enregistrée conservent l'accès à tous les jeux; dès qu'une sélection est enregistrée, seuls les titres cochés sont accessibles. Les jeux intégrés et importés plus tard apparaissent automatiquement dans le sélecteur; un nouveau titre n'est pas ajouté à la liste autorisée d'un abonné dont l'accès a été personnalisé. Dans le panneau, l'administrateur voit son **salon hôte**, les membres connectés qui y sont affectés, leur jeu ouvert, leur heure d'arrivée, leur durée de présence, l'état de leur abonnement et leurs autorisations TTS/jeux. La liste se rafraîchit toutes les 10 secondes. L'administrateur peut attribuer un numéro de salon de 1 à 9999 aux comptes; son propre numéro définit le salon hôte (le salon 1 est utilisé tant qu'aucun autre numéro n'est attribué). Les numéros de salon sont des affectations de l'arcade, distinctes des identifiants de salon renvoyés par TikTok.

L'expiration ou la suspension PayPal invalide l'accès aux jeux et au TTS des abonnés, y compris les liens TTS déjà créés. Retirer l'autorisation TTS d'un abonné révoque également son lien privé et déconnecte sa source audio. Réautoriser le TTS ne recrée pas un lien : le créateur devra en générer un nouveau.

Les liens TTS sont individuels, leurs jetons ne sont stockés que sous forme d'empreinte et l'adresse complète n'est affichée qu'au moment de sa création. Copie-la immédiatement dans TikTok Live Studio. Une révocation coupe les sources TTS actives utilisant ce lien. Les comptes définis uniquement dans `GAME_USERS_JSON`, sans abonnement PayPal actif associé, peuvent se connecter à l'accueil mais n'ont pas accès aux jeux ni au TTS, sauf le compte configuré comme administrateur pour son TTS personnel.

Les panneaux du bureau administrateur ne peuvent pas être masqués. Fais-les glisser avec le bouton **Déplacer** pour choisir leur ordre, puis clique sur **Épingler ici** pour verrouiller leur position. Clique sur **Enregistrer mon bureau** pour conserver la disposition et les épingles lors des prochaines visites. **Annuler mes changements** rétablit la dernière disposition enregistrée. Les préférences sont propres à chaque compte administrateur; les anciens panneaux masqués sont automatiquement réaffichés.

La loupe verte indique le nombre de comptes authentifiés présents dans l'application. Le tableau de présence affiche les pages de jeu ouvertes, leur durée et le salon attribué. La présence est actualisée toutes les 15 secondes et considérée terminée après 45 secondes sans signal ; les durées en cours ne sont pas conservées après le redémarrage du serveur.

Le panneau affiche aussi le nombre quotidien de comptes authentifiés distincts ayant ouvert l’accueil ou un jeu, selon le jour civil de Paris. Ce compteur est enregistré une seule fois par compte et par jour dans le stockage persistant, puis les journées précédentes sont supprimées. Le suivi commence après le déploiement de cette fonctionnalité : les visites antérieures ne peuvent pas être reconstituées.

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
