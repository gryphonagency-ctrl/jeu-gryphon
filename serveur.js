const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const port = 3000;
const gameFile = path.join(__dirname, 'pousoire.html');
const hangmanFile = path.join(__dirname, 'pendu.html');
const chestsFile = path.join(__dirname, 'coffres.html');
const footballFile = path.join(__dirname, 'jeu-foot-tiktok.html');
const footballImage = path.join(__dirname, 'ballon-foot-reel.jpg');
const coinPusherFile = path.join(__dirname, 'coin-pusher-tiktok.html');
const aquariumLiveFile = path.join(__dirname, 'aquarium-tiktok-live.html');
const aquariumFishBossImage = path.join(__dirname, 'aquarium-fish-boss.png');
const gryphonPlinkoFile = path.join(__dirname, 'index.html');
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
        ['/coin-pusher-tiktok.html', [coinPusherFile, 'text/html; charset=utf-8']],
        ['/aquarium-tiktok-live.html', [aquariumLiveFile, 'text/html; charset=utf-8']],
        ['/gryphon-plinko', [gryphonPlinkoFile, 'text/html; charset=utf-8']],
        ['/index.html', [gryphonPlinkoFile, 'text/html; charset=utf-8']],
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

wss.on('connection', socket => {
    console.log('Client connecté au jeu.');
    socket.on('message', message => {
        for (const client of wss.clients) {
            if (client !== socket && client.readyState === WebSocket.OPEN) {
                client.send(message.toString());
            }
        }
    });
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Serveur lancé : http://127.0.0.1:${port}`);
});