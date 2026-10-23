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

La création d'un compte manuel lui accorde initialement l'accès au TTS et à tous les jeux. L'administrateur peut ensuite régler son accès TTS et enregistrer une sélection personnalisée persistante de jeux. Les abonnements actifs bénéficient automatiquement des jeux et du TTS pendant la période payée; la sélection de jeux enregistrée permet de limiter le catalogue d'un utilisateur jusqu'à une modification administrative. Le seul compte administrateur est `gryphon.agency`; tous les autres comptes sont des comptes joueur.

Le panneau **Créateurs, accès, TTS et salons** réunit les comptes PayPal enregistrés, les membres créés manuellement et les identifiants définis dans `GAME_USERS_JSON`. Seul l'administrateur `gryphon.agency`, après connexion, peut utiliser l'administration; tous les autres comptes restent des comptes joueurs sans privilèges administratifs. Les membres manuels et les comptes `GAME_USERS_JSON` ont accès aux jeux et au TTS par défaut; l'administrateur peut révoquer ces deux accès séparément. Les abonnements payés ont obligatoirement accès aux jeux et au TTS pendant 30 jours pour la formule mensuelle à 7,50 €, ou 365 jours pour la formule annuelle, à compter du dernier paiement réussi. Un renouvellement payé repart de sa date de paiement; sans nouveau paiement, l'accès s'arrête automatiquement à la fin de la période. Pendant une période payée, l'administrateur ne peut pas révoquer les jeux, le TTS, le lien TTS ni le compte de l'abonné. Dans le tableau, tous les jeux sont sélectionnés par défaut; l'administrateur peut enregistrer une sélection précise de jeux par utilisateur, avec le nombre autorisé affiché. Une sélection explicitement enregistrée reste appliquée après les déploiements et n'inclut pas automatiquement les jeux ajoutés plus tard. Le tableau indique également la date d'expiration de la période payée. Le cadenas de réglages par membre enregistre et verrouille le pseudo TikTok, le numéro de salon, les accès aux jeux/TTS, les liens TTS et la sélection des jeux. Un verrouillage ne révoque pas les accès déjà accordés : il empêche leur modification et leur révocation tant que l'administrateur ne déverrouille pas le membre. Cet état est conservé dans le stockage des comptes après redémarrage et déploiement.

La création manuelle accorde initialement le TTS et tous les jeux. L'administrateur peut révoquer séparément le TTS ou les jeux et enregistrer une sélection personnalisée; les droits manuels persistent jusqu'à une modification administrative. Les abonnés actifs ont automatiquement les jeux et le TTS pendant leur période payée. Une sélection de jeux enregistrée reste appliquée après les déploiements et n'inclut pas automatiquement les nouveaux jeux. Les pages de jeu vérifient côté serveur l'accès global et la sélection individuelle. Dans son espace membre, un joueur TTS autorisé peut associer son pseudo TikTok, créer son lien/code privé et connecter directement la voix à son live.

Le panneau affiche le **salon hôte**, les membres qui y sont connectés, leur jeu ouvert, leur heure d'arrivée, leur durée de présence, leur abonnement et leurs autorisations. La liste se rafraîchit toutes les 10 secondes. L'administrateur attribue un numéro de salon de 1 à 9999 à un compte; son propre numéro définit le salon hôte (le salon 1 est utilisé s'il n'en a pas). Dans les tableaux des sessions actives, il peut aussi attribuer un numéro différent à une session précise; cette affectation remplace celle du compte pour cette session seulement, est conservée pendant ses heartbeats et disparaît à sa déconnexion. Effacer le champ rétablit le numéro de salon du compte. Les comptes manuels conservent leur salon sans limite de durée jusqu'à révocation; les abonnés le conservent jusqu'à expiration ou renouvellement. Le bouton **Révoquer accès salon** / **Rétablir accès salon** suspend uniquement l'accès au salon, sans modifier les jeux ni le TTS. L'expiration retire l'accès effectif même si le numéro reste enregistré; le cadenas des réglages bloque les modifications jusqu'au déverrouillage. Ces salons Arcade sont distincts des numéros TikTok. **Fermer le salon** invalide immédiatement les sessions de l'hôte, coupe les connexions aux jeux, bloque le TTS et révoque son lien; son numéro et ses droits sont conservés pour permettre de rouvrir le salon. Cette action et **Retirer de l'application** sont indisponibles pendant une période abonnée active. Après expiration, retirer le compte supprime ses droits, son numéro de salon et ses liens TTS, puis bloque ses prochaines connexions. Pour `GAME_USERS_JSON`, ce blocage local persiste même si son mot de passe reste configuré. La suppression locale ne résilie pas l'abonnement PayPal.

