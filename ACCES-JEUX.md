# Accès aux jeux et configuration PayPal

Les pages des jeux et leur connexion WebSocket sont protégées côté serveur. Les abonnements PayPal créent automatiquement un compte après vérification par l'API PayPal. Les mots de passe des comptes créés sont stockés sous forme de hachages `scrypt`.

## Stockage durable sur Render

Pour conserver la base des comptes, les jeux importés et les autres données locales, ajoute un **Persistent Disk** à ton service Render avec le point de montage `/var/data`, puis définis :

```text
GAME_DATA_FILE=/var/data/gryphon-accounts.json
```

Si `GAME_DATA_FILE` n'est pas défini, le serveur utilise `/var/data/gryphon-accounts.json` lorsque `/var/data` est accessible en écriture. Si le disque persistant n'est pas monté ou accessible, il démarre en utilisant un stockage temporaire et affiche un avertissement explicite; comptes, accès accordés/révoqués et réglages temporaires peuvent alors être perdus au redémarrage. Configure `GAME_DATA_FILE=/var/data/gryphon-accounts.json` et monte le Persistent Disk Render sur `/var/data` pour conserver ces données après redéploiement. Si des données existent déjà, copie d'abord le fichier de comptes actuel vers le disque, sans écraser une base plus récente. Ne place pas ce fichier dans le dépôt.

Le compte administrateur unique est `gryphon.agency`. Il doit être défini avec `GAME_USERS_JSON` si le compte n'a pas encore été créé par un abonnement PayPal :

```json
{"gryphon.agency":"choisir-un-mot-de-passe-long-et-unique"}
```

Utilise un mot de passe d'au moins 12 caractères et garde cette variable secrète. Les autres comptes configurés ou abonnés n'ont aucun droit d'administration. `GAME_ADMIN_USERS` ne permet pas d'ajouter d'autres administrateurs.

## Comptes administrateurs et gestion des jeux

Seul le compte `gryphon.agency` voit le tableau de bord et peut appeler les API d'administration; les autres comptes restent sur les pages publiques et leur espace membre autorisé. Cette restriction est vérifiée côté serveur, pas seulement par masquage de l'interface. Le compte unique peut remplacer l'image d'un jeu, modifier son titre et sa description, masquer/restaurer un jeu intégré, ou importer et supprimer un jeu. Il peut également ajouter ou retirer un lien PayPal HTTPS (`paypal.com` ou `paypal.me`) depuis le panneau. Le bouton correspondant n'apparaît sur la page publique que lorsqu'un lien est enregistré; le champ vide le retire. Les vignettes par défaut sont fournies dans `images-vitrine/` et livrées avec le site. Les images personnalisées de la vitrine sont envoyées sur Cloudinary. Le disque persistant Render reste nécessaire pour la base des comptes et les fichiers des jeux importés. Chaque jeu importé doit être un fichier HTML autonome de 2 Mo maximum et avoir une image PNG, JPG ou WebP de 2 Mo maximum.

### Créateurs, TTS, accès et salons

