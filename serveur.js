const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { createTikTokSession } = require('./tiktok-session');
const access = require('./access-control');
const paypal = require('./paypal');
const store = require('./account-store');
const dbSync = require('./db-sync');

const port = Number(process.env.PORT) || 3000;
const GAME_HTML_MAX_BYTES = 2 * 1024 * 1024;
const GAME_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const adminDashboardWidgetIds = [
    'creators',
    'partner-access',
    'host-room',
    'homepage-notice',
    'paypal-link',
    'live-tts',
    'live-sessions',
    'game-image',
    'game-manage',
    'game-import'
];
const configuredMaxTikTokSessions = Number(process.env.MAX_TIKTOK_SESSIONS);
const maxTikTokSessions = Number.isSafeInteger(configuredMaxTikTokSessions) &&
    configuredMaxTikTokSessions > 0 ? configuredMaxTikTokSessions : 25;
const gameFile = path.join(__dirname, 'pousoire.html');
const hangmanFile = path.join(__dirname, 'pendu.html');
const footballFile = path.join(__dirname, 'jeu-foot-tiktok.html');
const starsGameFile = path.join(__dirname, 'qui-veut-gagner-des-etoiles.html');
const footballImage = path.join(__dirname, 'ballon-foot-reel.jpg');
const coinPusherFile = path.join(__dirname, 'coin-pusher-tiktok.html');
const astraPush3dFile = path.join(__dirname, 'coin-pusher-3d-preview.html');
const coinPusherDuckFile = path.join(__dirname, 'coin-pusher-canard.html');
const coinPusher2dOldFile = path.join(__dirname, 'coin-pusher-tiktok-2d-ancien.html');
const footballV2File = path.join(__dirname, 'jeu-foot-tiktok (1).html');
const aquariumLiveFile = path.join(__dirname, 'aquarium-tiktok-live.html');
const petitTrotFile = path.join(__dirname, 'petits-chevaux-tiktok.html');
const wishLabFile = path.join(__dirname, 'wish-lab.html');
const balloonGameFile = path.join(__dirname, 'monde-du-ballon.html');
const plushGameFile = path.join(__dirname, 'peluches-mutantes.html');
const bottleGameFile = path.join(__dirname, 'bouteilles-colorees.html');
const dealGameFile = path.join(__dirname, 'a-prendre-ou-a-laisser.html');
const trueFalseGameFile = path.join(__dirname, 'vrai-ou-faux.html');
const marbleRaceGameFile = path.join(__dirname, 'course-de-billes.html');
const duckFishingGameFile = path.join(__dirname, 'peche-aux-canards.html');
const circusWheelGameFile = path.join(__dirname, 'roue-du-cirque.html');
const marbleRaceControlFile = path.join(__dirname, 'course-de-billes-controle.html');
const aquariumFishBossImage = path.join(__dirname, 'aquarium-fish-boss.png');
const sixBoxesScript = path.join(__dirname, 'gemini-code-1792321382503.js');
const gryphonPlinkoFile = path.join(__dirname, 'index.html');
const coffersGameFile = path.join(__dirname, 'index.html');
const plinkoFile = path.join(__dirname, 'plinko.html');
const gryphonImage = path.join(__dirname, 'griffon-gauche.jpg');
const gryphonSwordImage = path.join(__dirname, 'epee-fanfan-detouree.png');
const matterFile = path.join(__dirname, 'node_modules', 'matter-js', 'build', 'matter.min.js');
const homepageFile = path.join(__dirname, 'accueil.html');
const liveTtsFile = path.join(__dirname, 'live-tts.html');
const presenceScriptFile = path.join(__dirname, 'arcade-presence.js');
const arcadeStarsFile = path.join(__dirname, 'arcade-stars.js');
const protectedRoutes = new Set([
    '/pousoire.html',
    '/pendu',
    '/pendu.html',
    '/coffres',
    '/coffres.html',
    '/jeu-foot-tiktok.html',
    '/qui-veut-gagner-des-etoiles.html',
    '/inedexd.html',
    '/gemini-code-1792321382503.js',
    '/coin-pusher-tiktok.html',
    '/coin-pusher-3d-preview.html',
    '/coin-pusher-canard.html',
    '/coin-pusher-tiktok-2d-ancien.html',
    '/jeu-foot-tiktok-v2.html',
    '/aquarium-tiktok-live.html',
    '/peche-en-mer.html',
    '/course-karts.html',
    '/petits-chevaux-tiktok.html',
    '/wish-lab.html',
    '/monde-du-ballon.html',
    '/peluches-mutantes.html',
    '/machine-cadeaux.html',
    '/mots-associes.html',
    '/flipper-neon.html',
    '/bouteilles-colorees.html',
    '/a-prendre-ou-a-laisser.html',
    '/vrai-ou-faux.html',
    '/course-de-billes.html',
    '/peche-aux-canards.html',
    '/roue-du-cirque.html',
    '/course-de-billes-controle.html',
    '/gryphon-plinko',
    '/index.html',
    '/plinko.html',
    '/griffon-gauche.jpg',
    '/donut.jpg',
    '/epee-fanfan-detouree.png',
    '/aquarium-fish-boss.png',
    '/matter.min.js',
    '/node_modules/matter-js/build/matter.min.js',
    '/ballon-foot-reel.jpg'
]);
const staticGameIds = [
    '/pousoire.html',
    '/pendu.html',
    '/plinko.html',
    '/aquarium-tiktok-live.html',
    '/coin-pusher-tiktok.html',
    '/coin-pusher-3d-preview.html',
    '/coin-pusher-canard.html',
    '/jeu-foot-tiktok.html',
    '/coin-pusher-tiktok-2d-ancien.html',
    '/jeu-foot-tiktok-v2.html',
    '/qui-veut-gagner-des-etoiles.html',
    '/peche-en-mer.html',
    '/course-karts.html',
    '/petits-chevaux-tiktok.html',
    '/wish-lab.html',
    '/monde-du-ballon.html',
    '/peluches-mutantes.html',
    '/machine-cadeaux.html',
    '/mots-associes.html',
    '/flipper-neon.html',
    '/bouteilles-colorees.html',
    '/a-prendre-ou-a-laisser.html',
    '/vrai-ou-faux.html',
    '/course-de-billes.html',
    '/peche-aux-canards.html',
    '/roue-du-cirque.html',
    '/coffres',
    '/inedexd.html'
];
store.lockCreatorGamesOnce('gryphon.games', ['/pendu.html', '/plinko.html'], '/lock-gryphon.games-2026-10-27');
store.grantGameAccessToExistingCreators('/monde-du-ballon.html');
store.grantGameAccessToExistingCreators('/qui-veut-gagner-des-etoiles.html');
store.grantGameAccessToExistingCreators('/coin-pusher-3d-preview.html');
store.grantGameAccessToExistingCreators('/coin-pusher-canard.html');
store.grantGameAccessToExistingCreators('/coin-pusher-tiktok-2d-ancien.html');
store.grantGameAccessToExistingCreators('/jeu-foot-tiktok-v2.html');
store.grantGameAccessToExistingCreators('/peluches-mutantes.html');
store.grantGameAccessToExistingCreators('/machine-cadeaux.html');
store.grantGameAccessToExistingCreators('/mots-associes.html');
store.grantGameAccessToExistingCreators('/flipper-neon.html');
store.grantGameAccessToExistingCreators('/peche-en-mer.html');
store.grantGameAccessToExistingCreators('/course-karts.html');
store.grantGameAccessToExistingCreators('/bouteilles-colorees.html');
store.grantGameAccessToExistingCreators('/a-prendre-ou-a-laisser.html');
store.grantGameAccessToExistingCreators('/vrai-ou-faux.html');
store.grantGameAccessToExistingCreators('/course-de-billes.html');
store.grantGameAccessToExistingCreators('/peche-aux-canards.html');
store.grantGameAccessToExistingCreators('/roue-du-cirque.html');
const staticGameTitles = {
    '/pousoire.html': 'Table à pièces',
    '/pendu.html': 'Le Pendu',
    '/plinko.html': 'Gryphon Plinko',
    '/aquarium-tiktok-live.html': 'Aquarium Live',
    '/coin-pusher-tiktok.html': 'Coin Pusher',
    '/coin-pusher-3d-preview.html': 'Astra Push 3D',
    '/coin-pusher-canard.html': 'Queen Pusher Canard',
    '/jeu-foot-tiktok.html': 'Le Coup de Pied',
    '/coin-pusher-tiktok-2d-ancien.html': 'Coin Pusher 2D (ancien)',
    '/jeu-foot-tiktok-v2.html': 'Le Coup de Pied (v2)',
    '/qui-veut-gagner-des-etoiles.html': 'Qui veut gagner des étoiles ?',
    '/petits-chevaux-tiktok.html': 'Petit Trot',
    '/wish-lab.html': 'Wish Lab',
    '/monde-du-ballon.html': 'Le Monde du Ballon',
    '/peluches-mutantes.html': 'Le Jeu des Peluches Mutantes',
    '/machine-cadeaux.html': 'Machine à Cadeaux',
    '/mots-associes.html': 'Mots Associés',
    '/flipper-neon.html': 'Flipper Néon',
    '/peche-en-mer.html': 'Pêche en mer',
    '/course-karts.html': 'Course de karts Live',
    '/bouteilles-colorees.html': 'Le Jeu des Bouteilles Colorées',
    '/a-prendre-ou-a-laisser.html': 'À prendre ou à laisser',
    '/vrai-ou-faux.html': 'Vrai ou Faux',
    '/course-de-billes.html': 'Course de Billes',
    '/peche-aux-canards.html': 'Pêche aux Canards',
    '/roue-du-cirque.html': 'La Roue du Cirque',
    '/coffres': 'Les Coffres',
    '/inedexd.html': 'Six Boîtes'
};
const gameRouteIds = new Map([
    ['/pousoire.html', '/pousoire.html'],
    ['/pendu', '/pendu.html'],
    ['/pendu.html', '/pendu.html'],
    ['/plinko.html', '/plinko.html'],
    ['/aquarium-tiktok-live.html', '/aquarium-tiktok-live.html'],
    ['/coin-pusher-tiktok.html', '/coin-pusher-tiktok.html'],
    ['/coin-pusher-3d-preview.html', '/coin-pusher-3d-preview.html'],
    ['/coin-pusher-canard.html', '/coin-pusher-canard.html'],
    ['/jeu-foot-tiktok.html', '/jeu-foot-tiktok.html'],
    ['/coin-pusher-tiktok-2d-ancien.html', '/coin-pusher-tiktok-2d-ancien.html'],
    ['/jeu-foot-tiktok-v2.html', '/jeu-foot-tiktok-v2.html'],
    ['/qui-veut-gagner-des-etoiles.html', '/qui-veut-gagner-des-etoiles.html'],
    ['/petits-chevaux-tiktok.html', '/petits-chevaux-tiktok.html'],
    ['/monde-du-ballon.html', '/monde-du-ballon.html'],
    ['/peluches-mutantes.html', '/peluches-mutantes.html'],
    ['/machine-cadeaux.html', '/machine-cadeaux.html'],
    ['/mots-associes.html', '/mots-associes.html'],
    ['/flipper-neon.html', '/flipper-neon.html'],
    ['/peche-en-mer.html', '/peche-en-mer.html'],
    ['/course-karts.html', '/course-karts.html'],
    ['/bouteilles-colorees.html', '/bouteilles-colorees.html'],
    ['/a-prendre-ou-a-laisser.html', '/a-prendre-ou-a-laisser.html'],
    ['/vrai-ou-faux.html', '/vrai-ou-faux.html'],
    ['/course-de-billes.html', '/course-de-billes.html'],
    ['/peche-aux-canards.html', '/peche-aux-canards.html'],
    ['/roue-du-cirque.html', '/roue-du-cirque.html'],
    ['/wish-lab.html', '/wish-lab.html'],
    ['/coffres', '/coffres'],
    ['/coffres.html', '/coffres'],
    ['/gryphon-plinko', '/coffres'],
    ['/index.html', '/coffres'],
    ['/inedexd.html', '/inedexd.html']
]);
const defaultHomepageNotice = Object.freeze({
    label: 'Nouveautés de l’arcade',
    text: 'Bienvenue dans l’univers de Griffon Arcade 🐉🎮 Découvrez nos jeux déjà disponibles : de nouvelles aventures arrivent bientôt ! 🚀 Une idée de jeu à créer ensemble ? Écrivez-moi en privé sur Snapchat 💬 L’abonnement inclut aussi le TTS : faites lire gratuitement tous vos commentaires en direct et donnez vie à vos lives 🎙️✨',
    fontSize: 11,
    widthPercent: 100,
    placement: 'hero'
});
const applicationPresence = new Map();
const PRESENCE_EXPIRY_MS = 45 * 1000;

function invalidAdminInput(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function normalizePaypalLink(value) {
    const input = typeof value === 'string' ? value.trim() : '';
    if (!input) return null;
    if (input.length > 2048) throw invalidAdminInput('Le lien PayPal est trop long.');
    let url;
    try {
        url = new URL(input);
    } catch {
        throw invalidAdminInput('Saisis une adresse PayPal valide en HTTPS.');
    }
    const allowedHosts = new Set(['paypal.com', 'www.paypal.com', 'paypal.me', 'www.paypal.me']);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase()) ||
        url.username || url.password || url.pathname === '/') {
        throw invalidAdminInput('Le lien doit être une adresse HTTPS PayPal personnelle ou de paiement.');
    }
    return url.href;
}

function canUseCreatorTts(username) {
    return access.canUseCreatorService(username, 'tts');
}

