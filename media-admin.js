const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const dns = require('dns').promises;
const net = require('net');
const https = require('https');
const ffmpegPath = process.env.FFMPEG_PATH || require('ffmpeg-static');

const MEDIA_MAX_BYTES = 45 * 1024 * 1024;
const VIDEO_CONVERSION_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_PENDING_VIDEO_CONVERSIONS = 3;
const USER_QUOTA_BYTES = 300 * 1024 * 1024;
const USER_MAX_FILES = 100;
const MEDIA_TYPES = {
    mp3: ['audio', 'audio/mpeg'], wav: ['audio', 'audio/wav'], ogg: ['audio', 'audio/ogg'], m4a: ['audio', 'audio/mp4'],
    mp4: ['video', 'video/mp4'], webm: ['video', 'video/webm'], mov: ['video', 'video/quicktime'],
    m4v: ['video', 'video/mp4'], mkv: ['video', 'video/x-matroska'], avi: ['video', 'video/x-msvideo'],
    wmv: ['video', 'video/x-ms-wmv'], flv: ['video', 'video/x-flv'], mpeg: ['video', 'video/mpeg'],
    mpg: ['video', 'video/mpeg'], '3gp': ['video', 'video/3gpp'],
    png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'],
    webp: ['image', 'image/webp'], gif: ['image', 'image/gif']
};
const FILE_PATTERN = /^[a-f0-9-]{36}\.(?:mp3|wav|ogg|m4a|mp4|webm|png|jpe?g|webp|gif)$/;
const OWNER_PATTERN = /^[a-z0-9._-]{1,64}$/;
const EVENT_PATTERN = /^[a-z0-9_-]{1,60}$/;
const MAX_TIKTOK_GIFTS = 2000;
const MAX_TIKTOK_GIFT_SELECTION = 2048;
const IMPORT_TIMEOUT_MS = 20000;
let pendingVideoConversions = 0;
let videoConversionQueue = Promise.resolve();

function isAllowedGiftImageUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return false;
    if (!value || /^\/images-vitrine\/petit-trot-cadeaux\/[a-z0-9_.-]+\.png$/i.test(value)) return true;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
        return false;
    }
}

function normalizeCatalogGift(gift) {
    const id = gift?.id;
    const name = typeof gift?.name === 'string' ? gift.name.trim() : '';
    const coinValue = gift?.coinValue ?? null;
    const imageUrl = gift?.imageUrl ?? '';
    if (!Number.isSafeInteger(id) || id < 1 || !name || name.length > 100 ||
        typeof imageUrl !== 'string' ||
        (coinValue !== null && (!Number.isSafeInteger(coinValue) || coinValue < 0)) ||
        !isAllowedGiftImageUrl(imageUrl)) return null;
    return { id, name, coinValue, imageUrl };
}

function isGiftAlertEvent(event) {
    return typeof event === 'string' && /^gift(?:_id_\d+|_[a-z0-9_-]+)$/.test(event);
}

const DEFAULT_OVERLAY_TOOL_ORDER = Object.freeze(['likes', 'chat', 'leaderboard', 'stats', 'timer', 'wheel']);
const OVERLAY_TOOL_IDS = new Set(DEFAULT_OVERLAY_TOOL_ORDER);

function normalizeOverlayToolOrder(order) {
    const requested = Array.isArray(order)
        ? order.filter(id => typeof id === 'string' && OVERLAY_TOOL_IDS.has(id))
        : [];
    return [...new Set([...requested, ...DEFAULT_OVERLAY_TOOL_ORDER])];
}

function isValidOverlayToolOrder(order) {
    return Array.isArray(order) &&
        order.length === DEFAULT_OVERLAY_TOOL_ORDER.length &&
        new Set(order).size === DEFAULT_OVERLAY_TOOL_ORDER.length &&
        order.every(id => OVERLAY_TOOL_IDS.has(id));
}

