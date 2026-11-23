import { renderSpectatorLeaderboard, setOverlayPosition } from "./overlay-display.js";
import { deleteSetupVideo, loadSetupVideo, saveSetupVideo } from "./setup-video-storage.js";
import { MAX_GIFT_COIN_COUNT } from "./gift-limits.js";
import createTestAvatarDataUri from "./test-avatar.js";

const RELAY_URL = "wss://jeu6boite.onrender.com";
const RECONNECT_DELAY = 3000;
const MAX_TIKTOK_GIFT_COINS = MAX_GIFT_COIN_COUNT;
const SETUP_STORAGE_KEY = "coin-pusher-2000-live-panel-v1";
const SETUP_FORMAT = "coin-pusher-2000-control-panel";
const MAX_SETUP_FILE_BYTES = 2000000;
const MAX_EXPORTABLE_SETUP_VIDEO_BYTES = 1300000;
const MAX_SETUP_VIDEO_DATA_URL_LENGTH = 1800000;
const MAX_SETUP_BACKGROUND_DATA_URL_LENGTH = 1800000;
const IS_LOCAL_PREVIEW = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const DEFAULT_CHARACTER_HORIZONTAL_PERCENT = 15;
const DEFAULT_CHARACTER_DEPTH_PERCENT = 30;
const PRIZE_STOCK_ADDITION_VERSION = 1;
const PRIZE_STOCK_ADDITIONS = [
    { stars: 1, count: 100 },
    { stars: 2, count: 25 },
    { stars: 30, count: 10 },
    { stars: 100, count: 3 },
    { stars: 300, count: 1 }
];
const DEFAULT_PRIZE_CARDS = [
    { stars: 1, count: 200 },
    { stars: 2, count: 125 },
    { stars: 10, count: 25 },
    { stars: 30, count: 35 },
    { stars: 100, count: 8 },
    { stars: 300, count: 2 }
];
const MAX_CARD_DENOMINATIONS = 50;
const MAX_CARD_STARS = 250000;
const MAX_CARDS_PER_DENOMINATION = 10000;
const MAX_TOTAL_CARDS = 100000;
const STAR_WINNERS_STORAGE_KEY = "coin-pusher-2000-star-winners-v1";
const COIN_VOLUME_STORAGE_KEY = "coin-pusher-2000-coin-volume-v1";
const MAX_AVATAR_DATA_URI_LENGTH = 700000;