function isManualAccountExpired(account, now = Date.now()) {
    if (account?.accessMode !== 'MANUAL' || account.accessExpiresAt === undefined) return false;
    const expiresAt = Date.parse(account.accessExpiresAt);
    return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function canUseCreatorRoom(username) {
    if (access.isAdminUser(username)) return true;
    const account = store.getAccount(username);
    if (isManualAccountExpired(account)) return false;
    return account?.accessMode === 'MANUAL' ||
        access.hasConfiguredUser(username) ||
        access.hasActiveSubscription(account);
}

function canManageCreatorAccess(username) {
    const account = store.getAccount(username);
    if (isManualAccountExpired(account)) return false;
    return account?.accessMode === 'MANUAL' ||
        access.hasConfiguredUser(username) ||
        access.hasActiveSubscription(account);
}

function getCreatorRoomNumber(username) {
    const settings = store.getCreatorSettings(username);
    if (!settings.roomNumber || settings.roomRevoked || store.isCreatorRemoved(username) ||
        store.isUserRevoked(username)) return null;
    return canUseCreatorRoom(username) ? settings.roomNumber : null;
}

function getGameCatalog() {
    const hiddenGames = new Set(store.getHiddenGames());
    const storedGames = store.listGames();
    const builtInGames = staticGameIds.map(id => {
        const metadata = storedGames.find(game => game.id === id && !game.uploaded);
        return {
            id,
            title: metadata?.title || staticGameTitles[id],
            href: id,
            hidden: hiddenGames.has(id),
            uploaded: false
        };
    });
    const uploadedGames = storedGames.filter(game => game.uploaded).map(game => ({
        id: game.id,
        title: game.title,
        href: `/uploaded-games/${game.id}`,
        hidden: hiddenGames.has(game.id),
        uploaded: true
    }));
    return [...builtInGames, ...uploadedGames];
}

function getPublicTikTokPlayer(player, owner) {
    return {
        playerId: player.id,
        username: player.username,
        uniqueId: player.uniqueId,
        nickname: player.nickname,
        stars: store.getWalletBalance(player, owner),
        avatarUrl: player.avatarKey ? `/api/tiktok-avatars/${player.avatarKey}` : ''
    };
}

function injectArcadeScripts(html) {
    const insertBeforeDocumentEnd = (content, script) => {
        if (/<\/body>/i.test(content)) return content.replace(/<\/body>/i, `${script}</body>`);
        if (/<\/html>/i.test(content)) return content.replace(/<\/html>/i, `${script}</html>`);
        return `${content}\n${script}`;
    };
    let content = html;
    const walletScript = '<script src="/arcade-stars.js"></script>';
    const presenceScript = '<script src="/arcade-presence.js" defer></script>';
    if (!/<script\b[^>]*src=["']\/arcade-stars\.js["']/i.test(content)) {
        content = /<head\b[^>]*>/i.test(content)
            ? content.replace(/<head\b[^>]*>/i, match => `${match}${walletScript}`)
            : insertBeforeDocumentEnd(content, walletScript);
    }
    if (!/<script\b[^>]*src=["']\/arcade-presence\.js["']/i.test(content)) {
        content = insertBeforeDocumentEnd(content, presenceScript);
    }
    return content;
}

function normalizeAdminDashboardLayout(layout) {
    if (!layout || typeof layout !== 'object' || Array.isArray(layout) ||
        ['order', 'pinned', 'hidden'].some(key =>
            !Array.isArray(layout[key]) ||
            layout[key].some(widgetId =>
                typeof widgetId !== 'string' || !adminDashboardWidgetIds.includes(widgetId)))) {
        throw invalidAdminInput('La disposition du tableau de bord est invalide.');
    }
    const order = [...new Set([...layout.order, ...adminDashboardWidgetIds])];
    return {
        order,
        pinned: [...new Set(layout.pinned)],
        hidden: []
    };
}

function getLiveTtsSource(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const providedHash = crypto.createHash('sha256').update(token).digest();
    const globalSource = store.getLiveTtsSource();
    const sources = [
        globalSource?.accountUsername ? globalSource : null,
        ...store.listAccountLiveTtsSources().map(([accountUsername, source]) => ({
            ...source,
            accountUsername
        }))
    ].filter(Boolean);
    for (const source of sources) {
        const storedHash = Buffer.from(source.tokenHash, 'hex');
        if (storedHash.length === providedHash.length &&
            crypto.timingSafeEqual(storedHash, providedHash)) {
            if (!source.accountUsername || !canUseCreatorTts(source.accountUsername)) return null;
            return source;
        }
    }
    return null;
}

function createAccountLiveTts(accountUsername, requestedUsername) {
    const username = typeof requestedUsername === 'string'
        ? requestedUsername.trim().replace(/^@/, '')
        : '';
    if (!/^[a-zA-Z0-9._]{1,32}$/.test(username)) {
        throw invalidAdminInput('Saisis un pseudo TikTok valide de 1 à 32 caractères.');
    }
    const normalizedUsername = username.toLocaleLowerCase();
    const duplicate = store.listAccountLiveTtsSources().some(([owner, source]) =>
        owner !== accountUsername.toLowerCase() &&
        source.username.toLocaleLowerCase() === normalizedUsername
    );
    const legacySource = store.getLiveTtsSource();
    if (duplicate || (legacySource?.accountUsername &&
        canUseCreatorTts(legacySource.accountUsername) &&
        legacySource.username.toLocaleLowerCase() === normalizedUsername)) {
        throw invalidAdminInput('Ce pseudo TikTok possède déjà un lien TTS actif.');
    }
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    store.saveAccountLiveTts(accountUsername, {
        username,
        tokenHash,
        createdAt: new Date().toISOString()
    });
    return { username, url: `/live-tts/${token}` };
}

function getActivePresence() {
    const cutoff = Date.now() - PRESENCE_EXPIRY_MS;
    const active = [];
    for (const [clientId, session] of applicationPresence) {
        if (session.lastSeenAt <= cutoff) {
            applicationPresence.delete(clientId);
            continue;
        }
        active.push({
            clientId,
            username: session.username,
            game: session.game,
            roomNumber: session.roomNumberOverride !== undefined
                ? session.roomNumberOverride
                : getCreatorRoomNumber(session.username),
            roomAssignmentEnabled: canUseCreatorRoom(session.username) &&
                store.getCreatorSettings(session.username).locked !== true &&
                !store.getCreatorSettings(session.username).roomRevoked &&
                !store.isCreatorRemoved(session.username) &&
                !store.isUserRevoked(session.username),
            connectedAt: session.connectedAt,
            durationSeconds: Math.floor((Date.now() - session.connectedAt) / 1000),
            gameStartedAt: session.gameStartedAt || session.connectedAt,
            gameDurationSeconds: Math.floor((Date.now() - (session.gameStartedAt || session.connectedAt)) / 1000)
        });
    }
    return active.sort((first, second) => first.connectedAt - second.connectedAt);
}

function getApplicationDate() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function listCreatorAccounts() {
    const creators = new Map(access.listConfiguredUsers()
        .filter(username => !store.isCreatorRemoved(username))
        .map(username => [username, null]));
    for (const [username, account] of store.listAccounts()) {
        if (!store.isCreatorRemoved(username)) creators.set(username, account);
    }
    return [...creators.entries()].map(([username, account]) => {
        const source = store.getAccountLiveTts(username);
        const settings = store.getCreatorSettings(username);
        const manualAccount = account?.accessMode === 'MANUAL';
        const managedPlayer = manualAccount || access.hasConfiguredUser(username);
        const subscriptionActive = access.hasActiveSubscription(account);
        const paidAt = Date.parse(account?.lastPaymentAt || account?.createdAt || '');
        const subscriptionExpiresAt = account?.subscriptionId && Number.isFinite(paidAt)
            ? new Date(paidAt + (account.plan === 'annuel' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString()
            : null;
        const accessExpiresAt = manualAccount && Number.isFinite(Date.parse(account.accessExpiresAt || ''))
            ? account.accessExpiresAt
            : null;
        return {
            username,
            subscriptionStatus: account?.status === 'ACTIVE' && !subscriptionActive
                ? 'EXPIRED'
                : account?.status || 'MANUEL',
            plan: account?.plan || null,
            hasSubscription: Boolean(account?.subscriptionId),
            subscriptionActive,
            subscriptionExpiresAt,
            accessExpiresAt,
            accessDurationDays: manualAccount && Number.isSafeInteger(account.durationDays)
                ? account.durationDays
                : null,
            protectedAdmin: access.isAdminUser(username),
            accessEnabled: access.isAdminUser(username) ||
                (!store.isUserRevoked(username) &&
                    (access.canUseCreatorService(username, 'games') || canUseCreatorTts(username))),
            roomClosed: store.isUserRevoked(username),
            gamesAccessEnabled: access.canUseCreatorService(username, 'games'),
            manualAccount,
            managedPlayer,
            ttsAccessEnabled: canUseCreatorTts(username),
            ttsActive: Boolean(source),
            ttsUsername: source?.username || settings.tiktokUsername || null,
            gameAccess: store.getCreatorGameAccess(username),
            settingsLocked: settings.locked === true,
            roomNumber: getCreatorRoomNumber(username),
            assignedRoomNumber: settings.roomNumber || null,
            roomEligible: canUseCreatorRoom(username),
            roomRevoked: settings.roomRevoked === true,
            roomAccessEnabled: Boolean(getCreatorRoomNumber(username))
        };
    }).sort((first, second) => first.username.localeCompare(second.username));
}

function cloudinaryConfigurationError() {
    const error = new Error('Configure CLOUDINARY_URL, ou CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY et CLOUDINARY_API_SECRET, dans Render pour enregistrer les images.');
    error.statusCode = 503;
    return error;
}

function getCloudinaryCredentials() {
    if (process.env.CLOUDINARY_URL) {
        try {
            const url = new URL(process.env.CLOUDINARY_URL);
            const credentials = {
                cloudName: url.hostname,
                apiKey: decodeURIComponent(url.username),
                apiSecret: decodeURIComponent(url.password)
            };
            if (url.protocol !== 'cloudinary:' ||
                !/^[a-zA-Z0-9_-]+$/.test(credentials.cloudName) ||
                !/^\d+$/.test(credentials.apiKey) ||
                !credentials.apiSecret ||
                (url.pathname !== '' && url.pathname !== '/')) {
                throw cloudinaryConfigurationError();
            }
            return credentials;
        } catch (error) {
            if (error.statusCode === 503) throw error;
            throw cloudinaryConfigurationError();
        }
    }

    return {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET
    };
}

function cloudinaryImageUrl(imageUrl) {
    if (typeof imageUrl !== 'string') return false;
    try {
        const url = new URL(imageUrl);
        const cloudName = getCloudinaryCredentials().cloudName;
        return url.protocol === 'https:' &&
            url.hostname === 'res.cloudinary.com' &&
            /^\/[a-zA-Z0-9_-]+\/image\/upload\//.test(url.pathname) &&
            (!cloudName || url.pathname.startsWith(`/${cloudName}/image/upload/`));
    } catch {
        return false;
    }
}

async function uploadGameImageToCloudinary(gameId, image) {
    const { cloudName, apiKey, apiSecret } = getCloudinaryCredentials();
    if (!cloudName || !apiKey || !apiSecret ||
        !/^[a-zA-Z0-9_-]+$/.test(cloudName) ||
        !/^\d+$/.test(apiKey)) {
        throw cloudinaryConfigurationError();
    }

    const publicId = `gryphon-arcade-${crypto.createHash('sha256').update(gameId).digest('hex')}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const parameters = { overwrite: 'true', public_id: publicId, timestamp };
    const signedParameters = Object.keys(parameters).sort()
        .map(key => `${key}=${parameters[key]}`).join('&');
    const signature = crypto.createHash('sha1')
        .update(`${signedParameters}${apiSecret}`)
        .digest('hex');
    const form = new FormData();
    form.set('file', new Blob([image.buffer], { type: `image/${image.extension === 'jpg' ? 'jpeg' : image.extension}` }), `vitrine.${image.extension}`);
    form.set('api_key', apiKey);
    form.set('overwrite', 'true');
    form.set('public_id', publicId);
    form.set('timestamp', timestamp);
    form.set('signature', signature);

    let response;
    try {
        response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(30000)
        });
    } catch {
        const uploadError = new Error('Cloudinary est inaccessible. Vérifie la connexion et réessaie.');
        uploadError.statusCode = 502;
        throw uploadError;
    }

    let result;
    try {
        result = await response.json();
    } catch {
        const uploadError = new Error('Cloudinary a renvoyé une réponse illisible. Réessaie plus tard.');
        uploadError.statusCode = 502;
        throw uploadError;
    }
    if (!response.ok) {
        const uploadError = new Error('Cloudinary a refusé l’image. Vérifie les identifiants et le quota du compte.');
        uploadError.statusCode = 502;
        throw uploadError;
    }
    if (!result || typeof result !== 'object' ||
        !cloudinaryImageUrl(result.secure_url) || result.public_id !== publicId) {
        const uploadError = new Error('Cloudinary a renvoyé une adresse d’image invalide.');
        uploadError.statusCode = 502;
        throw uploadError;
    }
    return { url: result.secure_url, publicId: result.public_id };
}

function cloudinaryAvatarId(avatarKey) {
    return `tiktok-avatar-${avatarKey}`;
}

function cloudinaryAvatarCredentials() {
    try {
        const { cloudName, apiKey, apiSecret } = getCloudinaryCredentials();
        if (cloudName && apiKey && apiSecret &&
            /^[a-zA-Z0-9_-]+$/.test(cloudName) && /^\d+$/.test(apiKey)) {
            return { cloudName, apiKey, apiSecret };
        }
    } catch {
        // Cloudinary non configuré : les avatars restent sur le disque local.
    }
    return null;
}

async function uploadAvatarToCloudinary(avatarKey, image, contentType) {
    const credentials = cloudinaryAvatarCredentials();
    if (!credentials) return;
    const { cloudName, apiKey, apiSecret } = credentials;
    const publicId = cloudinaryAvatarId(avatarKey);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHash('sha1')
        .update(`overwrite=true&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
        .digest('hex');
    const form = new FormData();
    form.set('file', new Blob([image], { type: contentType }), `${avatarKey}.img`);
    form.set('api_key', apiKey);
    form.set('overwrite', 'true');
    form.set('public_id', publicId);
    form.set('timestamp', timestamp);
    form.set('signature', signature);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Cloudinary a répondu ${response.status}.`);
}

async function downloadAvatarFromCloudinary(avatarKey) {
    const credentials = cloudinaryAvatarCredentials();
    if (!credentials) return null;
    const response = await fetch(
        `https://res.cloudinary.com/${credentials.cloudName}/image/upload/${cloudinaryAvatarId(avatarKey)}`,
        { signal: AbortSignal.timeout(15000) }
    );
    if (!response.ok) return null;
    const content = Buffer.from(await response.arrayBuffer());
    return content.length > 0 && content.length <= 2 * 1024 * 1024 ? content : null;
}

function decodeGameImage(dataUrl) {
    if (typeof dataUrl !== 'string') throw invalidAdminInput('Choisis une image PNG, JPG ou WebP.');
    const match = /^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) throw invalidAdminInput('Seules les images PNG, JPG et WebP sont acceptées.');
    const image = Buffer.from(match[2], 'base64');
    if (!image.length || image.length > GAME_IMAGE_MAX_BYTES) {
        throw invalidAdminInput('L’image doit faire 2 Mo maximum.');
    }
    const isPng = match[1] === 'png' && image.subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );
    const isJpeg = match[1] === 'jpeg' && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    const isWebp = match[1] === 'webp' &&
        image.toString('ascii', 0, 4) === 'RIFF' &&
        image.toString('ascii', 8, 12) === 'WEBP';
    if (!isPng && !isJpeg && !isWebp) {
        throw invalidAdminInput('Le contenu du fichier ne correspond pas à son format d’image.');
    }
    return { buffer: image, extension: match[1] === 'jpeg' ? 'jpg' : match[1] };
}

async function saveAdminGame(body) {
    if (!body || typeof body !== 'object') throw invalidAdminInput('Données de jeu invalides.');
    if (body.action === 'homepage-notice') {
        const label = typeof body.label === 'string' ? body.label.trim() : '';
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        const fontSize = body.fontSize;
        const widthPercent = body.widthPercent;
        const placement = body.placement;
        if (!label || label.length > 50) throw invalidAdminInput('Le titre du message doit contenir de 1 à 50 caractères.');
        if (!text || text.length > 800) throw invalidAdminInput('Le texte doit contenir de 1 à 800 caractères.');
        if (!Number.isInteger(fontSize) || fontSize < 11 || fontSize > 26) {
            throw invalidAdminInput('La taille du texte doit être comprise entre 11 et 26 pixels.');
        }
        if (!Number.isInteger(widthPercent) || widthPercent < 40 || widthPercent > 120) {
            throw invalidAdminInput('La largeur du message doit être comprise entre 40 et 120 %.');
        }
        if (body.fontSizeDoubled !== undefined && typeof body.fontSizeDoubled !== 'boolean') {
            throw invalidAdminInput('Le réglage de taille doublée est invalide.');
        }
        if (!['hero', 'games-before', 'games-after'].includes(placement)) {
            throw invalidAdminInput('Choisis un emplacement valide pour le message.');
        }
        const settings = {
            label,
            text,
            fontSize,
            fontSizeDoubled: body.fontSizeDoubled === true,
            widthPercent,
            placement
        };
        store.saveHomepageNotice(settings);
        return { success: true, settings };
    }
    if (body.action === 'image') {
        const gameId = typeof body.gameId === 'string' ? body.gameId : '';
        if (gameId === '/petits-chevaux-tiktok.html') {
            throw invalidAdminInput('L’image de Petit Trot est fixe et ne peut pas être personnalisée.');
        }
        if (!staticGameIds.includes(gameId) &&
            !store.listGames().some(game => game.id === gameId && game.uploaded)) {
            throw invalidAdminInput('Jeu à personnaliser introuvable.');
        }
        const image = decodeGameImage(body.image);
        const uploadedImage = await uploadGameImageToCloudinary(gameId, image);
        store.saveCloudinaryGameImage(gameId, uploadedImage);
        return { success: true, gameId, image: uploadedImage.url };
    }
    if (body.action === 'metadata') {
        const gameId = typeof body.gameId === 'string' ? body.gameId : '';
        if (!staticGameIds.includes(gameId) &&
            !store.listGames().some(game => game.id === gameId && game.uploaded)) {
            throw invalidAdminInput('Jeu introuvable.');
        }
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const description = typeof body.description === 'string' ? body.description.trim() : '';
        if (!title || title.length > 80) throw invalidAdminInput('Le titre doit contenir de 1 à 80 caractères.');
        if (!description || description.length > 240) throw invalidAdminInput('La description doit contenir de 1 à 240 caractères.');
        store.saveGameMetadata(gameId, { title, description });
        return { success: true, gameId, title, description };
    }
    if (body.action === 'visibility' || body.action === 'delete') {
        const gameId = typeof body.gameId === 'string' ? body.gameId : '';
        if (staticGameIds.includes(gameId)) {
            if (body.action === 'delete') throw invalidAdminInput('Les jeux intégrés peuvent être masqués, pas supprimés du serveur.');
            store.setGameHidden(gameId, body.hidden === true);
            return { success: true, gameId, hidden: body.hidden === true };
        }
        const game = store.listGames().find(item => item.id === gameId && item.uploaded);
        if (!game || !/^[a-f0-9-]{36}$/.test(game.id)) throw invalidAdminInput('Jeu importé introuvable.');
        if (body.action === 'visibility') {
            store.setGameHidden(gameId, body.hidden === true);
            return { success: true, gameId, hidden: body.hidden === true };
        }
        const removedGame = store.deleteGame(gameId);
        if (!removedGame) throw invalidAdminInput('Impossible de supprimer ce jeu.');
        for (const filename of [removedGame.html, removedGame.image]) {
            if (!/^[a-f0-9-]{36}\.(?:html|png|jpe?g|webp)$/.test(filename)) {
                throw new Error('Stored game file has an invalid filename.');
            }
            try {
                fs.unlinkSync(path.join(store.getGameFilesDirectory(), filename));
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            dbSync.deleteFile(filename);
        }
        return { success: true, gameId, deleted: true };
    }
    if (body.action !== 'import') throw invalidAdminInput('Action d’administration inconnue.');

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const html = typeof body.html === 'string' ? body.html : '';
    if (!title || title.length > 80) throw invalidAdminInput('Le titre doit contenir de 1 à 80 caractères.');
    if (!description || description.length > 240) throw invalidAdminInput('La description doit contenir de 1 à 240 caractères.');
    const htmlBytes = Buffer.byteLength(html, 'utf8');
    if (!htmlBytes || htmlBytes > GAME_HTML_MAX_BYTES) {
        throw invalidAdminInput('Le fichier HTML doit faire 2 Mo maximum.');
    }
    if (!/^\s*(?:<!doctype\s+html\b|<html\b)/i.test(html)) {
        throw invalidAdminInput('Le fichier doit être une page HTML complète, avec <!doctype html> ou <html>.');
    }
    const image = decodeGameImage(body.image);
    const id = crypto.randomUUID();
    const directory = store.getGameFilesDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const htmlFile = `${id}.html`;
    const imageFile = `${id}.${image.extension}`;
    fs.writeFileSync(path.join(directory, htmlFile), html, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(directory, imageFile), image.buffer, { flag: 'wx', mode: 0o600 });
    dbSync.pushFile(htmlFile, Buffer.from(html, 'utf8'));
    dbSync.pushFile(imageFile, image.buffer);
    const game = {
        id,
        title,
        description,
        html: htmlFile,
        image: imageFile,
        uploaded: true,
        createdAt: new Date().toISOString()
    };
    store.saveGame(game);
    return { success: true, game: { id, title, description, href: `/uploaded-games/${id}`, image: `/game-assets/${imageFile}` } };
}

const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const avatarMatch = pathname.match(/^\/api\/tiktok-avatars\/([a-f0-9]{64})$/);
    if (avatarMatch && req.method === 'GET') {
        if (!access.canAccessGames(req)) {
            res.writeHead(401, { 'Cache-Control': 'no-store' });
            res.end();
            return;
        }
        const player = Object.values(store.listTikTokPlayers())
            .find(item => item.avatarKey === avatarMatch[1]);
        if (!player) {
            res.writeHead(404, { 'Cache-Control': 'no-store' });
            res.end();
            return;
        }
        const avatarPath = store.getTikTokAvatarPath(avatarMatch[1]);
        if (!avatarPath) {
            downloadAvatarFromCloudinary(avatarMatch[1]).then(content => {
                if (!content) {
                    res.writeHead(404, { 'Cache-Control': 'no-store' });
                    res.end();
                    return;
                }
                res.writeHead(200, {
                    'Cache-Control': 'private, max-age=86400',
                    'Content-Type': player.avatarType,
                    'X-Content-Type-Options': 'nosniff'
                });
                res.end(content);
            }).catch(() => {
                res.writeHead(404, { 'Cache-Control': 'no-store' });
                res.end();
            });
            return;
        }
        res.writeHead(200, {
            'Cache-Control': 'private, max-age=86400',
            'Content-Type': player.avatarType,
            'X-Content-Type-Options': 'nosniff'
        });
        fs.createReadStream(avatarPath).pipe(res);
        return;
    }
    if (pathname === '/api/tiktok-stars/leaderboard' && req.method === 'GET') {
        if (!access.isAuthenticated(req)) {
            res.writeHead(401, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Connexion à l’arcade requise.' }));
            return;
        }
        const query = new URL(req.url, 'http://localhost').searchParams;
        try {
            if (query.get('scope') === 'wallet') {
                // Portefeuille propre au compte connecté : jamais les soldes d'un autre compte.
                if (!access.canAccessGames(req)) {
                    res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ message: 'Accès aux jeux requis.' }));
                    return;
                }
                const players = store.listTikTokStarLeaderboard(access.usernameForRequest(req))
                    .filter(player => player.totalEarned > 0 || player.totalSpent > 0 || player.balance > 0);
                res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ scope: 'wallet', players }));
                return;
            }
            if (query.get('scope') === 'total') {
                if (!access.isAdmin(req)) {
                    res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ message: 'Le total des étoiles est réservé à l’administrateur.' }));
                    return;
                }
                const players = store.listTikTokStarLeaderboard();
                res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    scope: 'total',
                    totalOwed: players.reduce((sum, player) => sum + Math.max(0, Number(player.balance) || 0), 0),
                    playerCount: players.filter(player => player.balance > 0).length
                }));
                return;
            }
            if (query.get('scope') === 'all') {
                if (!access.isAdmin(req)) {
                    res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ message: 'Le classement complet est réservé à l’administrateur.' }));
                    return;
                }
                const players = store.listTikTokStarLeaderboard();
                res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ scope: 'all', players }));
                return;
            }
            const player = store.getTikTokStarSummaryForAccount(access.usernameForRequest(req));
            res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ scope: 'self', player }));
        } catch (error) {
            console.error('Impossible de calculer le récapitulatif personnel des étoiles :', error.message);
            res.writeHead(500, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Impossible de calculer le récapitulatif des étoiles.' }));
        }
        return;
    }
    if (pathname === '/api/tiktok-stars/leaderboard/import' && req.method === 'POST') {
        if (!access.isAuthenticated(req) || !access.isAdmin(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'L’import du classement est réservé à l’administrateur.' }));
            return;
        }
        readJsonBody(req, res, body => {
            try {
                const result = store.importTikTokStarLeaderboard(body);
                res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    updatedPlayers: result.updatedPlayers,
                    message: `Classement importé. ${result.updatedPlayers} correction(s) appliquée(s).`
                }));
            } catch (error) {
                res.writeHead(400, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ message: error.message || 'Fichier de classement invalide.' }));
            }
        }, 1024 * 1024);
        return;
    }
    if (pathname === '/api/wallet/import' && req.method === 'POST') {
        if (!access.isAuthenticated(req) || !access.canAccessGames(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Connexion à l’arcade requise.' }));
            return;
        }
        const walletOwner = access.usernameForRequest(req).toLowerCase();
        readJsonBody(req, res, body => {
            const send = (status, payload) => {
                res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(payload));
            };
            if (!body || body.format !== 'gryphon-wallet' || body.version !== 1 || !Array.isArray(body.players)) {
                return send(400, { message: 'Ce fichier n’est pas une sauvegarde de portefeuille compatible.' });
            }
            if (body.players.length > 5000) return send(400, { message: 'Trop de joueurs dans ce fichier.' });
            // Seul le portefeuille du compte connecté est modifié, jamais celui d'un autre compte.
            let updated = 0;
            let skipped = 0;
            for (const entry of body.players) {
                const handle = String(entry?.username || '').trim().replace(/^@/, '').toLowerCase();
                const target = Number(entry?.balance);
                if (!/^[a-z0-9._]{1,32}$/.test(handle) || !Number.isSafeInteger(target) || target < 0 || target > 10000000) {
                    skipped += 1;
                    continue;
                }
                let player = store.resolveTikTokPlayer(handle);
                if (!player) {
                    if (target === 0) continue;
                    store.creditBrowserStars({ username: handle, amount: target, gameId: '/import-portefeuille', transactionId: `import:${crypto.randomUUID()}`, owner: walletOwner });
                    updated += 1;
                    continue;
                }
                const delta = target - store.getWalletBalance(player, walletOwner);
                if (delta === 0) continue;
                const result = store.applyTikTokStarTransaction({
                    transactionId: `import:${crypto.randomUUID()}`,
                    playerId: player.id,
                    delta,
                    gameId: '/import-portefeuille',
                    reason: delta > 0 ? 'game-reward' : 'run',
                    owner: walletOwner
                });
                if (result.applied) updated += 1; else skipped += 1;
            }
            send(200, { success: true, updated, skipped, message: `Portefeuille importé : ${updated} solde(s) mis à jour${skipped ? `, ${skipped} ignoré(s)` : ''}.` });
        }, 1024 * 1024);
        return;
    }
    if (pathname === '/api/admin/stars-restore' && req.method === 'POST') {
        if (!access.isAuthenticated(req) || !access.isAdmin(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Réservé à l’administrateur.' }));
            return;
        }
        readJsonBody(req, res, body => {
            // Complète seulement : un solde n'est jamais abaissé, et les joueurs absents sont recréés.
            const players = Array.isArray(body.players) ? body.players.slice(0, 5000) : [];
            let restored = 0;
            let added = 0;
            for (const entry of players) {
                const target = Number(entry?.balance);
                if (!Number.isSafeInteger(target) || target < 1) continue;
                const handle = String(entry.username || '').trim().replace(/^@/, '').toLowerCase();
                const current = store.resolveTikTokPlayer(handle);
                const missing = target - (current ? current.stars : 0);
                if (missing < 1) continue;
                const result = store.creditBrowserStars({
                    username: handle,
                    amount: missing,
                    gameId: '/restauration-navigateur',
                    transactionId: `restore:${crypto.randomUUID()}`
                });
                if (result.applied) { restored += 1; added += missing; }
            }
            res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ restored, added }));
        }, 1024 * 1024);
        return;
    }
    if (pathname === '/api/admin/stars-adjust' && req.method === 'POST') {
        // Chaque membre règle uniquement les dettes de son propre portefeuille ; l'administrateur règle le sien.
        if (!access.isAuthenticated(req) || !access.canAccessGames(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Connexion à l’arcade requise.' }));
            return;
        }
        const walletOwner = access.usernameForRequest(req).toLowerCase();
        readJsonBody(req, res, body => {
            const send = (status, payload) => {
                res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(payload));
            };
            const handle = String(body.username || '').trim().replace(/^@/, '').toLowerCase();
            const target = Number(body.balance);
            if (!/^[a-z0-9._]{1,32}$/.test(handle)) return send(400, { message: 'Pseudo invalide.' });
            if (!Number.isSafeInteger(target) || target < 0 || target > 10000000) return send(400, { message: 'Solde invalide.' });
            let player = store.resolveTikTokPlayer(handle);
            if (!player) {
                if (target === 0) return send(200, { balance: 0, changed: false });
                store.creditBrowserStars({ username: handle, amount: target, gameId: '/ajustement-admin', transactionId: `adjust:${crypto.randomUUID()}`, owner: walletOwner });
                player = store.resolveTikTokPlayer(handle);
                return send(200, { balance: store.getWalletBalance(player, walletOwner), changed: true });
            }
            const current = store.getWalletBalance(player, walletOwner);
            const delta = target - current;
            if (delta === 0) return send(200, { balance: current, changed: false });
            const result = store.applyTikTokStarTransaction({
                transactionId: `adjust:${crypto.randomUUID()}`,
                playerId: player.id,
                delta,
                gameId: '/ajustement-admin',
                reason: delta > 0 ? 'game-reward' : 'run',
                owner: walletOwner
            });
            send(result.applied ? 200 : 409, { balance: result.balance, changed: result.applied });
        }, 4096);
        return;
    }
    if (pathname === '/api/admin/stars-collect' && req.method === 'POST') {
        if (!access.isAuthenticated(req) || !access.canAccessGames(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Connexion à l’arcade requise.' }));
            return;
        }
        const walletOwner = access.usernameForRequest(req).toLowerCase();
        readJsonBody(req, res, body => {
            const entries = Array.isArray(body.entries) ? body.entries.slice(0, 5000) : [];
            let applied = 0;
            let skipped = 0;
            let total = 0;
            const results = [];
            for (const entry of entries) {
                const amount = Number(entry?.amount);
                const gameId = typeof entry?.gameId === 'string' ? entry.gameId : '';
                const transactionId = typeof entry?.transactionId === 'string' ? entry.transactionId : '';
                if (!Number.isSafeInteger(amount) || amount < 1 || amount > 250000 ||
                    !/^\/[a-zA-Z0-9._/-]{1,100}$/.test(gameId) ||
                    !/^[a-zA-Z0-9._:-]{1,128}$/.test(transactionId)) {
                    skipped += 1;
                    results.push(false);
                    continue;
                }
                const result = store.creditBrowserStars({ username: entry.username, amount, gameId, transactionId, absolute: entry.absolute === true, owner: walletOwner });
                if (result.applied) { applied += 1; total += amount; } else { skipped += 1; }
                results.push(Boolean(result.applied));
            }
            res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ applied, skipped, total, results }));
        }, 1024 * 1024);
        return;
    }
    if (pathname === '/api/tiktok-stars' && req.method === 'GET') {
        if (!access.canAccessGames(req)) {
            res.writeHead(401, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Connexion à l’arcade requise.' }));
            return;
        }
        const player = store.resolveTikTokPlayer(
            new URL(req.url, 'http://localhost').searchParams.get('player')
        );
        if (!player) {
            res.writeHead(404, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Profil TikTok introuvable sur un live connecté.' }));
            return;
        }
        res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ player: getPublicTikTokPlayer(player, access.usernameForRequest(req)) }));
        return;
    }
    if (pathname === '/api/tiktok-stars' && req.method === 'POST') {
        if (!access.canAccessGames(req)) {
            res.writeHead(401, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Connexion à l’arcade requise.' }));
            return;
        }
        readJsonBody(req, res, body => {
            const gameId = typeof body.gameId === 'string' ? body.gameId : '';
            const uploadedGameMatch = gameId.match(/^\/uploaded-games\/([a-f0-9-]{36})$/i);
            const canonicalGameId = gameRouteIds.get(gameId) || uploadedGameMatch?.[1] || gameId;
            if (body.action !== 'award' ||
                !/^(?:\/[a-zA-Z0-9._/-]{1,100}|[a-f0-9-]{36})$/.test(canonicalGameId) ||
                !access.canAccessGames(req, canonicalGameId)) {
                res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ message: 'Récompense non autorisée pour ce jeu.' }));
                return;
            }
            const amount = Number(body.amount);
            const transactionId = typeof body.transactionId === 'string' ? body.transactionId : '';
            if (!Number.isSafeInteger(amount) || amount < 1 || amount > 250000 ||
                !/^[a-zA-Z0-9._:-]{1,128}$/.test(transactionId)) {
                res.writeHead(400, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ message: 'Récompense invalide.' }));
                return;
            }
            const player = store.resolveTikTokPlayer(body.playerId || body.username);
            const accountName = access.usernameForRequest(req).toLowerCase();
            const appearedOnOwnerLive = player && [...sessions.values()].some(session =>
                session.isLive &&
                session.seenPlayerIds?.has(player.id) &&
                [...session.clients].some(client =>
                    authenticatedClientUsernames.get(client)?.toLowerCase() === accountName));
            if (!appearedOnOwnerLive && access.isAdmin(req)) {
                const credit = store.creditBrowserStars({
                    username: body.username || body.playerId,
                    amount,
                    gameId: canonicalGameId,
                    transactionId,
                    owner: accountName
                });
                const creditedPlayer = store.resolveTikTokPlayer(body.username || body.playerId);
                if (credit.skipped || !creditedPlayer || (!credit.applied && !credit.duplicate)) {
                    res.writeHead(404, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ message: 'Pseudo TikTok non valide pour le portefeuille.' }));
                    return;
                }
                res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ applied: credit.applied, duplicate: credit.duplicate, player: getPublicTikTokPlayer(creditedPlayer, accountName) }));
                return;
            }
            if (!appearedOnOwnerLive) {
                res.writeHead(404, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ message: 'Le joueur doit apparaître sur un live TikTok connecté avant de recevoir des étoiles.' }));
                return;
            }
            const result = store.applyTikTokStarTransaction({
                transactionId,
                playerId: player.id,
                delta: amount,
                gameId: canonicalGameId,
                reason: 'game-reward',
                owner: accountName
            });
            if (!result.applied && !result.duplicate) {
                res.writeHead(409, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ message: 'La récompense n’a pas pu être enregistrée.' }));
                return;
            }
            const updatedPlayer = store.resolveTikTokPlayer(player.id);
            const publicPlayer = getPublicTikTokPlayer(updatedPlayer, accountName);
            for (const session of sessions.values()) {
                const ownedByAccount = [...session.clients].some(client =>
                    authenticatedClientUsernames.get(client)?.toLowerCase() === accountName);
                if (ownedByAccount) {
                    broadcastSessionMessage(session, {
                        type: 'WALLET_BALANCE',
                        player: publicPlayer
                    });
                }
            }
            res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                applied: result.applied,
                duplicate: result.duplicate,
                player: publicPlayer
            }));
        });
        return;
    }
    if (pathname === '/api/session' && req.method === 'GET') {
        const authenticated = access.isAuthenticated(req);
        const username = authenticated ? access.usernameForRequest(req) : '';
        const account = username ? store.getAccount(username) : null;
        const creatorTts = username ? store.getAccountLiveTts(username) : null;
        res.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8'
        });
        res.end(JSON.stringify({
            authenticated,
            configured: access.hasUsers,
            isAdmin: access.isAdmin(req),
            username,
            hasSubscription: access.hasActiveSubscription(account),
            canUseTts: canUseCreatorTts(username),
            canAccessGames: access.canAccessGames(req),
            creatorTts: creatorTts
                ? { active: true, username: creatorTts.username }
                : { active: false, username: null },
            roomNumber: username ? getCreatorRoomNumber(username) : null
        }));
        return;
    }
    if (pathname === '/api/presence' && req.method === 'POST') {
        if (!access.isAuthenticated(req)) {
            res.writeHead(401, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Connexion requise.' }));
            return;
        }
        readJsonBody(req, res, body => {
            const clientId = typeof body.clientId === 'string' ? body.clientId : '';
            if (!/^[a-f0-9-]{36}$/i.test(clientId) ||
                (body.action !== 'heartbeat' && body.action !== 'leave')) {
                res.writeHead(400, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ message: 'Signal de présence invalide.' }));
                return;
            }
            const username = access.usernameForRequest(req);
            store.recordDailyUsage(username, getApplicationDate());
            if (body.action === 'leave') {
                if (applicationPresence.get(clientId)?.username === username) {
                    applicationPresence.delete(clientId);
                }
            } else {
                const game = typeof body.game === 'string' &&
                    /^\/[a-zA-Z0-9._/-]{1,100}$/.test(body.game)
                    ? body.game
                    : '/';
                const existing = applicationPresence.get(clientId);
                applicationPresence.set(clientId, {
                    username,
                    game,
                    connectedAt: existing?.username === username ? existing.connectedAt : Date.now(),
                    gameStartedAt: existing?.username === username && existing.game === game
                        ? existing.gameStartedAt || existing.connectedAt
                        : Date.now(),
                    ...(existing?.username === username && existing.roomNumberOverride !== undefined
                        ? { roomNumberOverride: existing.roomNumberOverride }
                        : {}),
                    lastSeenAt: Date.now()
                });
            }
            res.writeHead(204, { 'Cache-Control': 'no-store' });
            res.end();
        });
        return;
    }
    if (pathname === '/api/account/live-tts' &&
        (req.method === 'GET' || req.method === 'POST')) {
        if (!access.isAuthenticated(req)) {
            res.writeHead(401, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Connexion requise.' }));
            return;
        }
        const username = access.usernameForRequest(req);
        if (!canUseCreatorTts(username)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Un abonnement actif est requis et l’accès TTS ne doit pas avoir été révoqué par l’administrateur.' }));
            return;
        }
        if (req.method === 'GET') {
            const source = store.getAccountLiveTts(username);
            res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                active: Boolean(source),
                revoked: store.isAccountTtsLinkRevoked(username) &&
                    !access.hasActiveSubscription(store.getAccount(username)),
                username: source?.username || null,
                roomNumber: getCreatorRoomNumber(username)
            }));
            return;
        }
        readJsonBody(req, res, body => {
            try {
                if (store.getCreatorSettings(username).locked === true) {
                    const error = new Error('Les réglages de ce membre sont verrouillés. Contacte l’administrateur pour les modifier.');
                    error.statusCode = 403;
                    throw error;
                }
                const existing = store.getAccountLiveTts(username);
                if (body.action === 'revoke') {
                    const error = new Error('Seul l’administrateur peut révoquer un lien TTS.');
                    error.statusCode = 403;
                    throw error;
                }
                if (body.action !== 'create') throw invalidAdminInput('Action TTS inconnue.');
                if (existing) {
                    const error = new Error('Un lien TTS est déjà actif. Contacte l’administrateur pour le remplacer.');
                    error.statusCode = 409;
                    throw error;
                }
                if (store.isAccountTtsLinkRevoked(username) &&
                    !access.hasActiveSubscription(store.getAccount(username))) {
                    const error = new Error('Le lien TTS a été révoqué par l’administrateur. Contacte-le pour rétablir ton accès.');
                    error.statusCode = 403;
                    throw error;
                }
                const result = createAccountLiveTts(username, body.username);
                store.setCreatorTiktokUsername(username, result.username);
                store.setAccountTtsLinkRevoked(username, false);
                res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, ...result }));
            } catch (error) {
                const status = error.statusCode || 500;
                if (status === 500) console.error('Échec de configuration du TTS du créateur :', error.message);
                res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    message: status === 500
                        ? 'Impossible de configurer le TTS. Vérifie le stockage persistant.'
                        : error.message
                }));
            }
        });
        return;
    }
    if (pathname === '/api/admin/dashboard-layout' &&
        (req.method === 'GET' || req.method === 'POST')) {
        if (!access.isAuthenticated(req) || !access.isAdmin(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Accès réservé à un administrateur connecté.' }));
            return;
        }
        const username = access.usernameForRequest(req);
        if (req.method === 'GET') {
            const layout = normalizeAdminDashboardLayout(store.getAdminDashboardLayout(username));
            res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ layout }));
            return;
        }
        readJsonBody(req, res, body => {
            try {
                const layout = normalizeAdminDashboardLayout(body.layout);
                store.saveAdminDashboardLayout(username, layout);
                res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, layout }));
            } catch (error) {
                const status = error.statusCode || 500;
                if (status === 500) console.error('Échec de sauvegarde du tableau de bord :', error.message);
                res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    message: status === 500
                        ? 'Impossible d’enregistrer la disposition du tableau de bord.'
                        : error.message
                }));
            }
        }, 32 * 1024);
        return;
    }
    if (pathname === '/api/admin/creators' &&
        (req.method === 'GET' || req.method === 'POST')) {
        if (!access.isAuthenticated(req) || !access.isAdmin(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Accès réservé à un administrateur connecté.' }));
            return;
        }
        if (req.method === 'GET') {
            const connections = getActivePresence();
            const hostUsername = access.usernameForRequest(req);
            const hostRoomNumber = getCreatorRoomNumber(hostUsername) || 1;
            const activeTtsSources = store.listAccountLiveTtsSources()
                .filter(([accountUsername]) => canUseCreatorTts(accountUsername))
                .map(([accountUsername, source]) => ({
                    accountUsername,
                    username: source.username,
                    legacy: false
                }));
            const legacySource = store.getLiveTtsSource();
            if (legacySource?.accountUsername && canUseCreatorTts(legacySource.accountUsername)) {
                activeTtsSources.unshift({
                    accountUsername: legacySource.accountUsername,
                    username: legacySource.username,
                    legacy: true
                });
            }
            res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                creators: listCreatorAccounts(),
                gameCatalog: getGameCatalog(),
                hostUsername,
                hostRoomNumber,
                roomMembers: connections.filter(connection => connection.roomNumber === hostRoomNumber),
                onlineCount: new Set(connections.map(connection => connection.username.toLowerCase())).size,
                dailyUniqueUsers: store.getDailyUsageCount(getApplicationDate()),
                dailyUsageDate: getApplicationDate(),
                activeTtsSources,
                connections
            }));
            return;
        }
        readJsonBody(req, res, body => {
            try {
                if (body.action === 'manual-create') {
                    const username = typeof body.username === 'string'
                        ? body.username.trim().toLowerCase()
                        : '';
                    const password = typeof body.password === 'string' ? body.password : '';
                    const durationDays = Number(body.durationDays);
                    if (!/^[a-zA-Z0-9._@-]{1,64}$/.test(username) ||
                        access.isAdminUser(username) ||
                        access.hasConfiguredUser(username) ||
                        store.getAccount(username)) {
                        throw invalidAdminInput('Choisis un identifiant valide qui n’est pas déjà utilisé.');
                    }
                    if (password.length < 12 || password.length > 256) {
                        throw invalidAdminInput('Le mot de passe doit contenir de 12 à 256 caractères.');
                    }
                    if (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
                        throw invalidAdminInput('La durée d’accès doit être un nombre entier de 1 à 3 650 jours.');
                    }
                    const salt = crypto.randomBytes(16).toString('hex');
                    const createdAt = new Date();
                    const accessExpiresAt = new Date(createdAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
                    const created = store.createManualAccount(username, {
                        salt,
                        passwordHash: crypto.scryptSync(password, salt, 64).toString('hex'),
                        status: 'ACTIVE',
                        subscriptionId: null,
                        plan: 'Accès manuel',
                        accessMode: 'MANUAL',
                        createdAt: createdAt.toISOString(),
                        accessExpiresAt: accessExpiresAt.toISOString(),
                        durationDays,
                        updatedAt: createdAt.toISOString()
                    });
                    if (!created) {
                        throw invalidAdminInput('Choisis un identifiant valide qui n’est pas déjà utilisé.');
                    }
                    store.setCreatorServiceAccess(username, 'games', true);
                    store.setCreatorServiceAccess(username, 'tts', true);
                    res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: true,
                        username,
                        durationDays,
                        accessExpiresAt: accessExpiresAt.toISOString()
                    }));
                    return;
                }
                const username = typeof body.accountUsername === 'string'
                    ? body.accountUsername.trim().toLowerCase()
                    : '';
                if (!/^[a-zA-Z0-9._@-]{1,64}$/.test(username) ||
                    store.isCreatorRemoved(username) ||
                    (!access.hasConfiguredUser(username) && !store.getAccount(username))) {
                    throw invalidAdminInput('Compte créateur introuvable.');
                }
                if (access.isAdminUser(username) &&
                    !['tts-create', 'tts-revoke', 'room', 'room-access', 'room-close', 'room-open',
                        'service-access', 'settings-lock', 'presence-room'].includes(body.action)) {
                    throw invalidAdminInput('La protection de l’administrateur principal ne peut pas être modifiée ici.');
                }
                if (body.action === 'settings-lock') {
                    const settings = store.getCreatorSettings(username);
                    if (access.isAdminUser(username) || typeof body.locked !== 'boolean' ||
                        (settings.locked === true && body.locked)) {
                        throw invalidAdminInput('Le verrouillage des réglages de ce compte est impossible.');
                    }
                    if (body.locked) {
                        const roomNumber = body.roomNumber;
                        const gameCatalog = getGameCatalog();
                        if (roomNumber !== null &&
                            (!Number.isInteger(roomNumber) || roomNumber < 1 || roomNumber > 9999)) {
                            throw invalidAdminInput('Le numéro de salon doit être compris entre 1 et 9999.');
                        }
                        if (roomNumber !== null && !canUseCreatorRoom(username)) {
                            throw invalidAdminInput('Un abonnement actif ou un compte créé manuellement par l’administrateur est requis pour attribuer un salon.');
                        }
                        const tiktokUsername = typeof body.tiktokUsername === 'string'
                            ? body.tiktokUsername.trim().replace(/^@/, '')
                            : '';
                        if (tiktokUsername && !/^[a-zA-Z0-9._]{1,32}$/.test(tiktokUsername)) {
                            throw invalidAdminInput('Pseudo TikTok invalide.');
                        }
                        if (!Array.isArray(body.gameIds) ||
                            body.gameIds.length > gameCatalog.length ||
                            body.gameIds.some(gameId =>
                                typeof gameId !== 'string' ||
                                !gameCatalog.some(game => game.id === gameId)) ||
                            new Set(body.gameIds).size !== body.gameIds.length) {
                            throw invalidAdminInput('La sélection des jeux est invalide.');
                        }
                        if (access.hasActiveSubscription(store.getAccount(username)) &&
                            body.gameIds.length === 0) {
                            throw invalidAdminInput('Un abonné actif doit conserver l’accès à au moins un jeu.');
                        }
                        store.setCreatorGameAccess(username, body.gameIds);
                        store.setCreatorRoom(username, roomNumber);
                        store.setCreatorTiktokUsername(username, tiktokUsername || null);
                    }
                    store.setCreatorSettingsLocked(username, body.locked);
                } else if (store.getCreatorSettings(username).locked === true) {
                    throw invalidAdminInput('Les réglages de ce membre sont verrouillés. Déverrouille-les avant de les modifier.');
                } else if (body.action === 'presence-room') {
                    const clientId = typeof body.clientId === 'string' ? body.clientId : '';
                    const roomNumber = body.roomNumber;
                    if (!/^[a-f0-9-]{36}$/i.test(clientId) ||
                        (roomNumber !== null &&
                            (!Number.isInteger(roomNumber) || roomNumber < 1 || roomNumber > 9999))) {
                        throw invalidAdminInput('Session active ou numéro de chambre invalide.');
                    }
                    const session = applicationPresence.get(clientId);
                    if (!session || session.lastSeenAt <= Date.now() - PRESENCE_EXPIRY_MS ||
                        session.username.toLowerCase() !== username) {
                        throw invalidAdminInput('Cette session n’est plus active. Actualise la liste des connexions.');
                    }
                    const settings = store.getCreatorSettings(username);
                    if (!canUseCreatorRoom(username) || settings.roomRevoked === true ||
                        store.isCreatorRemoved(username) || store.isUserRevoked(username)) {
                        throw invalidAdminInput('Un salon autorisé est requis pour affecter cette session.');
                    }
                    if (roomNumber === null) delete session.roomNumberOverride;
                    else session.roomNumberOverride = roomNumber;
                } else if (body.action === 'room-close' || body.action === 'remove-creator') {
                    if (access.isAdminUser(username)) {
                        throw invalidAdminInput('Le salon et le compte de l’administrateur principal sont protégés.');
                    }
                    if (access.hasActiveSubscription(store.getAccount(username))) {
                        throw invalidAdminInput('Les accès de l’abonné restent actifs jusqu’à la fin de la période payée.');
                    }
                    const removedSources = body.action === 'room-close'
                        ? store.closeCreatorRoom(username)
                        : store.removeCreator(username);
                    access.revokeUserSessions(username);
                    for (const [clientId, session] of applicationPresence) {
                        if (session.username.toLowerCase() === username) applicationPresence.delete(clientId);
                    }
                    closeAuthenticatedSockets(username);
                    if (removedSources.ttsSource) closeLiveTtsSockets(removedSources.ttsSource.username);
                    if (removedSources.legacyTtsSource) closeLiveTtsSockets(removedSources.legacyTtsSource.username);
                } else if (body.action === 'room-open') {
                    if (access.isAdminUser(username)) {
                        throw invalidAdminInput('Le salon de l’administrateur principal ne peut pas être fermé ici.');
                    }
                    store.setUserRevoked(username, false);
                    access.revokeUserSessions(username);
                } else if (body.action === 'access') {
                    if (typeof body.enabled !== 'boolean') throw invalidAdminInput('État d’accès invalide.');
                    if (!body.enabled && access.hasActiveSubscription(store.getAccount(username))) {
                        throw invalidAdminInput('Les accès de l’abonné restent actifs jusqu’à la fin de la période payée.');
                    }
                    store.setUserRevoked(username, !body.enabled);
                    access.revokeUserSessions(username);
                    if (!body.enabled) {
                        for (const [clientId, session] of applicationPresence) {
                            if (session.username.toLowerCase() === username) applicationPresence.delete(clientId);
                        }
                        closeAuthenticatedSockets(username);
                    }
                } else if (body.action === 'room') {
                    const roomNumber = body.roomNumber;
                    if (roomNumber !== null &&
                        (!Number.isInteger(roomNumber) || roomNumber < 1 || roomNumber > 9999)) {
                        throw invalidAdminInput('Le numéro de salon doit être compris entre 1 et 9999.');
                    }
                    if (roomNumber !== null && !access.isAdminUser(username) &&
                        !canManageCreatorAccess(username)) {
                        throw invalidAdminInput('Un compte joueur autorisé est requis pour attribuer un salon.');
                    }
                    store.setCreatorRoom(username, roomNumber);
                } else if (body.action === 'room-access') {
                    if (access.isAdminUser(username) || typeof body.enabled !== 'boolean') {
                        throw invalidAdminInput('État d’accès au salon invalide.');
                    }
                    const settings = store.getCreatorSettings(username);
                    if (!settings.roomNumber) {
                        throw invalidAdminInput('Attribue d’abord un numéro de salon à ce membre.');
                    }
                    if (body.enabled) {
                        if (!canManageCreatorAccess(username)) {
                            throw invalidAdminInput('Un compte joueur autorisé est requis pour rétablir le salon.');
                        }
                    }
                    store.setCreatorRoomRevoked(username, !body.enabled);
                } else if (body.action === 'service-access') {
                    const service = body.service;
                    if (!['games', 'tts'].includes(service) || typeof body.enabled !== 'boolean') {
                        throw invalidAdminInput('Service ou autorisation invalide.');
                    }
                    if (access.isAdminUser(username)) {
                        throw invalidAdminInput('Les droits de service de l’administrateur principal ne peuvent pas être modifiés.');
                    }
                    const targetAccount = store.getAccount(username);
                    if (!body.enabled && access.hasActiveSubscription(targetAccount)) {
                        throw invalidAdminInput('Les accès aux jeux et au TTS restent obligatoires jusqu’à la fin de la période payée.');
                    }
                    if (body.enabled && !canManageCreatorAccess(username)) {
                        throw invalidAdminInput('Un compte joueur autorisé est requis.');
                    }
                    store.setCreatorServiceAccess(username, service, body.enabled);
                    if (service === 'games' && body.enabled) {
                        store.setUserRevoked(username, false);
                    }
                    if (service === 'tts' && body.enabled) {
                        store.setAccountTtsLinkRevoked(username, false);
                    }
                    if (service === 'tts' && !body.enabled) {
                        const existing = store.getAccountLiveTts(username);
                        if (existing) {
                            store.saveAccountLiveTts(username, null);
                            closeLiveTtsSockets(existing.username);
                        }
                        closeTtsControlSockets(username);
                    }
                    if (service === 'games' && !body.enabled) {
                        for (const [clientId, session] of applicationPresence) {
                            if (session.username.toLowerCase() === username) applicationPresence.delete(clientId);
                        }
                        closeAuthenticatedSockets(username);
                    }
                } else if (body.action === 'game-access') {
                    if (access.isAdminUser(username)) {
                        throw invalidAdminInput('Les droits de jeu de l’administrateur principal ne peuvent pas être modifiés.');
                    }
                    const targetAccount = store.getAccount(username);
                    if (!canManageCreatorAccess(username)) {
                        throw invalidAdminInput('Un compte joueur autorisé est requis.');
                    }
                    const gameCatalog = getGameCatalog();
                    if (!Array.isArray(body.gameIds) ||
                        body.gameIds.length > gameCatalog.length ||
                        body.gameIds.some(gameId =>
                            typeof gameId !== 'string' ||
                            !gameCatalog.some(game => game.id === gameId)) ||
                        new Set(body.gameIds).size !== body.gameIds.length) {
                        throw invalidAdminInput('La sélection des jeux est invalide.');
                    }
                    if (access.hasActiveSubscription(targetAccount) && !body.gameIds.length) {
                        throw invalidAdminInput('Un abonné actif doit conserver l’accès à au moins un jeu.');
                    }
                    store.setCreatorGameAccess(username, body.gameIds);
                    if (!body.gameIds.length) {
                        for (const [clientId, session] of applicationPresence) {
                            if (session.username.toLowerCase() === username) applicationPresence.delete(clientId);
                        }
                        closeAuthenticatedSockets(username);
                    }
                } else if (body.action === 'tts-create') {
                    if (!canUseCreatorTts(username)) {
                        throw invalidAdminInput('Un abonnement actif est requis et l’accès TTS ne doit pas avoir été révoqué par l’administrateur.');
                    }
                    const existing = store.getAccountLiveTts(username);
                    if (existing) {
                        closeLiveTtsSockets(existing.username);
                        closeTtsControlSockets(username);
                    }
                    const result = createAccountLiveTts(username, body.username);
                    store.setCreatorTiktokUsername(username, result.username);
                    store.setAccountTtsLinkRevoked(username, false);
                    res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true, ...result }));
                    return;
                } else if (body.action === 'tts-revoke') {
                    if (access.hasActiveSubscription(store.getAccount(username))) {
                        throw invalidAdminInput('Le TTS reste obligatoire jusqu’à la fin de la période payée.');
                    }
                    const existing = store.getAccountLiveTts(username);
                    if (!existing) {
                        const error = new Error('Aucun lien TTS actif pour ce créateur.');
                        error.statusCode = 404;
                        throw error;
                    }
                    store.saveAccountLiveTts(username, null);
                    store.setAccountTtsLinkRevoked(username, true);
                    closeLiveTtsSockets(existing.username);
                    closeTtsControlSockets(username);
                } else if (body.action === 'legacy-tts-revoke') {
                    const existing = store.getLiveTtsSource();
                    if (!existing) {
                        const error = new Error('Aucune source TTS globale active.');
                        error.statusCode = 404;
                        throw error;
                    }
                    store.saveLiveTtsSource(null);
                    closeLiveTtsSockets(existing.username);
                } else {
                    throw invalidAdminInput('Action de gestion du créateur inconnue.');
                }
                res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                const status = error.statusCode || 500;
                if (status === 500) console.error('Échec de gestion d’un créateur :', error.message);
                res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    message: status === 500
                        ? 'Impossible de gérer ce créateur. Vérifie le stockage persistant.'
                        : error.message
                }));
            }
        }, 256 * 1024);
        return;
    }
    if (pathname === '/api/games' && req.method === 'GET') {
        const storedGames = store.listGames();
        const hiddenGames = store.getHiddenGames();
        const games = storedGames.filter(game => game.uploaded).map(game => ({
            id: game.id,
            title: game.title,
            description: game.description,
            href: `/uploaded-games/${game.id}`,
            image: cloudinaryImageUrl(game.imageUrl)
                ? game.imageUrl
                : `/game-assets/${game.image}`,
            hidden: !access.isAdmin(req) && hiddenGames.includes(game.id),
            allowed: access.canAccessGames(req, game.id)
        }));
        const allowedGameIds = getGameCatalog()
            .filter(game => access.canAccessGames(req, game.id))
            .map(game => game.id);
        const gameImages = {};
        const metadata = {};
        for (const gameId of staticGameIds) {
            const image = store.getGameImage(gameId);
            if (image) gameImages[gameId] = cloudinaryImageUrl(image)
                ? image
                : `/game-assets/${image}`;
            const game = storedGames.find(item => item.id === gameId && !item.uploaded);
            if (game?.title || game?.description) metadata[gameId] = {
                title: game.title,
                description: game.description
            };
        }
        const savedHomepageNotice = store.getHomepageNotice();
        const homepageNotice = savedHomepageNotice
            ? {
                ...savedHomepageNotice,
                text: savedHomepageNotice.text === 'Notre arcade propose plusieurs jeux interactifs, et de nouvelles expériences sont en préparation. Une idée de jeu ou une fonctionnalité vous intéresse ? Faites-nous part de vos suggestions : nous les étudierons avec attention pour enrichir la vitrine.'
                    ? defaultHomepageNotice.text
                    : savedHomepageNotice.text,
                fontSizeDoubled: savedHomepageNotice.fontSizeDoubled === true,
                widthPercent: savedHomepageNotice.widthPercent ?? 100
            }
            : defaultHomepageNotice;
        res.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8'
        });
        res.end(JSON.stringify({
            games,
            images: gameImages,
            metadata,
            hidden: access.isAdmin(req) ? [] : hiddenGames,
            allowedGameIds: access.isAuthenticated(req) ? allowedGameIds : null,
            homepageNotice,
            paypalLink: store.getPaypalLink()
        }));
        return;
    }
    if (pathname === '/api/admin/paypal-link' && req.method === 'POST') {
        if (!access.isAdmin(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Accès réservé à l’administrateur Gryphon Agency.' }));
            return;
        }
        readJsonBody(req, res, body => {
            try {
                const url = normalizePaypalLink(body.url);
                store.savePaypalLink(url);
                res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, url }));
            } catch (error) {
                const status = error.statusCode || 500;
                if (status === 500) console.error('Échec de sauvegarde du lien PayPal :', error.message);
                res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    message: status === 500
                        ? 'Impossible d’enregistrer le lien PayPal.'
                        : error.message
                }));
            }
        }, 4096);
        return;
    }
    if (pathname === '/api/admin/live-tts' && req.method === 'GET') {
        if (!access.isAuthenticated(req) || !access.isAdmin(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Accès réservé à un administrateur connecté.' }));
            return;
        }
        const source = store.getLiveTtsSource();
        res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
        const active = Boolean(source?.accountUsername && canUseCreatorTts(source.accountUsername));
        res.end(JSON.stringify({ active, username: active ? source.username : null }));
        return;
    }
    if (pathname === '/api/admin/live-sessions' && req.method === 'GET') {
        if (!access.isAuthenticated(req) || !access.isAdmin(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Accès réservé à un administrateur connecté.' }));
            return;
        }
        const source = store.getLiveTtsSource();
        const activeSource = source?.accountUsername && canUseCreatorTts(source.accountUsername)
            ? source
            : null;
        const accountSources = store.listAccountLiveTtsSources()
            .filter(([accountUsername]) => canUseCreatorTts(accountUsername))
            .map(([, item]) => item);
        const protectedSubscriberTtsNames = new Set([
            ...(activeSource &&
                access.hasActiveSubscription(store.getAccount(activeSource.accountUsername))
                ? [activeSource.username.toLocaleLowerCase()]
                : []),
            ...store.listAccountLiveTtsSources()
                .filter(([accountUsername]) => access.hasActiveSubscription(store.getAccount(accountUsername)))
                .map(([, item]) => item.username.toLocaleLowerCase())
        ]);
        const lockedTtsNames = new Set([
            ...(source?.accountUsername &&
                store.getCreatorSettings(source.accountUsername).locked === true
                ? [source.username.toLocaleLowerCase()]
                : []),
            ...store.listAccountLiveTtsSources()
                .filter(([accountUsername]) => store.getCreatorSettings(accountUsername).locked === true)
                .map(([, item]) => item.username.toLocaleLowerCase())
        ]);
        const liveSessions = [...sessions.values()]
            .filter(session => session.isLive)
            .map(session => ({
                username: session.username,
                roomId: session.roomId,
                hasTtsLink: [activeSource, ...accountSources].some(item =>
                    item?.username.toLocaleLowerCase() === session.username.toLocaleLowerCase()),
                subscriptionActive: protectedSubscriberTtsNames.has(session.username.toLocaleLowerCase()),
                settingsLocked: lockedTtsNames.has(session.username.toLocaleLowerCase())
            }));
        res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ sessions: liveSessions }));
        return;
    }
    if (pathname === '/api/admin/live-sessions' && req.method === 'POST') {
        if (!access.isAuthenticated(req) || !access.isAdmin(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Accès réservé à un administrateur connecté.' }));
            return;
        }
        readJsonBody(req, res, body => {
            try {
                const username = typeof body.username === 'string' ? body.username.trim().replace(/^@/, '') : '';
                if (!/^[a-zA-Z0-9._]{1,32}$/.test(username)) {
                    throw invalidAdminInput('Pseudo TikTok invalide.');
                }
                const sessionKey = username.toLocaleLowerCase();
                if (body.action === 'disconnect') {
                    if (!disconnectLiveSession(sessionKey)) {
                        const error = new Error('Ce live n’est plus connecté.');
                        error.statusCode = 404;
                        throw error;
                    }
                } else if (body.action === 'revoke') {
                    const legacySource = store.getLiveTtsSource();
                    const accountSource = store.listAccountLiveTtsSources().find(([, item]) =>
                        item.username.toLocaleLowerCase() === sessionKey
                    );
                    if (legacySource?.username.toLocaleLowerCase() === sessionKey) {
                        if (legacySource.accountUsername &&
                            store.getCreatorSettings(legacySource.accountUsername).locked === true) {
                            throw invalidAdminInput('Les réglages TTS de ce membre sont verrouillés. Déverrouille-les avant de révoquer son lien.');
                        }
                        if (legacySource.accountUsername &&
                            access.hasActiveSubscription(store.getAccount(legacySource.accountUsername))) {
                            throw invalidAdminInput('Le TTS reste obligatoire jusqu’à la fin de la période payée.');
                        }
                        store.saveLiveTtsSource(null);
                    } else if (accountSource) {
                        if (store.getCreatorSettings(accountSource[0]).locked === true) {
                            throw invalidAdminInput('Les réglages TTS de ce membre sont verrouillés. Déverrouille-les avant de révoquer son lien.');
                        }
                        if (access.hasActiveSubscription(store.getAccount(accountSource[0]))) {
                            throw invalidAdminInput('Le TTS reste obligatoire jusqu’à la fin de la période payée.');
                        }
                        store.saveAccountLiveTts(accountSource[0], null);
                        store.setAccountTtsLinkRevoked(accountSource[0], true);
                        closeTtsControlSockets(accountSource[0]);
                    } else {
                        const error = new Error('Aucun lien TTS actif pour ce pseudo.');
                        error.statusCode = 404;
                        throw error;
                    }
                    closeLiveTtsSockets(username);
                } else {
                    throw invalidAdminInput('Action d’administration du live inconnue.');
                }
                res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                const status = error.statusCode || 500;
                if (status === 500) console.error('Échec de gestion du live TikTok :', error.message);
                res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ message: status === 500 ? 'Impossible de gérer ce live.' : error.message }));
            }
        });
        return;
    }
    if (pathname === '/api/admin/live-tts' && req.method === 'POST') {
        if (!access.isAuthenticated(req) || !access.isAdmin(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Accès réservé à un administrateur connecté.' }));
            return;
        }
        readJsonBody(req, res, body => {
            try {
                if (body.action === 'revoke') {
                    const existing = store.getLiveTtsSource();
                    if (existing?.accountUsername &&
                        store.getCreatorSettings(existing.accountUsername).locked === true) {
                        throw invalidAdminInput('Les réglages TTS de ce membre sont verrouillés. Déverrouille-les avant de révoquer son lien.');
                    }
                    if (existing?.accountUsername &&
                        access.hasActiveSubscription(store.getAccount(existing.accountUsername))) {
                        throw invalidAdminInput('Le TTS reste obligatoire jusqu’à la fin de la période payée.');
                    }
                    store.saveLiveTtsSource(null);
                    closeLiveTtsSockets();
                    res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true, revoked: true }));
                    return;
                }
                if (body.action !== 'create') throw invalidAdminInput('Action de source audio inconnue.');
                const username = typeof body.username === 'string' ? body.username.trim().replace(/^@/, '') : '';
                if (!/^[a-zA-Z0-9._]{1,32}$/.test(username)) {
                    throw invalidAdminInput('Saisis un pseudo TikTok valide de 1 à 32 caractères.');
                }
                const accountUsername = access.usernameForRequest(req);
                if (!canUseCreatorTts(accountUsername)) {
                    throw invalidAdminInput('Un abonnement actif est requis et l’accès TTS ne doit pas avoir été révoqué par l’administrateur.');
                }
                const token = crypto.randomBytes(32).toString('hex');
                const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
                store.saveLiveTtsSource({ username, tokenHash, accountUsername });
                closeLiveTtsSockets();
                res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, username, url: `/live-tts/${token}` }));
            } catch (error) {
                const status = error.statusCode || 500;
                if (status === 500) console.error('Échec de configuration de la source TTS :', error.message);
                res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    message: status === 500
                        ? 'Impossible de configurer la source TTS. Vérifie le stockage persistant.'
                        : error.message
                }));
            }
        });
        return;
    }
    if (pathname.startsWith('/live-tts/') && req.method === 'GET') {
        const token = pathname.slice('/live-tts/'.length);
        if (!getLiveTtsSource(token)) {
            res.writeHead(404, {
                'Cache-Control': 'no-store',
                'Referrer-Policy': 'no-referrer',
                'Content-Type': 'text/plain; charset=utf-8'
            });
            res.end('Source audio introuvable ou révoquée.');
            return;
        }
        fs.readFile(liveTtsFile, (error, content) => {
            if (error) {
                console.error('Fichier de source TTS introuvable :', error.message);
                res.writeHead(500, { 'Cache-Control': 'no-store' });
                res.end('Source audio indisponible.');
                return;
            }
            res.writeHead(200, {
                'Cache-Control': 'no-store',
                'Content-Type': 'text/html; charset=utf-8',
                'Referrer-Policy': 'no-referrer',
                'X-Content-Type-Options': 'nosniff'
            });
            res.end(content);
        });
        return;
    }
    if (pathname === '/api/admin/games' && req.method === 'POST') {
        if (!access.isAuthenticated(req) || !access.isAdmin(req)) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Accès réservé à un administrateur connecté.' }));
            return;
        }
        readJsonBody(req, res, async body => {
            try {
                const result = await saveAdminGame(body);
                res.writeHead(200, {
                    'Cache-Control': 'no-store',
                    'Content-Type': 'application/json; charset=utf-8'
                });
                res.end(JSON.stringify(result));
            } catch (error) {
                const status = error.statusCode || 500;
                if (status === 500) console.error('Échec d’une action d’administration :', error.message);
                res.writeHead(status, {
                    'Cache-Control': 'no-store',
                    'Content-Type': 'application/json; charset=utf-8'
                });
                res.end(JSON.stringify({
                    message: status === 500
                        ? 'Impossible d’enregistrer les modifications. Vérifie le stockage persistant.'
                        : error.message
                }));
            }
        }, GAME_HTML_MAX_BYTES * 2 + GAME_IMAGE_MAX_BYTES * 2 + 8192);
        return;
    }
    if (pathname === '/api/paypal/config' && req.method === 'GET') {
        paypal.getPublicConfiguration()
            .then(configuration => {
                res.writeHead(200, {
                    'Cache-Control': 'no-store',
                    'Content-Type': 'application/json; charset=utf-8'
                });
                res.end(JSON.stringify(configuration));
            })
            .catch(error => {
                console.error('Impossible de configurer les formules PayPal :', error.message);
                res.writeHead(503, {
                    'Cache-Control': 'no-store',
                    'Content-Type': 'application/json; charset=utf-8'
                });
                res.end(JSON.stringify({
                    configured: false,
                    message: 'Le paiement PayPal est temporairement indisponible.'
                }));
            });
        return;
    }
    if (pathname === '/api/paypal/checkout' && req.method === 'POST') {
        readJsonBody(req, res, async body => {
            try {
                const checkout = await paypal.createCheckout(body.username, body.password, body.plan, req);
                res.writeHead(200, {
                    'Cache-Control': 'no-store',
                    'Content-Type': 'application/json; charset=utf-8'
                });
                res.end(JSON.stringify(checkout));
            } catch (error) {
                res.writeHead(400, {
                    'Cache-Control': 'no-store',
                    'Content-Type': 'application/json; charset=utf-8'
                });
                res.end(JSON.stringify({ message: error.message }));
            }
        });
        return;
    }
    if (pathname === '/api/paypal/confirm' && req.method === 'POST') {
        readJsonBody(req, res, async body => {
            try {
                const result = await paypal.confirmSubscription(
                    body.subscriptionID,
                    body.checkoutId,
                    body.password,
                    req,
                    res
                );
                res.writeHead(result.status, {
                    'Cache-Control': 'no-store',
                    'Content-Type': 'application/json; charset=utf-8'
                });
                res.end(JSON.stringify(result));
            } catch (error) {
                console.error('La confirmation de l’abonnement PayPal a échoué :', error.message);
                res.writeHead(502, {
                    'Cache-Control': 'no-store',
                    'Content-Type': 'application/json; charset=utf-8'
                });
                res.end(JSON.stringify({
                    success: false,
                    message: 'Impossible de vérifier le paiement pour le moment.'
                }));
            }
        });
        return;
    }
    if (pathname === '/api/paypal/webhook' && req.method === 'POST') {
        readJsonBody(req, res, async event => {
            try {
                const result = await paypal.verifyWebhook(event, req.headers);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(result));
            } catch (error) {
                console.error('Webhook PayPal refusé :', error.message);
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ received: false }));
            }
        });
        return;
    }
    if (pathname === '/api/login' && req.method === 'POST') {
        readJsonBody(req, res, (body) => {
            const result = access.login(body.username, body.password, req, res);
            res.writeHead(result.success ? 200 : result.limited ? 429 : 401, {
                'Cache-Control': 'no-store',
                'Content-Type': 'application/json; charset=utf-8'
            });
            res.end(JSON.stringify({
                success: result.success,
                message: result.success
                    ? 'Connexion réussie.'
                    : result.limited
                        ? 'Trop de tentatives. Réessaie dans quinze minutes.'
                        : 'Identifiant ou mot de passe incorrect.'
            }));
        });
        return;
    }
    if (pathname === '/api/logout' && req.method === 'POST') {
        access.logout(req, res);
        res.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8'
        });
        res.end(JSON.stringify({ success: true }));
        return;
    }
    const routes = new Map([
        ['/', [homepageFile, 'text/html; charset=utf-8']],
        ['/arcade-presence.js', [presenceScriptFile, 'text/javascript; charset=utf-8']],
        ['/arcade-stars.js', [arcadeStarsFile, 'text/javascript; charset=utf-8']],
        ['/pousoire.html', [gameFile, 'text/html; charset=utf-8']],
        ['/pendu', [hangmanFile, 'text/html; charset=utf-8']],
        ['/pendu.html', [hangmanFile, 'text/html; charset=utf-8']],
        ['/coffres', [coffersGameFile, 'text/html; charset=utf-8']],
        ['/coffres.html', [coffersGameFile, 'text/html; charset=utf-8']],
        ['/jeu-foot-tiktok.html', [footballFile, 'text/html; charset=utf-8']],
        ['/qui-veut-gagner-des-etoiles.html', [starsGameFile, 'text/html; charset=utf-8']],
        ['/inedexd.html', [path.join(__dirname, 'inedexd.html'), 'text/html; charset=utf-8']],
        ['/gemini-code-1792321382503.js', [sixBoxesScript, 'text/javascript; charset=utf-8']],
        ['/coin-pusher-tiktok.html', [coinPusherFile, 'text/html; charset=utf-8']],
        ['/coin-pusher-3d-preview.html', [astraPush3dFile, 'text/html; charset=utf-8']],
        ['/coin-pusher-canard.html', [coinPusherDuckFile, 'text/html; charset=utf-8']],
        ['/coin-pusher-tiktok-2d-ancien.html', [coinPusher2dOldFile, 'text/html; charset=utf-8']],
        ['/jeu-foot-tiktok-v2.html', [footballV2File, 'text/html; charset=utf-8']],
        ['/aquarium-tiktok-live.html', [aquariumLiveFile, 'text/html; charset=utf-8']],
        ['/petits-chevaux-tiktok.html', [petitTrotFile, 'text/html; charset=utf-8']],
        ['/wish-lab.html', [wishLabFile, 'text/html; charset=utf-8']],
        ['/monde-du-ballon.html', [balloonGameFile, 'text/html; charset=utf-8']],
        ['/peluches-mutantes.html', [plushGameFile, 'text/html; charset=utf-8']],
        ['/machine-cadeaux.html', [path.join(__dirname, 'machine-cadeaux.html'), 'text/html; charset=utf-8']],
        ['/mots-associes.html', [path.join(__dirname, 'mots-associes.html'), 'text/html; charset=utf-8']],
        ['/flipper-neon.html', [path.join(__dirname, 'flipper-neon.html'), 'text/html; charset=utf-8']],
        ['/peche-en-mer.html', [path.join(__dirname, 'peche-en-mer.html'), 'text/html; charset=utf-8']],
        ['/course-karts.html', [path.join(__dirname, 'course-karts.html'), 'text/html; charset=utf-8']],
        ['/bouteilles-colorees.html', [bottleGameFile, 'text/html; charset=utf-8']],
        ['/a-prendre-ou-a-laisser.html', [dealGameFile, 'text/html; charset=utf-8']],
        ['/vrai-ou-faux.html', [trueFalseGameFile, 'text/html; charset=utf-8']],
        ['/course-de-billes.html', [marbleRaceGameFile, 'text/html; charset=utf-8']],
        ['/course-de-billes-controle.html', [marbleRaceControlFile, 'text/html; charset=utf-8']],
        ['/peche-aux-canards.html', [duckFishingGameFile, 'text/html; charset=utf-8']],
        ['/roue-du-cirque.html', [circusWheelGameFile, 'text/html; charset=utf-8']],
        ['/gryphon-plinko', [gryphonPlinkoFile, 'text/html; charset=utf-8']],
        ['/index.html', [gryphonPlinkoFile, 'text/html; charset=utf-8']],
        ['/plinko.html', [plinkoFile, 'text/html; charset=utf-8']],
        ['/griffon-gauche.jpg', [gryphonImage, 'image/jpeg']],
        ['/donut.jpg', [path.join(__dirname, 'donut.jpg'), 'image/jpeg']],
        ['/epee-fanfan-detouree.png', [gryphonSwordImage, 'image/png']],
        ['/aquarium-fish-boss.png', [aquariumFishBossImage, 'image/png']],
        ['/images-vitrine/table-a-pieces.png', [path.join(__dirname, 'images-vitrine', 'table-a-pieces.png'), 'image/png']],
        ['/images-vitrine/pendu.png', [path.join(__dirname, 'images-vitrine', 'pendu.png'), 'image/png']],
        ['/images-vitrine/gryphon-plinko.png', [path.join(__dirname, 'images-vitrine', 'gryphon-plinko.png'), 'image/png']],
        ['/images-vitrine/aquarium-live.png', [path.join(__dirname, 'images-vitrine', 'aquarium-live.png'), 'image/png']],
        ['/images-vitrine/coin-pusher.png', [path.join(__dirname, 'images-vitrine', 'coin-pusher.png'), 'image/png']],
        ['/images-vitrine/astra-push.png', [path.join(__dirname, 'images-vitrine', 'astra-push.png'), 'image/png']],
        ['/images-vitrine/coin-pusher-canard.png', [path.join(__dirname, 'images-vitrine', 'coin-pusher-canard.png'), 'image/png']],
        ['/images-vitrine/wish-lab.png', [path.join(__dirname, 'images-vitrine', 'wish-lab.png'), 'image/png']],
        ['/images-vitrine/coup-de-pied.png', [path.join(__dirname, 'images-vitrine', 'coup-de-pied.png'), 'image/png']],
        ['/images-vitrine/coffres.png', [path.join(__dirname, 'images-vitrine', 'coffres.png'), 'image/png']],
        ['/images-vitrine/six-boites.png', [path.join(__dirname, 'images-vitrine', 'six-boites.png'), 'image/png']],
        ['/images-vitrine/petit-trot.png', [path.join(__dirname, 'images-vitrine', 'petit-trot.png'), 'image/png']],
        ['/images-vitrine/monde-du-ballon.png', [path.join(__dirname, 'images-vitrine', 'monde-du-ballon.png'), 'image/png']],
        ['/images-vitrine/peluches-mutantes-apercu.png', [path.join(__dirname, 'images-vitrine', 'peluches-mutantes-apercu.png'), 'image/png']],
        ['/images-vitrine/machine-cadeaux.png', [path.join(__dirname, 'images-vitrine', 'machine-cadeaux.png'), 'image/png']],
        ['/images-vitrine/mots-associes.png', [path.join(__dirname, 'images-vitrine', 'mots-associes.png'), 'image/png']],
        ['/images-vitrine/flipper-neon.png', [path.join(__dirname, 'images-vitrine', 'flipper-neon.png'), 'image/png']],
        ['/images-vitrine/peche-en-mer.png', [path.join(__dirname, 'images-vitrine', 'peche-en-mer.png'), 'image/png']],
        ['/images-vitrine/course-karts.png', [path.join(__dirname, 'images-vitrine', 'course-karts.png'), 'image/png']],
        ['/images-vitrine/peche-math-fish95.png', [path.join(__dirname, 'images-vitrine', 'peche-math-fish95.png'), 'image/png']],
        ['/images-vitrine/bouteilles-colorees-apercu.png', [path.join(__dirname, 'images-vitrine', 'bouteilles-colorees-apercu.png'), 'image/png']],
        ['/images-vitrine/a-prendre-ou-a-laisser-apercu.png', [path.join(__dirname, 'images-vitrine', 'a-prendre-ou-a-laisser-apercu.png'), 'image/png']],
        ['/images-vitrine/vrai-ou-faux-apercu.png', [path.join(__dirname, 'images-vitrine', 'vrai-ou-faux-apercu.png'), 'image/png']],
        ['/images-vitrine/course-de-billes-apercu.png', [path.join(__dirname, 'images-vitrine', 'course-de-billes-apercu.png'), 'image/png']],
        ['/images-vitrine/peche-aux-canards-apercu.png', [path.join(__dirname, 'images-vitrine', 'peche-aux-canards-apercu.png'), 'image/png']],
        ['/images-vitrine/roue-du-cirque-apercu.png', [path.join(__dirname, 'images-vitrine', 'roue-du-cirque-apercu.png'), 'image/png']],
        ['/images-vitrine/clown-cirque.png', [path.join(__dirname, 'images-vitrine', 'clown-cirque.png'), 'image/png']],
        ['/matter.min.js', [matterFile, 'text/javascript; charset=utf-8']],
        ['/node_modules/matter-js/build/matter.min.js', [matterFile, 'text/javascript; charset=utf-8']],
        ['/ballon-foot-reel.jpg', [footballImage, 'image/jpeg']]
    ]);
    const route = routes.get(pathname);

    if (pathname.startsWith('/uploaded-games/')) {
        if (!access.canAccessGames(req)) {
            res.writeHead(302, {
                'Cache-Control': 'no-store',
                Location: access.isAuthenticated(req) ? '/?acces=jeux' : '/?connexion=requise'
            });
            res.end();
            return;
        }
        const gameId = pathname.slice('/uploaded-games/'.length);
        const game = store.listGames().find(item => item.id === gameId && item.uploaded);
        if (!game || !/^[a-f0-9-]{36}$/.test(game.id)) {
            res.writeHead(404);
            res.end('Jeu introuvable.');
            return;
        }
        if (!access.canAccessGames(req, game.id)) {
            res.writeHead(302, {
                'Cache-Control': 'no-store',
                Location: '/?acces=jeux'
            });
            res.end();
            return;
        }
        fs.readFile(path.join(store.getGameFilesDirectory(), game.html), (error, content) => {
            if (error) {
                console.error('Fichier de jeu importé introuvable :', error.message);
                res.writeHead(500);
                res.end('Fichier de jeu introuvable.');
                return;
            }
            res.writeHead(200, {
                'Cache-Control': 'no-store',
                'Content-Type': 'text/html; charset=utf-8'
            });
            res.end(injectArcadeScripts(content.toString('utf8')));
        });
        return;
    }

    if (pathname.startsWith('/cadeaux-machine/')) {
        const file = pathname.slice('/cadeaux-machine/'.length);
        if (!/^[a-z0-9-]+\.(?:png|jpg)$/.test(file)) {
            res.writeHead(404);
            res.end('Image introuvable.');
            return;
        }
        fs.readFile(path.join(__dirname, 'cadeaux-machine', file), (error, content) => {
            if (error) {
                res.writeHead(404);
                res.end('Image introuvable.');
                return;
            }
            res.writeHead(200, {
                'Cache-Control': 'public, max-age=3600',
                'Content-Type': file.endsWith('.png') ? 'image/png' : 'image/jpeg',
                'X-Content-Type-Options': 'nosniff'
            });
            res.end(content);
        });
        return;
    }

    if (pathname.startsWith('/game-assets/')) {
        const filename = pathname.slice('/game-assets/'.length);
        if (!/^[a-f0-9-]{36}\.(?:png|jpe?g|webp)$/.test(filename)) {
            res.writeHead(404);
            res.end('Image introuvable.');
            return;
        }
        fs.readFile(path.join(store.getGameFilesDirectory(), filename), (error, content) => {
            if (error) {
                res.writeHead(error.code === 'ENOENT' ? 404 : 500);
                res.end('Image introuvable.');
                return;
            }
            const extension = path.extname(filename).toLowerCase();
            const contentType = extension === '.png' ? 'image/png'
                : extension === '.webp' ? 'image/webp' : 'image/jpeg';
            res.writeHead(200, {
                'Cache-Control': 'public, max-age=3600',
                'Content-Type': contentType,
                'X-Content-Type-Options': 'nosniff'
            });
            res.end(content);
        });
        return;
    }

    if (route) {
        const gameId = gameRouteIds.get(pathname);
        if (protectedRoutes.has(pathname) &&
            (!access.canAccessGames(req) ||
                (gameId !== undefined && !access.canAccessGames(req, gameId)))) {
            res.writeHead(302, {
                'Cache-Control': 'no-store',
                Location: access.isAuthenticated(req) ? '/?acces=jeux' : '/?connexion=requise'
            });
            res.end();
            return;
        }
        const [requestedFile, contentType] = route;
        // Si l'image n'est pas dans images-vitrine/ (import à plat sur GitHub), on la cherche à la racine.
        const flatFile = path.join(__dirname, path.basename(requestedFile));
        const sourceFile = !fs.existsSync(requestedFile) && fs.existsSync(flatFile) ? flatFile : requestedFile;
        fs.readFile(sourceFile, (error, content) => {
            if (error) {
                res.writeHead(500);
                return res.end('Fichier de jeu introuvable.');
            }
            const headers = { 'Content-Type': contentType };
            if (contentType.startsWith('text/html;')) {
                headers['Cache-Control'] = 'no-store';
            }
            res.writeHead(200, headers);
            res.end(contentType.startsWith('text/html;')
                ? injectArcadeScripts(content.toString('utf8'))
                : content);
        });
    } else {
        res.writeHead(404);
        res.end('Introuvable');
    }
});

