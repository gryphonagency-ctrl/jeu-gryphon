const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const https = require('https');

const MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const USER_QUOTA_BYTES = 300 * 1024 * 1024;
const USER_MAX_FILES = 100;
const MEDIA_TYPES = {
    mp3: ['audio', 'audio/mpeg'], wav: ['audio', 'audio/wav'], ogg: ['audio', 'audio/ogg'], m4a: ['audio', 'audio/mp4'],
    mp4: ['video', 'video/mp4'], webm: ['video', 'video/webm'],
    png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'],
    webp: ['image', 'image/webp'], gif: ['image', 'image/gif']
};
const FILE_PATTERN = /^[a-f0-9-]{36}\.(?:mp3|wav|ogg|m4a|mp4|webm|png|jpe?g|webp|gif)$/;
const OWNER_PATTERN = /^[a-z0-9._-]{1,64}$/;
const EVENT_PATTERN = /^[a-z0-9_-]{1,60}$/;
const IMPORT_TIMEOUT_MS = 20000;

function isPublicAddress(address) {
    if (net.isIPv4(address)) {
        const [a, b] = address.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
    }
    if (net.isIPv6(address)) {
        const lower = address.toLowerCase();
        if (lower.startsWith('::ffff:')) return isPublicAddress(lower.slice(7));
        return !(lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower));
    }
    return false;
}

// Télécharge en https uniquement, vers des IP publiques (adresse validée puis utilisée telle quelle), avec limite de taille.
function safeDownload(rawUrl, maxBytes, redirects = 3) {
    return new Promise((resolve, reject) => {
        let url;
        try { url = new URL(rawUrl); } catch { return reject(Object.assign(new Error('Lien invalide.'), { statusCode: 400 })); }
        if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
            return reject(Object.assign(new Error('Seuls les liens https:// sont acceptés.'), { statusCode: 400 }));
        }
        dns.lookup(url.hostname, { all: true }).then(addresses => {
            if (!addresses.length || !addresses.every(item => isPublicAddress(item.address))) {
                throw Object.assign(new Error('Adresse non autorisée.'), { statusCode: 400 });
            }
            const pinned = addresses[0];
            const request = https.request({
                host: url.hostname,
                servername: url.hostname,
                path: url.pathname + url.search,
                method: 'GET',
                headers: { 'User-Agent': 'Mozilla/5.0 GriffonArcade', Accept: '*/*' },
                lookup: (_host, options, callback) => options?.all
                    ? callback(null, [{ address: pinned.address, family: pinned.family }])
                    : callback(null, pinned.address, pinned.family),
                timeout: IMPORT_TIMEOUT_MS
            }, response => {
                if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
                    response.resume();
                    if (redirects <= 0) return reject(Object.assign(new Error('Trop de redirections.'), { statusCode: 400 }));
                    return resolve(safeDownload(new URL(response.headers.location, url).href, maxBytes, redirects - 1));
                }
                if (response.statusCode !== 200) {
                    response.resume();
                    return reject(Object.assign(new Error('Le lien est inaccessible.'), { statusCode: 400 }));
                }
                const chunks = [];
                let size = 0;
                response.on('data', chunk => {
                    size += chunk.length;
                    if (size > maxBytes) {
                        request.destroy(Object.assign(new Error('Le fichier dépasse 25 Mo.'), { statusCode: 400 }));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => resolve({ buffer: Buffer.concat(chunks), url, contentType: response.headers['content-type'] || '' }));
                response.on('error', reject);
            });
            request.on('timeout', () => request.destroy(Object.assign(new Error('Le lien a mis trop de temps à répondre.'), { statusCode: 400 })));
            request.on('error', error => reject(error.statusCode ? error : Object.assign(new Error('Impossible de télécharger ce lien.'), { statusCode: 400 })));
            request.end();
        }).catch(error => reject(error.statusCode ? error : Object.assign(new Error('Lien introuvable.'), { statusCode: 400 })));
    });
}

