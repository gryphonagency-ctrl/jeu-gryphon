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

function invalidAdminInput(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
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
        const id = crypto.randomUUID();
        const filename = `${id}.${image.extension}`;
        const directory = store.getGameFilesDirectory();
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, filename), image.buffer, { flag: 'wx', mode: 0o600 });
        const previousImage = store.saveGameImage(gameId, filename);
        if (previousImage && /^[a-f0-9-]{36}\.(?:png|jpe?g|webp)$/.test(previousImage)) {
            try {
                fs.unlinkSync(path.join(directory, previousImage));
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
        return { success: true, gameId, image: `/game-assets/${filename}` };
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
        res.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8'
        });
        res.end(JSON.stringify({
            authenticated: access.isAuthenticated(req),
            configured: access.hasUsers,
            isAdmin: access.isAdmin(req),
            username: access.usernameForRequest(req)
        }));
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
            image: `/game-assets/${game.image}`,
            hidden: hiddenGames.includes(game.id)
        }));
        const gameImages = {};
        const metadata = {};
        for (const gameId of staticGameIds) {
            const image = store.getGameImage(gameId);
            if (image) gameImages[gameId] = `/game-assets/${image}`;
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
        ['/matter.min.js', [matterFile, 'text/javascript; charset=utf-8']],
        ['/node_modules/matter-js/build/matter.min.js', [matterFile, 'text/javascript; charset=utf-8']],
        ['/ballon-foot-reel.jpg', [footballImage, 'image/jpeg']]
    ]);
    const route = routes.get(pathname);

    if (pathname.startsWith('/uploaded-games/')) {
        if (!access.isAuthenticated(req)) {
            res.writeHead(302, { 'Cache-Control': 'no-store', Location: '/?connexion=requise' });
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
        if (protectedRoutes.has(pathname) && !access.isAuthenticated(req)) {
            res.writeHead(302, { 'Cache-Control': 'no-store', Location: '/?connexion=requise' });
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
            res.end(content);
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
server.on('upgrade', (req, socket, head) => {
    if (!access.isAuthenticated(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, webSocket => {
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

wss.on('connection', socket => {
    socket.on('message', message => {
        let request;
        try {
            request = JSON.parse(message.toString());
        } catch (error) {
            console.warn('Message reçu du jeu invalide :', error.message);
            return;
        }
        if (request.action !== 'CONNECT_TIKTOK') return;

        const username = String(request.username || '').trim().replace(/^@/, '');
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
            session = { username, clients: new Set(), disconnect: null, statusMessage: '' };
            session.disconnect = createTikTokSession(messageData => {
                if (messageData.type === 'STATUS') session.statusMessage = messageData.message;
                const encoded = JSON.stringify(messageData);
                for (const client of session.clients) {
                    if (client.readyState === WebSocket.OPEN) client.send(encoded);
                }
            }, username);
            sessions.set(sessionKey, session);
        }
        session.clients.add(socket);
        clientSessions.set(socket, sessionKey);
        socket.send(JSON.stringify({
            type: 'STATUS',
            message: session.statusMessage || `Connexion TikTok en cours · @${username}`
        }));
    });
    socket.on('close', () => {
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