function readJsonBody(req, res, callback, maxBytes = 8192) {
    let body = '';
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
        if (tooLarge) return;
        body += chunk;
        if (Buffer.byteLength(body, 'utf8') > maxBytes) {
            tooLarge = true;
            body = '';
        }
    });
    req.on('end', () => {
        if (tooLarge) {
            res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, message: 'Requête trop volumineuse.' }));
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(body);
        } catch {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, message: 'Requête invalide.' }));
            return;
        }
        callback(parsed && typeof parsed === 'object' ? parsed : {});
    });
}

const wss = new WebSocket.Server({ noServer: true });
const liveTtsClientUsernames = new WeakMap();
const liveTtsSockets = new Set();
const authenticatedClientUsernames = new Map();
const authenticatedTtsClientUsernames = new Map();
function closeLiveTtsSockets(username) {
    for (const socket of liveTtsSockets) {
        if (username && liveTtsClientUsernames.get(socket)?.toLocaleLowerCase() !== username.toLocaleLowerCase()) continue;
        socket.terminate();
    }
}

function closeTtsControlSockets(username) {
    const normalizedUsername = username.toLowerCase();
    for (const [socket, connectedUsername] of authenticatedTtsClientUsernames) {
        if (connectedUsername.toLowerCase() === normalizedUsername) socket.terminate();
    }
}

