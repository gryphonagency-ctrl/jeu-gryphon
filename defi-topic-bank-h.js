window.DEFI_TOPIC_BANKS = window.DEFI_TOPIC_BANKS || Array.from({ length: 8 }, () => ({}));
while (window.DEFI_TOPIC_BANKS.length < 8) window.DEFI_TOPIC_BANKS.push({});
window.DEFI_TOPIC_BANKS[7] = window.DEFI_TOPIC_BANKS[7] || {};

Object.assign(window.DEFI_TOPIC_BANKS[7], {
  "Mythologies": [
    ["Quel dieu de la mythologie nordique manie le marteau Mjölnir ?", "Thor", "Odin", "Loki", "Tyr"],
    ["Quelle déesse égyptienne est l'épouse d'Osiris et la mère d'Horus ?", "Isis", "Bastet", "Sekhmet", "Néfertoum"],
    ["Quel dieu romain est associé à la guerre ?", "Mars", "Janus", "Vulcain", "Mercure"],
    ["Quel héros grec a vaincu la Gorgone Méduse ?", "Persée", "Thésée", "Achille", "Héraclès"],
    ["Quel dieu inca était associé au Soleil ?", "Inti", "Viracocha", "Pachacamac", "Supay"],
    ["Quelle divinité mésoaméricaine est représentée comme un serpent à plumes ?", "Quetzalcóatl", "Huitzilopochtli", "Tlaloc", "Tezcatlipoca"],
    ["Quel dieu hindou à tête d'éléphant est associé à la sagesse et aux nouveaux départs ?", "Ganesha", "Shiva", "Vishnou", "Indra"],
    ["Comment s'appelle le royaume des morts gouverné par Hel dans la mythologie nordique ?", "Helheim", "Asgard", "Midgard", "Jötunheim"],
    ["Quelle déesse grecque est associée aux récoltes et à l'agriculture ?", "Déméter", "Artémis", "Héra", "Aphrodite"],
    ["Quel dieu égyptien à tête de chacal est associé à l'embaumement ?", "Anubis", "Rê", "Thot", "Sobek"]
  ],
  "Architecture": [
    ["Comment appelle-t-on l'ouverture circulaire au sommet de la coupole du Panthéon de Rome ?", "L'oculus", "Le tympan", "Le triforium", "Le lanternon"],
    ["Quel élément extérieur soutient les murs des grandes églises gothiques ?", "L'arc-boutant", "Le fronton", "La colonnade dorique", "Le péristyle"],
    ["À quoi servaient principalement les pyramides royales de l'Égypte ancienne ?", "De tombeaux pour les pharaons", "De théâtres pour les cérémonies", "De marchés couverts", "De fortifications portuaires"],
    ["Quelle était la fonction initiale de Sainte-Sophie de Constantinople, inaugurée en 537 ?", "Une basilique chrétienne", "Un palais impérial romain", "Un amphithéâtre", "Un mausolée égyptien"],
    ["Quel architecte américain a conçu la maison Fallingwater, construite au-dessus d'une cascade ?", "Frank Lloyd Wright", "Frank Gehry", "Louis Sullivan", "I. M. Pei"],
    ["Quel architecte danois a conçu l'Opéra de Sydney ?", "Jørn Utzon", "Oscar Niemeyer", "Renzo Piano", "Antoni Gaudí"],
    ["Quel empereur moghol fit construire le Taj Mahal comme mausolée pour Mumtaz Mahal ?", "Shah Jahan", "Akbar", "Babur", "Aurangzeb"],
    ["À quelle déesse grecque le Parthénon d'Athènes était-il dédié ?", "Athéna", "Héra", "Déméter", "Aphrodite"],
    ["Comment nomme-t-on la pierre centrale qui bloque les claveaux d'un arc ?", "La clé de voûte", "Le chapiteau", "La corniche", "Le pilastre"],
    ["Quel style architectural se reconnaît notamment à ses arcs brisés et à ses voûtes d'ogives ?", "Le style gothique", "Le style roman", "Le style baroque", "Le style néoclassique"]
  ],
  "Théâtre": [
    ["Quel dramaturge français a écrit la comédie Le Tartuffe ?", "Molière", "Pierre Corneille", "Jean Racine", "Marivaux"],
    ["Dans quelle tragédie de Shakespeare le prince du Danemark cherche-t-il à venger son père ?", "Hamlet", "Macbeth", "Othello", "Le Roi Lear"],
    ["Dans le théâtre grec antique, quel était notamment le rôle du chœur ?", "Commenter l'action et s'adresser au public", "Changer les décors pendant les scènes", "Jouer uniquement les personnages muets", "Diriger les musiciens hors du théâtre"],
    ["Comment appelle-t-on la partie de la scène qui s'avance vers le public devant le rideau ?", "L'avant-scène", "Le poulailler", "La loge", "Le foyer"],
    ["Comment nomme-t-on un discours qu'un personnage prononce seul sur scène ?", "Un monologue", "Un aparté", "Un dialogue", "Une didascalie"],
    ["Que désigne une didascalie dans un texte de théâtre ?", "Une indication de jeu, de geste ou de mise en scène", "Une réplique dite par le chœur", "Un changement de pièce entre deux actes", "Une chanson interprétée par le public"],
    ["Quel personnage masqué de la commedia dell'arte est traditionnellement un valet vif et malicieux ?", "Arlequin", "Pantalon", "Le Capitan", "Le Docteur"],
    ["Quel théâtre londonien associé à William Shakespeare a ouvert à la fin du XVIᵉ siècle ?", "Le Globe", "Le Royal Albert Hall", "Le Coliseum", "Le Covent Garden"],
    ["Quel dramaturge grec a écrit la tragédie Médée ?", "Euripide", "Eschyle", "Aristophane", "Ménandre"],
    ["Comment appelle-t-on les espaces situés hors de la vue du public, sur les côtés ou derrière la scène ?", "Les coulisses", "Le parterre", "Le balcon", "La fosse"]
  ],
  "Drapeaux et symboles": [
    ["Quelle feuille figure au centre du drapeau du Canada ?", "Une feuille d'érable", "Une feuille de chêne", "Une feuille de bouleau", "Une feuille de palmier"],
    ["Que représente le disque rouge du drapeau japonais ?", "Le Soleil", "La Lune", "Une fleur de cerisier", "Une lanterne"],
    ["Quelle est la forme particulière du drapeau national de la Suisse ?", "Un carré", "Un triangle", "Un cercle", "Un pentagone"],
    ["Quel arbre est représenté sur le drapeau du Liban ?", "Un cèdre", "Un olivier", "Un cyprès", "Un palmier-dattier"],
    ["Quel symbole vert apparaît au centre du drapeau rouge du Maroc ?", "Une étoile à cinq branches", "Un croissant et une étoile", "Un soleil à huit rayons", "Une étoile à six branches"],
    ["Quel animal mythique figure sur le drapeau national du Bhoutan ?", "Un dragon", "Un griffon", "Un phénix", "Une licorne"],
    ["Combien d'étoiles dorées figurent sur le drapeau de l'Union européenne ?", "Douze", "Vingt-sept", "Vingt-huit", "Quinze"],
    ["Combien d'anneaux entrelacés composent le symbole olympique ?", "Cinq", "Quatre", "Six", "Sept"],
    ["Qu'est-ce qui rend le drapeau national du Népal unique parmi les drapeaux nationaux actuels ?", "Il est formé de deux pennons superposés", "Il est entièrement circulaire", "Il ne comporte aucune couleur", "Il est divisé en trois disques"],
    ["Quel animal apparaît sur les armoiries au centre du drapeau du Mexique ?", "Un aigle tenant un serpent", "Un jaguar tenant une lance", "Un condor portant une couronne", "Un puma tenant un rameau"]
  ],
  "Civilisations antiques": [
    ["Quel peuple de Mésopotamie a développé l'une des premières formes d'écriture cunéiforme ?", "Les Sumériens", "Les Hittites", "Les Phéniciens", "Les Perses"],
    ["Quel roi de Babylone est associé à un célèbre recueil de lois gravé sur une stèle ?", "Hammurabi", "Nabuchodonosor II", "Sargon d'Akkad", "Assurbanipal"],
    ["Quel peuple marchand de l'Antiquité a diffusé un alphabet autour de la Méditerranée ?", "Les Phéniciens", "Les Scythes", "Les Étrusques", "Les Huns"],
    ["Quel support fabriqué à partir d'une plante du Nil était utilisé pour écrire dans l'Égypte ancienne ?", "Le papyrus", "Le parchemin de bambou", "La soie tissée", "La tablette de cire"],
    ["Dans quelle cité grecque la démocratie directe s'est-elle développée au Ve siècle avant notre ère ?", "Athènes", "Sparte", "Corinthe", "Thèbes"],
    ["Quel site était le principal centre palatial de la civilisation minoenne en Crète ?", "Cnossos", "Mycènes", "Troie", "Delphes"],
    ["Quelle civilisation de la vallée de l'Indus avait pour grands centres Harappa et Mohenjo-daro ?", "La civilisation harappéenne", "La civilisation minoenne", "La civilisation nabatéenne", "La civilisation étrusque"],
    ["Quel souverain de la dynastie Qin est considéré comme le premier empereur ayant unifié la Chine ?", "Qin Shi Huang", "Liu Bang", "Han Wudi", "Confucius"],
    ["Quel objet à cordelettes nouées servait à enregistrer des informations dans l'Empire inca ?", "Le quipu", "Le codex", "Le sceau-cylindre", "L'ostracon"],
    ["Quelle ancienne cité était la capitale de l'Empire assyrien sous le règne de Sennachérib ?", "Ninive", "Babylone", "Persépolis", "Memphis"]
  ],
  "Photographie": [
    ["Quel dispositif optique ancien projette une image renversée et a servi de principe à la photographie ?", "La chambre noire", "Le stéréoscope", "Le périscope", "Le kaléidoscope"],
    ["À quel inventeur français attribue-t-on la plus ancienne photographie conservée, réalisée vers 1826-1827 ?", "Nicéphore Niépce", "Louis Daguerre", "Hippolyte Bayard", "Nadar"],
    ["Quel réglage de l'appareil contrôle la quantité de lumière qui entre par l'objectif ?", "L'ouverture du diaphragme", "La balance des blancs", "La correction d'exposition", "Le retardateur"],
    ["Quel réglage détermine la durée pendant laquelle le capteur ou la pellicule reçoit la lumière ?", "La vitesse d'obturation", "La focale", "La sensibilité ISO", "La balance des blancs"],
    ["Quels composés photosensibles étaient couramment utilisés dans les pellicules argentiques ?", "Des halogénures d'argent", "Des sels de cuivre", "Des cristaux de quartz", "Des oxydes de zinc"],
    ["Quel procédé photographique sur plaque métallique est associé à Louis Daguerre ?", "Le daguerréotype", "Le cyanotype", "Le calotype", "L'ambrotype"],
    ["Quelle caractéristique d'un objectif, exprimée en millimètres, influence fortement l'angle de vue ?", "La distance focale", "La vitesse d'obturation", "La sensibilité ISO", "La profondeur de couleur"],
    ["Quel composant d'un appareil photo numérique convertit la lumière en signal électronique ?", "Le capteur d'image", "Le viseur optique", "L'obturateur mécanique", "La griffe porte-accessoire"],
    ["À quoi correspond le réglage ISO d'un appareil photo numérique ?", "À la sensibilité du capteur à la lumière", "À la durée d'ouverture de l'obturateur", "À la distance focale de l'objectif", "À la taille de l'écran"],
    ["Que désigne la profondeur de champ sur une photographie ?", "La zone de l'image qui paraît suffisamment nette", "La quantité totale de lumière reçue", "La distance minimale de mise au point", "Le nombre de pixels du capteur"]
  ],
  "Inventions du quotidien": [
    ["Quel ingénieur suisse a inventé le système autoagrippant commercialisé sous le nom de Velcro ?", "George de Mestral", "Walter Hunt", "Gideon Sundback", "László Bíró"],
    ["Qui a breveté une épingle de sûreté à ressort aux États-Unis en 1849 ?", "Walter Hunt", "George de Mestral", "Josephine Cochrane", "Richard Drew"],
    ["Quel ingénieur suédois a perfectionné la fermeture à glissière moderne au début du XXᵉ siècle ?", "Gideon Sundback", "Whitcomb Judson", "Walter Hunt", "Spencer Silver"],
    ["Quel journaliste hongrois est connu pour avoir développé un stylo à bille moderne ?", "László Bíró", "George de Mestral", "Percy Spencer", "Richard Drew"],
    ["Quelle Américaine a breveté en 1886 une machine à laver la vaisselle pratique ?", "Josephine Cochrane", "Bette Nesmith Graham", "Mary Anderson", "Margaret Knight"],
    ["Quel ingénieur de 3M a mis au point le ruban adhésif transparent Scotch dans les années 1930 ?", "Richard Drew", "Spencer Silver", "Art Fry", "Percy Spencer"],
    ["Quel ingénieur de 3M a créé l'adhésif peu collant qui a rendu possibles les notes Post-it ?", "Spencer Silver", "Richard Drew", "Gideon Sundback", "Walter Hunt"],
    ["Quel ingénieur de 3M a eu l'idée d'utiliser cet adhésif repositionnable pour marquer des pages avec des notes ?", "Art Fry", "Spencer Silver", "László Bíró", "Josephine Cochrane"],
    ["Quel ingénieur américain a découvert en 1945 que des micro-ondes pouvaient chauffer des aliments, ouvrant la voie au four à micro-ondes ?", "Percy Spencer", "Richard Drew", "John Bardeen", "Clarence Birdseye"],
    ["Quels inventeurs ont obtenu en 1952 un brevet précoce pour un système de code-barres ?", "Norman Joseph Woodland et Bernard Silver", "Charles Babbage et Ada Lovelace", "John Baird et Philo Farnsworth", "Robert Noyce et Jack Kilby"]
  ]
});
