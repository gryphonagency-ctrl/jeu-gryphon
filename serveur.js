const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { createTikTokSession } = require('./tiktok-session');
const access = require('./access-control');
const paypal = require('./paypal');
const store = require('./account-store');

const port = Number(process.env.PORT) || 3000;
const GAME_HTML_MAX_BYTES = 2 * 1024 * 1024;
const GAME_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const configuredMaxTikTokSessions = Number(process.env.MAX_TIKTOK_SESSIONS);
const maxTikTokSessions = Number.isSafeInteger(configuredMaxTikTokSessions) &&
    configuredMaxTikTokSessions > 0 ? configuredMaxTikTokSessions : 25;
const gameFile = path.join(__dirname, 'pousoire.html');
const hangmanFile = path.join(__dirname, 'pendu.html');
const footballFile = path.join(__dirname, 'jeu-foot-tiktok.html');
const footballImage = path.join(__dirname, 'ballon-foot-reel.jpg');
const coinPusherFile = path.join(__dirname, 'coin-pusher-tiktok.html');
const aquariumLiveFile = path.join(__dirname, 'aquarium-tiktok-live.html');
const aquariumFishBossImage = path.join(__dirname, 'aquarium-fish-boss.png');
const sixBoxesScript = path.join(__dirname, 'gemini-code-1792321382503.js');
const gryphonPlinkoFile = path.join(__dirname, 'index.html');
const plinkoFile = path.join(__dirname, 'plinko.html');
const gryphonImage = path.join(__dirname, 'griffon-gauche.jpg');
const gryphonSwordImage = path.join(__dirname, 'epee-fanfan-detouree.png');
const matterFile = path.join(__dirname, 'node_modules', 'matter-js', 'build', 'matter.min.js');
const homepageFile = path.join(__dirname, 'accueil.html');
const liveTtsFile = path.join(__dirname, 'live-tts.html');
const presenceScriptFile = path.join(__dirname, 'arcade-presence.js');
const protectedRoutes = new Set([
    '/pousoire.html',
    '/pendu',
    '/pendu.html',
    '/coffres',
    '/coffres.html',
    '/jeu-foot-tiktok.html',
    '/inedexd.html',
    '/gemini-code-1792321382503.js',
    '/coin-pusher-tiktok.html',
    '/aquarium-tiktok-live.html',
    '/gryphon-plinko',
    '/index.html',
    '/plinko.html',
    '/griffon-gauche.jpg',
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
    '/jeu-foot-tiktok.html',
    '/coffres',
    '/inedexd.html'
];
const defaultHomepageNotice = Object.freeze({
    label: 'Nouveautés de l’arcade',
    text: 'Notre arcade propose plusieurs jeux interactifs, et de nouvelles expériences sont en préparation. Une idée de jeu ou une fonctionnalité vous intéresse ? Faites-nous part de vos suggestions : nous les étudierons avec attention pour enrichir la vitrine.',
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

function canUseCreatorTts(username) {
    if (access.isAdminUser(username)) return true;
    const account = store.getAccount(username);
    return store.hasCreatorServiceGrant(username, 'tts') ||
        Boolean(account?.subscriptionId &&
            account.status === 'ACTIVE' &&
            store.isCreatorServiceEnabled(username, 'tts'));
}

function getLiveTtsSource(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const providedHash = crypto.createHash('sha256').update(token).digest();
    const sources = [
        store.getLiveTtsSource(),
        ...store.listAccountLiveTtsSources().map(([accountUsername, source]) => ({
            ...source,
            accountUsername
        }))
    ].filter(Boolean);
    for (const source of sources) {
        const storedHash = Buffer.from(source.tokenHash, 'hex');
        if (storedHash.length === providedHash.length &&
            crypto.timingSafeEqual(storedHash, providedHash)) {
            if (source.accountUsername && !canUseCreatorTts(source.accountUsername)) return null;
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
    if (duplicate || legacySource?.username.toLocaleLowerCase() === normalizedUsername) {
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
            username: session.username,
            game: session.game,
            roomNumber: store.getCreatorSettings(session.username).roomNumber || null,
            connectedAt: session.connectedAt,
            durationSeconds: Math.floor((Date.now() - session.connectedAt) / 1000)
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
    const creators = new Map(access.listConfiguredUsers().map(username => [username, null]));
    for (const [username, account] of store.listAccounts()) creators.set(username, account);
    return [...creators.entries()].map(([username, account]) => {
        const source = store.getAccountLiveTts(username);
        const settings = store.getCreatorSettings(username);
        return {
            username,
            subscriptionStatus: account?.status || 'MANUEL',
            plan: account?.plan || null,
            hasSubscription: Boolean(account?.subscriptionId),
            subscriptionActive: Boolean(account?.subscriptionId && account.status === 'ACTIVE'),
            protectedAdmin: access.isAdminUser(username),
            accessEnabled: !store.isUserRevoked(username) &&
                (!account || account.status === 'ACTIVE'),
            gamesAccessEnabled: !store.isUserRevoked(username) &&
                store.isCreatorServiceEnabled(username, 'games') &&
                (!account || (Boolean(account.subscriptionId) && account.status === 'ACTIVE')),
            ttsAccessEnabled: canUseCreatorTts(username),
            ttsActive: Boolean(source),
            ttsUsername: source?.username || null,
            roomNumber: settings.roomNumber || null
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
        if (!Number.isInteger(widthPercent) || widthPercent < 40 || widthPercent > 100) {
            throw invalidAdminInput('La largeur du message doit être comprise entre 40 et 100 %.');
        }
        if (!['hero', 'games-before', 'games-after'].includes(placement)) {
            throw invalidAdminInput('Choisis un emplacement valide pour le message.');
        }
        const settings = { label, text, fontSize, widthPercent, placement };
        store.saveHomepageNotice(settings);
        return { success: true, settings };
    }
    if (body.action === 'image') {
        const gameId = typeof body.gameId === 'string' ? body.gameId : '';
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
            hasSubscription: Boolean(account?.subscriptionId && account.status === 'ACTIVE'),
            canUseTts: canUseCreatorTts(username),
            canAccessGames: access.canAccessGames(req),
            creatorTts: creatorTts
                ? { active: true, username: creatorTts.username }
                : { active: false, username: null },
            roomNumber: username ? store.getCreatorSettings(username).roomNumber || null : null
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
            res.end(JSON.stringify({ message: 'L’accès au TTS doit être autorisé par l’administrateur ou par un abonnement actif.' }));
            return;
        }
        if (req.method === 'GET') {
            const source = store.getAccountLiveTts(username);
            res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                active: Boolean(source),
                username: source?.username || null,
                roomNumber: store.getCreatorSettings(username).roomNumber || null
            }));
            return;
        }
        readJsonBody(req, res, body => {
            try {
                const existing = store.getAccountLiveTts(username);
                if (body.action === 'revoke') {
                    if (!existing) throw Object.assign(new Error('Aucun lien TTS personnel n’est actif.'), { statusCode: 404 });
                    store.saveAccountLiveTts(username, null);
                    closeLiveTtsSockets(existing.username);
                    res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true, active: false }));
                    return;
                }
                if (body.action !== 'create') throw invalidAdminInput('Action TTS inconnue.');
                if (existing) closeLiveTtsSockets(existing.username);
                const result = createAccountLiveTts(username, body.username);
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
            const hostRoomNumber = store.getCreatorSettings(hostUsername).roomNumber || 1;
            const activeTtsSources = store.listAccountLiveTtsSources().map(([accountUsername, source]) => ({
                accountUsername,
                username: source.username,
                legacy: false
            }));
            const legacySource = store.getLiveTtsSource();
            if (legacySource) {
                activeTtsSources.unshift({
                    accountUsername: null,
                    username: legacySource.username,
                    legacy: true
                });
            }
            res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                creators: listCreatorAccounts(),
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
                const username = typeof body.accountUsername === 'string'
                    ? body.accountUsername.trim().toLowerCase()
                    : '';
                if (!/^[a-zA-Z0-9._@-]{1,64}$/.test(username) ||
                    (!access.hasConfiguredUser(username) && !store.getAccount(username))) {
                    throw invalidAdminInput('Compte créateur introuvable.');
                }
                if (access.isAdminUser(username) &&
                    !['tts-create', 'tts-revoke', 'room', 'service-access'].includes(body.action)) {
                    throw invalidAdminInput('La protection de l’administrateur principal ne peut pas être modifiée ici.');
                }
                if (body.action === 'access') {
                    if (typeof body.enabled !== 'boolean') throw invalidAdminInput('État d’accès invalide.');
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
                    store.setCreatorRoom(username, roomNumber);
                } else if (body.action === 'service-access') {
                    const service = body.service;
                    if (!['games', 'tts'].includes(service) || typeof body.enabled !== 'boolean') {
                        throw invalidAdminInput('Service ou autorisation invalide.');
                    }
                    if (access.isAdminUser(username)) {
                        throw invalidAdminInput('Les droits de service de l’administrateur principal ne peuvent pas être modifiés.');
                    }
                    const targetAccount = store.getAccount(username);
                    if (body.enabled && service === 'games' &&
                        (!targetAccount || targetAccount.status !== 'ACTIVE' || !targetAccount.subscriptionId)) {
                        throw invalidAdminInput('Seul un abonnement PayPal actif peut autoriser cet accès.');
                    }
                    store.setCreatorServiceAccess(username, service, body.enabled);
                    if (service === 'games' && body.enabled) {
                        store.setUserRevoked(username, false);
                    }
                    if (service === 'tts' && !body.enabled) {
                        const existing = store.getAccountLiveTts(username);
                        if (existing) {
                            store.saveAccountLiveTts(username, null);
                            closeLiveTtsSockets(existing.username);
                        }
                    }
                    if (service === 'games' && !body.enabled) {
                        for (const [clientId, session] of applicationPresence) {
                            if (session.username.toLowerCase() === username) applicationPresence.delete(clientId);
                        }
                        closeAuthenticatedSockets(username);
                    }
                } else if (body.action === 'tts-create') {
                    if (!canUseCreatorTts(username)) {
                        throw invalidAdminInput('L’accès TTS doit d’abord être autorisé pour ce compte.');
                    }
                    const existing = store.getAccountLiveTts(username);
                    if (existing) closeLiveTtsSockets(existing.username);
                    const result = createAccountLiveTts(username, body.username);
                    res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: true, ...result }));
                    return;
                } else if (body.action === 'tts-revoke') {
                    const existing = store.getAccountLiveTts(username);
                    if (!existing) {
                        const error = new Error('Aucun lien TTS actif pour ce créateur.');
                        error.statusCode = 404;
                        throw error;
                    }
                    store.saveAccountLiveTts(username, null);
                    closeLiveTtsSockets(existing.username);
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
        });
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
            hidden: hiddenGames.includes(game.id)
        }));
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
        res.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8'
        });
        res.end(JSON.stringify({
            games,
            images: gameImages,
            metadata,
            hidden: hiddenGames,
            homepageNotice: store.getHomepageNotice() || defaultHomepageNotice
        }));
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
        res.end(JSON.stringify({ active: Boolean(source), username: source?.username || null }));
        return;
    }
    if (pathname === '/api/admin/live-sessions' && req.method === 'GET') {
        if (!access.isAuthenticated(req) || !access.isAdmin(req)) {
            res.writeHead(403, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ message: 'Accès réservé à un administrateur connecté.' }));
            return;
        }
        const source = store.getLiveTtsSource();
        const accountSources = store.listAccountLiveTtsSources().map(([, item]) => item);
        const liveSessions = [...sessions.values()]
            .filter(session => session.isLive)
            .map(session => ({
                username: session.username,
                roomId: session.roomId,
                hasTtsLink: [source, ...accountSources].some(item =>
                    item?.username.toLocaleLowerCase() === session.username.toLocaleLowerCase())
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
                        store.saveLiveTtsSource(null);
                    } else if (accountSource) {
                        store.saveAccountLiveTts(accountSource[0], null);
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
                const token = crypto.randomBytes(32).toString('hex');
                const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
                store.saveLiveTtsSource({ username, tokenHash });
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
        ['/pousoire.html', [gameFile, 'text/html; charset=utf-8']],
        ['/pendu', [hangmanFile, 'text/html; charset=utf-8']],
        ['/pendu.html', [hangmanFile, 'text/html; charset=utf-8']],
        ['/coffres', [gryphonPlinkoFile, 'text/html; charset=utf-8']],
        ['/coffres.html', [gryphonPlinkoFile, 'text/html; charset=utf-8']],
        ['/jeu-foot-tiktok.html', [footballFile, 'text/html; charset=utf-8']],
        ['/inedexd.html', [path.join(__dirname, 'inedexd.html'), 'text/html; charset=utf-8']],
        ['/gemini-code-1792321382503.js', [sixBoxesScript, 'text/javascript; charset=utf-8']],
        ['/coin-pusher-tiktok.html', [coinPusherFile, 'text/html; charset=utf-8']],
        ['/aquarium-tiktok-live.html', [aquariumLiveFile, 'text/html; charset=utf-8']],
        ['/gryphon-plinko', [gryphonPlinkoFile, 'text/html; charset=utf-8']],
        ['/index.html', [gryphonPlinkoFile, 'text/html; charset=utf-8']],
        ['/plinko.html', [plinkoFile, 'text/html; charset=utf-8']],
        ['/griffon-gauche.jpg', [gryphonImage, 'image/jpeg']],
        ['/epee-fanfan-detouree.png', [gryphonSwordImage, 'image/png']],
        ['/aquarium-fish-boss.png', [aquariumFishBossImage, 'image/png']],
        ['/images-vitrine/table-a-pieces.png', [path.join(__dirname, 'images-vitrine', 'table-a-pieces.png'), 'image/png']],
        ['/images-vitrine/pendu.png', [path.join(__dirname, 'images-vitrine', 'pendu.png'), 'image/png']],
        ['/images-vitrine/gryphon-plinko.png', [path.join(__dirname, 'images-vitrine', 'gryphon-plinko.png'), 'image/png']],
        ['/images-vitrine/aquarium-live.png', [path.join(__dirname, 'images-vitrine', 'aquarium-live.png'), 'image/png']],
        ['/images-vitrine/coin-pusher.png', [path.join(__dirname, 'images-vitrine', 'coin-pusher.png'), 'image/png']],
        ['/images-vitrine/coup-de-pied.png', [path.join(__dirname, 'images-vitrine', 'coup-de-pied.png'), 'image/png']],
        ['/images-vitrine/coffres.png', [path.join(__dirname, 'images-vitrine', 'coffres.png'), 'image/png']],
        ['/images-vitrine/six-boites.png', [path.join(__dirname, 'images-vitrine', 'six-boites.png'), 'image/png']],
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
            res.end(content.toString('utf8').replace(
                /<\/body>/i,
                '<script src="/arcade-presence.js" defer></script></body>'
            ));
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
        if (protectedRoutes.has(pathname) && !access.canAccessGames(req)) {
            res.writeHead(302, {
                'Cache-Control': 'no-store',
                Location: access.isAuthenticated(req) ? '/?acces=jeux' : '/?connexion=requise'
            });
            res.end();
            return;
        }
        const [requestedFile, contentType] = route;
        fs.readFile(requestedFile, (error, content) => {
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
                ? content.toString('utf8').replace(
                    /<\/body>/i,
                    '<script src="/arcade-presence.js" defer></script></body>'
                )
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
function closeLiveTtsSockets(username) {
    for (const socket of liveTtsSockets) {
        if (username && liveTtsClientUsernames.get(socket)?.toLocaleLowerCase() !== username.toLocaleLowerCase()) continue;
        socket.terminate();
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
    if ((!access.isAuthenticated(req) || !access.canAccessGames(req)) && !ttsSource) {
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
const sessions = new Map();
const clientSessions = new Map();

function detachClient(socket) {
    const sessionKey = clientSessions.get(socket);
    if (!sessionKey) return;
    clientSessions.delete(socket);
    const session = sessions.get(sessionKey);
    if (!session) return;
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
        const encoded = JSON.stringify(messageData);
        for (const client of session.clients) {
            if (client.readyState === WebSocket.OPEN) client.send(encoded);
        }
    }, session.username, ({ connected, roomId }) => {
        session.isLive = connected;
        session.roomId = roomId;
    });
}

wss.on('connection', (socket, req) => {
    const liveTtsUsername = liveTtsClientUsernames.get(socket);
    if (!liveTtsUsername && access.isAuthenticated(req)) {
        authenticatedClientUsernames.set(socket, access.usernameForRequest(req));
    }
    if (liveTtsUsername) {
        socket.send(JSON.stringify({ type: 'TTS_CONFIG', username: liveTtsUsername }));
    }
    socket.on('message', message => {
        let request;
        try {
            request = JSON.parse(message.toString());
        } catch (error) {
            console.warn('Message reçu du jeu invalide :', error.message);
            return;
        }
        if (request.action !== 'CONNECT_TIKTOK') return;

        const requestedUsername = String(request.username || '').trim().replace(/^@/, '');
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
        const currentSessionKey = clientSessions.get(socket);
        if (currentSessionKey === sessionKey) {
            const currentSession = sessions.get(sessionKey);
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
            session = { username, clients: new Set(), disconnect: null, statusMessage: '', roomId: null, isLive: false };
            sessions.set(sessionKey, session);
            startTikTokSession(session);
        }
        session.clients.add(socket);
        clientSessions.set(socket, sessionKey);
        socket.send(JSON.stringify({
            type: 'STATUS',
            message: session.statusMessage || `Connexion TikTok en cours · @${username}`
        }));
    });
    socket.on('close', () => {
        liveTtsSockets.delete(socket);
        authenticatedClientUsernames.delete(socket);
        detachClient(socket);
    });
    socket.on('error', error => {
        console.warn('Erreur WebSocket client :', error.message);
    });
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Serveur lancé sur le port ${port}`);
    if (!access.hasUsers) {
        console.warn('Accès aux jeux fermé : configure au moins un compte dans GAME_USERS_JSON.');
    }
});