function closeAuthenticatedSockets(username) {
    const normalizedUsername = username.toLowerCase();
    for (const [socket, connectedUsername] of authenticatedClientUsernames) {
        if (connectedUsername.toLowerCase() === normalizedUsername) socket.terminate();
    }
}

server.on('upgrade', (req, socket, head) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    const isLiveTtsRequest = requestUrl.pathname === '/live-tts-relay';
    const ttsSource = isLiveTtsRequest ? getLiveTtsSource(requestUrl.searchParams.get('token')) : null;
    const isTtsControlRequest = requestUrl.pathname === '/live-tts-control';
    const authenticated = access.isAuthenticated(req);
    const accountUsername = authenticated ? access.usernameForRequest(req) : '';
    const canControlTts = isTtsControlRequest &&
        authenticated &&
        canUseCreatorTts(accountUsername) &&
        Boolean(store.getAccountLiveTts(accountUsername));
    if ((isTtsControlRequest && !canControlTts) ||
        ((!authenticated || !access.canAccessGames(req)) && !canControlTts && !ttsSource)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, webSocket => {
        if (ttsSource) {
            liveTtsClientUsernames.set(webSocket, ttsSource.username);
            liveTtsSockets.add(webSocket);
        }
        wss.emit('connection', webSocket, req);
    });
});