export default function initializeTikTokBridge({ receiveGift, updateGiftAvatar, getPendingCoins, startGame, getMachineControls, pressMachineButton, setScreenVideo, setSceneHorizontalOffset, setCharacterScale, setCharacterPosition, dropPrizeCard, dropPrizeIngot, setPrizeConfig }) {
    const usernameInput = document.getElementById("tiktok-username");
    const connectButton = document.getElementById("connect-tiktok");
    const statusElement = document.getElementById("live-status");
    const pendingElement = document.getElementById("pending-coins");
    const machineCoinsElement = document.getElementById("machine-coins");
    const machineStatusElement = document.getElementById("machine-status");
    const coinVolumeInput = document.getElementById("coin-volume");
    const coinVolumeValue = document.getElementById("coin-volume-value");
    const avatarLookupRequests = new Map();
    const machineButtons = Object.fromEntries(
        ["start", "hold", "center"]
            .map(name => [name, document.getElementById(`machine-${name}`)])
    );
    const test1000CoinsButton = document.getElementById("test-1000-coins");
    const testCoinsStatusElement = document.getElementById("test-coins-status");
    const gameBackgroundInput = document.getElementById("game-background-input");
    const gameBackgroundImage = document.getElementById("game-background-image");
    const gameBackgroundVideo = document.getElementById("game-background-video");
    const gameBackgroundMedia = document.getElementById("game-background-media");
    const clearGameBackgroundButton = document.getElementById("clear-game-background");
    const gameBackgroundStatusElement = document.getElementById("game-background-status");
    const videoInput = document.getElementById("screen-video");
    const clearVideoButton = document.getElementById("clear-screen-video");
    const videoStatusElement = document.getElementById("video-status");
    const characterScaleInput = document.getElementById("character-scale");
    const characterScaleValue = document.getElementById("character-scale-value");
    const characterHorizontalInput = document.getElementById("character-horizontal");
    const characterHorizontalValue = document.getElementById("character-horizontal-value");
    const characterDepthInput = document.getElementById("character-depth");
    const characterDepthValue = document.getElementById("character-depth-value");
    const toggleButton = document.getElementById("toggle-live-panel");
    const panel = document.getElementById("live-panel");
    const panelHeader = document.getElementById("live-panel-header");
    const panelResizeHandle = document.getElementById("panel-resize-handle");
    const showPanelButton = document.getElementById("show-live-panel");
    const saveSetupButton = document.getElementById("save-setup");
    const restoreSetupButton = document.getElementById("restore-setup");
    const exportSetupButton = document.getElementById("export-setup");
    const importSetupButton = document.getElementById("import-setup");
    const setupImportInput = document.getElementById("setup-import-file");
    const setupStatusElement = document.getElementById("setup-status");
    const prizeTableBody = document.getElementById("prize-card-table");
    const prizeStockTotalElement = document.getElementById("prize-stock-total");
    const manualCardUsernameInput = document.getElementById("manual-card-username");
    const manualCardStarsInput = document.getElementById("manual-card-stars");
    const dropPrizeCardButton = document.getElementById("drop-prize-card");
    const dropPrizeIngotButton = document.getElementById("drop-prize-ingot");
    const newCardStarsInput = document.getElementById("new-card-stars");
    const newCardCountInput = document.getElementById("new-card-count");
    const addPrizeCardsButton = document.getElementById("add-prize-cards");
    const resetPrizeCardsButton = document.getElementById("reset-prize-cards");
    const retryPrizeCreditsButton = document.getElementById("retry-prize-credits");
    const ingotFrequencyInput = document.getElementById("ingot-frequency");
    const ingotFrequencyValue = document.getElementById("ingot-frequency-value");
    const prizeStatusElement = document.getElementById("prize-status");
    const leaderboardXInput = document.getElementById("leaderboard-x");
    const leaderboardYInput = document.getElementById("leaderboard-y");
    const leaderboardScaleInput = document.getElementById("leaderboard-scale");
    const starLeaderboard = document.getElementById("star-leaderboard");
    const starLeaderboardDragHandle = document.getElementById("star-leaderboard-drag-handle");
    const showStarLeaderboardInput = document.getElementById("show-star-leaderboard");
    const starLeaderboardList = document.getElementById("star-leaderboard-list");
    const panelStarLeaderboard = document.getElementById("panel-star-leaderboard");
    const prizeBanner = document.getElementById("starcard");
    const prizeBannerAvatar = prizeBanner.querySelector("img");
    const prizeBannerName = prizeBanner.querySelector("strong");
    const prizeBannerMessage = prizeBanner.querySelector("span");
    let socket;
    let reconnectTimer;
    let activeGameBackgroundUrl = null;
    let activeGameBackgroundName = "";
    let activeGameBackgroundType = "";
    let activeGameBackgroundDataUrl = "";
    let activeGameBackgroundStorageKey = "";
    let activeGameBackgroundSavePromise = Promise.resolve();
    let activeGameBackgroundDataUrlPromise = Promise.resolve();
    let activeGameBackgroundSaveError = null;
    const retiredGameBackgroundUrls = new Set();
    let activeVideoUrl = null;
    let activeVideoName = "";
    let activeVideoDataUrl = "";
    let activeVideoStorageKey = "";
    let activeVideoSavePromise = Promise.resolve();
    let activeVideoDataUrlPromise = Promise.resolve();
    let activeVideoSaveError = null;
    const retiredVideoUrls = new Set();
    let panelBounds;
    let panelDrag;
    let panelResize;
    let sceneHorizontalOffset = 0;
    let leaderboardDrag;
    let setupPersistTimer = 0;
    let setupReloadPending = false;
    let prizeCards = DEFAULT_PRIZE_CARDS.map(card => ({ ...card }));
    let prizeStockAdditionVersion = PRIZE_STOCK_ADDITION_VERSION;
    let ingotFrequency = 10;
    let prizeBannerTimer;
    let starWinners = [];

    function setStatus(message, state = "") {
        statusElement.textContent = message;
        statusElement.dataset.state = state;
    }

    function refreshMachineControls() {
        const { buttons, coins } = getMachineControls();
        machineCoinsElement.textContent = coins.toLocaleString("fr-FR");
        for (const [name, button] of Object.entries(machineButtons)) {
            button.disabled = !buttons[name];
        }
    }

    for (const [name, button] of Object.entries(machineButtons)) {
        button.addEventListener("click", () => {
            if (!pressMachineButton(name)) {
                machineStatusElement.textContent = "Ce bouton n’est pas disponible pour le moment.";
            }
            refreshMachineControls();
        });
    }
    refreshMachineControls();

    function setVideoStatus(message, state = "") {
        videoStatusElement.textContent = message;
        videoStatusElement.dataset.state = state;
    }

    function setGameBackgroundStatus(message, state = "") {
        gameBackgroundStatusElement.textContent = message;
        gameBackgroundStatusElement.dataset.state = state;
    }

    function setSetupStatus(message, state = "") {
        setupStatusElement.textContent = message;
        setupStatusElement.dataset.state = state;
    }

    function setPrizeStatus(message, state = "") {
        prizeStatusElement.textContent = message;
        prizeStatusElement.dataset.state = state;
    }

    function validatePrizeCards(cards) {
        if (!Array.isArray(cards) || cards.length > MAX_CARD_DENOMINATIONS) {
            throw new Error("La liste doit contenir au maximum 50 valeurs de cartes.");
        }
        const merged = new Map();
        for (const card of cards) {
            if (
                !card ||
                !Number.isSafeInteger(card.stars) ||
                card.stars < 1 ||
                card.stars > MAX_CARD_STARS ||
                !Number.isSafeInteger(card.count) ||
                card.count < 0 ||
                card.count > MAX_CARDS_PER_DENOMINATION
            ) {
                throw new Error("Valeur ou quantité de carte invalide.");
            }
            merged.set(card.stars, (merged.get(card.stars) || 0) + card.count);
            if (merged.get(card.stars) > MAX_CARDS_PER_DENOMINATION) {
                throw new Error("Maximum de 10 000 cartes par valeur.");
            }
        }
        const normalized = [...merged.entries()]
            .map(([stars, count]) => ({ stars, count }))
            .sort((a, b) => a.stars - b.stars);
        if (normalized.reduce((total, card) => total + card.count, 0) > MAX_TOTAL_CARDS) {
            throw new Error("Le stock total ne peut pas dépasser 100 000 cartes.");
        }
        return normalized;
    }

    function addPrizeStock(cards) {
        const updated = cards.map(card => ({ ...card }));
        for (const addition of PRIZE_STOCK_ADDITIONS) {
            const existing = updated.find(card => card.stars === addition.stars);
            if (existing) {
                existing.count += addition.count;
            } else {
                updated.push({ ...addition });
            }
        }
        return validatePrizeCards(updated);
    }

    function getAvatarKey(profile) {
        return getAvatarKeys(profile)[0] || "";
    }

    function getAvatarKeys(profile) {
        return [...new Set([profile?.userId, profile?.uniqueId, profile?.username, profile?.nickname]
            .map(identity => String(identity || "").trim().replace(/^@/, "").toLocaleLowerCase().slice(0, 128))
            .filter(Boolean))];
    }

    function getAvatarUrl(profile) {
        const candidates = [
            profile?.avatarUrl,
            profile?.profilePicture,
            profile?.profilePictureUrl,
            ...(Array.isArray(profile?.avatarUrls) ? profile.avatarUrls : [])
        ];
        return candidates.find(source =>
            typeof source === "string" &&
            /^(?:https?:\/\/|\/(?!\/))/i.test(source.trim())
        )?.trim() || "";
    }

    function getAvatarSource(profile) {
        const dataUri = String(profile?.avatarDataUri || "").trim();
        return /^data:image\/(?:jpeg|png|webp|gif|avif);base64,/i.test(dataUri)
            ? dataUri
            : getAvatarUrl(profile);
    }

    function isLocalAvatarUrl(source) {
        if (!source) return false;
        try {
            return new URL(source, location.href).origin === location.origin;
        } catch {
            return false;
        }
    }

    function lookupWalletAvatar(avatarKeys, username) {
        const requestKey = avatarKeys[0] || username.toLowerCase();
        if (avatarLookupRequests.has(requestKey)) {
            return avatarLookupRequests.get(requestKey);
        }
        const request = (async () => {
            try {
                const response = await fetch(`/api/tiktok-stars?player=${encodeURIComponent(username)}`, {
                    credentials: "same-origin",
                    cache: "no-store"
                });
                if (!response.ok) {
                    throw new Error(`Profil TikTok indisponible (HTTP ${response.status}).`);
                }
                const data = await response.json();
                const avatarUrl = getAvatarUrl(data.player);
                if (!isLocalAvatarUrl(avatarUrl)) {
                    throw new Error("Aucune photo TikTok sauvegardée pour ce pseudo.");
                }
                for (const avatarKey of avatarKeys) {
                    updateGiftAvatar(avatarKey, "", avatarUrl);
                }
            } catch (error) {
                console.warn(`Photo TikTok de secours indisponible pour @${username} :`, error);
            } finally {
                avatarLookupRequests.delete(requestKey);
            }
        })();
        avatarLookupRequests.set(requestKey, request);
        return request;
    }

    function receiveGiftWithAvatar(count, profile) {
        const username = String(profile.uniqueId || profile.username || "").trim().replace(/^@/, "");
        const avatarKeys = getAvatarKeys(profile);
        const avatarKey = avatarKeys[0] || username.toLowerCase();
        const avatarDataUri = typeof profile.avatarDataUri === "string" &&
            profile.avatarDataUri.length <= MAX_AVATAR_DATA_URI_LENGTH &&
            /^data:image\/(?:jpeg|png|webp|gif|avif);base64,/i.test(profile.avatarDataUri)
            ? profile.avatarDataUri
            : "";
        const avatarUrl = getAvatarUrl(profile);
        const queued = receiveGift(count, {
            ...profile,
            avatarKey,
            username,
            avatarDataUri,
            avatarUrl
        });
        if (
            queued > 0 &&
            avatarKeys.length &&
            /^[a-zA-Z0-9._]{1,32}$/.test(username) &&
            !avatarDataUri &&
            !isLocalAvatarUrl(avatarUrl)
        ) {
            void lookupWalletAvatar(avatarKeys, username);
        }
        return queued;
    }

    function setCoinVolumeFromInput() {
        const volume = Number(coinVolumeInput.value);
        coinVolumeValue.value = `${volume} %`;
        window.CoinPusher2000.setCoinVolume(volume / 100);
        try {
            localStorage.setItem(COIN_VOLUME_STORAGE_KEY, String(volume));
        } catch (error) {
            console.warn("Impossible d’enregistrer le volume des pièces :", error);
        }
    }

    try {
        const storedVolume = localStorage.getItem(COIN_VOLUME_STORAGE_KEY);
        if (storedVolume !== null) {
            const savedVolume = Number(storedVolume);
            if (Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 100) {
                coinVolumeInput.value = String(savedVolume);
            }
        }
    } catch (error) {
        console.warn("Impossible de lire le volume enregistré des pièces :", error);
    }
    coinVolumeValue.value = `${coinVolumeInput.value} %`;
    window.CoinPusher2000.setCoinVolume(Number(coinVolumeInput.value) / 100);
    coinVolumeInput.addEventListener("input", setCoinVolumeFromInput);
    const unlockCoinAudio = () => {
        window.CoinPusher2000.setCoinVolume(Number(coinVolumeInput.value) / 100);
    };
    document.addEventListener("pointerdown", unlockCoinAudio, { once: true });
    document.addEventListener("keydown", unlockCoinAudio, { once: true });

    function validateSetupRecord(record) {
        if (!record || typeof record !== "object" || Array.isArray(record) || record.version !== 1) {
            throw new Error("Format de setup non reconnu.");
        }
        const normalized = {
            version: 1,
            username: "",
            characterScalePercent: 100,
            characterHorizontalPercent: DEFAULT_CHARACTER_HORIZONTAL_PERCENT,
            characterDepthPercent: DEFAULT_CHARACTER_DEPTH_PERCENT,
            panel: null,
            panelVisible: true,
            video: null,
            gameBackground: null,
            prizeCards: DEFAULT_PRIZE_CARDS.map(card => ({ ...card })),
            ingotFrequency: 10,
            showStarLeaderboard: true,
            leaderboardX: 5,
            leaderboardY: 55,
            leaderboardScalePercent: 100,
            manualCardUsername: "",
            manualCardStars: 300
        };
        if (record.prizeStockAdditionVersion !== undefined &&
            (!Number.isSafeInteger(record.prizeStockAdditionVersion) ||
                record.prizeStockAdditionVersion < 0 ||
                record.prizeStockAdditionVersion > PRIZE_STOCK_ADDITION_VERSION)) {
            throw new Error("Version de stock des cartes invalide.");
        }
        if (record.username !== undefined) {
            if (typeof record.username !== "string" || record.username.length > 32) {
                throw new Error("Pseudo TikTok invalide dans le setup.");
            }
            normalized.username = record.username.trim().replace(/^@/, "");
        }
        if (record.characterScalePercent !== undefined) {
            if (!Number.isSafeInteger(record.characterScalePercent) || record.characterScalePercent < 50 || record.characterScalePercent > 250) {
                throw new Error("Taille du personnage invalide dans le setup.");
            }
            normalized.characterScalePercent = record.characterScalePercent;
        }
        for (const [key, label] of [
            ["characterHorizontalPercent", "Position horizontale du personnage"],
            ["characterDepthPercent", "Profondeur du personnage"],
            ["leaderboardX", "Position horizontale du Top 3"],
            ["leaderboardY", "Position verticale du Top 3"]
        ]) {
            if (record[key] !== undefined) {
                if (!Number.isSafeInteger(record[key]) || record[key] < 0 || record[key] > 100) {
                    throw new Error(`${label} invalide dans le setup.`);
                }
                normalized[key] = record[key];
            }
        }
        for (const [key, label, maximum] of [
            ["leaderboardScalePercent", "Taille du Top 3", 100]
        ]) {
            if (record[key] !== undefined) {
                if (!Number.isSafeInteger(record[key]) || record[key] < 30 || record[key] > maximum) {
                    throw new Error(`${label} invalide dans le setup.`);
                }
                normalized[key] = record[key];
            }
        }
        if (record.panel !== undefined && record.panel !== null) {
            const keys = ["left", "top", "width", "height"];
            if (
                typeof record.panel !== "object" ||
                Array.isArray(record.panel) ||
                !keys.every(key => Number.isFinite(record.panel[key])) ||
                record.panel.width <= 0 ||
                record.panel.height <= 0
            ) {
                throw new Error("Position ou taille du panneau invalide dans le setup.");
            }
            normalized.panel = Object.fromEntries(keys.map(key => [key, record.panel[key]]));
        }
        if (record.panelVisible !== undefined) {
            if (typeof record.panelVisible !== "boolean") {
                throw new Error("État du panneau invalide dans le setup.");
            }
            normalized.panelVisible = record.panelVisible;
        }
        if (record.video !== undefined && record.video !== null) {
            if (
                typeof record.video !== "object" ||
                Array.isArray(record.video) ||
                typeof record.video.name !== "string" ||
                record.video.name.length > 255
            ) {
                throw new Error("Vidéo du setup invalide.");
            }
            const dataUrl = record.video.dataUrl;
            if (
                dataUrl !== undefined &&
                dataUrl !== null &&
                (typeof dataUrl !== "string" ||
                    dataUrl.length > MAX_SETUP_VIDEO_DATA_URL_LENGTH ||
                    !/^data:video\/[a-z0-9.+-]+;base64,/i.test(dataUrl))
            ) {
                throw new Error("Données vidéo du setup invalides ou trop volumineuses.");
            }
            const storageKey = record.video.storageKey;
            if (
                storageKey !== undefined &&
                storageKey !== null &&
                (typeof storageKey !== "string" || !/^[a-zA-Z0-9._-]{1,128}$/.test(storageKey))
            ) {
                throw new Error("Référence de vidéo invalide dans le setup.");
            }
            normalized.video = {
                name: record.video.name,
                dataUrl: dataUrl || null,
                storageKey: storageKey || null
            };
        }
        if (record.gameBackground !== undefined && record.gameBackground !== null) {
            if (
                typeof record.gameBackground !== "object" ||
                Array.isArray(record.gameBackground) ||
                typeof record.gameBackground.name !== "string" ||
                record.gameBackground.name.length > 255 ||
                (record.gameBackground.type !== "image" && record.gameBackground.type !== "video")
            ) {
                throw new Error("Arrière-plan du jeu invalide.");
            }
            const dataUrl = record.gameBackground.dataUrl;
            if (
                dataUrl !== undefined &&
                dataUrl !== null &&
                (typeof dataUrl !== "string" ||
                    dataUrl.length > MAX_SETUP_BACKGROUND_DATA_URL_LENGTH ||
                    !new RegExp(`^data:${record.gameBackground.type}\/[a-z0-9.+-]+;base64,`, "i").test(dataUrl))
            ) {
                throw new Error("Données de l’arrière-plan invalides ou trop volumineuses.");
            }
            const storageKey = record.gameBackground.storageKey;
            if (
                storageKey !== undefined &&
                storageKey !== null &&
                (typeof storageKey !== "string" || !/^[a-zA-Z0-9._-]{1,128}$/.test(storageKey))
            ) {
                throw new Error("Référence de l’arrière-plan invalide dans le setup.");
            }
            normalized.gameBackground = {
                name: record.gameBackground.name,
                type: record.gameBackground.type,
                dataUrl: dataUrl || null,
                storageKey: storageKey || null
            };
        }
        if (record.prizeCards !== undefined) {
            normalized.prizeCards = validatePrizeCards(record.prizeCards);
        }
        normalized.prizeStockAdditionVersion = record.prizeStockAdditionVersion ??
            (record.prizeCards === undefined ? PRIZE_STOCK_ADDITION_VERSION : 0);
        if (record.ingotFrequency !== undefined) {
            if (!Number.isSafeInteger(record.ingotFrequency) || record.ingotFrequency < 0 || record.ingotFrequency > 1000) {
                throw new Error("Fréquence des lingots invalide.");
            }
            normalized.ingotFrequency = record.ingotFrequency;
        }
        if (record.showStarLeaderboard !== undefined) {
            if (typeof record.showStarLeaderboard !== "boolean") {
                throw new Error("État du classement invalide.");
            }
            normalized.showStarLeaderboard = record.showStarLeaderboard;
        }
        if (record.manualCardUsername !== undefined) {
            if (typeof record.manualCardUsername !== "string" || record.manualCardUsername.length > 33) {
                throw new Error("Pseudo bénéficiaire invalide dans le setup.");
            }
            normalized.manualCardUsername = record.manualCardUsername.trim().replace(/^@/, "");
        }
        if (record.manualCardStars !== undefined) {
            if (!Number.isSafeInteger(record.manualCardStars) || record.manualCardStars < 1 || record.manualCardStars > MAX_CARD_STARS) {
                throw new Error("Valeur de carte invalide dans le setup.");
            }
            normalized.manualCardStars = record.manualCardStars;
        }
        return normalized;
    }

    function readSetupRecord() {
        try {
            const raw = localStorage.getItem(SETUP_STORAGE_KEY);
            return raw ? validateSetupRecord(JSON.parse(raw)) : validateSetupRecord({ version: 1 });
        } catch (error) {
            console.error("Impossible de lire le setup enregistré :", error);
            setSetupStatus(`Setup local illisible : ${error.message}`);
            return validateSetupRecord({ version: 1 });
        }
    }

    function clamp(value, minimum, maximum) {
        return Math.min(Math.max(value, minimum), maximum);
    }

    function setPanelBounds(bounds) {
        const maxWidth = Math.max(160, window.innerWidth - 16);
        const minWidth = Math.min(240, maxWidth);
        const width = clamp(bounds.width, minWidth, maxWidth);
        const maxHeight = Math.max(120, window.innerHeight - 16);
        const minHeight = Math.min(180, maxHeight);
        const height = clamp(bounds.height, minHeight, maxHeight);
        const left = clamp(bounds.left, 8, Math.max(8, window.innerWidth - width - 8));
        const top = clamp(bounds.top, 8, Math.max(8, window.innerHeight - height - 8));
        panelBounds = { left, top, width, height };
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = "auto";
        panel.style.width = `${width}px`;
        panel.style.height = `${height}px`;
        updateGameSceneOffset();
    }

    function setPanelVisible(visible, shouldSave = true) {
        panel.hidden = !visible;
        showPanelButton.hidden = visible;
        toggleButton.setAttribute("aria-expanded", String(visible));
        showPanelButton.setAttribute("aria-expanded", String(visible));
        updateGameSceneOffset();
        if (shouldSave) {
            persistSetupRecord();
        }
    }

    function updateGameSceneOffset() {
        const panelRight = panelBounds.left + panelBounds.width;
        const panelIsOnLeft = panelBounds.left < window.innerWidth / 2;
        const maximumOffset = window.innerWidth * 0.18;
        sceneHorizontalOffset = !panel.hidden && panelIsOnLeft
            ? Math.min((panelRight + 16) / 2, maximumOffset)
            : 0;
        document.documentElement.style.setProperty(
            "--scene-horizontal-offset",
            `${sceneHorizontalOffset}px`
        );
        setSceneHorizontalOffset(sceneHorizontalOffset);
    }

    function releaseRetiredVideoUrls() {
        retiredVideoUrls.forEach(url => {
            if (url.startsWith("blob:")) {
                URL.revokeObjectURL(url);
            }
        });
        retiredVideoUrls.clear();
    }

    function releaseRetiredGameBackgroundUrls() {
        retiredGameBackgroundUrls.forEach(url => {
            if (url.startsWith("blob:")) {
                URL.revokeObjectURL(url);
            }
        });
        retiredGameBackgroundUrls.clear();
    }

    function setGameBackground(url, type) {
        gameBackgroundMedia.hidden = !url;
        gameBackgroundImage.hidden = type !== "image";
        gameBackgroundVideo.hidden = type !== "video";
        if (type === "image" && url) {
            gameBackgroundVideo.pause();
            gameBackgroundVideo.removeAttribute("src");
            gameBackgroundVideo.load();
            gameBackgroundImage.src = url;
        } else if (type === "video" && url) {
            gameBackgroundImage.removeAttribute("src");
            gameBackgroundVideo.src = url;
            void gameBackgroundVideo.play().catch(error => {
                if (activeGameBackgroundUrl === url) {
                    console.warn("Impossible de lancer la vidéo d’arrière-plan :", error);
                    setGameBackgroundStatus("Vidéo chargée, mais la lecture automatique est bloquée par le navigateur.", "warning");
                }
            });
        } else {
            gameBackgroundVideo.pause();
            gameBackgroundVideo.removeAttribute("src");
            gameBackgroundVideo.load();
            gameBackgroundImage.removeAttribute("src");
        }
    }

    function persistSetupRecord() {
        const characterScalePercent = Number(characterScaleInput.value);
        if (!Number.isSafeInteger(characterScalePercent) || characterScalePercent < 50 || characterScalePercent > 250) {
            setSetupStatus("La taille du personnage doit être comprise entre 50 % et 250 %.", "error");
            return false;
        }
        const manualCardStars = Number(manualCardStarsInput.value);
        if (!Number.isSafeInteger(manualCardStars) || manualCardStars < 1 || manualCardStars > MAX_CARD_STARS) {
            setPrizeStatus("La valeur de la carte doit être comprise entre 1 et 250 000 étoiles.", "error");
            return false;
        }
        const record = {
            version: 1,
            username: usernameInput.value.trim().replace(/^@/, "").slice(0, 32),
            characterScalePercent,
            characterHorizontalPercent: Number(characterHorizontalInput.value),
            characterDepthPercent: Number(characterDepthInput.value),
            panel: { ...panelBounds },
            panelVisible: !panel.hidden,
            prizeCards: prizeCards.map(card => ({ ...card })),
            prizeStockAdditionVersion,
            ingotFrequency,
            showStarLeaderboard: showStarLeaderboardInput.checked,
            leaderboardX: Number(leaderboardXInput.value),
            leaderboardY: Number(leaderboardYInput.value),
            leaderboardScalePercent: Number(leaderboardScaleInput.value),
            manualCardUsername: manualCardUsernameInput.value.trim().slice(0, 33),
            manualCardStars,
            gameBackground: activeGameBackgroundName
                ? {
                    name: activeGameBackgroundName,
                    type: activeGameBackgroundType,
                    dataUrl: activeGameBackgroundDataUrl || null,
                    storageKey: activeGameBackgroundStorageKey || null
                }
                : null,
            video: activeVideoName
                ? {
                    name: activeVideoName,
                    dataUrl: activeVideoDataUrl || null,
                    storageKey: activeVideoStorageKey || null
                }
                : null
        };
        try {
            localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(record));
            return true;
        } catch (error) {
            console.error("Impossible d’enregistrer le setup :", error);
            setSetupStatus("Sauvegarde impossible : espace local indisponible.", "error");
            return false;
        }
    }

    function scheduleSetupPersistence() {
        if (setupPersistTimer) {
            return;
        }
        setupPersistTimer = window.setTimeout(() => {
            setupPersistTimer = 0;
            persistSetupRecord();
        }, 400);
    }

    function prepareSetupReload() {
        setupReloadPending = true;
        if (setupPersistTimer) {
            clearTimeout(setupPersistTimer);
            setupPersistTimer = 0;
        }
    }

    function setupMediaExportNotice() {
        const notices = [];
        if (activeVideoName && !activeVideoDataUrl) {
            notices.push(`la vidéo de l’écran « ${activeVideoName} »`);
        }
        if (activeGameBackgroundName && !activeGameBackgroundDataUrl) {
            notices.push(`l’arrière-plan « ${activeGameBackgroundName} »`);
        }
        return notices.length
            ? ` ${notices.join(" et ")} ne sont pas inclus; il faudra les sélectionner à nouveau après import.`
            : "";
    }

    const handleGameBackgroundReady = () => {
        releaseRetiredGameBackgroundUrls();
        if (activeGameBackgroundName) {
            setGameBackgroundStatus(`« ${activeGameBackgroundName} » est affiché en arrière-plan.`);
        }
    };
    gameBackgroundImage.addEventListener("load", handleGameBackgroundReady);
    gameBackgroundImage.addEventListener("error", () => {
        if (activeGameBackgroundType === "image") {
            setGameBackgroundStatus("Impossible d’afficher cette image d’arrière-plan.", "error");
        }
        releaseRetiredGameBackgroundUrls();
    });
    gameBackgroundVideo.addEventListener("loadeddata", handleGameBackgroundReady);
    gameBackgroundVideo.addEventListener("error", () => {
        if (activeGameBackgroundType === "video") {
            setGameBackgroundStatus("Impossible de lire cette vidéo d’arrière-plan. Essaie un fichier MP4 ou WebM.", "error");
        }
        releaseRetiredGameBackgroundUrls();
    });

    function createVideoStorageKey() {
        const randomId = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return `video-${randomId}`;
    }

    function renderPrizeCards() {
        prizeTableBody.replaceChildren();
        let total = 0;
        prizeCards.forEach((card, index) => {
            total += card.count;
            const row = document.createElement("tr");
            const valueCell = document.createElement("td");
            valueCell.textContent = `${card.stars.toLocaleString("fr-FR")} ⭐`;
            const countCell = document.createElement("td");
            const countInput = document.createElement("input");
            countInput.type = "number";
            countInput.min = "0";
            countInput.max = String(MAX_CARDS_PER_DENOMINATION);
            countInput.step = "1";
            countInput.value = String(card.count);
            countInput.setAttribute("aria-label", `Nombre de cartes à ${card.stars} étoiles`);
            countInput.addEventListener("change", () => {
                const count = Number(countInput.value);
                if (!Number.isSafeInteger(count) || count < 0 || count > MAX_CARDS_PER_DENOMINATION) {
                    setPrizeStatus("Le stock doit être un nombre entier entre 0 et 10 000.", "error");
                    countInput.value = String(card.count);
                    return;
                }
                const updated = prizeCards.map(entry => ({ ...entry }));
                updated[index].count = count;
                commitPrizeConfig(updated, ingotFrequency, "Stock des cartes mis à jour.");
            });
            countCell.append(countInput);
            const removeCell = document.createElement("td");
            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.className = "secondary-button";
            removeButton.textContent = "×";
            removeButton.setAttribute("aria-label", `Supprimer les cartes à ${card.stars} étoiles`);
            removeButton.addEventListener("click", () => {
                const updated = prizeCards.filter((_, entryIndex) => entryIndex !== index);
                commitPrizeConfig(updated, ingotFrequency, `Valeur ${card.stars} étoiles supprimée.`);
            });
            removeCell.append(removeButton);
            row.append(valueCell, countCell, removeCell);
            prizeTableBody.append(row);
        });
        prizeStockTotalElement.textContent = `Stock de cartes : ${total.toLocaleString("fr-FR")}`;
        ingotFrequencyValue.textContent = String(ingotFrequency);
    }

    function commitPrizeConfig(cards, frequency, message) {
        try {
            prizeCards = validatePrizeCards(cards);
            if (!Number.isSafeInteger(frequency) || frequency < 0 || frequency > 1000) {
                throw new Error("La fréquence des lingots doit être comprise entre 0 et 1 000.");
            }
            ingotFrequency = frequency;
            ingotFrequencyInput.value = String(ingotFrequency);
            setPrizeConfig({ cards: prizeCards, ingotFrequency });
            renderPrizeCards();
            if (persistSetupRecord()) {
                setPrizeStatus(message);
            }
            return true;
        } catch (error) {
            console.error("Configuration des récompenses refusée :", error);
            setPrizeStatus(error.message, "error");
            return false;
        }
    }

    function readStarWinners() {
        try {
            const stored = JSON.parse(localStorage.getItem(STAR_WINNERS_STORAGE_KEY) || "[]");
            if (!Array.isArray(stored)) {
                return [];
            }
            return stored
                .filter(entry =>
                    entry &&
                    typeof entry.username === "string" &&
                    /^[a-zA-Z0-9._]{1,32}$/.test(entry.username) &&
                    Number.isSafeInteger(entry.stars) &&
                    entry.stars > 0
                )
                .map(entry => ({
                    username: entry.username,
                    stars: entry.stars,
                    globalStars: Number.isSafeInteger(entry.globalStars) && entry.globalStars >= 0
                        ? entry.globalStars
                        : null,
                    avatarUrl: getAvatarSource({ avatarUrl: entry.avatarUrl }).startsWith("data:")
                        ? ""
                        : getAvatarSource({ avatarUrl: entry.avatarUrl })
                }))
                .slice(0, 100);
        } catch (error) {
            console.error("Classement local des étoiles illisible :", error);
            return [];
        }
    }

    function saveStarWinners() {
        try {
            localStorage.setItem(STAR_WINNERS_STORAGE_KEY, JSON.stringify(starWinners.slice(0, 100)));
        } catch (error) {
            console.error("Impossible d’enregistrer le classement local des étoiles :", error);
            setPrizeStatus("Le gain est crédité, mais le classement local ne peut pas être sauvegardé.", "warning");
        }
    }

    function sortedStarWinners() {
        return [...starWinners].sort((a, b) =>
            b.stars - a.stars || a.username.localeCompare(b.username, "fr")
        );
    }

    function renderStarLeaderboard() {
        const winners = sortedStarWinners().slice(0, 3);
        renderSpectatorLeaderboard(starLeaderboardList, winners);
        panelStarLeaderboard.replaceChildren();
        if (!winners.length) {
            const empty = document.createElement("li");
            empty.textContent = "En attente des premiers gains";
            panelStarLeaderboard.append(empty);
            return;
        }
        winners.forEach((winner, index) => {
            const row = document.createElement("li");
            const name = document.createElement("span");
            name.textContent = `${index + 1}. @${winner.username}`;
            const score = document.createElement("span");
            score.textContent = `${winner.stars.toLocaleString("fr-FR")} ⭐ jeu · ${winner.globalStars === null ? "—" : winner.globalStars.toLocaleString("fr-FR")} ⭐ tous jeux`;
            row.append(name, score);
            panelStarLeaderboard.append(row);
        });
    }

    function updateOverlayPositions() {
        updateOverlayPosition(starLeaderboard, leaderboardXInput, leaderboardYInput, leaderboardScaleInput);
    }

    function updateOverlayPosition(element, xInput, yInput, scaleInput) {
        document.getElementById(`${xInput.id}-value`).value = `${xInput.value} %`;
        document.getElementById(`${yInput.id}-value`).value = `${yInput.value} %`;
        if (scaleInput) {
            document.getElementById(`${scaleInput.id}-value`).value = `${scaleInput.value} %`;
        }
        const scalePercent = scaleInput ? Number(scaleInput.value) : 100;
        const maximumScalePercent = element === starLeaderboard ? 100 : 200;
        setOverlayPosition(element, Number(xInput.value), Number(yInput.value), scalePercent, maximumScalePercent);
    }

    function updateGlobalStars(player) {
        const username = String(player?.username || player?.uniqueId || "").trim().replace(/^@/, "");
        if (!/^[a-zA-Z0-9._]{1,32}$/.test(username)) {
            return;
        }
        const winner = starWinners.find(entry => entry.username.toLowerCase() === username.toLowerCase());
        if (!winner) {
            return;
        }
        const stars = Number(player.stars);
        if (Number.isSafeInteger(stars) && stars >= 0) {
            winner.globalStars = stars;
        }
        const avatarUrl = getAvatarSource(player);
        if (avatarUrl && !avatarUrl.startsWith("data:")) {
            winner.avatarUrl = avatarUrl;
        }
        saveStarWinners();
        renderStarLeaderboard();
    }

    function showPrizeBanner({ username, avatarUrl, amount, earned = false }) {
        prizeBannerName.textContent = `@${username}`;
        const earnedPrefix = earned ? "+" : "";
        prizeBannerMessage.textContent = `${earnedPrefix}${Number(amount).toLocaleString("fr-FR")} ⭐`;
        const safeAvatar = getAvatarSource({ avatarUrl });
        if (safeAvatar) {
            prizeBannerAvatar.src = safeAvatar;
            prizeBannerAvatar.hidden = false;
        } else {
            prizeBannerAvatar.removeAttribute("src");
            prizeBannerAvatar.hidden = true;
        }
        prizeBanner.hidden = false;
        window.clearTimeout(prizeBannerTimer);
        prizeBannerTimer = window.setTimeout(() => {
            prizeBanner.hidden = true;
        }, 8000);
    }

    async function refreshLeaderboardBalances() {
        if (!window.ArcadeStars || typeof window.ArcadeStars.getBalance !== "function") {
            return;
        }
        for (const winner of sortedStarWinners().slice(0, 3)) {
            try {
                const player = await window.ArcadeStars.getBalance(winner.username);
                updateGlobalStars(player);
            } catch (error) {
                console.error(`Impossible de lire le solde de @${winner.username} :`, error);
            }
        }
    }

    const initialPanelRect = panel.getBoundingClientRect();
    panelBounds = {
        left: initialPanelRect.left,
        top: initialPanelRect.top,
        width: initialPanelRect.width,
        height: Math.min(initialPanelRect.height, window.innerHeight * 0.8)
    };
    const setupRecord = readSetupRecord();
    const originalPrizeCards = setupRecord.prizeCards.map(card => ({ ...card }));
    let prizeStockAdditionApplied = false;
    let prizeStockMigrationMessage = "";
    if (setupRecord.prizeStockAdditionVersion < PRIZE_STOCK_ADDITION_VERSION) {
        try {
            setupRecord.prizeCards = addPrizeStock(setupRecord.prizeCards);
            setupRecord.prizeStockAdditionVersion = PRIZE_STOCK_ADDITION_VERSION;
            prizeStockAdditionApplied = true;
        } catch (error) {
            console.error("Impossible d’ajouter le nouveau stock de cartes :", error);
            prizeStockMigrationMessage = `Lot de cartes non ajouté : ${error.message}`;
        }
    }
    prizeStockAdditionVersion = setupRecord.prizeStockAdditionVersion;
    usernameInput.value = setupRecord.username;
    characterScaleInput.value = String(setupRecord.characterScalePercent);
    characterScaleValue.value = `${setupRecord.characterScalePercent} %`;
    characterHorizontalInput.value = String(setupRecord.characterHorizontalPercent);
    characterHorizontalValue.value = `${setupRecord.characterHorizontalPercent} %`;
    characterDepthInput.value = String(setupRecord.characterDepthPercent);
    characterDepthValue.value = `${setupRecord.characterDepthPercent} %`;
    starWinners = readStarWinners();
    renderStarLeaderboard();
    showStarLeaderboardInput.checked = setupRecord.showStarLeaderboard;
    starLeaderboard.hidden = !setupRecord.showStarLeaderboard;
    leaderboardXInput.value = String(setupRecord.leaderboardX);
    leaderboardYInput.value = String(setupRecord.leaderboardY);
    leaderboardScaleInput.value = String(setupRecord.leaderboardScalePercent);
    updateOverlayPositions();
    prizeCards = setupRecord.prizeCards;
    ingotFrequency = setupRecord.ingotFrequency;
    manualCardUsernameInput.value = setupRecord.manualCardUsername;
    manualCardStarsInput.value = String(setupRecord.manualCardStars);
    ingotFrequencyInput.value = String(ingotFrequency);
    ingotFrequencyValue.textContent = String(ingotFrequency);
    renderPrizeCards();
    setCharacterScale(setupRecord.characterScalePercent / 100);
    setCharacterPosition({
        horizontalPercent: setupRecord.characterHorizontalPercent,
        depthPercent: setupRecord.characterDepthPercent
    });
    if (setupRecord.panel) {
        setPanelBounds(setupRecord.panel);
    } else {
        setPanelBounds(panelBounds);
    }
    setPanelVisible(setupRecord.panelVisible, false);
    if (setupRecord.video) {
        activeVideoName = setupRecord.video.name;
        activeVideoDataUrl = setupRecord.video.dataUrl || "";
        activeVideoStorageKey = setupRecord.video.storageKey || "";
        clearVideoButton.disabled = false;
        if (activeVideoDataUrl) {
            activeVideoUrl = activeVideoDataUrl;
            setScreenVideo(activeVideoUrl);
            setVideoStatus(`Restauration de « ${activeVideoName} »…`);
        } else if (activeVideoStorageKey) {
            const storageKey = activeVideoStorageKey;
            setVideoStatus(`Restauration de « ${activeVideoName} »…`);
            activeVideoSavePromise = loadSetupVideo(storageKey).then(file => {
                if (activeVideoStorageKey !== storageKey) {
                    return;
                }
                if (!file) {
                    throw new Error("Fichier vidéo introuvable dans le stockage local.");
                }
                activeVideoUrl = URL.createObjectURL(file);
                setScreenVideo(activeVideoUrl);
            }).catch(error => {
                if (activeVideoStorageKey !== storageKey) {
                    return;
                }
                activeVideoSaveError = error;
                console.error("Impossible de restaurer la vidéo du setup :", error);
                setVideoStatus(`Impossible de restaurer « ${activeVideoName} » : ${error.message}`, "error");
            });
        } else {
            setVideoStatus(`« ${activeVideoName} » devra être re-sélectionnée après rechargement.`);
        }
    }
    if (setupRecord.gameBackground) {
        activeGameBackgroundName = setupRecord.gameBackground.name;
        activeGameBackgroundType = setupRecord.gameBackground.type;
        activeGameBackgroundDataUrl = setupRecord.gameBackground.dataUrl || "";
        activeGameBackgroundStorageKey = setupRecord.gameBackground.storageKey || "";
        clearGameBackgroundButton.disabled = false;
        if (activeGameBackgroundDataUrl) {
            activeGameBackgroundUrl = activeGameBackgroundDataUrl;
            setGameBackground(activeGameBackgroundUrl, activeGameBackgroundType);
            setGameBackgroundStatus(`Restauration de l’arrière-plan « ${activeGameBackgroundName} »…`);
        } else if (activeGameBackgroundStorageKey) {
            const storageKey = activeGameBackgroundStorageKey;
            setGameBackgroundStatus(`Restauration de l’arrière-plan « ${activeGameBackgroundName} »…`);
            activeGameBackgroundSavePromise = loadSetupVideo(storageKey).then(file => {
                if (activeGameBackgroundStorageKey !== storageKey) {
                    return;
                }
                if (!file) {
                    throw new Error("Fichier d’arrière-plan introuvable dans le stockage local.");
                }
                activeGameBackgroundUrl = URL.createObjectURL(file);
                setGameBackground(activeGameBackgroundUrl, activeGameBackgroundType);
            }).catch(error => {
                if (activeGameBackgroundStorageKey !== storageKey) {
                    return;
                }
                activeGameBackgroundSaveError = error;
                console.error("Impossible de restaurer l’arrière-plan du setup :", error);
                setGameBackgroundStatus(`Impossible de restaurer « ${activeGameBackgroundName} » : ${error.message}`, "error");
            });
        } else {
            setGameBackgroundStatus(`« ${activeGameBackgroundName} » devra être re-sélectionné après rechargement.`);
        }
    }
    if (prizeStockAdditionApplied) {
        if (persistSetupRecord()) {
            prizeStockMigrationMessage = "Nouveau lot ajouté au stock existant et sauvegardé.";
        } else {
            prizeCards = originalPrizeCards;
            prizeStockAdditionVersion = 0;
            renderPrizeCards();
            prizeStockMigrationMessage = "Lot non ajouté : impossible de sauvegarder le stock mis à jour.";
        }
    }
    setPrizeConfig({ cards: prizeCards, ingotFrequency });
    if (prizeStockMigrationMessage) {
        setPrizeStatus(
            prizeStockMigrationMessage,
            prizeStockAdditionApplied && prizeStockAdditionVersion === PRIZE_STOCK_ADDITION_VERSION ? "" : "error"
        );
    }

    addPrizeCardsButton.addEventListener("click", () => {
        const stars = Number(newCardStarsInput.value);
        const count = Number(newCardCountInput.value);
        if (
            !Number.isSafeInteger(stars) ||
            stars < 1 ||
            stars > MAX_CARD_STARS ||
            !Number.isSafeInteger(count) ||
            count < 1 ||
            count > MAX_CARDS_PER_DENOMINATION
        ) {
            setPrizeStatus("Indique une valeur de 1 à 250 000 étoiles et un stock de 1 à 10 000 cartes.", "error");
            return;
        }
        const updated = prizeCards.map(card => ({ ...card }));
        const existing = updated.find(card => card.stars === stars);
        if (existing) {
            existing.count += count;
        } else {
            updated.push({ stars, count });
        }
        if (commitPrizeConfig(updated, ingotFrequency, `${count.toLocaleString("fr-FR")} carte${count === 1 ? "" : "s"} à ${stars.toLocaleString("fr-FR")} étoiles ajoutée${count === 1 ? "" : "s"}.`)) {
            newCardCountInput.value = "1";
        }
    });
    resetPrizeCardsButton.addEventListener("click", () => {
        commitPrizeConfig(
            DEFAULT_PRIZE_CARDS.map(card => ({ ...card })),
            10,
            "Les 395 cartes par défaut sont rétablies."
        );
    });
    retryPrizeCreditsButton.addEventListener("click", () => {
        setPrizeStatus("Vérification des gains en attente…");
        window.dispatchEvent(new Event("coin-pusher-retry-credits"));
    });
    dropPrizeCardButton.addEventListener("click", () => {
        const username = manualCardUsernameInput.value.trim().replace(/^@/, "");
        if (!/^[a-zA-Z0-9._]{1,32}$/.test(username)) {
            setPrizeStatus("Indique un pseudo TikTok valide pour la carte.", "error");
            manualCardUsernameInput.focus();
            return;
        }
        manualCardUsernameInput.value = username;
        const stars = Number(manualCardStarsInput.value);
        if (!Number.isSafeInteger(stars) || stars < 1 || stars > MAX_CARD_STARS) {
            setPrizeStatus("La valeur de la carte doit être comprise entre 1 et 250 000 étoiles.", "error");
            manualCardStarsInput.focus();
            return;
        }
        persistSetupRecord();
        dropPrizeCard(username, stars);
    });
    dropPrizeIngotButton.addEventListener("click", () => {
        const username = manualCardUsernameInput.value.trim().replace(/^@/, "");
        if (!/^[a-zA-Z0-9._]{1,32}$/.test(username)) {
            setPrizeStatus("Indique un pseudo TikTok valide pour le lingot.", "error");
            manualCardUsernameInput.focus();
            return;
        }
        manualCardUsernameInput.value = username;
        persistSetupRecord();
        dropPrizeIngot(username);
    });
    manualCardStarsInput.addEventListener("change", persistSetupRecord);
    showStarLeaderboardInput.addEventListener("change", () => {
        starLeaderboard.hidden = !showStarLeaderboardInput.checked;
        persistSetupRecord();
    });
    window.addEventListener("pointermove", event => {
        const bounds = starLeaderboard.getBoundingClientRect();
        const hovering = event.pointerType === "mouse" &&
            event.clientX >= bounds.left &&
            event.clientX <= bounds.right &&
            event.clientY >= bounds.top &&
            event.clientY <= bounds.bottom;
        starLeaderboard.classList.toggle("is-handle-visible", hovering || Boolean(leaderboardDrag));
    });
    starLeaderboardDragHandle.addEventListener("pointerdown", event => {
        if (event.button !== 0) {
            return;
        }
        const bounds = starLeaderboard.getBoundingClientRect();
        leaderboardDrag = {
            pointerId: event.pointerId,
            offsetX: event.clientX - (bounds.left + bounds.width / 2),
            offsetY: event.clientY - (bounds.top + bounds.height / 2)
        };
        starLeaderboard.classList.add("is-dragging");
        starLeaderboardDragHandle.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    function finishLeaderboardDrag(event) {
        if (!leaderboardDrag || leaderboardDrag.pointerId !== event.pointerId) {
            return;
        }
        leaderboardDrag = null;
        starLeaderboard.classList.remove("is-dragging");
        persistSetupRecord();
    }
    window.addEventListener("pointermove", event => {
        if (!leaderboardDrag || leaderboardDrag.pointerId !== event.pointerId) {
            return;
        }
        const bounds = starLeaderboard.getBoundingClientRect();
        const minX = Math.min(bounds.width / 2, window.innerWidth / 2);
        const maxX = Math.max(window.innerWidth - bounds.width / 2, window.innerWidth / 2);
        const minY = Math.min(bounds.height / 2, window.innerHeight / 2);
        const maxY = Math.max(window.innerHeight - bounds.height / 2, window.innerHeight / 2);
        const centerX = Math.min(maxX, Math.max(minX, event.clientX - leaderboardDrag.offsetX));
        const centerY = Math.min(maxY, Math.max(minY, event.clientY - leaderboardDrag.offsetY));
        leaderboardXInput.value = String(Math.round(centerX / window.innerWidth * 100));
        leaderboardYInput.value = String(Math.round(centerY / window.innerHeight * 100));
        updateOverlayPosition(starLeaderboard, leaderboardXInput, leaderboardYInput, leaderboardScaleInput);
    });
    window.addEventListener("pointerup", finishLeaderboardDrag);
    window.addEventListener("pointercancel", finishLeaderboardDrag);
    for (const input of [leaderboardXInput, leaderboardYInput, leaderboardScaleInput]) {
        input.addEventListener("input", () => {
            updateOverlayPosition(starLeaderboard, leaderboardXInput, leaderboardYInput, leaderboardScaleInput);
            scheduleSetupPersistence();
        });
    }
    ingotFrequencyInput.addEventListener("change", () => {
        const frequency = Number(ingotFrequencyInput.value);
        if (!Number.isSafeInteger(frequency) || frequency < 0 || frequency > 1000) {
            setPrizeStatus("La fréquence doit être un nombre entier entre 0 et 1 000.", "error");
            ingotFrequencyInput.value = String(ingotFrequency);
            return;
        }
        commitPrizeConfig(prizeCards, frequency, frequency
            ? `Un lingot de 50 étoiles sera ajouté après chaque tranche de ${frequency} cartes créditées.`
            : "Les lingots automatiques sont désactivés.");
    });

    window.addEventListener("coin-pusher-prize-deck-change", event => {
        try {
            prizeCards = validatePrizeCards(event.detail.cards);
            ingotFrequency = Number(event.detail.ingotFrequency);
            ingotFrequencyInput.value = String(ingotFrequency);
            renderPrizeCards();
            if (persistSetupRecord()) {
                setPrizeStatus("Carte réservée · stock mis à jour.");
            }
        } catch (error) {
            console.error("Impossible de mettre à jour le stock des cartes :", error);
            setPrizeStatus(error.message, "error");
        }
    });
    window.addEventListener("coin-pusher-prize-status", event => {
        setPrizeStatus(String(event.detail?.message || ""), event.detail?.state || "");
    });
    window.addEventListener("coin-pusher-prize-awarded", event => {
        const detail = event.detail || {};
        const username = String(detail.username || "").trim().replace(/^@/, "");
        const amount = Number(detail.amount);
        if (!/^[a-zA-Z0-9._]{1,32}$/.test(username) || !Number.isSafeInteger(amount) || amount < 1) {
            console.error("Événement de gain d’étoiles invalide :", detail);
            setPrizeStatus("Le portefeuille a confirmé un gain avec des données invalides.", "error");
            return;
        }
        let winner = starWinners.find(entry => entry.username.toLowerCase() === username.toLowerCase());
        if (!winner) {
            winner = { username, stars: 0, globalStars: 0, avatarUrl: "" };
            starWinners.push(winner);
        }
        winner.stars += amount;
        winner.globalStars = Number.isSafeInteger(detail.globalStars) ? detail.globalStars : winner.globalStars;
        const avatarUrl = getAvatarSource({ avatarUrl: detail.avatarUrl });
        if (avatarUrl && !avatarUrl.startsWith("data:")) {
            winner.avatarUrl = avatarUrl;
        }
        starWinners = sortedStarWinners().slice(0, 100);
        saveStarWinners();
        renderStarLeaderboard();
        showPrizeBanner({
            ...detail,
            username,
            amount,
            avatarUrl: avatarUrl || winner.avatarUrl,
            earned: true
        });
        setPrizeStatus(`Gain confirmé : @${username} reçoit ${amount.toLocaleString("fr-FR")} étoiles.`);
    });
    window.addEventListener("coin-pusher-prize-error", event => {
        const detail = event.detail || {};
        setPrizeStatus(`Gain non crédité${detail.username ? ` pour @${detail.username}` : ""} : ${detail.message || "portefeuille indisponible"}`, "error");
    });
    window.addEventListener("arcade:wallet", event => {
        const detail = event.detail || {};
        if (!/non confirmée/i.test(String(detail.message || ""))) {
            updateGlobalStars(detail.player);
        }
        if (/^Solde global/.test(String(detail.message || "")) && detail.player) {
            const player = detail.player;
            showPrizeBanner({
                username: player.username || player.uniqueId || "Spectateur",
                avatarUrl: getAvatarSource(player),
                amount: Number(player.stars) || 0
            });
        }
    });
    window.addEventListener("arcade:wallet-run", event => {
        const detail = event.detail || {};
        const player = detail.player || {};
        const username = String(player.uniqueId || player.username || "").trim().replace(/^@/, "");
        const count = Math.floor(Number(detail.spent) || 0);
        if (!/^[a-zA-Z0-9._]{1,32}$/.test(username) || count < 1 || count > MAX_TIKTOK_GIFT_COINS) {
            return;
        }
        const queued = receiveGiftWithAvatar(count, { ...player, username });
        setStatus(`RUN de @${username} · ${queued.toLocaleString("fr-FR")} pièce${queued === 1 ? "" : "s"} ajoutée${queued === 1 ? "" : "s"} à la file.`);
    });
    window.addEventListener("arcade:wallet-run-rejected", event => {
        setStatus(String(event.detail?.message || "RUN refusé : solde insuffisant."), "error");
    });

    function sendTikTokConnection(connection, username) {
        connection.send(JSON.stringify({ action: "CONNECT_TIKTOK", username }));
        startGame();
        setStatus(`Demande envoyée pour @${username} · en attente du bot.`);
    }

    function connectTikTok(username) {
        if (IS_LOCAL_PREVIEW) {
            setStatus("Aperçu local · la connexion TikTok live est disponible sur Griffon Arcade.", "error");
            return;
        }
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            connectRelay();
            return;
        }
        sendTikTokConnection(socket, username);
    }

    function handleMessage(data) {
        const type = String(data.type || "").toLowerCase();
        if (type === "status") {
            setStatus(String(data.message || "Statut du direct reçu."));
            return;
        }
        if (type === "viewer") {
            const viewer = data.viewer || data;
            const avatarKeys = getAvatarKeys(viewer);
            const avatarDataUri = typeof viewer.avatarDataUri === "string" &&
                viewer.avatarDataUri.length <= MAX_AVATAR_DATA_URI_LENGTH &&
                /^data:image\/(?:jpeg|png|webp|gif|avif);base64,/i.test(viewer.avatarDataUri)
                ? viewer.avatarDataUri
                : "";
            const avatarUrl = getAvatarUrl(viewer);
            for (const avatarKey of avatarKeys) {
                updateGiftAvatar(avatarKey, avatarDataUri, avatarUrl);
            }
            const username = String(viewer.uniqueId || viewer.username || "").trim().replace(/^@/, "");
            if (
                !avatarDataUri &&
                avatarKeys.length &&
                /^[a-zA-Z0-9._]{1,32}$/.test(username) &&
                !isLocalAvatarUrl(avatarUrl)
            ) {
                void lookupWalletAvatar(avatarKeys, username);
            }
            return;
        }
        if (type !== "gift" && type !== "tiktok-gift") {
            return;
        }
        const gift = data.gift || data;
        const count = Number(gift.coinCount ?? gift.count ?? gift.repeatCount ?? 1);
        if (!Number.isSafeInteger(count) || count < 1 || count > MAX_TIKTOK_GIFT_COINS) {
            setStatus(`Cadeau ignoré : nombre de pièces invalide (maximum ${MAX_TIKTOK_GIFT_COINS.toLocaleString("fr-FR")}).`, "error");
            return;
        }
        const username = String(gift.uniqueId || gift.username || "")
            .trim()
            .replace(/^@/, "");
        const queued = receiveGiftWithAvatar(count, {
            ...gift,
            username: /^[a-zA-Z0-9._]{1,32}$/.test(username) ? username : ""
        });
        setStatus(`@${username || "Spectateur"} · ${queued.toLocaleString("fr-FR")} pièce${queued === 1 ? "" : "s"} ajoutée${queued === 1 ? "" : "s"} à la file.`);
    }

    function connectRelay() {
        clearTimeout(reconnectTimer);
        if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
            return;
        }
        const connection = new WebSocket(RELAY_URL);
        socket = connection;
        connection.addEventListener("open", () => {
            setStatus("Relais connecté · saisis le pseudo TikTok du direct.");
            const username = usernameInput.value.trim().replace(/^@/, "");
            if (username) {
                sendTikTokConnection(connection, username);
            }
        });
        connection.addEventListener("message", event => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (error) {
                console.error("Événement TikTok invalide :", error);
                setStatus("Message du relais illisible · consulte la console.", "error");
                return;
            }
            handleMessage(data);
        });
        connection.addEventListener("error", () => {
            setStatus("Relais TikTok inaccessible · vérifie la connexion Internet.", "error");
        });
        connection.addEventListener("close", () => {
            if (socket === connection) {
                socket = null;
            }
            setStatus("Relais déconnecté · nouvelle tentative…");
            reconnectTimer = setTimeout(connectRelay, RECONNECT_DELAY);
        });
    }

    connectButton.addEventListener("click", () => {
        const username = usernameInput.value.trim().replace(/^@/, "");
        if (!username) {
            setStatus("Saisis ton pseudo TikTok.", "error");
            usernameInput.focus();
            return;
        }
        connectTikTok(username);
    });
    usernameInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            connectButton.click();
        }
    });
    test1000CoinsButton.addEventListener("click", () => {
        const username = "test";
        const queued = receiveGift(1000, {
            username,
            uniqueId: username,
            avatarKey: username,
            avatarDataUri: createTestAvatarDataUri()
        }, true);
        const coinLabel = `${queued.toLocaleString("fr-FR")} pièce${queued === 1 ? "" : "s"}`;
        testCoinsStatusElement.textContent = queued === 1000
            ? `Test lancé : ${coinLabel} ajoutées à la file (aucun cadeau TikTok envoyé).`
            : `Test partiel : ${coinLabel} ajoutées à la file sur 1 000.`;
        setStatus(testCoinsStatusElement.textContent, queued === 1000 ? "" : "error");
    });
    characterScaleInput.addEventListener("input", () => {
        const percent = Number(characterScaleInput.value);
        characterScaleValue.value = `${percent} %`;
        setCharacterScale(percent / 100);
        scheduleSetupPersistence();
    });
    const updateCharacterPosition = () => {
        const horizontalPercent = Number(characterHorizontalInput.value);
        const depthPercent = Number(characterDepthInput.value);
        characterHorizontalValue.value = `${horizontalPercent} %`;
        characterDepthValue.value = `${depthPercent} %`;
        setCharacterPosition({ horizontalPercent, depthPercent });
        scheduleSetupPersistence();
    };
    characterHorizontalInput.addEventListener("input", updateCharacterPosition);
    characterDepthInput.addEventListener("input", updateCharacterPosition);
    gameBackgroundInput.addEventListener("change", () => {
        const file = gameBackgroundInput.files[0];
        gameBackgroundInput.value = "";
        if (!file) {
            return;
        }
        const isImage = file.type.startsWith("image/") || /\.(apng|avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name);
        const isVideo = file.type.startsWith("video/") || /\.(3gp|avi|m4v|mkv|mov|mp4|mpeg|mpg|ogv|ogg|webm)$/i.test(file.name);
        const mediaType = file.type.startsWith("image/")
            ? "image"
            : file.type.startsWith("video/")
                ? "video"
                : isImage
                    ? "image"
                    : isVideo
                        ? "video"
                        : "";
        if (!mediaType) {
            setGameBackgroundStatus("Choisis un fichier image ou vidéo.", "error");
            return;
        }
        if (activeGameBackgroundUrl && activeGameBackgroundUrl.startsWith("blob:")) {
            retiredGameBackgroundUrls.add(activeGameBackgroundUrl);
        }
        const previousStorageKey = activeGameBackgroundStorageKey;
        const mediaUrl = URL.createObjectURL(file);
        const storageKey = createVideoStorageKey();
        activeGameBackgroundUrl = mediaUrl;
        activeGameBackgroundName = file.name;
        activeGameBackgroundType = mediaType;
        activeGameBackgroundDataUrl = "";
        activeGameBackgroundStorageKey = "";
        activeGameBackgroundDataUrlPromise = Promise.resolve();
        activeGameBackgroundSaveError = null;
        clearGameBackgroundButton.disabled = false;
        setGameBackground(mediaUrl, mediaType);
        scheduleSetupPersistence();
        activeGameBackgroundSavePromise = saveSetupVideo(storageKey, file).then(() => {
            if (activeGameBackgroundUrl !== mediaUrl) {
                return deleteSetupVideo(storageKey);
            }
            activeGameBackgroundSaveError = null;
            activeGameBackgroundStorageKey = storageKey;
            if (!persistSetupRecord()) {
                activeGameBackgroundSaveError = new Error("Impossible d’enregistrer la référence de l’arrière-plan dans le setup.");
                setGameBackgroundStatus(activeGameBackgroundSaveError.message, "error");
                return;
            }
            if (previousStorageKey) {
                void deleteSetupVideo(previousStorageKey).catch(error => {
                    console.warn("Impossible de supprimer l’ancien arrière-plan du setup :", error);
                });
            }
            setGameBackgroundStatus(activeGameBackgroundDataUrl
                ? `« ${file.name} » est affiché en arrière-plan et inclus dans l’export du setup.`
                : `« ${file.name} » est affiché en arrière-plan et conservé sur cet appareil, mais ne sera pas inclus dans l’export.`);
        }).catch(error => {
            activeGameBackgroundSaveError = error;
            console.error("Impossible de conserver l’arrière-plan dans le setup :", error);
            if (activeGameBackgroundUrl === mediaUrl) {
                setGameBackgroundStatus(`« ${file.name} » est affiché, mais n’a pas pu être sauvegardé : ${error.message}`, "error");
            }
        });
        if (file.size > MAX_EXPORTABLE_SETUP_VIDEO_BYTES) {
            setGameBackgroundStatus(`« ${file.name} » est affiché; sauvegarde locale en cours. Il ne sera pas inclus dans l’export du setup (limite : 1,3 Mo).`, "warning");
            return;
        }
        const reader = new FileReader();
        activeGameBackgroundDataUrlPromise = new Promise(resolve => {
            reader.addEventListener("load", () => {
                if (activeGameBackgroundUrl !== mediaUrl) {
                    resolve();
                    return;
                }
                if (
                    typeof reader.result !== "string" ||
                    !reader.result.startsWith(`data:${mediaType}/`)
                ) {
                    setGameBackgroundStatus("Le média est affiché, mais ne peut pas être inclus dans le setup.", "warning");
                    resolve();
                    return;
                }
                activeGameBackgroundDataUrl = reader.result;
                if (persistSetupRecord()) {
                    setGameBackgroundStatus(`« ${file.name} » est affiché en arrière-plan et inclus dans l’export du setup.`);
                }
                resolve();
            }, { once: true });
            reader.addEventListener("error", () => {
                if (activeGameBackgroundUrl === mediaUrl) {
                    console.error("Impossible de préparer le média d’arrière-plan pour l’export :", reader.error);
                    setGameBackgroundStatus("Média affiché, mais impossible de l’inclure dans le setup.", "warning");
                }
                resolve();
            }, { once: true });
            reader.readAsDataURL(file);
        });
    });
    clearGameBackgroundButton.addEventListener("click", () => {
        const storageKey = activeGameBackgroundStorageKey;
        if (storageKey) {
            void deleteSetupVideo(storageKey).catch(error => {
                console.error("Impossible de supprimer l’arrière-plan du stockage local :", error);
                setGameBackgroundStatus(`Arrière-plan retiré, mais impossible d’effacer sa copie locale : ${error.message}`, "warning");
            });
        }
        if (activeGameBackgroundUrl && activeGameBackgroundUrl.startsWith("blob:")) {
            URL.revokeObjectURL(activeGameBackgroundUrl);
        }
        activeGameBackgroundUrl = null;
        activeGameBackgroundName = "";
        activeGameBackgroundType = "";
        activeGameBackgroundDataUrl = "";
        activeGameBackgroundStorageKey = "";
        activeGameBackgroundDataUrlPromise = Promise.resolve();
        activeGameBackgroundSaveError = null;
        gameBackgroundInput.value = "";
        clearGameBackgroundButton.disabled = true;
        setGameBackground(null, null);
        releaseRetiredGameBackgroundUrls();
        setGameBackgroundStatus("Arrière-plan retiré.");
        scheduleSetupPersistence();
    });
    videoInput.addEventListener("change", () => {
        const file = videoInput.files[0];
        videoInput.value = "";
        if (!file) {
            return;
        }
        if (
            !file.type.startsWith("video/") &&
            !/\.(mp4|m4v|mov|webm|ogv|ogg|avi|mkv|3gp|mpeg|mpg)$/i.test(file.name)
        ) {
            setVideoStatus("Choisis un fichier vidéo.", "error");
            return;
        }
        if (activeVideoUrl && activeVideoUrl.startsWith("blob:")) {
            retiredVideoUrls.add(activeVideoUrl);
        }
        const previousStorageKey = activeVideoStorageKey;
        const videoUrl = URL.createObjectURL(file);
        const storageKey = createVideoStorageKey();
        activeVideoUrl = videoUrl;
        activeVideoName = file.name;
        activeVideoDataUrl = "";
        activeVideoStorageKey = "";
        activeVideoDataUrlPromise = Promise.resolve();
        activeVideoSaveError = null;
        clearVideoButton.disabled = false;
        setScreenVideo(activeVideoUrl);
        scheduleSetupPersistence();
        activeVideoSavePromise = saveSetupVideo(storageKey, file).then(() => {
            if (activeVideoUrl !== videoUrl) {
                return deleteSetupVideo(storageKey);
            }
            activeVideoSaveError = null;
            activeVideoStorageKey = storageKey;
            if (!persistSetupRecord()) {
                activeVideoSaveError = new Error("Impossible d’enregistrer la référence de la vidéo dans le setup.");
                setVideoStatus(activeVideoSaveError.message, "error");
                return;
            }
            if (previousStorageKey) {
                void deleteSetupVideo(previousStorageKey).catch(error => {
                    console.warn("Impossible de supprimer l’ancienne vidéo du setup :", error);
                });
            }
            setVideoStatus(activeVideoDataUrl
                ? `« ${file.name} » est affichée et incluse dans l’export du setup, et conservée sur cet appareil.`
                : `« ${file.name} » est affichée et conservée sur cet appareil, mais ne sera pas incluse dans l’export.`);
        }).catch(error => {
            activeVideoSaveError = error;
            console.error("Impossible de conserver la vidéo dans le setup :", error);
            if (activeVideoUrl === videoUrl) {
                setVideoStatus(`« ${file.name} » est affichée, mais n’a pas pu être sauvegardée : ${error.message}`, "error");
            }
        });
        if (file.size > MAX_EXPORTABLE_SETUP_VIDEO_BYTES) {
            setVideoStatus(`« ${file.name} » est affichée; sauvegarde locale en cours. Elle ne sera pas incluse dans l’export du setup (limite : 1,3 Mo).`, "warning");
            return;
        }
        const reader = new FileReader();
        activeVideoDataUrlPromise = new Promise(resolve => {
            reader.addEventListener("load", () => {
                if (activeVideoUrl !== videoUrl) {
                    resolve();
                    return;
                }
                if (typeof reader.result !== "string") {
                    setVideoStatus("La vidéo est affichée, mais ne peut pas être incluse dans le setup.", "warning");
                    resolve();
                    return;
                }
                activeVideoDataUrl = reader.result;
                if (persistSetupRecord()) {
                    setVideoStatus(`« ${file.name} » est affichée et incluse dans l’export du setup.`);
                }
                resolve();
            }, { once: true });
            reader.addEventListener("error", () => {
                if (activeVideoUrl === videoUrl) {
                    console.error("Impossible de préparer la vidéo pour l’export :", reader.error);
                    setVideoStatus("Vidéo affichée, mais impossible de l’inclure dans le setup.", "warning");
                }
                resolve();
            }, { once: true });
            reader.readAsDataURL(file);
        });
    });
    clearVideoButton.addEventListener("click", () => {
        const storageKey = activeVideoStorageKey;
        if (storageKey) {
            void deleteSetupVideo(storageKey).catch(error => {
                console.error("Impossible de supprimer la vidéo du stockage local :", error);
                setVideoStatus(`Vidéo retirée, mais impossible d’effacer sa copie locale : ${error.message}`, "warning");
            });
        }
        if (activeVideoUrl && activeVideoUrl.startsWith("blob:")) {
            retiredVideoUrls.add(activeVideoUrl);
        }
        activeVideoUrl = null;
        activeVideoName = "";
        activeVideoDataUrl = "";
        activeVideoStorageKey = "";
        activeVideoDataUrlPromise = Promise.resolve();
        activeVideoSaveError = null;
        videoInput.value = "";
        clearVideoButton.disabled = true;
        setScreenVideo(null);
        setVideoStatus("Vidéo retirée.");
        scheduleSetupPersistence();
    });
    window.addEventListener("message", event => {
        if (event.origin !== location.origin || !event.data) {
            return;
        }
        if (event.data.type === "screenVideoLoaded" && event.data.url === activeVideoUrl) {
            releaseRetiredVideoUrls();
            setVideoStatus(
                activeVideoDataUrl
                    ? `« ${activeVideoName} » est affichée et incluse dans l’export du setup.`
                    : activeVideoStorageKey
                        ? `« ${activeVideoName} » est affichée et conservée sur cet appareil.`
                        : `« ${activeVideoName} » est affichée en boucle.`
            );
        }
        if (event.data.type === "screenVideoError" && event.data.url === activeVideoUrl) {
            setVideoStatus("Impossible de lire cette vidéo. Essaie un fichier MP4 ou WebM.", "error");
        }
        if (event.data.type === "screenVideoCleared") {
            releaseRetiredVideoUrls();
        }
    });
    function backupSetup(raw) {
        localStorage.setItem(`${SETUP_STORAGE_KEY}-backup`, JSON.stringify({
            savedAt: Date.now(),
            data: raw
        }));
    }

    saveSetupButton.addEventListener("click", async () => {
        try {
            await Promise.all([
                activeVideoSavePromise,
                activeVideoDataUrlPromise,
                activeGameBackgroundSavePromise,
                activeGameBackgroundDataUrlPromise
            ]);
            if (activeVideoName && activeVideoSaveError && !activeVideoDataUrl) {
                throw activeVideoSaveError;
            }
            if (activeGameBackgroundName && activeGameBackgroundSaveError && !activeGameBackgroundDataUrl) {
                throw activeGameBackgroundSaveError;
            }
            if (!persistSetupRecord()) {
                return;
            }
            const raw = localStorage.getItem(SETUP_STORAGE_KEY);
            if (!raw) {
                throw new Error("Aucun setup à sauvegarder.");
            }
            backupSetup(raw);
            setSetupStatus(
                activeVideoName || activeGameBackgroundName
                    ? "Setup sauvegardé sur cet appareil. Les médias sélectionnés seront restaurés."
                    : "Setup sauvegardé sur cet appareil."
            );
        } catch (error) {
            console.error("Échec de la sauvegarde du setup :", error);
            setSetupStatus(`Sauvegarde impossible : ${error.message}`, "error");
        }
    });
    restoreSetupButton.addEventListener("click", () => {
        try {
            const rawBackup = localStorage.getItem(`${SETUP_STORAGE_KEY}-backup`);
            const backup = rawBackup ? JSON.parse(rawBackup) : null;
            if (!backup || typeof backup.data !== "string") {
                setSetupStatus("Aucune sauvegarde locale à restaurer.", "error");
                return;
            }
            validateSetupRecord(JSON.parse(backup.data));
            if (!confirm(`Restaurer la sauvegarde du ${new Date(backup.savedAt).toLocaleString("fr-FR")} ?`)) {
                return;
            }
            localStorage.setItem(SETUP_STORAGE_KEY, backup.data);
            prepareSetupReload();
            location.reload();
        } catch (error) {
            console.error("Échec de la restauration du setup :", error);
            setSetupStatus(`Restauration impossible : ${error.message}`, "error");
        }
    });
    exportSetupButton.addEventListener("click", async () => {
        try {
            await Promise.all([
                activeVideoSavePromise,
                activeVideoDataUrlPromise,
                activeGameBackgroundSavePromise,
                activeGameBackgroundDataUrlPromise
            ]);
            if (!persistSetupRecord()) {
                return;
            }
            const raw = localStorage.getItem(SETUP_STORAGE_KEY);
            if (!raw) {
                throw new Error("Aucun setup à exporter.");
            }
            const portableSetup = JSON.parse(raw);
            if (portableSetup.video) {
                portableSetup.video.storageKey = null;
            }
            if (portableSetup.gameBackground) {
                portableSetup.gameBackground.storageKey = null;
            }
            const payload = JSON.stringify({
                format: SETUP_FORMAT,
                game: SETUP_STORAGE_KEY,
                exportedAt: new Date().toISOString(),
                data: portableSetup
            }, null, 2);
            if (new Blob([payload]).size > MAX_SETUP_FILE_BYTES) {
                throw new Error("Le setup dépasse la taille maximale d’export (2 Mo).");
            }
            const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = `${SETUP_STORAGE_KEY}-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 2000);
            const mediaNotice = setupMediaExportNotice();
            setSetupStatus(`Setup exporté.${mediaNotice}`, mediaNotice ? "warning" : "");
        } catch (error) {
            console.error("Échec de l’export du setup :", error);
            setSetupStatus(`Export impossible : ${error.message}`, "error");
        }
    });
    importSetupButton.addEventListener("click", () => setupImportInput.click());
    setupImportInput.addEventListener("change", async () => {
        const file = setupImportInput.files[0];
        setupImportInput.value = "";
        if (!file) {
            return;
        }
        try {
            if (file.size > MAX_SETUP_FILE_BYTES) {
                throw new Error("Fichier trop volumineux (maximum 2 Mo).");
            }
            const payload = JSON.parse(await file.text());
            if (
                !payload ||
                payload.format !== SETUP_FORMAT ||
                payload.game !== SETUP_STORAGE_KEY
            ) {
                throw new Error("Ce fichier n’est pas un setup compatible avec Coin Pusher 2000.");
            }
            const importedSetup = validateSetupRecord(payload.data);
            const serializedSetup = JSON.stringify(importedSetup);
            if (new Blob([serializedSetup]).size > MAX_SETUP_FILE_BYTES) {
                throw new Error("Les données du setup dépassent la taille maximale.");
            }
            const currentSetup = localStorage.getItem(SETUP_STORAGE_KEY);
            if (currentSetup) {
                backupSetup(currentSetup);
            }
            localStorage.setItem(SETUP_STORAGE_KEY, serializedSetup);
            prepareSetupReload();
            setSetupStatus("Import réussi, rechargement du setup…");
            window.setTimeout(() => location.reload(), 500);
        } catch (error) {
            console.error("Échec de l’import du setup :", error);
            setSetupStatus(`Import impossible : ${error.message}`, "error");
        }
    });
    usernameInput.addEventListener("input", scheduleSetupPersistence);
    panelHeader.addEventListener("pointerdown", event => {
        if (event.button !== 0 || event.target.closest("button")) {
            return;
        }
        panelDrag = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: panelBounds.left,
            top: panelBounds.top
        };
        event.preventDefault();
    });
    panelResizeHandle.addEventListener("pointerdown", event => {
        if (event.button !== 0) {
            return;
        }
        panelResize = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            width: panelBounds.width,
            height: panelBounds.height
        };
        event.preventDefault();
    });
    function finishPanelAdjustment(event) {
        const dragged = panelDrag && panelDrag.pointerId === event.pointerId;
        const resized = panelResize && panelResize.pointerId === event.pointerId;
        if (!dragged && !resized) {
            return;
        }
        panelDrag = null;
        panelResize = null;
        persistSetupRecord();
    }
    window.addEventListener("pointermove", event => {
        if (panelDrag && panelDrag.pointerId === event.pointerId) {
            const rect = panel.getBoundingClientRect();
            setPanelBounds({
                left: panelDrag.left + event.clientX - panelDrag.x,
                top: panelDrag.top + event.clientY - panelDrag.y,
                width: rect.width,
                height: rect.height
            });
        }
        if (panelResize && panelResize.pointerId === event.pointerId) {
            setPanelBounds({
                ...panelBounds,
                width: panelResize.width + event.clientX - panelResize.x,
                height: panelResize.height + event.clientY - panelResize.y
            });
        }
    });
    window.addEventListener("pointerup", finishPanelAdjustment);
    window.addEventListener("pointercancel", finishPanelAdjustment);
    toggleButton.addEventListener("click", () => {
        setPanelVisible(false);
        showPanelButton.focus();
    });
    showPanelButton.addEventListener("click", () => {
        setPanelVisible(true);
        toggleButton.focus();
    });
    window.addEventListener("resize", () => {
        setPanelBounds(panelBounds);
        scheduleSetupPersistence();
    });
    window.addEventListener("pagehide", () => {
        if (setupReloadPending) {
            return;
        }
        if (setupPersistTimer) {
            clearTimeout(setupPersistTimer);
            setupPersistTimer = 0;
        }
        persistSetupRecord();
        releaseRetiredGameBackgroundUrls();
    });
    window.addEventListener("beforeunload", () => {
        if (activeVideoUrl && activeVideoUrl.startsWith("blob:")) {
            URL.revokeObjectURL(activeVideoUrl);
        }
        if (activeGameBackgroundUrl && activeGameBackgroundUrl.startsWith("blob:")) {
            URL.revokeObjectURL(activeGameBackgroundUrl);
        }
        releaseRetiredGameBackgroundUrls();
        releaseRetiredVideoUrls();
    });

    window.setInterval(() => {
        pendingElement.textContent = getPendingCoins().toLocaleString("fr-FR");
        refreshMachineControls();
    }, 250);
    window.setTimeout(refreshLeaderboardBalances, 3000);
    if (IS_LOCAL_PREVIEW) {
        setStatus("Aperçu local · utilise la simulation; le live se connecte depuis Griffon Arcade.");
    } else {
        connectRelay();
    }
}
