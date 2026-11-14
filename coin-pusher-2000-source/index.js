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
    updateTikTokGiftAvatar: (avatarKey, avatarDataUri) => Game.updateTikTokGiftAvatar(avatarKey, avatarDataUri),
    setScreenVideo: url => Game.setScreenVideo(url),
    setCharacterScale: scale => Game.setCharacterScale(scale),
    get pendingCoins() {
        return Game.pendingCoins;
    }
};
initializeTikTokBridge({
    receiveGift: (count, avatar) => Game.receiveTikTokGift(count, avatar),
    updateGiftAvatar: (avatarKey, avatarDataUri) => Game.updateTikTokGiftAvatar(avatarKey, avatarDataUri),
    getPendingCoins: () => Game.pendingCoins,
    startGame: () => Game.startGame(),
    setScreenVideo: url => Game.setScreenVideo(url),
    setCharacterScale: scale => Game.setCharacterScale(scale),
    setCharacterScale: scale => Game.setCharacterScale(scale)
});
Game.run();