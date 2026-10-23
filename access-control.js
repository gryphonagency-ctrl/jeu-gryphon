const crypto = require('crypto');
const store = require('./account-store');

const SESSION_COOKIE = 'gryphon_session';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const ADMIN_USERNAME = 'gryphon.agency';
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
    const cookieHeader = req.headers.cookie || '';
    const token = cookieHeader.split(';').map(item => item.trim())
        .find(item => item.startsWith(`${SESSION_COOKIE}=`))
        ?.slice(SESSION_COOKIE.length + 1);
    if (!token) return false;

    const session = sessions.get(token);
    if (!session) return false;
    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return false;
    }
    const administrator = isAdminUser(session.username);
    if (!administrator && store.isCreatorRemoved(session.username)) {
        sessions.delete(token);
        return false;
    }
    if (session.storeBacked) {
        const account = store.getAccount(session.username);
        if (!administrator && !account) {
            sessions.delete(token);
            return false;
        }
    }
    if (!administrator && store.isUserRevoked(session.username)) {
        sessions.delete(token);
        return false;
    }
    return true;
}

function usernameForRequest(req) {
    const cookieHeader = req.headers.cookie || '';
    const token = cookieHeader.split(';').map(item => item.trim())
        .find(item => item.startsWith(`${SESSION_COOKIE}=`))
        ?.slice(SESSION_COOKIE.length + 1);
    if (!token) return '';
    const session = sessions.get(token);
    return session && session.expiresAt > Date.now() ? session.username || '' : '';
}

function canUseCreatorService(username, service) {
    if (isAdminUser(username)) return true;
    const account = store.getAccount(username);
    if (store.isCreatorRemoved(username) ||
        store.isUserRevoked(username) ||
        !store.isCreatorServiceEnabled(username, service)) return false;

    const explicitAccess = store.getCreatorServiceAccess(username, service);
    if (explicitAccess === false) return false;
    return Boolean(account?.subscriptionId && account.status === 'ACTIVE');
}

function hasConfiguredUser(username) {
    return users.has(username.trim().toLowerCase());
}

function listConfiguredUsers() {
    return [...users.keys()];
}

function isAdminUser(username) {
    return username.trim().toLowerCase() === ADMIN_USERNAME;
}

function isAdmin(req) {
    return isAuthenticated(req) && isAdminUser(usernameForRequest(req));
}

function canAccessGames(req, gameId) {
    if (!isAuthenticated(req)) return false;
    const username = usernameForRequest(req);
    if (isAdminUser(username)) return true;
    return canUseCreatorService(username, 'games');
}

function hasAdminUsers() {
    return users.has(ADMIN_USERNAME) || Boolean(store.getAccount(ADMIN_USERNAME));
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
    hasConfiguredUser,
    canAccessGames,
    canUseCreatorService,
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
