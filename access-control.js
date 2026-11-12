const crypto = require('crypto');
const store = require('./account-store');

const SESSION_COOKIE = 'gryphon_session';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const PRIMARY_ADMIN_USERNAME = 'gryphon.agency';
const ADMIN_USERNAMES = new Set([PRIMARY_ADMIN_USERNAME, 'mrbobo']);
const sessions = new Map();
const loginAttempts = new Map();

function loadUsers() {
    const configuredUsers = process.env.GAME_USERS_JSON;
    if (!configuredUsers) return new Map();

    let parsed;
    try {
        parsed = JSON.parse(configuredUsers);
    } catch (error) {
        throw new Error('GAME_USERS_JSON must contain a valid JSON object.', { cause: error });
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('GAME_USERS_JSON must be a JSON object of usernames and passwords.');
    }

    const users = new Map();
    for (const [username, password] of Object.entries(parsed)) {
        if (!/^[a-zA-Z0-9._@-]{1,64}$/.test(username.trim()) ||
            typeof password !== 'string' || password.length < 12 || password.length > 256) {
            throw new Error('Each GAME_USERS_JSON account needs a valid username and a password between 12 and 256 characters.');
        }
        users.set(username.trim().toLowerCase(), password);
    }
    return users;
}

const users = loadUsers();

function getClientKey(req) {
    const forwardedAddresses = req.headers['x-forwarded-for'];
    if (typeof forwardedAddresses === 'string') {
        const addresses = forwardedAddresses.split(',').map(address => address.trim()).filter(Boolean);
        if (addresses.length) return addresses[addresses.length - 1];
    }
    return req.socket.remoteAddress || 'unknown';
}

function isAuthenticated(req) {
    const { token, session } = getRequestSession(req);
    if (!session) return false;
    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return false;
    }
    const administrator = isAdminUser(session.username);
    if (administrator) return true;
    const data = store.getSessionData(session.username);
    if (data.creatorRemoved || (session.storeBacked && !data.account) || data.userRevoked) {
        sessions.delete(token);
        return false;
    }
    return true;
}

function getRequestSession(req) {
    const cookieHeader = req.headers.cookie || '';
    const token = cookieHeader.split(';').map(item => item.trim())
        .find(item => item.startsWith(`${SESSION_COOKIE}=`))
        ?.slice(SESSION_COOKIE.length + 1);
    return { token, session: token ? sessions.get(token) : null };
}

function usernameForRequest(req) {
    const { session } = getRequestSession(req);
    return session && session.expiresAt > Date.now() ? session.username || '' : '';
}

function getSessionContext(req) {
    const { token, session } = getRequestSession(req);
    const now = Date.now();
    if (!session || session.expiresAt <= now) {
        if (session) sessions.delete(token);
        return {
            authenticated: false,
            configured: users.size > 0 || store.hasAccounts(),
            isAdmin: false,
            username: '',
            hasSubscription: false,
            canUseTts: false,
            canAccessGames: false,
            creatorSettings: {},
            creatorTts: null,
            roomNumber: null
        };
    }

    const username = session.username || '';
    const administrator = isAdminUser(username);
    const data = store.getSessionData(username);
    if ((!administrator && data.creatorRemoved) ||
        (session.storeBacked && !administrator && !data.account) ||
        (!administrator && data.userRevoked)) {
        sessions.delete(token);
        return {
            authenticated: false,
            configured: users.size > 0 || data.hasAccounts,
            isAdmin: false,
            username: '',
            hasSubscription: false,
            canUseTts: false,
            canAccessGames: false,
            creatorSettings: {},
            creatorTts: null,
            roomNumber: null
        };
    }

    const activeSubscription = hasActiveSubscription(data.account, now);
    const roomSettings = data.creatorSettings;
    const manualAccessExpiresAt = data.account?.accessMode === 'MANUAL'
        ? Date.parse(data.account.accessExpiresAt || '')
        : NaN;
    const manualAccessExpired = data.account?.accessMode === 'MANUAL' &&
        data.account.accessExpiresAt !== undefined &&
        (!Number.isFinite(manualAccessExpiresAt) || manualAccessExpiresAt <= now);
    const canUseRoom = administrator || (!manualAccessExpired &&
        (data.account?.accessMode === 'MANUAL' ||
            hasConfiguredUser(username) ||
            activeSubscription));

    return {
        authenticated: true,
        configured: users.size > 0 || data.hasAccounts,
        isAdmin: administrator,
        username,
        hasSubscription: activeSubscription,
        canUseTts: canUseCreatorServiceFromData(username, 'tts', data, now),
        canAccessGames: canUseCreatorServiceFromData(username, 'games', data, now),
        creatorSettings: data.creatorSettings,
        creatorTts: data.creatorTts,
        roomNumber: roomSettings.roomNumber && !roomSettings.roomRevoked &&
            !data.creatorRemoved && !data.userRevoked && canUseRoom
            ? roomSettings.roomNumber
            : null
    };
}

function canUseCreatorService(username, service) {
    if (isAdminUser(username)) return true;
    return canUseCreatorServiceFromData(username, service, store.getSessionData(username));
}

function canUseCarousel(username) {
    if (typeof username !== 'string') return false;
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{1,64}$/.test(normalizedUsername)) return false;
    if (isAdminUser(normalizedUsername)) return true;
    const data = store.getSessionData(normalizedUsername);
    return !data.creatorRemoved && !data.userRevoked &&
        Boolean(data.account || hasConfiguredUser(normalizedUsername));
}