setInterval(() => {
    for (const [username, account] of store.listAccounts()) {
        if (!account.subscriptionId || access.hasActiveSubscription(account)) continue;
        closeAuthenticatedSockets(username);
        closeTtsControlSockets(username);
        const source = store.getAccountLiveTts(username);
        if (source) closeLiveTtsSockets(source.username);
        for (const [clientId, session] of applicationPresence) {
            if (session.username.toLowerCase() === username) applicationPresence.delete(clientId);
        }
    }
}, 30_000).unref();

const sessions = new Map();
const clientSessions = new Map();
const balloonShotRates = new WeakMap();
const MAX_BALLOON_GAME_PLAYERS = 30;

function getMessageProfile(messageData) {
    if (messageData.type === 'gift') return messageData.gift || {};
    if (messageData.type === 'comment') return messageData.commentData || {};
    if (messageData.type === 'viewer') return messageData.viewer || {};
    return null;
}

function updateSessionWalletProfile(session, messageData) {
    const profileData = getMessageProfile(messageData);
    if (!profileData) return null;
    const userId = String(profileData.userId || '');
    const username = String(profileData.username || '').trim().replace(/^@/, '').slice(0, 32);
    const uniqueId = String(profileData.uniqueId || username).trim().replace(/^@/, '').slice(0, 32);
    if ((userId && !/^[a-zA-Z0-9._:-]{1,128}$/.test(userId)) ||
        !/^[a-zA-Z0-9._]{1,32}$/.test(uniqueId)) return null;

    const identityKey = userId ? `id:${userId}` : `handle:${uniqueId.toLowerCase()}`;
    const playerId = userId ? `id:${userId}` : `handle:${uniqueId.toLowerCase()}`;
    const cached = session.walletProfiles.get(playerId);
    let avatarKey = cached?.avatarKey || '';
    let avatarType = cached?.avatarType || '';
    let avatarSavedAt = cached?.avatarSavedAt || 0;
    const avatarDataUri = typeof profileData.avatarDataUri === 'string'
        ? profileData.avatarDataUri
        : '';
    if (avatarDataUri && Date.now() - avatarSavedAt >= 24 * 60 * 60 * 1000) {
        const match = avatarDataUri.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/]+=*)$/);
        if (match && match[2].length <= 700000) {
            const image = Buffer.from(match[2], 'base64');
            if (image.length <= 512 * 1024) {
                const saved = store.saveTikTokAvatar(identityKey, image, match[1]);
                uploadAvatarToCloudinary(saved.avatarKey, image, match[1])
                    .catch(error => console.warn('Envoi avatar vers Cloudinary impossible :', error.message));
                avatarKey = saved.avatarKey;
                avatarType = saved.avatarType;
                avatarSavedAt = Date.now();
            }
        }
    }
    const changed = !cached || cached.username !== username ||
        cached.nickname !== String(profileData.nickname || '').slice(0, 80) ||
        cached.uniqueId !== uniqueId ||
        cached.avatarKey !== avatarKey;
    let player = cached?.player || null;
    if (changed) {
        player = store.upsertTikTokPlayer({
            userId,
            uniqueId,
            username,
            nickname: String(profileData.nickname || '').slice(0, 80),
            avatarKey,
            avatarType
        });
    }
    player ||= store.resolveTikTokPlayer(playerId);
    if (!player) return null;
    session.walletProfiles.set(player.id, {
        player,
        username,
        nickname: player.nickname,
        uniqueId,
        avatarKey: player.avatarKey,
        avatarType: player.avatarType,
        avatarSavedAt
    });
    session.seenPlayerIds.add(player.id);
    messageData.walletPlayer = getPublicTikTokPlayer(player, session.username);
    if (messageData.type === 'viewer' && messageData.viewer) {
        messageData.viewer.avatarUrl = messageData.walletPlayer.avatarUrl;
    }
    if (messageData.type === 'gift' && messageData.gift) {
        messageData.gift.avatarUrl = messageData.walletPlayer.avatarUrl;
    }
    if (messageData.type === 'comment' && messageData.commentData) {
        messageData.commentData.avatarUrl = messageData.walletPlayer.avatarUrl;
    }
    return player;
}

