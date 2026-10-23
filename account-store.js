const fs = require('fs');
const path = require('path');
const os = require('os');

const renderEnvironment = process.env.RENDER === 'true';
const persistentDataDirectory = '/var/data';
let defaultStoreDirectory = path.join(__dirname, 'data');
if (renderEnvironment) {
    try {
        fs.accessSync(persistentDataDirectory, fs.constants.W_OK);
        defaultStoreDirectory = persistentDataDirectory;
    } catch (error) {
        if (!['EACCES', 'ENOENT', 'ENOTDIR', 'EROFS'].includes(error.code)) throw error;
        defaultStoreDirectory = path.join(os.tmpdir(), 'gryphon-arcade');
        console.warn(`Persistent disk unavailable at ${persistentDataDirectory}; using temporary storage at ${defaultStoreDirectory}. Data may be lost on restart. Attach a Persistent Disk to preserve it.`);
    }
}
const storeFile = process.env.GAME_DATA_FILE || path.join(defaultStoreDirectory, 'gryphon-accounts.json');
const gameFilesDirectory = path.join(path.dirname(storeFile), 'game-files');

function readStore() {
    try {
        const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Game account store must contain a JSON object.');
        }
        parsed.users ||= {};
        parsed.checkouts ||= {};
        parsed.plans ||= {};
        parsed.games ||= {};
        parsed.hiddenGames ||= {};
        parsed.homepageNotice ??= null;
        parsed.paypalLink ??= null;
        parsed.liveTtsSource ??= null;
        parsed.liveTtsSources ||= {};
        parsed.revokedTtsLinks ||= {};
        parsed.revokedUsers ||= {};
        parsed.removedUsers ||= {};
        parsed.creatorSettings ||= {};
        parsed.dailyUsage ||= {};
        parsed.serviceAccess ||= {};
        parsed.serviceRevocations ||= {};
        parsed.gameAccess ||= {};
        parsed.adminDashboardLayouts ||= {};
        if (typeof parsed.users !== 'object' || Array.isArray(parsed.users) ||
            typeof parsed.checkouts !== 'object' || Array.isArray(parsed.checkouts) ||
            typeof parsed.plans !== 'object' || Array.isArray(parsed.plans) ||
            typeof parsed.games !== 'object' || Array.isArray(parsed.games) ||
            typeof parsed.hiddenGames !== 'object' || Array.isArray(parsed.hiddenGames) ||
            typeof parsed.liveTtsSources !== 'object' || Array.isArray(parsed.liveTtsSources) ||
            typeof parsed.revokedTtsLinks !== 'object' || Array.isArray(parsed.revokedTtsLinks) ||
            typeof parsed.revokedUsers !== 'object' || Array.isArray(parsed.revokedUsers) ||
            typeof parsed.removedUsers !== 'object' || Array.isArray(parsed.removedUsers) ||
            typeof parsed.creatorSettings !== 'object' || Array.isArray(parsed.creatorSettings) ||
            typeof parsed.dailyUsage !== 'object' || Array.isArray(parsed.dailyUsage) ||
            typeof parsed.serviceAccess !== 'object' || Array.isArray(parsed.serviceAccess) ||
            typeof parsed.serviceRevocations !== 'object' || Array.isArray(parsed.serviceRevocations) ||
            Object.entries(parsed.serviceRevocations).some(([username, services]) =>
                !/^[a-zA-Z0-9._@-]{1,64}$/.test(username) ||
                !services || typeof services !== 'object' || Array.isArray(services) ||
                Object.entries(services).some(([service, revoked]) =>
                    !['games', 'tts'].includes(service) || revoked !== true)) ||
            typeof parsed.gameAccess !== 'object' || Array.isArray(parsed.gameAccess) ||
            typeof parsed.adminDashboardLayouts !== 'object' || Array.isArray(parsed.adminDashboardLayouts) ||
            Object.entries(parsed.adminDashboardLayouts).some(([username, layout]) =>
                !/^[a-zA-Z0-9._@-]{1,64}$/.test(username) ||
                !layout || typeof layout !== 'object' || Array.isArray(layout) ||
                ['order', 'pinned', 'hidden'].some(key =>
                    !Array.isArray(layout[key]) ||
                    layout[key].length > 100 ||
                    layout[key].some(widgetId =>
                        typeof widgetId !== 'string' ||
                        !/^[a-z][a-z0-9-]{1,63}$/.test(widgetId)))) ||
            Object.entries(parsed.gameAccess).some(([username, gameIds]) =>
                !/^[a-zA-Z0-9._@-]{1,64}$/.test(username) ||
                (gameIds !== null &&
                    (!Array.isArray(gameIds) ||
                        gameIds.some(gameId => typeof gameId !== 'string' ||
                            !/^(?:\/[a-zA-Z0-9._/-]{1,79}|[a-f0-9-]{36})$/.test(gameId))))) ||
            Object.entries(parsed.liveTtsSources).some(([owner, source]) =>
                !/^[a-zA-Z0-9._@-]{1,64}$/.test(owner) ||
                !source || typeof source !== 'object' || Array.isArray(source) ||
                typeof source.username !== 'string' ||
                !/^[a-zA-Z0-9._]{1,32}$/.test(source.username) ||
                typeof source.tokenHash !== 'string' ||
                !/^[a-f0-9]{64}$/.test(source.tokenHash)) ||
            Object.entries(parsed.revokedUsers).some(([username, revoked]) =>
                !/^[a-zA-Z0-9._@-]{1,64}$/.test(username) || revoked !== true) ||
            Object.entries(parsed.revokedTtsLinks).some(([username, revoked]) =>
                !/^[a-zA-Z0-9._@-]{1,64}$/.test(username) || revoked !== true) ||
            Object.entries(parsed.removedUsers).some(([username, removed]) =>
                !/^[a-zA-Z0-9._@-]{1,64}$/.test(username) || removed !== true) ||
            Object.entries(parsed.creatorSettings).some(([username, settings]) =>
                !/^[a-zA-Z0-9._@-]{1,64}$/.test(username) ||
                !settings || typeof settings !== 'object' || Array.isArray(settings) ||
                (settings.roomNumber !== undefined &&
                    (!Number.isInteger(settings.roomNumber) ||
                        settings.roomNumber < 1 || settings.roomNumber > 9999)) ||
                (settings.roomRevoked !== undefined && typeof settings.roomRevoked !== 'boolean') ||
                (settings.tiktokUsername !== undefined &&
                    (typeof settings.tiktokUsername !== 'string' ||
                        !/^[a-zA-Z0-9._]{1,32}$/.test(settings.tiktokUsername))) ||
                (settings.locked !== undefined && typeof settings.locked !== 'boolean')) ||
            Object.entries(parsed.dailyUsage).some(([date, users]) =>
                !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
                !users || typeof users !== 'object' || Array.isArray(users) ||
                Object.entries(users).some(([username, used]) =>
                    !/^[a-zA-Z0-9._@-]{1,64}$/.test(username) || used !== true)) ||
            Object.entries(parsed.serviceAccess).some(([username, services]) =>
                !/^[a-zA-Z0-9._@-]{1,64}$/.test(username) ||
                !services || typeof services !== 'object' || Array.isArray(services) ||
                Object.entries(services).some(([service, enabled]) =>
                    !['games', 'tts'].includes(service) || typeof enabled !== 'boolean')) ||
            (parsed.liveTtsSource !== null &&
                (typeof parsed.liveTtsSource !== 'object' ||
                    Array.isArray(parsed.liveTtsSource) ||
                    typeof parsed.liveTtsSource.username !== 'string' ||
                    !/^[a-zA-Z0-9._]{1,32}$/.test(parsed.liveTtsSource.username) ||
                    typeof parsed.liveTtsSource.tokenHash !== 'string' ||
                    !/^[a-f0-9]{64}$/.test(parsed.liveTtsSource.tokenHash) ||
                    (parsed.liveTtsSource.accountUsername !== undefined &&
                        (typeof parsed.liveTtsSource.accountUsername !== 'string' ||
                            !/^[a-zA-Z0-9._@-]{1,64}$/.test(parsed.liveTtsSource.accountUsername))))) ||
            (parsed.homepageNotice !== null &&
                (typeof parsed.homepageNotice !== 'object' ||
                    Array.isArray(parsed.homepageNotice) ||
                    typeof parsed.homepageNotice.label !== 'string' ||
                    parsed.homepageNotice.label.length < 1 ||
                    parsed.homepageNotice.label.length > 50 ||
                    typeof parsed.homepageNotice.text !== 'string' ||
                    parsed.homepageNotice.text.length < 1 ||
                    parsed.homepageNotice.text.length > 800 ||
                    !Number.isInteger(parsed.homepageNotice.fontSize) ||
                    parsed.homepageNotice.fontSize < 11 ||
                    parsed.homepageNotice.fontSize > 26 ||
                    (parsed.homepageNotice.fontSizeDoubled !== undefined &&
                        typeof parsed.homepageNotice.fontSizeDoubled !== 'boolean') ||
                    (parsed.homepageNotice.widthPercent !== undefined &&
                        (!Number.isInteger(parsed.homepageNotice.widthPercent) ||
                            parsed.homepageNotice.widthPercent < 40 ||
                            parsed.homepageNotice.widthPercent > 120)) ||
                    !['hero', 'games-before', 'games-after'].includes(parsed.homepageNotice.placement))) ||
            (parsed.paypalLink !== null &&
                (typeof parsed.paypalLink !== 'string' ||
                    parsed.paypalLink.length > 2048 ||
                    !/^https:\/\/(?:www\.)?paypal\.(?:com|me)\/[^\s]*$/i.test(parsed.paypalLink)))) {
            throw new Error('Game account store has an invalid data shape.');
        }
        return parsed;
    } catch (error) {
        if (error.code === 'ENOENT') return {
            users: {},
            checkouts: {},
            plans: {},
            games: {},
            hiddenGames: {},
            homepageNotice: null,
            paypalLink: null,
            liveTtsSource: null,
            liveTtsSources: {},
            revokedTtsLinks: {},
            revokedUsers: {},
            removedUsers: {},
            creatorSettings: {},
            dailyUsage: {},
            serviceAccess: {},
            serviceRevocations: {},
            gameAccess: {},
            adminDashboardLayouts: {}
        };
        throw new Error(`Could not read game account store at ${storeFile}.`, { cause: error });
    }
}

