const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// Chaque compte autorisé gère ses propres médias dans <mediaDirectory>/users/<compte>/.
function createMediaAdmin({ mediaDirectory, getUser, canManage, readJsonBody }) {
    const usersDir = path.join(mediaDirectory, 'users');
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

    function handleAction(owner, body) {
        const index = readIndex(owner);
        if (body.action === 'upload') {
            const original = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
            const extension = path.extname(original).toLowerCase();
            const type = MEDIA_TYPES[extension.slice(1)];
            if (!type) throw fail('Format non pris en charge (mp3, wav, ogg, m4a, mp4, webm, png, jpg, webp, gif).');
            const base64 = typeof body.data === 'string' ? body.data.replace(/^data:[^,]*,/, '') : '';
            const buffer = Buffer.from(base64, 'base64');
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
        if (body.action === 'delete') {
            if (typeof body.id !== 'string' || !FILE_PATTERN.test(body.id)) throw fail('Fichier invalide.');
            if (!index.files.some(file => file.id === body.id)) throw fail('Fichier introuvable.', 404);
            index.files = index.files.filter(file => file.id !== body.id);
            for (const alert of Object.values(index.alerts)) {
                if (alert.audio === body.id) alert.audio = null;
                if (alert.video === body.id) alert.video = null;
            }
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
    return function handle(req, res, pathname, searchParams) {
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
                limits: { fileBytes: MEDIA_MAX_BYTES, totalBytes: USER_QUOTA_BYTES, files: USER_MAX_FILES }
            });
            return true;
        }
        if (req.method === 'POST') {
            readJsonBody(req, res, body => {
                try {
                    send(res, 200, handleAction(user, body));
                } catch (error) {
                    const status = error.statusCode || 500;
                    if (status === 500) console.error('Échec de la gestion des médias :', error.message);
                    send(res, status, { message: status === 500 ? 'Impossible d’enregistrer le média.' : error.message });
                }
            }, Math.ceil(MEDIA_MAX_BYTES * 1.4) + 8192);
            return true;
        }
        return false;
    };
}

module.exports = { createMediaAdmin };
