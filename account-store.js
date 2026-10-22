const fs = require('fs');
const path = require('path');

const storeFile = process.env.GAME_DATA_FILE || path.join(__dirname, 'data', 'accounts.json');
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
        parsed.liveTtsSource ??= null;
        if (parsed.homepageNotice) {
            if (parsed.homepageNotice.widthPercent === undefined) parsed.homepageNotice.widthPercent = 100;
            if (parsed.homepageNotice.text ===
                'Plusieurs jeux sont déjà disponibles et de nouvelles expériences arriveront prochainement. Vous avez une idée de jeu ou une envie particulière ? Nous sommes à votre écoute pour étudier vos propositions et imaginer de nouveaux jeux avec vous.') {
                parsed.homepageNotice.text =
                    'Notre arcade propose plusieurs jeux interactifs, et de nouvelles expériences sont en préparation. Une idée de jeu ou une fonctionnalité vous intéresse ? Faites-nous part de vos suggestions : nous les étudierons avec attention pour enrichir la vitrine.';
            }
        }
        if (typeof parsed.users !== 'object' || Array.isArray(parsed.users) ||
            typeof parsed.checkouts !== 'object' || Array.isArray(parsed.checkouts) ||
            typeof parsed.plans !== 'object' || Array.isArray(parsed.plans) ||
            typeof parsed.games !== 'object' || Array.isArray(parsed.games) ||
            typeof parsed.hiddenGames !== 'object' || Array.isArray(parsed.hiddenGames) ||
            (parsed.liveTtsSource !== null &&
                (typeof parsed.liveTtsSource !== 'object' ||
                    Array.isArray(parsed.liveTtsSource) ||
                    typeof parsed.liveTtsSource.username !== 'string' ||
                    !/^[a-zA-Z0-9._]{1,32}$/.test(parsed.liveTtsSource.username) ||
                    typeof parsed.liveTtsSource.tokenHash !== 'string' ||
                    !/^[a-f0-9]{64}$/.test(parsed.liveTtsSource.tokenHash))) ||
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
                    !Number.isInteger(parsed.homepageNotice.widthPercent) ||
                    parsed.homepageNotice.widthPercent < 40 ||
                    parsed.homepageNotice.widthPercent > 100 ||
                    !['hero', 'games-before', 'games-after'].includes(parsed.homepageNotice.placement)))) {
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
            liveTtsSource: null
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

function setSubscriptionStatus(subscriptionId, status) {
    return updateStore(store => {
        const entry = Object.entries(store.users).find(([, account]) =>
            account.subscriptionId === subscriptionId
        );
        if (!entry) return false;
        entry[1].status = status;
        entry[1].updatedAt = new Date().toISOString();
        return true;
    });
}

module.exports = {
    deleteCheckout,
    deleteGame,
    getAccount,
    getAccountBySubscription,
    getCheckout,
    getGameFilesDirectory,
    getGameImage,
    getHiddenGames,
    getHomepageNotice,
    getLiveTtsSource,
    listGames,
    getPlans,
    hasAccounts,
    saveGame,
    saveGameImage,
    saveCloudinaryGameImage,
    saveGameMetadata,
    saveHomepageNotice,
    saveLiveTtsSource,
    setGameHidden,
    saveAccount,
    reserveCheckout,
    savePlans,
    setSubscriptionStatus
};