Le panneau **Créateurs, accès, TTS et salons** réunit les comptes PayPal enregistrés, les membres créés manuellement et les identifiants définis dans `GAME_USERS_JSON`. Seul l'administrateur `gryphon.agency`, après connexion, peut utiliser l'administration et accéder sans restriction à tous les jeux. Un abonnement payé donne automatiquement accès aux jeux et au TTS pendant 30 jours pour la formule mensuelle à 7,50 €, ou 365 jours pour la formule annuelle, à compter du dernier paiement réussi. Un renouvellement payé repart de sa date de paiement; sans nouveau paiement, l'accès s'arrête automatiquement à la fin de la période. Aucun compte ordinaire ni identifiant `GAME_USERS_JSON` n'obtient de droits de jeu/TTS du seul fait de ses identifiants. Dans son espace Griffon Arcade, le membre abonné ou autorisé peut associer son pseudo TikTok, créer son propre lien/code TTS, puis activer ou désactiver la voix sur son appareil. **Ajouter un membre manuellement** crée un compte sans abonnement; l'administrateur peut lui accorder séparément les jeux et le TTS, et chaque droit accordé reste actif sans limite de durée jusqu'à sa révocation explicite. Le cadenas à côté du pseudo permet de verrouiller ou rétablir l'accès aux jeux. L'administrateur peut révoquer séparément le TTS; les révocations restent enregistrées et appliquées après déconnexion ou redémarrage. Un abonnement actif est nécessaire pour prolonger les droits d'un compte abonné; un droit accordé à un compte manuel ne dépend pas d'un abonnement. Une révocation de compte bloque également la connexion. Chaque page de jeu est contrôlée côté serveur. Les jeux intégrés et importés sont disponibles à tous les comptes auxquels l'accès aux jeux est accordé. Dans le panneau, l'administrateur voit son **salon hôte**, les membres connectés qui y sont affectés, leur jeu ouvert, leur heure d'arrivée, leur durée de présence, l'état de leur abonnement et leurs autorisations TTS/jeux. La liste se rafraîchit toutes les 10 secondes. L'administrateur peut attribuer un numéro de salon de 1 à 9999 aux comptes; son propre numéro définit le salon hôte (le salon 1 est utilisé tant qu'aucun autre numéro n'est attribué). Les numéros de salon sont des affectations de l'arcade, distinctes des identifiants de salon renvoyés par TikTok.

Le lien **Salons des hôtes** ouvre la page dédiée de gestion des salons, avec l'état de connexion de chaque compte actualisé toutes les 10 secondes. **Fermer le salon** invalide immédiatement les sessions, coupe les connexions aux jeux, bloque le TTS et révoque le lien TTS de l'hôte; son numéro de salon et ses droits attribués sont conservés pour permettre de rouvrir le salon. **Retirer de l'application** supprime le compte et ses autorisations, son numéro de salon et ses liens TTS, puis bloque toute nouvelle connexion avec cet identifiant. Pour un utilisateur défini dans `GAME_USERS_JSON`, ce blocage reste mémorisé même si le mot de passe figure toujours dans la configuration. Cette suppression locale ne résilie pas l'abonnement PayPal.

L'expiration ou la suspension PayPal ne prolonge pas la période payée : les droits d'abonné cessent au plus tard 30 jours après le dernier paiement mensuel réussi (ou 365 jours après le paiement annuel), même si l'état PayPal tarde à être mis à jour. L'administrateur peut révoquer séparément les jeux, le TTS ou tout le compte; une révocation de service reste enregistrée, y compris lors d'un renouvellement, jusqu'à ce que l'administrateur la rétablisse. Les droits des comptes créés manuellement sont indépendants des paiements et n'expirent pas. Retirer l'autorisation TTS d'un membre révoque également son lien privé et déconnecte sa source audio. Réautoriser le TTS ne recrée pas de lien : le membre devra en générer un nouveau.

Après connexion, les comptes avec un abonnement actif et sans révocation administrative voient leur espace TTS et le panneau de commande vocale. Un compte sans abonnement actif ne voit pas les contrôles TTS. Pour utiliser la voix, le membre abonné associe d'abord son pseudo TikTok en créant son lien TTS, puis clique sur **Activer la voix**. La synthèse vocale fonctionne sur l'appareil et le navigateur utilisés.

Les liens TTS sont individuels, leurs jetons ne sont stockés que sous forme d'empreinte et l'adresse complète n'est affichée qu'au moment de sa création. Le membre ne peut ni révoquer ni remplacer son lien TTS : ces actions sont réservées à l'administrateur. Une révocation administrative coupe les sources TTS et les commandes vocales actives; l'administrateur peut rétablir l'accès depuis le panneau, après quoi un abonné en période payée ou un compte manuel autorisé peut utiliser son lien. Un compte PayPal expiré ou suspendu peut toujours se connecter, mais ne peut pas utiliser les jeux ou le TTS après la fin de sa période payée, sauf s'il s'agit d'un compte créé manuellement avec les droits concernés. L'administrateur connecté conserve l'accès à ses jeux même si son compte est marqué révoqué ou que son abonnement est inactif; son mot de passe reste nécessaire pour ouvrir une session.