// Chaque compte autorisé gère ses propres médias dans <mediaDirectory>/users/<compte>/.
function createMediaAdmin({ mediaDirectory, persistent = true, getUser, canManage, canManageUser, readJsonBody }) {
    const usersDir = path.join(mediaDirectory, 'users');
    const tokensPath = path.join(mediaDirectory, 'overlay-tokens.json');

    function readTokens() {
        try {
            const parsed = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }

    function writeTokens(tokens) {
        fs.mkdirSync(mediaDirectory, { recursive: true });
        const temp = `${tokensPath}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(tokens, null, 2), { mode: 0o600 });
        fs.renameSync(temp, tokensPath);
    }

    // Un lien d'overlay secret (64 hex) par compte ; le régénérer invalide l'ancien.
    function overlayToken(owner, mode) {
        const tokens = readTokens();
        const current = tokens[owner]?.token;
        if (mode === 'get' || (mode === 'create' && /^[a-f0-9]{64}$/.test(current || ''))) return current || null;
        const token = crypto.randomBytes(32).toString('hex');
        tokens[owner] = { token, createdAt: new Date().toISOString() };
        writeTokens(tokens);
        return token;
    }

    function findOverlayOwner(token) {
        if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
        const provided = crypto.createHash('sha256').update(token).digest();
        let found = null;
        for (const [owner, entry] of Object.entries(readTokens())) {
            const stored = crypto.createHash('sha256').update(String(entry?.token || '')).digest();
            if (crypto.timingSafeEqual(stored, provided) && OWNER_PATTERN.test(owner)) found = owner;
        }
        return found && canManageUser(found) ? found : null;
    }

    function revokeOverlay(owner) {
        const tokens = readTokens();
        if (!tokens[owner]) return;
        delete tokens[owner];
        writeTokens(tokens);
    }

    const overlayPath = token => token ? `/overlay/${token}` : null;
    const ownerDir = owner => path.join(usersDir, owner);
    const indexPath = owner => path.join(ownerDir(owner), 'index.json');

    function readIndex(owner) {
        try {
            const parsed = JSON.parse(fs.readFileSync(indexPath(owner), 'utf8'));
            return {
                files: Array.isArray(parsed.files) ? parsed.files : [],
                alerts: parsed.alerts && typeof parsed.alerts === 'object' ? parsed.alerts : {}
            };
        } catch {
            return { files: [], alerts: {} };
        }
    }

    function writeIndex(owner, index) {
        fs.mkdirSync(ownerDir(owner), { recursive: true });
        const temp = `${indexPath(owner)}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(index, null, 2), { mode: 0o600 });
        fs.renameSync(temp, indexPath(owner));
    }

    function send(res, status, payload) {
        res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
    }

    const publicFile = (owner, file) => ({ ...file, url: `/media-files/${owner}/${file.id}` });

    function fail(message, statusCode = 400) {
        return Object.assign(new Error(message), { statusCode });
    }

    function storeMedia(owner, originalName, buffer) {
        const index = readIndex(owner);
        const original = String(originalName || '').trim().slice(0, 120);
        const extension = path.extname(original).toLowerCase();
        const type = MEDIA_TYPES[extension.slice(1)];
        if (!type) throw fail('Format non pris en charge (mp3, wav, ogg, m4a, mp4, webm, png, jpg, webp, gif).');
        if (!buffer.length || buffer.length > MEDIA_MAX_BYTES) throw fail('Le fichier doit faire 25 Mo maximum.');
        const used = index.files.reduce((sum, file) => sum + (file.size || 0), 0);
        if (index.files.length >= USER_MAX_FILES || used + buffer.length > USER_QUOTA_BYTES) {
            throw fail('Espace média plein : supprime des fichiers avant d’en ajouter (300 Mo / 100 fichiers max).', 413);
        }
        const id = `${crypto.randomUUID()}${extension}`;
        fs.mkdirSync(ownerDir(owner), { recursive: true });
        fs.writeFileSync(path.join(ownerDir(owner), id), buffer, { flag: 'wx', mode: 0o600 });
        const file = { id, name: original, kind: type[0], size: buffer.length, createdAt: new Date().toISOString() };
        index.files.push(file);
        writeIndex(owner, index);
        return { success: true, file: publicFile(owner, file) };
    }

    async function importFromUrl(owner, rawUrl) {
        if (typeof rawUrl !== 'string' || rawUrl.length > 500) throw fail('Lien invalide.');
        let download = await safeDownload(rawUrl.trim(), MEDIA_MAX_BYTES);
        // Page d'un son MyInstants : on récupère le mp3 qu'elle référence.
        if (/(^|\.)myinstants\.com$/.test(download.url.hostname) && /text\/html/i.test(download.contentType)) {
            if (!/\/instant\//.test(download.url.pathname)) throw fail('Colle le lien d’un son précis (page « /instant/… »), pas d’une catégorie.');
            const match = /\/media\/sounds\/[A-Za-z0-9_%.\-]+\.mp3/.exec(download.buffer.toString('utf8'));
            if (!match) throw fail('Aucun son trouvé sur cette page. Utilise la page d’un son précis.');
            download = await safeDownload(new URL(match[0], download.url).href, MEDIA_MAX_BYTES);
        }
        let name = decodeURIComponent(path.basename(download.url.pathname)) || 'son.mp3';
        if (!MEDIA_TYPES[path.extname(name).slice(1).toLowerCase()]) throw fail('Le lien doit pointer vers un fichier audio, vidéo ou image (mp3, mp4, png…).');
        name = name.replace(/[^\w .()-]/g, '_');
        return storeMedia(owner, name, download.buffer);
    }

    function handleAction(owner, body) {
        const index = readIndex(owner);
        if (body.action === 'upload') {
            const base64 = typeof body.data === 'string' ? body.data.replace(/^data:[^,]*,/, '') : '';
            return storeMedia(owner, body.name, Buffer.from(base64, 'base64'));
        }
        if (body.action === 'import-url') return importFromUrl(owner, body.url);
        if (body.action === 'overlay-create') return { success: true, overlayPath: overlayPath(overlayToken(owner, 'create')) };
        if (body.action === 'overlay-regenerate') return { success: true, overlayPath: overlayPath(overlayToken(owner, 'regenerate')) };
        if (body.action === 'overlay-revoke') { revokeOverlay(owner); return { success: true, overlayPath: null }; }
        if (body.action === 'delete') {
            if (typeof body.id !== 'string' || !FILE_PATTERN.test(body.id)) throw fail('Fichier invalide.');
            if (!index.files.some(file => file.id === body.id)) throw fail('Fichier introuvable.', 404);
            // Un média relié à une alerte n'est jamais supprimé en silence : il faut d'abord retirer l'alerte.
            const usedBy = Object.entries(index.alerts).find(([, alert]) => alert.audio === body.id || alert.video === body.id);
            if (usedBy) throw fail(`Ce média est utilisé par l’alerte « ${usedBy[0]} » : change ou réinitialise l’alerte avant de le supprimer.`, 409);
            index.files = index.files.filter(file => file.id !== body.id);
            writeIndex(owner, index);
            try { fs.unlinkSync(path.join(ownerDir(owner), body.id)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            return { success: true };
        }
        if (body.action === 'set-alert') {
            const event = typeof body.event === 'string' ? body.event.trim().toLowerCase().replace(/ /g, '_') : '';
            if (!EVENT_PATTERN.test(event)) throw fail('Nom d’évènement invalide (lettres, chiffres, _ ou -).');
            const pick = (value, kind) => {
                if (!value) return null;
                const file = index.files.find(item => item.id === value);
                if (!file || file.kind !== kind) throw fail(`Média ${kind} introuvable.`);
                return value;
            };
            index.alerts[event] = { audio: pick(body.audio, 'audio'), video: pick(body.video, 'video') };
            writeIndex(owner, index);
            return { success: true };
        }
        if (body.action === 'delete-alert') {
            if (typeof body.event !== 'string' || !index.alerts[body.event]) throw fail('Alerte introuvable.', 404);
            delete index.alerts[body.event];
            writeIndex(owner, index);
            return { success: true };
        }
        throw fail('Action inconnue.');
    }

    function publicAlerts(owner) {
        const alerts = {};
        for (const [event, alert] of Object.entries(readIndex(owner).alerts)) {
            alerts[event] = {
                audioUrl: alert.audio ? `/media-files/${owner}/${alert.audio}` : null,
                videoUrl: alert.video ? `/media-files/${owner}/${alert.video}` : null
            };
        }
        return alerts;
    }

    function serveFile(req, res, owner, id) {
        const type = OWNER_PATTERN.test(owner) && FILE_PATTERN.test(id) && MEDIA_TYPES[path.extname(id).slice(1)];
        if (!type) { res.writeHead(404); res.end('Média introuvable.'); return; }
        const filePath = path.join(ownerDir(owner), id);
        fs.stat(filePath, (error, stat) => {
            if (error) { res.writeHead(404); res.end('Média introuvable.'); return; }
            const headers = {
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=3600',
                'Content-Type': type[1],
                'X-Content-Type-Options': 'nosniff',
                'Access-Control-Allow-Origin': '*'
            };
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
            if (range && (range[1] || range[2])) {
                const start = range[1] ? Number(range[1]) : Math.max(stat.size - Number(range[2]), 0);
                const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
                if (start > end || start >= stat.size) {
                    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
                    res.end();
                    return;
                }
                res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
                fs.createReadStream(filePath, { start, end }).pipe(res);
                return;
            }
            res.writeHead(200, { ...headers, 'Content-Length': stat.size });
            fs.createReadStream(filePath).pipe(res);
        });
    }

    // Retourne true si la requête a été prise en charge.
    function handle(req, res, pathname, searchParams) {
        if (pathname === '/api/overlay-alerts' && req.method === 'GET') {
            const owner = findOverlayOwner(searchParams?.get('token'));
            if (!owner) { send(res, 403, { message: 'Lien overlay invalide ou révoqué.' }); return true; }
            send(res, 200, { alerts: publicAlerts(owner) });
            return true;
        }
        if (pathname === '/api/media-alerts' && req.method === 'GET') {
            const owner = String(searchParams?.get('user') || '').trim().toLowerCase();
            if (!OWNER_PATTERN.test(owner)) { send(res, 400, { message: 'Compte invalide.' }); return true; }
            const alerts = {};
            for (const [event, alert] of Object.entries(readIndex(owner).alerts)) {
                alerts[event] = {
                    audioUrl: alert.audio ? `/media-files/${owner}/${alert.audio}` : null,
                    videoUrl: alert.video ? `/media-files/${owner}/${alert.video}` : null
                };
            }
            send(res, 200, { alerts });
            return true;
        }
        if (pathname.startsWith('/media-files/') && req.method === 'GET') {
            const [owner, id, extra] = pathname.slice('/media-files/'.length).split('/');
            if (extra !== undefined) { res.writeHead(404); res.end('Média introuvable.'); return true; }
            serveFile(req, res, owner, id);
            return true;
        }
        if (pathname !== '/api/media') return false;
        const user = String(getUser(req) || '').trim().toLowerCase();
        if (!user || !OWNER_PATTERN.test(user) || !canManage(req, user)) {
            send(res, 403, { message: 'La gestion des médias est réservée aux abonnés et aux comptes autorisés.' });
            return true;
        }
        if (req.method === 'GET') {
            const index = readIndex(user);
            send(res, 200, {
                user,
                files: index.files.map(file => publicFile(user, file)),
                alerts: index.alerts,
                persistent,
                overlayPath: overlayPath(overlayToken(user, 'get')),
                limits: { fileBytes: MEDIA_MAX_BYTES, totalBytes: USER_QUOTA_BYTES, files: USER_MAX_FILES }
            });
            return true;
        }
        if (req.method === 'POST') {
            readJsonBody(req, res, body => {
                Promise.resolve().then(() => handleAction(user, body)).then(result => send(res, 200, result)).catch(error => {
                    const status = error.statusCode || 500;
                    if (status === 500) console.error('Échec de la gestion des médias :', error.message);
                    send(res, status, { message: status === 500 ? 'Impossible d’enregistrer le média.' : error.message });
                });
            }, Math.ceil(MEDIA_MAX_BYTES * 1.4) + 8192);
            return true;
        }
        return false;
    }

    handle.findOverlayOwner = findOverlayOwner;
    return handle;
}

module.exports = { createMediaAdmin };
