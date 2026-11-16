import * as rapier from "@dimforge/rapier3d-simd";
import Game from "./lib/index.js";
import initializeTikTokBridge from "./lib/tiktok-bridge.js";
import { GIFT_CATALOG } from "./lib/gift-catalog.js";
import { MAX_GIFT_COIN_COUNT } from "./lib/gift-limits.js";
import retryLegacyRouletteCredits from "./lib/legacy-roulette-credits.js";

Game.DEBUG_EMPTY_POOL = 0
Game.DEBUG_AUTOPLAY = 0
Game.DEBUG_MAX_SPEED = 0
Game.DEBUG_COLLIDERS = 0
Game.DEBUG_HIDE_CABINET = 0
Game.DEBUG_POLYGONS = 0
Game.DEBUG_CONTROLS = 0
Game.DEBUG_FPS = 0

const characterStatusElement = document.getElementById("character-status");
await Game.initialize({
    rapier,
    onCharacterStatus: message => {
        characterStatusElement.textContent = message;
    }
});
function receiveGift(count, avatar = {}) {
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_GIFT_COIN_COUNT) {
        return 0;
    }
    const profile = avatar && typeof avatar === "object" ? avatar : {};
    const candidate = String(profile.uniqueId || profile.username || "").trim().replace(/^@/, "");
    const username = /^[a-zA-Z0-9._]{1,32}$/.test(candidate) ? candidate : "Spectateur";
    return Game.receiveTikTokGift(count, { ...profile, username });
}
window.CoinPusher2000 = {
    startGame: () => Game.startGame(),
    receiveTikTokGift: receiveGift,
    updateTikTokGiftAvatar: (avatarKey, avatarDataUri, avatarUrl) => Game.updateTikTokGiftAvatar(avatarKey, avatarDataUri, avatarUrl),
    setCoinVolume: volume => Game.setCoinVolume(volume),
    setScreenVideo: url => Game.setScreenVideo(url),
    setSceneHorizontalOffset: offsetPixels => Game.setSceneHorizontalOffset(offsetPixels),
    setCharacterScale: scale => Game.setCharacterScale(scale),
    setCharacterPosition: position => Game.setCharacterPosition(position),
    dropPrizeCard: (username, stars) => Game.dropPrizeCard(username, stars),
    dropPrizeIngot: username => Game.dropPrizeIngot(username),
    setPrizeConfig: config => Game.setPrizeConfig(config),
    get pendingCoins() {
        return Game.pendingCoins;
    }
};
initializeTikTokBridge({
    receiveGift,
    giftCatalog: GIFT_CATALOG,
    updateGiftAvatar: (avatarKey, avatarDataUri, avatarUrl) => Game.updateTikTokGiftAvatar(avatarKey, avatarDataUri, avatarUrl),
    setCoinVolume: volume => Game.setCoinVolume(volume),
    getPendingCoins: () => Game.pendingCoins,
    startGame: () => Game.startGame(),
    getMachineControls: () => Game.getMachineControls(),
    pressMachineButton: name => Game.pressMachineButton(name),
    setScreenVideo: url => Game.setScreenVideo(url),
    setSceneHorizontalOffset: offsetPixels => Game.setSceneHorizontalOffset(offsetPixels),
    setCharacterScale: scale => Game.setCharacterScale(scale),
    setCharacterPosition: position => Game.setCharacterPosition(position),
    dropPrizeCard: (username, stars) => Game.dropPrizeCard(username, stars),
    dropPrizeIngot: username => Game.dropPrizeIngot(username),
    setPrizeConfig: config => Game.setPrizeConfig(config)
});
retryLegacyRouletteCredits();
const isLocalPreview = location.hostname === "localhost" || location.hostname === "127.0.0.1";
let checkingPrizeCredits = false;
async function retryPrizeCredits() {
    if (isLocalPreview) {
        return;
    }
    if (checkingPrizeCredits) return;
    checkingPrizeCredits = true;
    try {
        const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error("Impossible de vérifier le compte Griffon Arcade.");
        const session = await response.json();
        if (!session.authenticated || !session.username) {
            throw new Error("Connecte-toi à Griffon Arcade pour activer les récompenses.");
        }
        Game.configurePrizeCredits(session.username);
        Game.retryPrizeCredits();
    } catch (error) {
        console.error("Récompenses indisponibles :", error);
        window.dispatchEvent(new CustomEvent("coin-pusher-prize-status", {
            detail: { message: error.message, state: "error" }
        }));
    } finally {
        checkingPrizeCredits = false;
    }
}
window.addEventListener("coin-pusher-retry-credits", retryPrizeCredits);
if (isLocalPreview) {
    window.dispatchEvent(new CustomEvent("coin-pusher-prize-status", {
        detail: { message: "Aperçu local : les lâchers manuels sont visuels et ne créditent pas d’étoiles.", state: "warning" }
    }));
} else {
    window.addEventListener("online", retryPrizeCredits);
    window.setInterval(retryPrizeCredits, 30000);
    void retryPrizeCredits();
}
Game.run();