function probeVideo(inputPath) {
    if (!ffmpegPath) {
        return Promise.reject(Object.assign(new Error('La vérification vidéo est indisponible sur ce serveur.'), { statusCode: 503 }));
    }
    return new Promise((resolve, reject) => {
        let child;
        let output = '';
        let finished = false;
        const finish = (error, details) => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            if (error) reject(error);
            else resolve(details);
        };
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            finish(Object.assign(new Error('La vérification vidéo a dépassé son délai.'), { statusCode: 400 }));
        }, 15000);
        try {
            child = spawn(ffmpegPath, ['-hide_banner', '-i', inputPath], { stdio: ['ignore', 'ignore', 'pipe'] });
        } catch {
            finish(Object.assign(new Error('Impossible de démarrer la vérification vidéo sur ce serveur.'), { statusCode: 503 }));
            return;
        }
        child.stderr.on('data', chunk => {
            output += chunk.toString();
            if (output.length > 65536) {
                child.kill('SIGKILL');
                finish(Object.assign(new Error('Les informations de cette vidéo sont trop volumineuses.'), { statusCode: 400 }));
            }
        });
        child.once('error', () => finish(Object.assign(new Error('Impossible de démarrer la vérification vidéo sur ce serveur.'), { statusCode: 503 })));
        child.once('close', () => {
            if (finished) return;
            const videoLine = output.split(/\r?\n/).find(line => /Stream #\d+:\d+.*Video:/i.test(line));
            const match = videoLine && /Video:\s*([^\s,(]+).*?,\s*([a-z][a-z0-9_]*)(?:\([^)]*\))?,/i.exec(videoLine);
            if (!match) return finish(Object.assign(new Error('Aucune piste vidéo exploitable n’a été trouvée.'), { statusCode: 400 }));
            const [, codec, pixelFormat] = match;
            const hasAlpha = /^yuva|^(?:gbrap|rgba|bgra|argb|abgr)/i.test(pixelFormat) ||
                /ALPHA_MODE\s*:\s*1/i.test(output);
            finish(null, { codec: codec.toLowerCase(), hasAlpha });
        });
    });
}

function runVideoConversion(inputPath) {
    if (!ffmpegPath) {
        return Promise.reject(Object.assign(new Error('La conversion vidéo est indisponible sur ce serveur.'), { statusCode: 503 }));
    }

    return probeVideo(inputPath).then(probe => {
        const outputExtension = probe.hasAlpha ? '.webm' : '.mp4';
        const outputPath = path.join(path.dirname(inputPath), `converted-${crypto.randomUUID()}${outputExtension}`);
        const args = [
            '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
            '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1'
        ];
        if (probe.hasAlpha && probe.codec === 'vp9') args.push('-c:v', 'libvpx-vp9');
        else if (probe.hasAlpha && probe.codec === 'vp8') args.push('-c:v', 'libvpx');
        args.push('-i', inputPath, '-map', '0:v:0', '-map', '0:a:0?');
        if (probe.hasAlpha) {
            args.push('-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '4',
                '-crf', '32', '-b:v', '0', '-pix_fmt', 'yuva420p',
                '-c:a', 'libopus', '-b:a', '96k', '-f', 'webm');
        } else {
            args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
                '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart');
        }
        args.push('-threads', '1', outputPath);

        return new Promise((resolve, reject) => {
            let child;
            let stopReason = null;
            let finished = false;
            const timeout = setTimeout(() => {
                stopReason = 'timeout';
                child.kill('SIGKILL');
            }, VIDEO_CONVERSION_TIMEOUT_MS);
            const sizeCheck = setInterval(() => {
                try {
                    if (fs.statSync(outputPath).size > MEDIA_MAX_BYTES) {
                        stopReason = 'size';
                        child.kill('SIGKILL');
                    }
                } catch (error) {
                    if (error.code !== 'ENOENT') {
                        stopReason = 'storage';
                        child.kill('SIGKILL');
                    }
                }
            }, 500);
            const finish = (error, converted) => {
                if (finished) return;
                finished = true;
                clearTimeout(timeout);
                clearInterval(sizeCheck);
                if (error) reject(error);
                else resolve(converted);
            };
            try {
                child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'ignore'] });
            } catch {
                finish(Object.assign(new Error('Impossible de démarrer la conversion vidéo sur ce serveur.'), { statusCode: 503 }));
                return;
            }
            child.once('error', () => finish(Object.assign(new Error('Impossible de démarrer la conversion vidéo sur ce serveur.'), { statusCode: 503 })));
            child.once('close', code => {
                if (stopReason === 'timeout') {
                    return finish(Object.assign(new Error('La conversion vidéo a dépassé 3 minutes. Essaie une vidéo plus courte.'), { statusCode: 413 }));
                }
                if (stopReason === 'size') {
                    return finish(Object.assign(new Error('La vidéo convertie dépasse la limite de 45 Mo.'), { statusCode: 413 }));
                }
                if (stopReason === 'storage') {
                    return finish(Object.assign(new Error('Espace temporaire insuffisant pour convertir cette vidéo.'), { statusCode: 507 }));
                }
                if (code !== 0) {
                    return finish(Object.assign(new Error('Cette vidéo est illisible ou endommagée. Essaie un fichier vidéo valide.'), { statusCode: 400 }));
                }
                try {
                    const stat = fs.statSync(outputPath);
                    if (!stat.size || stat.size > MEDIA_MAX_BYTES) {
                        return finish(Object.assign(new Error('La vidéo convertie dépasse la limite de 45 Mo.'), { statusCode: 413 }));
                    }
                    finish(null, { path: outputPath, extension: outputExtension });
                } catch {
                    finish(Object.assign(new Error('La conversion vidéo n’a pas produit de fichier exploitable.'), { statusCode: 400 }));
                }
            });
        });
    });
}

