const crypto = require('crypto');

const FREE_GAME_IDS = Object.freeze([
    '/course-anneaux.html',
    '/combat-retro.html',
    '/pendu.html',
    '/mots-associes.html',
    '/mot-du-live.html',
    '/qui-veut-gagner-des-etoiles.html',
    '/lion-temple-maya.html',
    '/petits-chevaux-tiktok.html',
    '/jeu-foot-tiktok.html',
    '/super-mario-live.html',
    '/course-de-billes.html',
    '/billes-tour.html',
    '/flipper-neon.html',
    '/bouteilles-colorees.html',
    '/gryphon-blackjack.html',
    '/telepusher.html',
    '/grand-prix-pokemon.html',
    '/pachinko-live.html',
    '/live-photo-printer-studio.html'
]);

const FREE_GAME_PATHS = new Map(FREE_GAME_IDS.map(gameId => [gameId, gameId]));
FREE_GAME_PATHS.set('/pendu', '/pendu.html');

const SESSION_COOKIE = 'gryphon_free_game_session';
const STATE_COOKIE = 'gryphon_tiktok_oauth_state';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const STATE_DURATION_MS = 10 * 60 * 1000;
const sessions = new Map();
const loginStates = new Map();

function getTikTokProfileId(openId) {
    return crypto.createHash('sha256').update(openId).digest('hex');
}

function cookieValue(req, name) {
    const cookieHeader = req.headers.cookie || '';
    const prefix = `${name}=`;
    return cookieHeader.split(';').map(item => item.trim())
        .find(item => item.startsWith(prefix))
        ?.slice(prefix.length) || '';
}

function secureCookie(req, name, value, maxAge) {
    const secure = req.socket.encrypted ||
        req.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https';
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function clearCookie(req, name) {
    return secureCookie(req, name, '', 0);
}

function getOAuthConfiguration() {
    const clientKey = process.env.TIKTOK_CLIENT_KEY || '';
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET || '';
    const redirectUri = process.env.TIKTOK_REDIRECT_URI || '';
    let parsedRedirect;
    try {
        parsedRedirect = new URL(redirectUri);
    } catch {
        return null;
    }
    if (!clientKey || !clientSecret || parsedRedirect.protocol !== 'https:' ||
        parsedRedirect.search || parsedRedirect.hash) return null;
    return { clientKey, clientSecret, redirectUri };
}

function normalizeReturnTo(value) {
    if (typeof value !== 'string' || value.length > 512) return '/#jeux';
    let target;
    try {
        target = new URL(value, 'https://local.invalid');
    } catch {
        return '/#jeux';
    }
    if (target.origin !== 'https://local.invalid' || !FREE_GAME_PATHS.has(target.pathname)) {
        return '/#jeux';
    }
    return `${target.pathname}${target.search}`;
}

function sendPage(res, status, title, message, actionHref = '', actionLabel = '') {
    const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
    const action = actionHref
        ? `<p><a href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a></p>`
        : '';
    res.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
    });
    res.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#101827;color:#fff;font:16px system-ui,sans-serif"><main style="max-width:560px;margin:24px;padding:28px;border:1px solid #37516b;border-radius:16px;background:#17243a"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${action}</main></body></html>`);
}

function startLogin(req, res, returnTo) {
    const config = getOAuthConfiguration();
    if (!config) {
        sendPage(
            res,
            503,
            'Connexion TikTok indisponible',
            'La connexion TikTok Login Kit n’est pas encore configurée sur Render.'
        );
        return;
    }

    const now = Date.now();
    for (const [state, entry] of loginStates) {
        if (entry.expiresAt <= now) loginStates.delete(state);
    }
    const state = crypto.randomBytes(32).toString('hex');
    const redirectTo = normalizeReturnTo(returnTo);
    loginStates.set(state, { expiresAt: now + STATE_DURATION_MS, returnTo: redirectTo });
    const authorizeUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
    authorizeUrl.search = new URLSearchParams({
        client_key: config.clientKey,
        response_type: 'code',
        scope: 'user.info.basic,user.info.profile',
        redirect_uri: config.redirectUri,
        state
    }).toString();
    res.writeHead(302, {
        'Cache-Control': 'no-store',
        Location: authorizeUrl.toString(),
        'Set-Cookie': secureCookie(req, STATE_COOKIE, state, Math.ceil(STATE_DURATION_MS / 1000))
    });
    res.end();
}