function canUseCreatorServiceFromData(username, service, data, now = Date.now()) {
    if (isAdminUser(username)) return true;
    if (data.creatorRemoved || data.userRevoked) return false;
    if (data.account?.accessMode === 'MANUAL') {
        if (data.account.accessExpiresAt !== undefined) {
            const accessExpiresAt = Date.parse(data.account.accessExpiresAt);
            if (!Number.isFinite(accessExpiresAt) || accessExpiresAt <= now) return false;
        }
        return data.serviceRevocations[service] !== true &&
            data.serviceAccess[service] === true;
    }
    if (hasConfiguredUser(username)) {
        return data.serviceRevocations[service] !== true &&
            data.serviceAccess[service] !== false;
    }
    return hasActiveSubscription(data.account, now);
}

function hasActiveSubscription(account, now = Date.now()) {
    if (!account?.subscriptionId) return false;
    const paidAt = Date.parse(account.lastPaymentAt || account.createdAt || '');
    if (!Number.isFinite(paidAt)) return false;
    const duration = account.plan === 'annuel' ? 365 : 30;
    return now < paidAt + duration * 24 * 60 * 60 * 1000;
}

function hasConfiguredUser(username) {
    return users.has(username.trim().toLowerCase());
}

function listConfiguredUsers() {
    return [...users.keys()];
}

function isAdminUser(username) {
    return typeof username === 'string' &&
        ADMIN_USERNAMES.has(username.trim().toLowerCase());
}

function isAdmin(req) {
    return isAuthenticated(req) && isAdminUser(usernameForRequest(req));
}

function canAccessGames(req, gameId) {
    if (!isAuthenticated(req)) return false;
    const username = usernameForRequest(req);
    if (gameId === '/clowns-tomates.html') {
        return username === PRIMARY_ADMIN_USERNAME;
    }
    if (isAdminUser(username)) return true;
    return canUseCreatorService(username, 'games') &&
        (gameId === undefined || store.isCreatorGameAllowed(username, gameId));
}

function hasAdminUsers() {
    return [...ADMIN_USERNAMES].some(username =>
        users.has(username) || Boolean(store.getAccount(username))
    );
}

function login(username, password, req, res) {
    const now = Date.now();
    const clientKey = getClientKey(req);
    const attempts = loginAttempts.get(clientKey);
    if (attempts && attempts.expiresAt > now && attempts.count >= MAX_LOGIN_ATTEMPTS) {
        return { success: false, limited: true };
    }
    if (attempts && attempts.expiresAt <= now) loginAttempts.delete(clientKey);

    const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
    const configuredPassword = users.get(normalizedUsername);
    const providedPassword = typeof password === 'string' && password.length <= 256 ? password : '';
    const storedAccount = store.getAccount(normalizedUsername);
    const administrator = isAdminUser(normalizedUsername);
    let matches = false;
    if (!administrator && store.isCreatorRemoved(normalizedUsername)) {
        matches = false;
    } else if (storedAccount) {
        const providedHash = crypto.scryptSync(providedPassword, storedAccount.salt, 64);
        const storedHash = Buffer.from(storedAccount.passwordHash, 'hex');
        matches = (administrator || (
            !store.isUserRevoked(normalizedUsername))) &&
            storedHash.length === providedHash.length &&
            crypto.timingSafeEqual(providedHash, storedHash);
    } else if (configuredPassword !== undefined) {
        const providedBuffer = Buffer.from(providedPassword);
        const configuredBuffer = Buffer.from(configuredPassword);
        matches = (administrator || !store.isUserRevoked(normalizedUsername)) &&
            providedBuffer.length === configuredBuffer.length &&
            crypto.timingSafeEqual(providedBuffer, configuredBuffer);
    }

    if (!matches) {
        const current = loginAttempts.get(clientKey);
        loginAttempts.set(clientKey, {
            count: current && current.expiresAt > now ? current.count + 1 : 1,
            expiresAt: current && current.expiresAt > now
                ? current.expiresAt
                : now + RATE_LIMIT_WINDOW_MS
        });
        return { success: false, limited: false };
    }

    loginAttempts.delete(clientKey);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = now + SESSION_DURATION_MS;
    sessions.set(token, {
        expiresAt,
        username: normalizedUsername,
        storeBacked: Boolean(storedAccount)
    });
    const secure = req.socket.encrypted ||
        req.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https';
    const cookie = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION_MS / 1000}${secure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', cookie);
    return { success: true, limited: false, expiresAt };
}

function logout(req, res) {
    const cookieHeader = req.headers.cookie || '';
    const token = cookieHeader.split(';').map(item => item.trim())
        .find(item => item.startsWith(`${SESSION_COOKIE}=`))
        ?.slice(SESSION_COOKIE.length + 1);
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function revokeUserSessions(username) {
    const normalizedUsername = username.trim().toLowerCase();
    for (const [token, session] of sessions) {
        if (session.username === normalizedUsername) sessions.delete(token);
    }
}

module.exports = {
    get hasUsers() {
        return users.size > 0 || store.hasAccounts();
    },
    hasAdminUsers,
    hasActiveSubscription,
    hasConfiguredUser,
    canAccessGames,
    canUseCarousel,
    canUseCreatorService,
    getSessionContext,
    isCreatorRemoved: store.isCreatorRemoved,
    isAdminUser,
    isAdmin,
    isAuthenticated,
    listConfiguredUsers,
    login,
    logout,
    revokeUserSessions,
    usernameForRequest
};