Les panneaux du bureau administrateur ne peuvent pas être masqués. Fais-les glisser avec le bouton **Déplacer** pour choisir leur ordre, puis clique sur **Épingler ici** pour verrouiller leur position. Clique sur **Enregistrer mon bureau** pour conserver la disposition et les épingles lors des prochaines visites. **Annuler mes changements** rétablit la dernière disposition enregistrée. Les préférences sont propres à chaque compte administrateur; les anciens panneaux masqués sont automatiquement réaffichés.

La loupe verte indique le nombre de comptes authentifiés présents dans l'application. Le tableau de présence affiche les pages de jeu ouvertes, leur durée et le salon attribué. La présence est actualisée toutes les 15 secondes et considérée terminée après 45 secondes sans signal ; les durées en cours ne sont pas conservées après le redémarrage du serveur.

Le panneau affiche aussi le nombre quotidien de comptes authentifiés distincts ayant ouvert l’accueil ou un jeu, selon le jour civil de Paris. Ce compteur est enregistré une seule fois par compte et par jour dans le stockage persistant; les journées précédentes sont conservées. Le suivi commence après le déploiement de cette fonctionnalité : les visites antérieures ne peuvent pas être reconstituées.

Les droits accordés aux comptes manuels et les révocations faites par l'administrateur sont enregistrés durablement et restent en place lors des actualisations et redémarrages. Les droits d'abonné sont calculés à partir de la date du dernier paiement réussi (30 jours au mensuel, 365 jours à l'annuel) et un renouvellement payé met à jour cette date. Sur Render, un disque persistant monté sur `/var/data` est requis pour conserver les comptes, paiements et décisions d'accès lors des redémarrages et redéploiements.

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

- Mensuel : **7,50 EUR par mois (30 jours d'accès)**
- Annuelle : **83,00 EUR par an**

Une version de tarification est enregistrée avec les identifiants de plans. Les abonnements récurrents donnent accès pendant 30 jours après le dernier paiement mensuel réussi ou 365 jours après le dernier paiement annuel réussi. Un renouvellement payé actualise la période; en l'absence de paiement, les droits expirent automatiquement à la fin de celle-ci. Après une modification des tarifs, le serveur crée des plans à jour ; les anciens abonnements PayPal ne sont pas modifiés rétroactivement.

Dans le tableau de bord PayPal Developer correspondant au mode choisi, configure un webhook pointant vers `https://<ton-domaine>/api/paypal/webhook` et abonne-le au minimum aux événements suivants :

- `BILLING.SUBSCRIPTION.ACTIVATED`
- `BILLING.SUBSCRIPTION.CANCELLED`
- `BILLING.SUBSCRIPTION.EXPIRED`
- `BILLING.SUBSCRIPTION.SUSPENDED`
- `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
- `BILLING.SUBSCRIPTION.PAYMENT.COMPLETED`
- `BILLING.SUBSCRIPTION.PAYMENT.SUCCEEDED`
- `PAYMENT.SALE.COMPLETED`

Renseigne son identifiant dans `PAYPAL_WEBHOOK_ID`. Le paiement reste indisponible tant que les identifiants API et le webhook ne sont pas configurés.

## Passage en production

Après les tests Sandbox, configure une application et un webhook **Live**, puis remplace `PAYPAL_MODE` par `live`, le Client ID, le secret et l'identifiant du webhook par leurs valeurs Live. Ne réutilise pas les identifiants Sandbox.

Les sessions durent 12 heures et expirent au redémarrage du serveur. Les membres peuvent se connecter avec des identifiants valides; l'accès aux jeux et au TTS est vérifié séparément selon l'abonnement payé ou les droits d'un compte manuel. L'accueil reste public.