function broadcastSessionMessage(session, messageData) {
    const encoded = JSON.stringify(messageData);
    for (const client of session.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(encoded);
    }
}

function processTikTokWalletCommand(session, messageData, player) {
    if (messageData.type !== 'comment' || !player) return;
    player = store.resolveTikTokPlayer(player.id) || player;
    const walletOwner = session.username;
    const commentData = messageData.commentData || {};
    const comment = String(commentData.comment || '').trim();
    if (/^!?\s*(?:étoile|etoile|star)s?$/iu.test(comment) || comment === '*') {
        broadcastSessionMessage(session, {
            type: 'WALLET_BALANCE',
            source: 'chat',
            player: getPublicTikTokPlayer(player, walletOwner),
            messageId: commentData.messageId || ''
        });
    }
    const runMatch = /^!?\s*run(?:\s+(\d+))?$/iu.exec(comment);
    if (!runMatch) return;
    const requested = runMatch[1] ? Number(runMatch[1]) : 0;
    const balance = store.getWalletBalance(player, walletOwner);
    const amount = requested > 0 ? Math.min(requested, balance) : balance;
    if (amount < 1) {
        broadcastSessionMessage(session, {
            type: 'WALLET_RUN_REJECTED',
            player: getPublicTikTokPlayer(player, walletOwner),
            message: `@${player.username}, ton solde est à zéro : aucune étoile n’a été débitée.`
        });
        return;
    }
    const sourceId = commentData.messageId || crypto.randomUUID();
    const transactionId = crypto.createHash('sha256')
        .update(`${session.username.toLowerCase()}:${sourceId}`)
        .digest('hex');
    const result = store.applyTikTokStarTransaction({
        transactionId,
        playerId: player.id,
        delta: -amount,
        gameId: 'all-games',
        reason: 'run',
        owner: walletOwner
    });
    const updatedPlayer = store.resolveTikTokPlayer(player.id);
    if (!result.applied) return;
    broadcastSessionMessage(session, {
        type: 'WALLET_RUN',
        player: getPublicTikTokPlayer(updatedPlayer, walletOwner),
        spent: amount,
        messageId: sourceId
    });
}

