import * as rapier from "@dimforge/rapier3d-simd";
import Game from "./lib/index.js";
import initializeTikTokBridge from "./lib/tiktok-bridge.js";

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
window.CoinPusher2000 = {
    startGame: () => Game.startGame(),
    receiveTikTokGift: (count, avatar) => Game.receiveTikTokGift(count, avatar),
    updateTikTokGiftAvatar: (avatarKey, avatarDataUri, avatarUrl) => Game.updateTikTokGiftAvatar(avatarKey, avatarDataUri, avatarUrl),
    setCoinVolume: volume => Game.setCoinVolume(volume),
    setScreenVideo: url => Game.setScreenVideo(url),
    setCharacterScale: scale => Game.setCharacterScale(scale),
    setCharacterPosition: position => Game.setCharacterPosition(position),
    dropPrizeCard: username => Game.dropPrizeCard(username),
    setPrizeConfig: config => Game.setPrizeConfig(config),
    get pendingCoins() {
        return Game.pendingCoins;
    }
};
initializeTikTokBridge({
    receiveGift: (count, avatar) => Game.receiveTikTokGift(count, avatar),
    updateGiftAvatar: (avatarKey, avatarDataUri, avatarUrl) => Game.updateTikTokGiftAvatar(avatarKey, avatarDataUri, avatarUrl),
    setCoinVolume: volume => Game.setCoinVolume(volume),
    getPendingCoins: () => Game.pendingCoins,
    startGame: () => Game.startGame(),
    getMachineControls: () => Game.getMachineControls(),
    pressMachineButton: name => Game.pressMachineButton(name),
    setScreenVideo: url => Game.setScreenVideo(url),
    setCharacterScale: scale => Game.setCharacterScale(scale),
    setCharacterPosition: position => Game.setCharacterPosition(position),
    dropPrizeCard: username => Game.dropPrizeCard(username),
    setPrizeConfig: config => Game.setPrizeConfig(config)
});
let checkingPrizeCredits = false;
async function retryPrizeCredits() {
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
window.addEventListener("online", retryPrizeCredits);
window.setInterval(retryPrizeCredits, 30000);
void retryPrizeCredits();
Game.run();