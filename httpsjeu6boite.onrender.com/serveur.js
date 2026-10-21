const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createTikTokSession } = require('./tiktok-session');

const port = Number(process.env.PORT) || 3000;
const configuredMaxTikTokSessions = Number(process.env.MAX_TIKTOK_SESSIONS);
const maxTikTokSessions = Number.isSafeInteger(configuredMaxTikTokSessions) &&
    configuredMaxTikTokSessions > 0 ? configuredMaxTikTokSessions : 25;
const gameFile = path.join(__dirname, 'pousoire.html');
const hangmanFile = path.join(__dirname, 'pendu.html');
const chestsFile = path.join(__dirname, 'coffres.html');
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

const server = http.createServer((req, res) => {
    const pathname = req.url.split('?', 1)[0];
    const routes = new Map([
        ['/', [gameFile, 'text/html; charset=utf-8']],
        ['/pousoire.html', [gameFile, 'text/html; charset=utf-8']],
        ['/pendu', [hangmanFile, 'text/html; charset=utf-8']],
        ['/pendu.html', [hangmanFile, 'text/html; charset=utf-8']],
        ['/coffres', [chestsFile, 'text/html; charset=utf-8']],
        ['/coffres.html', [chestsFile, 'text/html; charset=utf-8']],
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

    if (route) {
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

const wss = new WebSocket.Server({ server });
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
});