function sendBalloonGameRole(session, socket) {
    socket.send(JSON.stringify({
        type: 'BALLOON_GAME_ROLE',
        owner: session.balloonOwner === socket,
        players: session.balloonClients.size,
        maxPlayers: MAX_BALLOON_GAME_PLAYERS,
        state: session.balloonLastState
    }));
}

function removeBalloonGameClient(session, socket) {
    if (!session.balloonClients.delete(socket)) return;
    if (session.balloonOwner === socket) {
        session.balloonOwner = session.balloonClients.values().next().value || null;
        if (session.balloonOwner) sendBalloonGameRole(session, session.balloonOwner);
    }
    const status = JSON.stringify({
        type: 'BALLOON_GAME_PLAYERS',
        players: session.balloonClients.size,
        maxPlayers: MAX_BALLOON_GAME_PLAYERS
    });
    for (const client of session.balloonClients) {
        if (client.readyState === WebSocket.OPEN) client.send(status);
    }
}

function detachClient(socket) {
    const sessionKey = clientSessions.get(socket);
    if (!sessionKey) return;
    clientSessions.delete(socket);
    const session = sessions.get(sessionKey);
    if (!session) return;
    removeBalloonGameClient(session, socket);
    session.clients.delete(socket);
    if (!session.clients.size) {
        sessions.delete(sessionKey);
        void session.disconnect();
    }
}