Le menu administrateur comporte deux pages : **Administrateur · page 1** pour la gestion des accès, du TTS et des jeux, et **Administrateur · page 2** pour les chambres et la présence en direct. La deuxième page affiche toutes les chambres actives, les membres autorisés, les connexions en cours, le jeu ouvert, l'heure de connexion ainsi que le temps écoulé sur l'arcade et dans le jeu courant. Ces données sont rafraîchies toutes les 10 secondes; le temps indiqué correspond à la session/au jeu actuellement ouvert et n'est pas un historique après déconnexion. L'administrateur peut y attribuer ou retirer un numéro de chambre sans modifier les droits de jeux ou de TTS. **Fermer le salon** invalide immédiatement les sessions, coupe les connexions aux jeux, bloque le TTS et révoque le lien TTS de l'hôte; son numéro de salon et ses droits attribués sont conservés pour permettre de rouvrir le salon. Cette action et **Retirer de l'application** sont indisponibles pour un abonné pendant sa période payée. Après cette période, retirer un compte supprime ses autorisations, son numéro de salon et ses liens TTS, puis bloque toute nouvelle connexion avec cet identifiant. Pour un utilisateur défini dans `GAME_USERS_JSON`, ce blocage reste mémorisé même si le mot de passe figure toujours dans la configuration. Cette suppression locale ne résilie pas l'abonnement PayPal.

L'expiration ou la suspension PayPal ne prolonge pas la période payée : les droits d'abonné cessent au plus tard 30 jours après le dernier paiement mensuel réussi (ou 365 jours après le paiement annuel), même si l'état PayPal tarde à être mis à jour. Les droits des comptes créés manuellement et des identifiants définis dans `GAME_USERS_JSON` sont indépendants des paiements et persistent jusqu'à révocation administrative. Pour ces comptes, retirer l'autorisation TTS révoque également leur lien privé et déconnecte leur source audio; la réautorisation ne recrée pas le lien, le membre devra en générer un nouveau.

Après connexion, les membres autorisés voient leur espace membre. Lorsque le TTS leur est accordé, ils peuvent associer leur pseudo TikTok, créer leur lien privé puis utiliser **Connecter mon TTS au live** pour démarrer la commande vocale dans leur navigateur. Si le TTS n'est pas autorisé, l'espace membre indique que l'administrateur doit d'abord rétablir ce droit. La sélection de jeux de chaque membre reste indépendante du TTS et continue d'appliquer exactement les jeux choisis par l'administrateur.

Les liens TTS sont individuels, leurs jetons ne sont stockés que sous forme d'empreinte et l'adresse complète n'est affichée qu'au moment de sa création. Le membre ne peut ni révoquer ni remplacer son lien TTS : ces actions sont réservées à l'administrateur. Pendant la période payée, l'administrateur ne peut pas révoquer le TTS d'un abonné; il peut révoquer les accès d'un compte manuel ou défini dans `GAME_USERS_JSON`, ce qui coupe ses sources TTS et commandes vocales actives. Un compte PayPal expiré ou suspendu peut toujours se connecter; ses droits d'abonné expirés cessent, mais un compte manuel ou `GAME_USERS_JSON` conserve les droits qui lui sont accordés. L'administrateur connecté conserve l'accès à ses jeux même si son compte est marqué révoqué ou que son abonnement est inactif; son mot de passe reste nécessaire pour ouvrir une session.

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