function writeStore(store) {
    const directory = path.dirname(storeFile);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryFile = `${storeFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(store), { mode: 0o600 });
    fs.renameSync(temporaryFile, storeFile);
}

function updateStore(mutator) {
    const store = readStore();
    const result = mutator(store);
    writeStore(store);
    return result;
}

function getAccount(username) {
    const store = readStore();
    return store.users[username.toLowerCase()] || null;
}

function listAccounts() {
    return Object.entries(readStore().users);
}

function isUserRevoked(username) {
    return readStore().revokedUsers[username.toLowerCase()] === true;
}

function isCreatorRemoved(username) {
    return readStore().removedUsers[username.toLowerCase()] === true;
}

function setUserRevoked(username, revoked) {
    updateStore(store => {
        const key = username.toLowerCase();
        if (revoked) store.revokedUsers[key] = true;
        else delete store.revokedUsers[key];
    });
}

function removeCreator(username) {
    return updateStore(store => {
        const key = username.toLowerCase();
        const ttsSource = store.liveTtsSources[key] || null;
        const legacyTtsSource = store.liveTtsSource?.accountUsername?.toLowerCase() === key
            ? store.liveTtsSource
            : null;

        delete store.users[key];
        delete store.liveTtsSources[key];
        delete store.revokedTtsLinks[key];
        delete store.creatorSettings[key];
        delete store.serviceAccess[key];
        delete store.serviceRevocations[key];
        delete store.gameAccess[key];
        delete store.revokedUsers[key];
        delete store.adminDashboardLayouts[key];
        if (legacyTtsSource) store.liveTtsSource = null;
        for (const users of Object.values(store.dailyUsage)) delete users[key];
        store.removedUsers[key] = true;

        return { ttsSource, legacyTtsSource };
    });
}

function closeCreatorRoom(username) {
    return updateStore(store => {
        const key = username.toLowerCase();
        const ttsSource = store.liveTtsSources[key] || null;
        const legacyTtsSource = store.liveTtsSource?.accountUsername?.toLowerCase() === key
            ? store.liveTtsSource
            : null;
        store.revokedUsers[key] = true;
        delete store.liveTtsSources[key];
        if (legacyTtsSource) store.liveTtsSource = null;
        return { ttsSource, legacyTtsSource };
    });
}

function getCreatorSettings(username) {
    return readStore().creatorSettings[username.toLowerCase()] || {};
}

function isCreatorServiceEnabled(username, service) {
    const store = readStore();
    const key = username.toLowerCase();
    return store.serviceRevocations[key]?.[service] !== true;
}

function getCreatorServiceAccess(username, service) {
    const key = username.toLowerCase();
    const store = readStore();
    if (store.serviceRevocations[key]?.[service] === true) return false;
    return store.serviceAccess[key]?.[service] ?? null;
}

function setCreatorServiceAccess(username, service, enabled) {
    if (!['games', 'tts'].includes(service)) throw new Error('Unknown creator service.');
    updateStore(store => {
        const key = username.toLowerCase();
        const settings = store.serviceAccess[key] || {};
        settings[service] = enabled;
        if (Object.keys(settings).length) store.serviceAccess[key] = settings;
        else delete store.serviceAccess[key];
        const revocations = store.serviceRevocations[key] || {};
        if (enabled) delete revocations[service];
        else revocations[service] = true;
        if (Object.keys(revocations).length) store.serviceRevocations[key] = revocations;
        else delete store.serviceRevocations[key];
    });
}

function getCreatorGameAccess(username) {
    const gameIds = readStore().gameAccess[username.toLowerCase()];
    return Array.isArray(gameIds) ? gameIds : null;
}

function isCreatorGameAllowed(username, gameId) {
    const gameIds = getCreatorGameAccess(username);
    return gameIds === null || gameIds.includes(gameId);
}

function setCreatorGameAccess(username, gameIds) {
    updateStore(store => {
        store.gameAccess[username.toLowerCase()] = gameIds === null
            ? null
            : [...new Set(gameIds)];
    });
}

function setCreatorRoom(username, roomNumber) {
    updateStore(store => {
        const key = username.toLowerCase();
        const settings = store.creatorSettings[key] || {};
        if (roomNumber === null) delete settings.roomNumber;
        else {
            if (settings.roomNumber !== roomNumber) delete settings.roomRevoked;
            settings.roomNumber = roomNumber;
        }
        if (Object.keys(settings).length) store.creatorSettings[key] = settings;
        else delete store.creatorSettings[key];
    });
}

function setCreatorRoomRevoked(username, revoked) {
    updateStore(store => {
        const key = username.toLowerCase();
        const settings = store.creatorSettings[key] || {};
        if (revoked) settings.roomRevoked = true;
        else delete settings.roomRevoked;
        if (Object.keys(settings).length) store.creatorSettings[key] = settings;
        else delete store.creatorSettings[key];
    });
}

function setCreatorTiktokUsername(username, tiktokUsername) {
    updateStore(store => {
        const key = username.toLowerCase();
        const settings = store.creatorSettings[key] || {};
        if (tiktokUsername === null) delete settings.tiktokUsername;
        else settings.tiktokUsername = tiktokUsername;
        if (Object.keys(settings).length) store.creatorSettings[key] = settings;
        else delete store.creatorSettings[key];
    });
}

function setCreatorSettingsLocked(username, locked) {
    updateStore(store => {
        const key = username.toLowerCase();
        const settings = store.creatorSettings[key] || {};
        if (locked) settings.locked = true;
        else delete settings.locked;
        if (Object.keys(settings).length) store.creatorSettings[key] = settings;
        else delete store.creatorSettings[key];
    });
}

function getAdminDashboardLayout(username) {
    return readStore().adminDashboardLayouts[username.toLowerCase()] ||
        { order: [], pinned: [], hidden: [] };
}

function saveAdminDashboardLayout(username, layout) {
    updateStore(store => {
        store.adminDashboardLayouts[username.toLowerCase()] = {
            order: [...layout.order],
            pinned: [...layout.pinned],
            hidden: [...layout.hidden]
        };
    });
}

function getAccountLiveTts(username) {
    return readStore().liveTtsSources[username.toLowerCase()] || null;
}

function isAccountTtsLinkRevoked(username) {
    return readStore().revokedTtsLinks[username.toLowerCase()] === true;
}

function setAccountTtsLinkRevoked(username, revoked) {
    updateStore(store => {
        const key = username.toLowerCase();
        if (revoked) store.revokedTtsLinks[key] = true;
        else delete store.revokedTtsLinks[key];
    });
}

function listAccountLiveTtsSources() {
    return Object.entries(readStore().liveTtsSources);
}

function saveAccountLiveTts(username, source) {
    updateStore(store => {
        const key = username.toLowerCase();
        if (source) store.liveTtsSources[key] = source;
        else delete store.liveTtsSources[key];
    });
}

function recordDailyUsage(username, date) {
    const key = username.toLowerCase();
    if (readStore().dailyUsage[date]?.[key]) return false;
    return updateStore(store => {
        const users = store.dailyUsage[date] || {};
        if (users[key]) return false;
        users[key] = true;
        store.dailyUsage[date] = users;
        return true;
    });
}

function getDailyUsageCount(date) {
    return Object.keys(readStore().dailyUsage[date] || {}).length;
}

function getAccountBySubscription(subscriptionId) {
    const store = readStore();
    return Object.entries(store.users).find(([, account]) =>
        account.subscriptionId === subscriptionId
    ) || null;
}

function saveAccount(username, account) {
    updateStore(store => {
        store.users[username.toLowerCase()] = account;
    });
}

function createManualAccount(username, account) {
    return updateStore(store => {
        const key = username.toLowerCase();
        if (store.users[key]) return false;

        store.users[key] = account;
        store.gameAccess[key] = null;
        delete store.serviceAccess[key];
        delete store.serviceRevocations[key];
        delete store.revokedTtsLinks[key];
        delete store.revokedUsers[key];
        return true;
    });
}

function hasAccounts() {
    return Object.keys(readStore().users).length > 0;
}

function listGames() {
    return Object.values(readStore().games);
}

function saveGame(game) {
    updateStore(store => {
        store.games[game.id] = game;
    });
}

function getGameImage(gameId) {
    const game = readStore().games[gameId];
    return game?.imageUrl || game?.image || null;
}

function saveGameImage(gameId, image) {
    const previousImage = updateStore(store => {
        store.games[gameId] ||= { id: gameId, uploaded: false };
        const previous = store.games[gameId].image || null;
        store.games[gameId].image = image;
        delete store.games[gameId].imageUrl;
        delete store.games[gameId].cloudinaryPublicId;
        store.games[gameId].updatedAt = new Date().toISOString();
        return previous;
    });
    return previousImage;
}

function saveCloudinaryGameImage(gameId, image) {
    updateStore(store => {
        store.games[gameId] ||= { id: gameId, uploaded: false };
        store.games[gameId].imageUrl = image.url;
        store.games[gameId].cloudinaryPublicId = image.publicId;
        store.games[gameId].updatedAt = new Date().toISOString();
    });
}

function saveGameMetadata(gameId, metadata) {
    updateStore(store => {
        store.games[gameId] = {
            ...(store.games[gameId] || { id: gameId, uploaded: false }),
            ...metadata,
            updatedAt: new Date().toISOString()
        };
    });
}

function setGameHidden(gameId, hidden) {
    updateStore(store => {
        if (hidden) store.hiddenGames[gameId] = true;
        else delete store.hiddenGames[gameId];
    });
}

function getHiddenGames() {
    return Object.keys(readStore().hiddenGames);
}

function getHomepageNotice() {
    return readStore().homepageNotice;
}

function saveHomepageNotice(settings) {
    updateStore(store => {
        store.homepageNotice = settings;
    });
}

function getPaypalLink() {
    return readStore().paypalLink;
}

function savePaypalLink(url) {
    updateStore(store => {
        store.paypalLink = url;
    });
}

function getLiveTtsSource() {
    return readStore().liveTtsSource;
}

function saveLiveTtsSource(source) {
    updateStore(store => {
        store.liveTtsSource = source;
    });
}

function deleteGame(gameId) {
    return updateStore(store => {
        const game = store.games[gameId];
        if (!game || !game.uploaded) return null;
        delete store.games[gameId];
        delete store.hiddenGames[gameId];
        for (const [username, allowedGameIds] of Object.entries(store.gameAccess)) {
            store.gameAccess[username] = allowedGameIds.filter(id => id !== gameId);
        }
        return game;
    });
}

function getGameFilesDirectory() {
    return gameFilesDirectory;
}

function getCheckout(checkoutId) {
    const store = readStore();
    return store.checkouts[checkoutId] || null;
}

function reserveCheckout(checkoutId, checkout) {
    return updateStore(store => {
        for (const [id, item] of Object.entries(store.checkouts)) {
            if (item.expiresAt <= Date.now()) delete store.checkouts[id];
        }
        const usernameAlreadyReserved = Object.values(store.checkouts).some(item =>
            item.username === checkout.username
        );
        if (store.users[checkout.username] || usernameAlreadyReserved) return false;
        store.checkouts[checkoutId] = checkout;
        return true;
    });
}

function deleteCheckout(checkoutId) {
    updateStore(store => {
        delete store.checkouts[checkoutId];
    });
}

function getPlans(mode) {
    const store = readStore();
    return store.plans.mode === mode ? store.plans : null;
}

function savePlans(plans) {
    updateStore(store => {
        store.plans = plans;
    });
}

function setSubscriptionStatus(subscriptionId, status, updates = {}) {
    return updateStore(store => {
        const entry = Object.entries(store.users).find(([, account]) =>
            account.subscriptionId === subscriptionId
        );
        if (!entry) return false;
        entry[1].status = status;
        if (updates.lastPaymentAt) entry[1].lastPaymentAt = updates.lastPaymentAt;
        entry[1].updatedAt = new Date().toISOString();
        return true;
    });
}

module.exports = {
    deleteCheckout,
    deleteGame,
    getAccount,
    getAccountLiveTts,
    isAccountTtsLinkRevoked,
    getAccountBySubscription,
    getCheckout,
    getCreatorGameAccess,
    getCreatorSettings,
    getAdminDashboardLayout,
    getCreatorServiceAccess,
    getDailyUsageCount,
    getGameFilesDirectory,
    getGameImage,
    getHiddenGames,
    getHomepageNotice,
    getPaypalLink,
    getLiveTtsSource,
    isUserRevoked,
    isCreatorRemoved,
    isCreatorServiceEnabled,
    isCreatorGameAllowed,
    listGames,
    listAccounts,
    listAccountLiveTtsSources,
    getPlans,
    hasAccounts,
    saveGame,
    saveGameImage,
    saveCloudinaryGameImage,
    saveGameMetadata,
    saveHomepageNotice,
    savePaypalLink,
    saveLiveTtsSource,
    saveAccountLiveTts,
    setAccountTtsLinkRevoked,
    saveAdminDashboardLayout,
    recordDailyUsage,
    setGameHidden,
    setCreatorRoom,
    setCreatorRoomRevoked,
    setCreatorTiktokUsername,
    setCreatorSettingsLocked,
    setCreatorGameAccess,
    setCreatorServiceAccess,
    setUserRevoked,
    closeCreatorRoom,
    removeCreator,
    saveAccount,
    createManualAccount,
    reserveCheckout,
    savePlans,
    setSubscriptionStatus
};