function disconnectLiveSession(sessionKey) {
    const session = sessions.get(sessionKey);
    if (!session) return false;
    sessions.delete(sessionKey);
    for (const client of session.clients) {
        clientSessions.delete(client);
        client.terminate();
    }
    session.clients.clear();
    void session.disconnect();
    return true;
}

function startTikTokSession(session) {
    session.statusMessage = '';
    session.roomId = null;
    session.isLive = false;
    session.disconnect = createTikTokSession(messageData => {
        if (messageData.type === 'STATUS') session.statusMessage = messageData.message;
        let player = null;
        try {
            player = updateSessionWalletProfile(session, messageData);
        } catch (error) {
            console.warn('Impossible d’enregistrer le profil TikTok pour le portefeuille :', error.message);
        }
        try {
            processTikTokWalletCommand(session, messageData, player);
        } catch (error) {
            console.error('Impossible de traiter une commande du portefeuille TikTok :', error);
        }
        const encoded = JSON.stringify(messageData);
        for (const client of session.clients) {
            if (session.balloonClients.has(client) &&
                client !== session.balloonOwner &&
                messageData.type !== 'STATUS' &&
                messageData.type !== 'viewer') continue;
            if (client.readyState === WebSocket.OPEN) client.send(encoded);
        }
    }, session.username, ({ connected, roomId }) => {
        session.isLive = connected;
        session.roomId = roomId;
    });
}

wss.on('connection', (socket, req) => {
    const liveTtsUsername = liveTtsClientUsernames.get(socket);
    const ttsControlAccount = new URL(req.url, 'http://localhost').pathname === '/live-tts-control'
        ? access.usernameForRequest(req)
        : '';
    if (!liveTtsUsername && access.isAuthenticated(req)) {
        authenticatedClientUsernames.set(socket, access.usernameForRequest(req));
    }
    if (ttsControlAccount) authenticatedTtsClientUsernames.set(socket, ttsControlAccount);
    if (liveTtsUsername) {
        socket.send(JSON.stringify({ type: 'TTS_CONFIG', username: liveTtsUsername }));
    } else if (ttsControlAccount) {
        const source = store.getAccountLiveTts(ttsControlAccount);
        if (!source || !canUseCreatorTts(ttsControlAccount)) {
            socket.send(JSON.stringify({
                type: 'STATUS',
                message: 'Aucun lien TTS actif ou accès révoqué pour ce compte.'
            }));
            socket.terminate();
            return;
        }
        socket.send(JSON.stringify({
            type: 'TTS_CONFIG',
            username: source.username
        }));
    }
    socket.on('message', message => {
        let request;
        try {
            request = JSON.parse(message.toString());
        } catch (error) {
            console.warn('Message reçu du jeu invalide :', error.message);
            return;
        }
        if (request.action === 'BALLOON_GAME_SYNC') {
            const session = sessions.get(clientSessions.get(socket));
            if (!session || session.balloonOwner !== socket ||
                !request.state || typeof request.state !== 'object' || Array.isArray(request.state)) return;
            const encoded = JSON.stringify({
                type: 'BALLOON_GAME_STATE',
                state: request.state,
                players: session.balloonClients.size,
                maxPlayers: MAX_BALLOON_GAME_PLAYERS
            });
            if (Buffer.byteLength(encoded, 'utf8') > 256 * 1024) {
                socket.send(JSON.stringify({
                    type: 'BALLOON_GAME_ERROR',
                    message: 'La sauvegarde synchronisée dépasse la taille autorisée.'
                }));
                return;
            }
            session.balloonLastState = request.state;
            for (const client of session.balloonClients) {
                if (client !== socket && client.readyState === WebSocket.OPEN) client.send(encoded);
            }
            return;
        }
        if (request.action === 'BALLOON_GAME_SHOOT') {
            const session = sessions.get(clientSessions.get(socket));
            if (!session?.balloonClients.has(socket) || !session.balloonOwner ||
                session.balloonOwner === socket) return;
            const now = Date.now();
            let rate = balloonShotRates.get(socket);
            if (!rate || now - rate.startedAt >= 1000) {
                rate = { startedAt: now, count: 0, notified: false };
                balloonShotRates.set(socket, rate);
            }
            if (rate.count >= 50) {
                if (!rate.notified) {
                    rate.notified = true;
                    socket.send(JSON.stringify({
                        type: 'BALLOON_GAME_ERROR',
                        message: 'Limite de tirs atteinte : réessaie dans un instant.'
                    }));
                }
                return;
            }
            rate.count++;
            if (session.balloonOwner.readyState === WebSocket.OPEN) {
                session.balloonOwner.send(JSON.stringify({
                    type: 'BALLOON_GAME_SHOOT',
                    balloonId: Number.isSafeInteger(request.balloonId) ? request.balloonId : null,
                    username: String(request.username || 'Spectateur').replace(/^@/, '').slice(0, 32)
                }));
            }
            return;
        }
        if (request.action !== 'CONNECT_TIKTOK') return;

        const requestedUsername = String(request.username || '').trim().replace(/^@/, '');
        const creatorTtsSource = ttsControlAccount
            ? store.getAccountLiveTts(ttsControlAccount)
            : null;
        if (ttsControlAccount &&
            (!canUseCreatorTts(ttsControlAccount) ||
                !creatorTtsSource ||
                requestedUsername.toLocaleLowerCase() !== creatorTtsSource.username.toLocaleLowerCase())) {
            socket.send(JSON.stringify({
                type: 'STATUS',
                message: 'Cette connexion TTS n’est plus autorisée pour ton compte.'
            }));
            socket.terminate();
            return;
        }
        if (liveTtsUsername &&
            requestedUsername.toLocaleLowerCase() !== liveTtsUsername.toLocaleLowerCase()) {
            socket.send(JSON.stringify({
                type: 'STATUS',
                message: 'Le pseudo demandé ne correspond pas à cette source audio privée.'
            }));
            return;
        }
        const username = liveTtsUsername || requestedUsername;
        if (!/^[a-zA-Z0-9._]{1,32}$/.test(username)) {
            socket.send(JSON.stringify({
                type: 'STATUS',
                message: 'Pseudo TikTok invalide : saisis un pseudo de 1 à 32 caractères.'
            }));
            return;
        }

        const sessionKey = username.toLocaleLowerCase();
        const wantsBalloonGame = request.gameMode === 'balloon';
        const currentSessionKey = clientSessions.get(socket);
        if (currentSessionKey === sessionKey) {
            const currentSession = sessions.get(sessionKey);
            if (wantsBalloonGame && !currentSession.balloonClients.has(socket)) {
                if (currentSession.balloonClients.size >= MAX_BALLOON_GAME_PLAYERS) {
                    socket.send(JSON.stringify({
                        type: 'BALLOON_GAME_ERROR',
                        message: 'La partie est complète : 30 joueurs peuvent jouer en même temps.'
                    }));
                    return;
                }
                currentSession.balloonClients.add(socket);
                if (!currentSession.balloonOwner) currentSession.balloonOwner = socket;
                sendBalloonGameRole(currentSession, socket);
            }
            if (currentSession && !currentSession.isLive &&
                /erreur de connexion tiktok|connexion tiktok interrompue/i.test(currentSession.statusMessage)) {
                void currentSession.disconnect();
                startTikTokSession(currentSession);
            }
            socket.send(JSON.stringify({
                type: 'STATUS',
                message: currentSession.statusMessage ||
                    `Connexion TikTok en cours · @${currentSession.username}`
            }));
            return;
        }
        const currentSession = sessions.get(currentSessionKey);
        const freesCurrentSlot = currentSession?.clients.size === 1;
        if (!sessions.has(sessionKey) && sessions.size >= maxTikTokSessions && !freesCurrentSlot) {
            socket.send(JSON.stringify({
                type: 'STATUS',
                message: 'Le nombre de lives simultanés est momentanément atteint.'
            }));
            return;
        }

        detachClient(socket);
        let session = sessions.get(sessionKey);
        if (!session) {
            session = {
                username,
                clients: new Set(),
                balloonClients: new Set(),
                balloonOwner: null,
                balloonLastState: null,
                seenPlayerIds: new Set(),
                walletProfiles: new Map(),
                disconnect: null,
                statusMessage: '',
                roomId: null,
                isLive: false
            };
            sessions.set(sessionKey, session);
            startTikTokSession(session);
        }
        if (wantsBalloonGame && !session.balloonClients.has(socket) &&
            session.balloonClients.size >= MAX_BALLOON_GAME_PLAYERS) {
            socket.send(JSON.stringify({
                type: 'BALLOON_GAME_ERROR',
                message: 'La partie est complète : 30 joueurs peuvent jouer en même temps.'
            }));
            return;
        }
        session.clients.add(socket);
        clientSessions.set(socket, sessionKey);
        if (wantsBalloonGame) {
            session.balloonClients.add(socket);
            if (!session.balloonOwner) session.balloonOwner = socket;
            sendBalloonGameRole(session, socket);
            for (const client of session.balloonClients) {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({
                    type: 'BALLOON_GAME_PLAYERS',
                    players: session.balloonClients.size,
                    maxPlayers: MAX_BALLOON_GAME_PLAYERS
                }));
            }
        }
        socket.send(JSON.stringify({
            type: 'STATUS',
            message: session.statusMessage || `Connexion TikTok en cours · @${username}`
        }));
    });
    socket.on('close', () => {
        liveTtsSockets.delete(socket);
        authenticatedClientUsernames.delete(socket);
        authenticatedTtsClientUsernames.delete(socket);
        detachClient(socket);
    });
    socket.on('error', error => {
        console.warn('Erreur WebSocket client :', error.message);
    });
});

server.listen(port, '0.0.0.0', () => {
    restoreStarsFromSeed();
    dbSync.startBackups();
    sweepExpiredManualAccounts();
    setInterval(() => {
        try {
            sweepExpiredManualAccounts();
        } catch (error) {
            console.error('Échec du nettoyage des comptes expirés :', error);
        }
    }, 60_000).unref();
    console.log(`Serveur lancé sur le port ${port}`);
    if (!access.hasUsers) {
        console.warn('Accès aux jeux fermé : configure au moins un compte dans GAME_USERS_JSON.');
    }
});

// Au démarrage, si le portefeuille est vide (serveur sans disque, redéployé), on le recharge depuis etoiles-sauvegarde.json.
// Ce fichier n'est servi par aucune route : il reste interne au serveur.
function restoreStarsFromSeed() {
    try {
        const seedFile = path.join(__dirname, 'etoiles-sauvegarde.json');
        if (!fs.existsSync(seedFile)) return;
        if (store.listTikTokPlayers().some(player => player.stars > 0)) return;
        const snapshot = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
        const result = store.importTikTokStarLeaderboard(snapshot);
        console.log(`Portefeuille d'étoiles rechargé depuis etoiles-sauvegarde.json (${snapshot.players.length} joueurs, ${result.updatedPlayers} ajustements).`);
    } catch (error) {
        console.warn('Rechargement du portefeuille d’étoiles impossible :', error.message);
    }
}

function sweepExpiredManualAccounts(now = Date.now()) {
    for (const [username, account] of store.listAccounts()) {
        if (account.accessMode !== 'MANUAL') continue;
        if (account.accessExpiresAt === undefined) continue;
        const expiresAt = Date.parse(account.accessExpiresAt || '');
        if (Number.isFinite(expiresAt) && expiresAt > now) continue;
        const removedSources = store.removeCreator(username);
        access.revokeUserSessions(username);
        for (const [clientId, session] of applicationPresence) {
            if (session.username.toLowerCase() === username) applicationPresence.delete(clientId);
        }
        closeAuthenticatedSockets(username);
        closeTtsControlSockets(username);
        if (removedSources.ttsSource) closeLiveTtsSockets(removedSources.ttsSource.username);
        if (removedSources.legacyTtsSource) closeLiveTtsSockets(removedSources.legacyTtsSource.username);
        console.info(`Compte manuel ${username} et ses accès supprimés après expiration.`);
    }
}