function transcodeVideo(inputPath) {
    if (pendingVideoConversions >= MAX_PENDING_VIDEO_CONVERSIONS) {
        return Promise.reject(Object.assign(new Error('Trop de vidéos sont en attente de conversion. Réessaie dans quelques instants.'), { statusCode: 503 }));
    }
    pendingVideoConversions++;
    const conversion = videoConversionQueue.then(() => runVideoConversion(inputPath));
    videoConversionQueue = conversion.catch(() => {});
    return conversion.finally(() => { pendingVideoConversions--; });
}

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
                        request.destroy(Object.assign(new Error('Le fichier dépasse 45 Mo.'), { statusCode: 400 }));
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
function createMediaAdmin({
    mediaDirectory,
    persistent = true,
    getUser,
    canManage,
    canManageCarousel = canManage,
    canManageUser,
    getTikTokUsername = () => '',
    readJsonBody
}) {
    const usersDir = path.join(mediaDirectory, 'users');
    const tokensPath = path.join(mediaDirectory, 'overlay-tokens.json');
    const activeUploads = new Set();

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

    function normalizeTikTokUsername(value) {
        const username = typeof value === 'string' ? value.trim().replace(/^@/, '') : '';
        return /^[a-zA-Z0-9._]{1,32}$/.test(username) ? username : '';
    }

    function overlayUsername(owner) {
        const entry = readTokens()[owner];
        return normalizeTikTokUsername(entry?.username) ||
            normalizeTikTokUsername(getTikTokUsername(owner));
    }

    function setOverlayUsername(owner, username) {
        const normalized = normalizeTikTokUsername(username);
        if (!normalized) throw fail('Saisis un pseudo TikTok valide, sans espace.');
        const tokens = readTokens();
        if (!/^[a-f0-9]{64}$/.test(tokens[owner]?.token || '')) {
            throw fail('Génère d’abord ton lien overlay.');
        }
        tokens[owner] = { ...tokens[owner], username: normalized };
        writeTokens(tokens);
        return normalized;
    }

    // Un lien d'overlay secret (64 hex) par compte ; le régénérer invalide l'ancien.
    function overlayToken(owner, mode) {
        const tokens = readTokens();
        const current = tokens[owner]?.token;
        if (mode === 'get' || (mode === 'create' && /^[a-f0-9]{64}$/.test(current || ''))) return current || null;
        const token = crypto.randomBytes(32).toString('hex');
        tokens[owner] = { ...tokens[owner], token, createdAt: new Date().toISOString() };
        writeTokens(tokens);
        return token;
    }

    function findOverlay(token) {
        if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
        const provided = crypto.createHash('sha256').update(token).digest();
        let found = null;
        for (const [owner, entry] of Object.entries(readTokens())) {
            const stored = crypto.createHash('sha256').update(String(entry?.token || '')).digest();
            if (crypto.timingSafeEqual(stored, provided) && OWNER_PATTERN.test(owner)) found = owner;
        }
        if (!found || !canManageUser(found)) return null;
        return { owner: found, username: overlayUsername(found) };
    }

    function findOverlayOwner(token) {
        return findOverlay(token)?.owner || null;
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
        let content;
        try {
            content = fs.readFileSync(indexPath(owner), 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    files: [],
                    alerts: {},
                    carouselAlerts: {},
                    giftCatalog: [],
                    overlayToolOrder: [...DEFAULT_OVERLAY_TOOL_ORDER]
                };
            }
            throw error;
        }
        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (error) {
            throw new Error(`Le catalogue des médias de ${owner} est illisible. Aucun média n’a été modifié.`, { cause: error });
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.files) ||
            (parsed.alerts !== undefined && (!parsed.alerts || typeof parsed.alerts !== 'object' || Array.isArray(parsed.alerts))) ||
            (parsed.carouselAlerts !== undefined &&
                (!parsed.carouselAlerts || typeof parsed.carouselAlerts !== 'object' || Array.isArray(parsed.carouselAlerts)))) {
            throw new Error(`Le catalogue des médias de ${owner} est invalide. Aucun média n’a été modifié.`);
        }
        const giftCatalog = parsed.giftCatalog === undefined ? [] : parsed.giftCatalog;
        if (!Array.isArray(giftCatalog) || giftCatalog.length > MAX_TIKTOK_GIFTS) {
            throw new Error(`Le catalogue des cadeaux TikTok de ${owner} est invalide.`);
        }
        const normalizedGiftCatalog = giftCatalog.map(normalizeCatalogGift);
        if (normalizedGiftCatalog.some(gift => !gift)) {
            throw new Error(`Le catalogue des cadeaux TikTok de ${owner} est invalide.`);
        }
        const alerts = parsed.alerts || {};
        const carouselAlerts = parsed.carouselAlerts || {};
        if (parsed.carouselAlerts === undefined) {
            for (const [event, alert] of Object.entries(alerts)) {
                if (!isGiftAlertEvent(event) || typeof alert?.giftName !== 'string') continue;
                carouselAlerts[event] = alert;
                delete alerts[event];
            }
        }
        return {
            files: parsed.files,
            alerts,
            carouselAlerts,
            giftCatalog: normalizedGiftCatalog,
            overlayToolOrder: normalizeOverlayToolOrder(parsed.overlayToolOrder)
        };
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

    function receiveUpload(req, res, owner) {
        let original;
        try {
            original = decodeURIComponent(String(req.headers['x-file-name'] || '')).trim().slice(0, 120);
        } catch {
            send(res, 400, { message: 'Nom de fichier invalide.' });
            req.resume();
            return;
        }
        const extension = path.extname(original).toLowerCase();
        if (!original || !MEDIA_TYPES[extension.slice(1)]) {
            send(res, 400, { message: 'Format de fichier non pris en charge.' });
            req.resume();
            return;
        }
        if (req.headers['content-type'] !== 'application/octet-stream') {
            send(res, 415, { message: 'Format de requête invalide. Actualise la page Médias et réessaie.' });
            req.resume();
            return;
        }
        const lengthHeader = req.headers['content-length'];
        const expectedSize = lengthHeader === undefined ? null : Number(lengthHeader);
        if (expectedSize !== null && (!Number.isSafeInteger(expectedSize) || expectedSize <= 0)) {
            send(res, 400, { message: 'Taille de fichier invalide.' });
            req.resume();
            return;
        }
        if (expectedSize > MEDIA_MAX_BYTES) {
            send(res, 413, { message: 'Le fichier doit faire 45 Mo maximum.' });
            req.resume();
            return;
        }
        if (activeUploads.has(owner)) {
            send(res, 429, { message: 'Un envoi est déjà en cours pour ce compte. Réessaie dans quelques instants.' });
            req.resume();
            return;
        }

        activeUploads.add(owner);
        let directory;
        let inputPath;
        let output;
        try {
            fs.mkdirSync(ownerDir(owner), { recursive: true });
            directory = fs.mkdtempSync(path.join(ownerDir(owner), '.upload-'));
            inputPath = path.join(directory, `input${extension}`);
            output = fs.createWriteStream(inputPath, { flags: 'wx', mode: 0o600 });
        } catch (error) {
            activeUploads.delete(owner);
            send(res, 500, { message: 'Impossible de préparer le stockage du média.' });
            console.error('Échec de préparation de l’envoi média :', error.message);
            req.resume();
            return;
        }

        let settled = false;
        let receivedSize = 0;
        let writeFinished = false;
        let streamClosed = false;
        const cleanup = () => {
            try {
                fs.rmSync(directory, { recursive: true, force: true });
            } catch (error) {
                console.error('Échec du nettoyage du téléversement temporaire :', error.message);
            }
        };
        const release = () => activeUploads.delete(owner);
        const sendFailure = error => {
            if (settled) return;
            settled = true;
            req.unpipe(output);
            output.destroy();
            req.resume();
            if (output.closed) cleanup();
            else output.once('close', cleanup);
            release();
            const status = error.statusCode || 500;
            if (status === 500) console.error('Échec de réception du média :', error.message);
            if (!res.destroyed && !res.writableEnded) {
                send(res, status, { message: status === 500 ? 'Impossible d’enregistrer le média.' : error.message });
            }
        };
        const finishUpload = () => {
            if (settled || !writeFinished || !streamClosed) return;
            if (!receivedSize) return sendFailure(fail('Le fichier est vide.'));
            if (expectedSize !== null && receivedSize !== expectedSize) {
                return sendFailure(fail('L’envoi du fichier est incomplet. Réessaie.'));
            }
            storeMediaFromPath(owner, original, inputPath, receivedSize).then(result => {
                if (settled) return;
                settled = true;
                cleanup();
                release();
                if (!res.destroyed && !res.writableEnded) send(res, 200, result);
            }).catch(sendFailure);
        };

        req.on('data', chunk => {
            receivedSize += chunk.length;
            if (receivedSize > MEDIA_MAX_BYTES) {
                sendFailure(fail('Le fichier doit faire 45 Mo maximum.', 413));
            }
        });
        req.once('aborted', () => sendFailure(fail('Envoi interrompu.')));
        req.once('error', sendFailure);
        output.once('error', sendFailure);
        output.once('finish', () => { writeFinished = true; finishUpload(); });
        output.once('close', () => { streamClosed = true; finishUpload(); });
        req.pipe(output);
    }

    async function storeMediaFromPath(owner, originalName, inputPath, inputSize) {
        const index = readIndex(owner);
        const original = String(originalName || '').trim().slice(0, 120);
        let extension = path.extname(original).toLowerCase();
        const type = MEDIA_TYPES[extension.slice(1)];
        if (!type) throw fail('Format non pris en charge (audio mp3/wav/ogg/m4a, vidéo mp4/webm/mov/m4v/mkv/avi/wmv/flv/mpeg/3gp, png, jpg, webp ou gif).');
        if (!inputSize || inputSize > MEDIA_MAX_BYTES) throw fail('Le fichier doit faire 45 Mo maximum.');
        let storedName = original;
        let storedPath = inputPath;
        if (type[0] === 'video') {
            const converted = await transcodeVideo(inputPath);
            storedPath = converted.path;
            const basename = path.basename(original, path.extname(original));
            extension = converted.extension;
            storedName = `${basename}${extension}`;
        }
        const stat = fs.statSync(storedPath);
        if (!stat.size || stat.size > MEDIA_MAX_BYTES) throw fail('La vidéo convertie dépasse la limite de 45 Mo.', 413);
        const used = index.files.reduce((sum, file) => sum + (file.size || 0), 0);
        if (index.files.length >= USER_MAX_FILES || used + stat.size > USER_QUOTA_BYTES) {
            throw fail('Espace média plein : supprime des fichiers avant d’en ajouter (300 Mo / 100 fichiers max).', 413);
        }
        const id = `${crypto.randomUUID()}${extension}`;
        fs.mkdirSync(ownerDir(owner), { recursive: true });
        const finalPath = path.join(ownerDir(owner), id);
        fs.renameSync(storedPath, finalPath);
        const file = { id, name: storedName, kind: type[0], size: stat.size, createdAt: new Date().toISOString() };
        index.files.push(file);
        try {
            writeIndex(owner, index);
        } catch (error) {
            try { fs.unlinkSync(finalPath); } catch (cleanupError) {
                if (cleanupError.code !== 'ENOENT') console.error('Échec du nettoyage du média non indexé :', cleanupError.message);
            }
            throw error;
        }
        return { success: true, file: publicFile(owner, file) };
    }

    async function storeMedia(owner, originalName, buffer) {
        if (!buffer.length || buffer.length > MEDIA_MAX_BYTES) throw fail('Le fichier doit faire 45 Mo maximum.');
        const original = String(originalName || '').trim().slice(0, 120);
        const extension = path.extname(original).toLowerCase();
        const type = MEDIA_TYPES[extension.slice(1)];
        if (!type) throw fail('Format non pris en charge.');
        fs.mkdirSync(ownerDir(owner), { recursive: true });
        const directory = fs.mkdtempSync(path.join(ownerDir(owner), '.upload-'));
        const inputPath = path.join(directory, `input${extension}`);
        try {
            fs.writeFileSync(inputPath, buffer, { flag: 'wx', mode: 0o600 });
            return await storeMediaFromPath(owner, original, inputPath, buffer.length);
        } finally {
            try { fs.rmSync(directory, { recursive: true, force: true }); } catch (error) {
                console.error('Échec du nettoyage du média temporaire :', error.message);
            }
        }
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

    function handleAction(owner, body, carouselOnly = false) {
        if (!carouselOnly &&
            ['cache-tiktok-gift-catalog', 'add-tiktok-gifts'].includes(body?.action)) {
            throw fail('La gestion du catalogue TikTok est réservée à la page Carrousel.');
        }
        if (carouselOnly) {
            const allowedActions = new Set([
                'overlay-create', 'overlay-regenerate', 'overlay-revoke',
                'cache-tiktok-gift-catalog', 'add-tiktok-gifts', 'set-alert', 'delete-alert'
            ]);
            if (!body || typeof body !== 'object' || !allowedActions.has(body.action)) {
                throw fail('Cette action n’est pas disponible depuis la page Carrousel.');
            }
            if ((body.action === 'set-alert' || body.action === 'delete-alert') &&
                !isGiftAlertEvent(body.event)) {
                throw fail('Seuls les réglages des cadeaux peuvent être modifiés depuis la page Carrousel.');
            }
        }
        const index = readIndex(owner);
        const alertStore = carouselOnly ? index.carouselAlerts : index.alerts;
        if (body.action === 'set-overlay-tool-order') {
            if (carouselOnly || !isValidOverlayToolOrder(body.order)) {
                throw fail('L’ordre des panneaux d’overlay est invalide.');
            }
            index.overlayToolOrder = [...body.order];
            writeIndex(owner, index);
            return { success: true, overlayToolOrder: index.overlayToolOrder };
        }
        if (body.action === 'upload') {
            throw fail('Actualise la page Médias avant de renvoyer le fichier.');
        }
        if (body.action === 'import-url') return importFromUrl(owner, body.url);
        if (body.action === 'overlay-create' || body.action === 'overlay-regenerate') {
            const username = normalizeTikTokUsername(body.username || overlayUsername(owner));
            if (!username && !carouselOnly) {
                throw fail('Saisis ton pseudo TikTok pour connecter les overlays à ton direct.');
            }
            const token = overlayToken(owner, body.action === 'overlay-create' ? 'create' : 'regenerate');
            if (username) setOverlayUsername(owner, username);
            return { success: true, overlayPath: overlayPath(token), overlayUsername: username };
        }
        if (body.action === 'overlay-set-username') {
            if (carouselOnly) throw fail('Cette action n’est pas disponible depuis la page Carrousel.');
            return { success: true, overlayUsername: setOverlayUsername(owner, body.username) };
        }
        if (body.action === 'overlay-revoke') { revokeOverlay(owner); return { success: true, overlayPath: null }; }
        if (body.action === 'cache-tiktok-gift-catalog') {
            if (!Array.isArray(body.gifts) || !body.gifts.length || body.gifts.length > MAX_TIKTOK_GIFTS) {
                throw fail('Le catalogue des cadeaux TikTok est invalide.');
            }
            const incomingGifts = new Map();
            for (const gift of body.gifts) {
                const normalizedGift = normalizeCatalogGift(gift);
                if (!normalizedGift) throw fail('Les informations d’un cadeau TikTok sont invalides.');
                incomingGifts.set(normalizedGift.id, normalizedGift);
            }
            const catalog = new Map(index.giftCatalog.map(gift => [gift.id, gift]));
            for (const [id, gift] of incomingGifts) {
                const previousGift = catalog.get(id);
                catalog.delete(id);
                catalog.set(id, {
                    ...previousGift,
                    ...gift,
                    imageUrl: gift.imageUrl || previousGift?.imageUrl || ''
                });
            }
            index.giftCatalog = [...catalog.values()].slice(-MAX_TIKTOK_GIFTS);
            writeIndex(owner, index);
            return { success: true, cached: incomingGifts.size, total: index.giftCatalog.length };
        }
        if (body.action === 'add-tiktok-gifts') {
            if (!Array.isArray(body.gifts) || !body.gifts.length || body.gifts.length > MAX_TIKTOK_GIFT_SELECTION) {
                throw fail('La liste des cadeaux TikTok est invalide.');
            }
            const gifts = new Map();
            for (const gift of body.gifts) {
                const giftId = gift?.id;
                const giftName = typeof gift?.name === 'string' ? gift.name.trim() : '';
                const giftImageUrl = typeof gift?.imageUrl === 'string' ? gift.imageUrl : '';
                const hasGiftId = Number.isSafeInteger(giftId) && giftId > 0;
                const giftSlug = giftName.toLowerCase().replace(/[^a-z0-9_ -]/g, '').replace(/ +/g, '_').slice(0, 53);
                if ((!hasGiftId && giftId !== null) ||
                    !giftName || giftName.length > 100 || giftImageUrl.length > 2048) {
                    throw fail('Les informations d’un cadeau TikTok sont invalides.');
                }
                if (!isAllowedGiftImageUrl(giftImageUrl)) throw fail('L’image d’un cadeau TikTok doit utiliser HTTPS.');
                if (!hasGiftId && !giftSlug) throw fail('Le nom d’un cadeau TikTok est invalide.');
                const key = hasGiftId ? `gift_id_${giftId}` : `gift_${giftSlug}`;
                gifts.set(key, {
                    ...(hasGiftId ? { giftId } : {}),
                    giftName,
                    giftImageUrl
                });
            }
            let added = 0;
            for (const gift of gifts.values()) {
                const key = gift.giftId ? `gift_id_${gift.giftId}` : `gift_${gift.giftName.toLowerCase().replace(/[^a-z0-9_ -]/g, '').replace(/ +/g, '_').slice(0, 53)}`;
                const previousAlert = index.carouselAlerts[key] || {};
                if (!previousAlert.giftName) added++;
                index.carouselAlerts[key] = {
                    ...previousAlert,
                    ...gift,
                    giftImageUrl: gift.giftImageUrl || previousAlert.giftImageUrl || '',
                    actionText: previousAlert.actionText ?? gift.giftName
                };
            }
            writeIndex(owner, index);
            return { success: true, added, alreadyAdded: gifts.size - added };
        }
        if (body.action === 'delete') {
            if (typeof body.id !== 'string' || !FILE_PATTERN.test(body.id)) throw fail('Fichier invalide.');
            if (!index.files.some(file => file.id === body.id)) throw fail('Fichier introuvable.', 404);
            // Un média relié à une alerte n'est jamais supprimé en silence : il faut d'abord retirer l'alerte.
            const usedBy = Object.entries({ ...index.alerts, ...index.carouselAlerts })
                .find(([, alert]) => alert.audio === body.id || alert.video === body.id);
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
            const previousVolume = Number.isFinite(alertStore[event]?.videoVolume)
                ? alertStore[event].videoVolume
                : 1;
            const videoVolume = body.videoVolume === undefined ? previousVolume : body.videoVolume;
            if (typeof videoVolume !== 'number' || !Number.isFinite(videoVolume) ||
                videoVolume < 0 || videoVolume > 1) {
                throw fail('Le volume vidéo doit être compris entre 0 et 100 %.');
            }
            const previousAlert = alertStore[event] || {};
            const videoFit = body.videoFit === undefined ? previousAlert.videoFit || 'contain' : body.videoFit;
            const videoWidth = body.videoWidth === undefined ? previousAlert.videoWidth ?? 100 : body.videoWidth;
            const videoHeight = body.videoHeight === undefined ? previousAlert.videoHeight ?? 100 : body.videoHeight;
            const videoOffsetY = body.videoOffsetY === undefined ? previousAlert.videoOffsetY ?? 0 : body.videoOffsetY;
            if (!['contain', 'cover'].includes(videoFit)) throw fail('Le cadrage vidéo est invalide.');
            if (![videoWidth, videoHeight].every(value =>
                typeof value === 'number' && Number.isFinite(value) && value >= 25 && value <= 150)) {
                throw fail('La taille de la vidéo doit être comprise entre 25 et 150 %.');
            }
            if (typeof videoOffsetY !== 'number' || !Number.isFinite(videoOffsetY) ||
                videoOffsetY < -50 || videoOffsetY > 50) {
                throw fail('La position verticale doit être comprise entre -50 et +50 % de l’écran.');
            }
            const giftEventId = /^gift_id_(\d+)$/.exec(event);
            let giftMetadata = {};
            const isKnownGift = !giftEventId && event.startsWith('gift_') &&
                (typeof body.giftName === 'string' || typeof previousAlert.giftName === 'string');
            if (giftEventId || isKnownGift) {
                const giftId = body.giftId ?? previousAlert.giftId;
                const giftName = String(body.giftName ?? previousAlert.giftName ?? '').trim();
                const actionText = String(body.actionText ?? previousAlert.actionText ?? '').trim();
                const giftImageUrl = body.giftImageUrl ?? previousAlert.giftImageUrl ?? '';
                const giftSlug = giftName.toLowerCase().replace(/[^a-z0-9_ -]/g, '').replace(/ +/g, '_').slice(0, 53);
                if ((giftEventId && (!Number.isSafeInteger(giftId) || giftId < 1 || String(giftId) !== giftEventId[1])) ||
                    (!giftEventId && (!giftSlug || event !== `gift_${giftSlug}`)) ||
                    !giftName || giftName.length > 100 || actionText.length > 80) {
                    throw fail('Les informations du cadeau TikTok sont invalides.');
                }
                if (typeof giftImageUrl !== 'string' || giftImageUrl.length > 2048) {
                    throw fail('L’image du cadeau TikTok est invalide.');
                }
                if (!isAllowedGiftImageUrl(giftImageUrl)) throw fail('L’image du cadeau TikTok doit utiliser HTTPS.');
                giftMetadata = {
                    ...(giftEventId ? { giftId } : {}),
                    giftName,
                    actionText,
                    giftImageUrl
                };
            }
            alertStore[event] = {
                audio: pick(body.audio, 'audio'),
                video: pick(body.video, 'video'),
                videoVolume,
                videoFit,
                videoWidth,
                videoHeight,
                videoOffsetY,
                ...giftMetadata
            };
            writeIndex(owner, index);
            return { success: true };
        }
        if (body.action === 'delete-alert') {
            if (typeof body.event !== 'string' || !alertStore[body.event]) throw fail('Alerte introuvable.', 404);
            delete alertStore[body.event];
            writeIndex(owner, index);
            return { success: true };
        }
        throw fail('Action inconnue.');
    }

    function publicAlerts(owner, carouselOnly = false) {
        const alerts = {};
        const index = readIndex(owner);
        const source = carouselOnly ? index.carouselAlerts : index.alerts;
        for (const [event, alert] of Object.entries(source)) {
            alerts[event] = {
                audioUrl: alert.audio ? `/media-files/${owner}/${alert.audio}` : null,
                videoUrl: alert.video ? `/media-files/${owner}/${alert.video}` : null,
                videoVolume: Number.isFinite(alert.videoVolume) ? Math.min(1, Math.max(0, alert.videoVolume)) : 1,
                videoFit: alert.videoFit === 'cover' ? 'cover' : 'contain',
                videoWidth: Number.isFinite(alert.videoWidth) ? Math.min(150, Math.max(25, alert.videoWidth)) : 100,
                videoHeight: Number.isFinite(alert.videoHeight) ? Math.min(150, Math.max(25, alert.videoHeight)) : 100,
                videoOffsetY: Number.isFinite(alert.videoOffsetY) ? Math.min(50, Math.max(-50, alert.videoOffsetY)) : 0,
                ...(typeof alert.giftName === 'string' && alert.giftName.length <= 100 ? {
                    ...(Number.isSafeInteger(alert.giftId) && alert.giftId > 0 ? { giftId: alert.giftId } : {}),
                    giftName: String(alert.giftName || '').slice(0, 100),
                    actionText: String(alert.actionText || '').slice(0, 80),
                    giftImageUrl: typeof alert.giftImageUrl === 'string' && alert.giftImageUrl.length <= 2048 &&
                        (/^https:\/\//i.test(alert.giftImageUrl) ||
                            /^\/images-vitrine\/petit-trot-cadeaux\/[a-z0-9_.-]+\.png$/i.test(alert.giftImageUrl))
                        ? alert.giftImageUrl : ''
                } : {})
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
            try {
                const carouselOnly = searchParams?.get('mode') === 'carousel';
                const index = readIndex(owner);
                send(res, 200, {
                    alerts: publicAlerts(owner, carouselOnly)
                });
            } catch (error) {
                console.error(`Impossible de lire le catalogue média de ${owner} :`, error.message);
                send(res, 500, { message: 'Impossible de lire les médias de cet overlay.' });
            }
            return true;
        }
        if (pathname === '/api/media-alerts' && req.method === 'GET') {
            const owner = String(searchParams?.get('user') || '').trim().toLowerCase();
            if (!OWNER_PATTERN.test(owner)) { send(res, 400, { message: 'Compte invalide.' }); return true; }
            const alerts = {};
            try {
                for (const [event, alert] of Object.entries(readIndex(owner).alerts)) {
                    alerts[event] = {
                        audioUrl: alert.audio ? `/media-files/${owner}/${alert.audio}` : null,
                        videoUrl: alert.video ? `/media-files/${owner}/${alert.video}` : null,
                        videoVolume: Number.isFinite(alert.videoVolume) ? Math.min(1, Math.max(0, alert.videoVolume)) : 1,
                        videoFit: alert.videoFit === 'cover' ? 'cover' : 'contain',
                        videoWidth: Number.isFinite(alert.videoWidth) ? Math.min(150, Math.max(25, alert.videoWidth)) : 100,
                        videoHeight: Number.isFinite(alert.videoHeight) ? Math.min(150, Math.max(25, alert.videoHeight)) : 100,
                        videoOffsetY: Number.isFinite(alert.videoOffsetY) ? Math.min(50, Math.max(-50, alert.videoOffsetY)) : 0
                    };
                }
            } catch (error) {
                console.error(`Impossible de lire le catalogue média de ${owner} :`, error.message);
                send(res, 500, { message: 'Impossible de lire les médias de cet overlay.' });
                return true;
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
        const isUpload = pathname === '/api/media/upload';
        const carouselOnly = pathname === '/api/gift-carousel';
        if (pathname !== '/api/media' && !isUpload && !carouselOnly) return false;
        const user = String(getUser(req) || '').trim().toLowerCase();
        const mayManage = carouselOnly ? canManageCarousel(req, user) : canManage(req, user);
        if (!user || !OWNER_PATTERN.test(user) || !mayManage) {
            if (req.method === 'POST') req.resume();
            send(res, 403, { message: carouselOnly
                ? 'Connecte-toi à ton compte pour gérer ton carrousel.'
                : 'La gestion des médias est réservée aux abonnés et aux comptes autorisés.' });
            return true;
        }
        if (isUpload) {
            if (req.method !== 'POST') {
                send(res, 405, { message: 'Méthode non autorisée.' });
                return true;
            }
            receiveUpload(req, res, user);
            return true;
        }
        if (req.method === 'GET') {
            try {
                const index = readIndex(user);
                send(res, 200, {
                    user,
                    files: index.files
                        .filter(file => !carouselOnly || file.kind === 'audio' || file.kind === 'video')
                        .map(file => publicFile(user, file)),
                    alerts: carouselOnly ? index.carouselAlerts : index.alerts,
                    giftCatalog: carouselOnly ? index.giftCatalog : [],
                    overlayToolOrder: carouselOnly ? undefined : index.overlayToolOrder,
                    persistent,
                    overlayPath: overlayPath(overlayToken(user, 'get')),
                    overlayUsername: overlayUsername(user),
                    limits: { fileBytes: MEDIA_MAX_BYTES, totalBytes: USER_QUOTA_BYTES, files: USER_MAX_FILES }
                });
            } catch (error) {
                console.error(`Impossible de lire le catalogue média de ${user} :`, error.message);
                send(res, 500, { message: 'Impossible de lire ta bibliothèque média. Aucun fichier n’a été supprimé.' });
            }
            return true;
        }
        if (req.method === 'POST') {
            readJsonBody(req, res, body => {
                Promise.resolve().then(() => handleAction(user, body, carouselOnly)).then(result => send(res, 200, result)).catch(error => {
                    const status = error.statusCode || 500;
                    if (status === 500) console.error('Échec de la gestion des médias :', error.message);
                    send(res, status, { message: status === 500 ? 'Impossible d’enregistrer le média.' : error.message });
                });
            }, 8 * 1024 * 1024);
            return true;
        }
        return false;
    }

    handle.findOverlay = findOverlay;
    handle.findOverlayOwner = findOverlayOwner;
    return handle;
}

module.exports = { createMediaAdmin };