async function completeLogin(req, res, requestUrl, store) {
    const config = getOAuthConfiguration();
    const returnedState = requestUrl.searchParams.get('state') || '';
    const stateCookie = cookieValue(req, STATE_COOKIE);
    const pending = loginStates.get(returnedState);
    loginStates.delete(returnedState);

    if (!config || !pending || pending.expiresAt <= Date.now() ||
        !/^[a-f0-9]{64}$/.test(returnedState) ||
        !/^[a-f0-9]{64}$/.test(stateCookie) ||
        !crypto.timingSafeEqual(Buffer.from(returnedState), Buffer.from(stateCookie))) {
        res.setHeader('Set-Cookie', clearCookie(req, STATE_COOKIE));
        sendPage(res, 403, 'Connexion refusée', 'La session de connexion a expiré ou n’est pas valide. Recommence depuis le jeu.');
        return;
    }

    const oauthError = requestUrl.searchParams.get('error');
    const code = requestUrl.searchParams.get('code') || '';
    if (oauthError || !code || code.length > 4096) {
        res.setHeader('Set-Cookie', clearCookie(req, STATE_COOKIE));
        sendPage(res, 403, 'Connexion TikTok annulée', 'TikTok n’a pas autorisé la connexion au jeu.');
        return;
    }

    try {
        const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_key: config.clientKey,
                client_secret: config.clientSecret,
                code,
                grant_type: 'authorization_code',
                redirect_uri: config.redirectUri
            }),
            signal: AbortSignal.timeout(10000)
        });
        if (!tokenResponse.ok) throw new Error(`Échange du code TikTok refusé (${tokenResponse.status}).`);
        const tokenPayload = await tokenResponse.json();
        const accessToken = tokenPayload?.data?.access_token;
        if (typeof accessToken !== 'string' || !accessToken) {
            throw new Error('TikTok n’a pas fourni de jeton de connexion.');
        }

        const profileUrl = new URL('https://open.tiktokapis.com/v2/user/info/');
        profileUrl.searchParams.set('fields', 'open_id,username,display_name');
        const profileResponse = await fetch(profileUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10000)
        });
        if (!profileResponse.ok) throw new Error(`Lecture du profil TikTok refusée (${profileResponse.status}).`);
        const profilePayload = await profileResponse.json();
        const profile = profilePayload?.data?.user;
        const openId = profile?.open_id;
        const username = profile?.username;
        const displayName = profile?.display_name;
        if (typeof openId !== 'string' || !openId || typeof username !== 'string' ||
            !/^[a-zA-Z0-9._]{1,32}$/.test(username) ||
            typeof displayName !== 'string' || !displayName.trim() || displayName.length > 80) {
            throw new Error('Le pseudo TikTok vérifié est indisponible. Vérifie que le scope user.info.profile est autorisé pour l’application.');
        }

        const playerId = getTikTokProfileId(openId);
        store.upsertTikTokFreeGamePlayer({
            id: playerId,
            username,
            displayName: displayName.trim()
        });
        const token = crypto.randomBytes(32).toString('hex');
        const now = Date.now();
        sessions.set(token, { playerId, expiresAt: now + SESSION_DURATION_MS });
        for (const [sessionToken, session] of sessions) {
            if (session.expiresAt <= now) sessions.delete(sessionToken);
        }
        res.writeHead(303, {
            'Cache-Control': 'no-store',
            Location: pending.returnTo,
            'Set-Cookie': [
                clearCookie(req, STATE_COOKIE),
                secureCookie(req, SESSION_COOKIE, token, Math.ceil(SESSION_DURATION_MS / 1000))
            ]
        });
        res.end();
    } catch (error) {
        console.error('Échec de connexion TikTok Login Kit :', error.message);
        res.setHeader('Set-Cookie', clearCookie(req, STATE_COOKIE));
        sendPage(
            res,
            502,
            'Connexion TikTok impossible',
            'Impossible de vérifier le pseudo TikTok. Vérifie la configuration Login Kit et le scope user.info.profile, puis réessaie.'
        );
    }
}

function getIdentity(req) {
    const token = cookieValue(req, SESSION_COOKIE);
    const session = /^[a-f0-9]{64}$/.test(token) ? sessions.get(token) : null;
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
    }
    return { playerId: session.playerId };
}

function getPlayerStatus(req, store, date) {
    const identity = getIdentity(req);
    return identity ? store.getTikTokFreeGameStatus(identity.playerId, date) : null;
}

function logout(req, res) {
    const token = cookieValue(req, SESSION_COOKIE);
    if (/^[a-f0-9]{64}$/.test(token)) sessions.delete(token);
    res.writeHead(204, {
        'Cache-Control': 'no-store',
        'Set-Cookie': clearCookie(req, SESSION_COOKIE)
    });
    res.end();
}

function sendAccessPage(res, status, kind, returnTo = '') {
    if (kind === 'unauthenticated') {
        const loginUrl = `/auth/tiktok?returnTo=${encodeURIComponent(returnTo)}`;
        sendPage(
            res,
            status,
            'Connexion TikTok requise',
            'Connecte-toi avec TikTok pour utiliser les jeux gratuits. Le temps est cumulé sur l’ensemble de ces jeux et remis à zéro chaque jour à minuit (heure de Paris).',
            loginUrl,
            'Continuer avec TikTok'
        );
        return;
    }
    if (kind === 'banned') {
        sendPage(res, status, 'Accès suspendu', 'L’accès aux jeux gratuits a été bloqué par l’administrateur.');
        return;
    }
    sendPage(res, status, 'Temps de jeu atteint', 'La limite quotidienne de jeu gratuit est atteinte. Réessaie demain (heure de Paris).');
}

function isFreeGamePath(pathname) {
    return FREE_GAME_PATHS.has(pathname);
}

function requiresTikTokAccess(pathname, hasArcadeGameAccess) {
    return isFreeGamePath(pathname) && !hasArcadeGameAccess;
}

module.exports = {
    FREE_GAME_IDS,
    completeLogin,
    getIdentity,
    getPlayerStatus,
    isFreeGamePath,
    logout,
    requiresTikTokAccess,
    sendAccessPage,
    startLogin
};
