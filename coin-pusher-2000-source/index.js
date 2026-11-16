import * as rapier from "@dimforge/rapier3d-simd";
import giftBear from "../cadeaux-machine/ourson.png";
import giftButterfly from "../cadeaux-machine/papillon.png";
import giftCafe from "../cadeaux-machine/cafe.png";
import giftCloudHeart from "../cadeaux-machine/coeur-nuage.png";
import giftConfetti from "../cadeaux-machine/confettis.png";
import giftConch from "../cadeaux-machine/coquillage.png";
import giftCrystalStaff from "../cadeaux-machine/canne-cristal.png";
import giftDonut from "../cadeaux-machine/donut.jpg";
import giftDrift from "../cadeaux-machine/drift.png";
import giftEarthHeart from "../cadeaux-machine/coeur-terrien.png";
import giftFamily from "../cadeaux-machine/famille.png";
import giftFalcon from "../cadeaux-machine/faucon.png";
import giftFlamingHeart from "../cadeaux-machine/coeur-flamme.png";
import giftGG from "../cadeaux-machine/gg.png";
import giftGamepad from "../cadeaux-machine/manette.jpg";
import giftHand from "../cadeaux-machine/gift-1-1.png";
import giftHandsHeart from "../cadeaux-machine/coeur-mains.png";
import giftIceCream from "../cadeaux-machine/cornet-creme-glacee.png";
import giftLeonAndLili from "../cadeaux-machine/leon-lili.png";
import giftLion from "../cadeaux-machine/lion.png";
import giftOctopus from "../cadeaux-machine/pieuvre.png";
import giftPlanet from "../cadeaux-machine/planete.png";
import giftSafari from "../cadeaux-machine/safari.png";
import giftStars from "../cadeaux-machine/stars.png";
import giftStarfish from "../cadeaux-machine/etoile-de-mer.png";
import giftSunsetHighway from "../cadeaux-machine/autoroute.png";
import giftTikTok from "../cadeaux-machine/tiktok.png";
import giftUniverse from "../cadeaux-machine/universe.png";
import giftWednesday from "../cadeaux-machine/mercredi.png";
import giftWoodenStaff from "../cadeaux-machine/canne-bois.png";
import giftZeus from "../cadeaux-machine/zeus.png";
import Game from "./lib/index.js";
import initializeTikTokBridge from "./lib/tiktok-bridge.js";
import GiftRouletteQueue, { MAX_GIFT_COIN_COUNT } from "./lib/gift-roulette-queue.js";
import { resolveGiftRouletteTurn } from "./lib/gift-roulette-outcome.js";
import { createGiftRouletteCatalog } from "./lib/gift-roulette-catalog.js";
import { advanceDiamondCharge, DIAMOND_CHARGE_TARGET } from "./lib/gift-roulette-diamond.js";
import PrizeCreditQueue from "./lib/prize-credit-queue.js";

const giftRouletteImages = document.querySelectorAll(".gift-roulette-item");
const giftRouletteCatalog = createGiftRouletteCatalog({
    universe: giftUniverse, stars: giftStars, lion: giftLion, zeus: giftZeus,
    donut: giftDonut, gamepad: giftGamepad, wednesday: giftWednesday,
    "hands-heart": giftHandsHeart, "wooden-staff": giftWoodenStaff, bear: giftBear,
    confetti: giftConfetti, conch: giftConch, "earth-heart": giftEarthHeart,
    butterfly: giftButterfly, family: giftFamily, falcon: giftFalcon, planet: giftPlanet,
    "crystal-staff": giftCrystalStaff, "sunset-highway": giftSunsetHighway,
    octopus: giftOctopus, "leon-lili": giftLeonAndLili, safari: giftSafari,
    drift: giftDrift, tiktok: giftTikTok, "ice-cream": giftIceCream,
    starfish: giftStarfish, gg: giftGG, hand: giftHand, cafe: giftCafe,
    "flaming-heart": giftFlamingHeart, "cloud-heart": giftCloudHeart
});
const giftRouletteSources = giftRouletteCatalog.map(gift => gift.image);
const initialGiftIndices = [0, 1, 2, 3, 1, 3];
const giftRouletteIndices = [...initialGiftIndices];
const GIFT_ROULETTE_CREDIT_STORAGE_KEY = "coin-pusher-2000-gift-roulette-credits-v1";
if (giftRouletteImages.length !== initialGiftIndices.length) {
    throw new Error("La roulette doit afficher exactement six cadeaux.");
}
giftRouletteImages.forEach((image, index) => {
    image.src = giftRouletteSources[giftRouletteIndices[index]];
});

const giftRouletteQueue = new GiftRouletteQueue();
const DIAMOND_CHARGE_STORAGE_KEY = "coin-pusher-2000-diamond-charge-v1";
const giftQueueElement = document.getElementById("gift-roulette-queue");
const giftQueueHeader = document.getElementById("gift-roulette-queue-header");
const giftQueueList = document.getElementById("gift-roulette-queue-list");
const giftQueueTotal = document.getElementById("gift-roulette-queue-total");
const giftQueueStatus = document.getElementById("gift-roulette-queue-status");
const giftQueueVisibleInput = document.getElementById("gift-roulette-queue-visible");
const giftQueueWidthInput = document.getElementById("gift-roulette-queue-width");
const giftQueueWidthValue = document.getElementById("gift-roulette-queue-width-value");
const giftQueueHeightInput = document.getElementById("gift-roulette-queue-height");
const giftQueueHeightValue = document.getElementById("gift-roulette-queue-height-value");
const giftRouletteStatus = document.getElementById("gift-roulette-status");
const giftRouletteDiamond = document.getElementById("gift-roulette-diamond");
const giftQueuePinButton = document.getElementById("gift-roulette-queue-pin-panel");
const GIFT_QUEUE_STORAGE_KEY = "coin-pusher-2000-gift-roulette-queue-v1";
let giftRouletteCreditQueue = null;
let giftRouletteAwardRetryTimer = 0;
const giftQueueDefaults = {
    left: Math.min(340, Math.max(12, window.innerWidth - 300)),
    top: Math.max(12, Math.round(window.innerHeight * 0.6)),
    width: 280,
    height: 190,
    pinned: true,
    visible: true
};
let giftQueueSettings = readGiftQueueSettings();
let giftQueueDrag = null;
let giftQueueSaveTimer = 0;
let giftRouletteSpinTimer = 0;
let giftRouletteResultTimer = 0;
let giftRouletteMilestoneTimer = 0;
const ROULETTE_SPIN_DURATIONS = [180, 120, 80, 48, 24];
const giftRouletteIdleTimers = Array(giftRouletteImages.length).fill(0);
let giftRouletteSpeed = 1;
let diamondCharge = readDiamondCharge();
let giftRouletteWinChance = 0.1;
let giftRouletteVolume = 0.45;
let giftRouletteAudioContext = null;
let lastGiftRouletteSoundAt = 0;
let giftRouletteAudioWarningShown = false;

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function readDiamondCharge() {
    try {
        const stored = localStorage.getItem(DIAMOND_CHARGE_STORAGE_KEY);
        if (stored === null) {
            return 0;
        }
        if (!/^\d+$/.test(stored)) {
            throw new Error("Valeur de progression du diamant invalide.");
        }
        const progress = Number(stored);
        if (!Number.isSafeInteger(progress) || progress < 0 || progress >= DIAMOND_CHARGE_TARGET) {
            throw new Error("Valeur de progression du diamant invalide.");
        }
        return progress;
    } catch (error) {
        console.error("Impossible de charger la progression du diamant :", error);
        giftRouletteStatus.textContent = "Progression du diamant illisible : elle repart à zéro.";
        return 0;
    }
}

function renderDiamondCharge() {
    const charge = diamondCharge / (DIAMOND_CHARGE_TARGET - 1);
    giftRouletteDiamond.style.setProperty("--diamond-charge", String(charge));
    giftRouletteDiamond.style.setProperty("--diamond-charge-duration", `${1.5 - charge * 1.3}s`);
    giftRouletteDiamond.style.setProperty("--diamond-charge-hue", `${charge * 145}deg`);
    giftRouletteDiamond.style.setProperty("--diamond-charge-saturation", `${100 + charge * 200}%`);
    giftRouletteDiamond.style.setProperty("--diamond-charge-glow", `${4 + charge * 26}px`);
    giftRouletteDiamond.classList.toggle("is-charging", diamondCharge > 0);
}

function addDiamondCharge(coins) {
    const next = advanceDiamondCharge(diamondCharge, coins);
    diamondCharge = next.progress;
    renderDiamondCharge();
    try {
        localStorage.setItem(DIAMOND_CHARGE_STORAGE_KEY, String(diamondCharge));
    } catch (error) {
        console.error("Impossible d’enregistrer la progression du diamant :", error);
        giftRouletteStatus.textContent = "Le diamant scintille, mais sa progression ne peut pas être sauvegardée.";
    }
    if (next.milestones) {
        window.clearTimeout(giftRouletteMilestoneTimer);
        giftRouletteDiamond.classList.remove("is-milestone");
        void giftRouletteDiamond.offsetWidth;
        giftRouletteDiamond.classList.add("is-milestone");
        giftRouletteMilestoneTimer = window.setTimeout(() => {
            giftRouletteDiamond.classList.remove("is-milestone");
        }, 1300);
    }
}

function readGiftQueueSettings() {
    try {
        const stored = JSON.parse(localStorage.getItem(GIFT_QUEUE_STORAGE_KEY) || "null");
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
            return { ...giftQueueDefaults };
        }
        return {
            left: Number.isFinite(stored.left) ? stored.left : giftQueueDefaults.left,
            top: Number.isFinite(stored.top) ? stored.top : giftQueueDefaults.top,
            width: Number.isFinite(stored.width) ? stored.width : giftQueueDefaults.width,
            height: Number.isFinite(stored.height) ? stored.height : giftQueueDefaults.height,
            pinned: typeof stored.pinned === "boolean" ? stored.pinned : giftQueueDefaults.pinned,
            visible: typeof stored.visible === "boolean" ? stored.visible : giftQueueDefaults.visible
        };
    } catch (error) {
        console.error("Réglages de la file de la roulette illisibles :", error);
        giftQueueStatus.textContent = "Réglages illisibles : les valeurs par défaut sont utilisées.";
        return { ...giftQueueDefaults };
    }
}

function applyGiftQueueSettings() {
    const maximumWidth = Math.max(180, Math.min(640, window.innerWidth - 16));
    const maximumHeight = Math.max(120, Math.min(520, window.innerHeight - 16));
    giftQueueSettings.width = clamp(Math.round(giftQueueSettings.width), 180, maximumWidth);
    giftQueueSettings.height = clamp(Math.round(giftQueueSettings.height), 120, maximumHeight);
    giftQueueSettings.left = clamp(
        Math.round(giftQueueSettings.left),
        8,
        Math.max(8, window.innerWidth - giftQueueSettings.width - 8)
    );
    giftQueueSettings.top = clamp(
        Math.round(giftQueueSettings.top),
        8,
        Math.max(8, window.innerHeight - giftQueueSettings.height - 8)
    );
    giftQueueElement.style.left = `${giftQueueSettings.left}px`;
    giftQueueElement.style.top = `${giftQueueSettings.top}px`;
    giftQueueElement.style.width = `${giftQueueSettings.width}px`;
    giftQueueElement.style.height = `${giftQueueSettings.height}px`;
    giftQueueElement.hidden = !giftQueueSettings.visible;
    giftQueueElement.classList.toggle("is-unpinned", !giftQueueSettings.pinned);
    giftQueueVisibleInput.checked = giftQueueSettings.visible;
    giftQueueWidthInput.max = String(maximumWidth);
    giftQueueWidthInput.value = String(giftQueueSettings.width);
    giftQueueWidthValue.textContent = `${giftQueueSettings.width} px`;
    giftQueueHeightInput.max = String(maximumHeight);
    giftQueueHeightInput.value = String(giftQueueSettings.height);
    giftQueueHeightValue.textContent = `${giftQueueSettings.height} px`;
    giftQueuePinButton.textContent = giftQueueSettings.pinned ? "📌 Déverrouiller" : "🔓 Épingler";
    giftQueuePinButton.setAttribute("aria-pressed", String(giftQueueSettings.pinned));
    giftQueuePinButton.title = giftQueueSettings.pinned ? "Déverrouiller le déplacement" : "Épingler la file";
}

function saveGiftQueueSettings() {
    try {
        localStorage.setItem(GIFT_QUEUE_STORAGE_KEY, JSON.stringify(giftQueueSettings));
    } catch (error) {
        console.error("Impossible d’enregistrer les réglages de la file de la roulette :", error);
        giftQueueStatus.textContent = "La file fonctionne, mais ses réglages ne peuvent pas être sauvegardés.";
    }
}

function scheduleGiftQueueSettingsSave() {
    window.clearTimeout(giftQueueSaveTimer);
    giftQueueSaveTimer = window.setTimeout(saveGiftQueueSettings, 250);
}

function renderGiftQueue() {
    const entries = giftRouletteQueue.entries;
    const total = giftRouletteQueue.pendingTurns;
    giftQueueTotal.textContent = `${total.toLocaleString("fr-FR")} tour${total === 1 ? "" : "s"}`;
    giftQueueList.replaceChildren();
    if (!entries.length) {
        const empty = document.createElement("li");
        empty.className = "gift-roulette-queue-empty";
        empty.textContent = "Aucun tour en attente";
        giftQueueList.append(empty);
        return;
    }
    entries.forEach(entry => {
        const row = document.createElement("li");
        const username = document.createElement("span");
        username.className = "gift-roulette-queue-name";
        username.textContent = `@${entry.username}`;
        const turns = document.createElement("strong");
        turns.textContent = `${entry.remaining.toLocaleString("fr-FR")} tour${entry.remaining === 1 ? "" : "s"}`;
        row.append(username, turns);
        giftQueueList.append(row);
    });
}

function setGiftRouletteSettings({ speed = giftRouletteSpeed, winChance = giftRouletteWinChance, volume = giftRouletteVolume } = {}) {
    const previousSpeed = giftRouletteSpeed;
    if (Number.isSafeInteger(speed) && speed >= 1 && speed <= ROULETTE_SPIN_DURATIONS.length) {
        giftRouletteSpeed = speed;
    }
    if (Number.isFinite(winChance) && winChance >= 0 && winChance <= 1) {
        giftRouletteWinChance = winChance;
    }
    if (Number.isFinite(volume) && volume >= 0 && volume <= 1) {
        giftRouletteVolume = volume;
    }
    document.documentElement.style.setProperty(
        "--gift-roulette-duration",
        `${ROULETTE_SPIN_DURATIONS[giftRouletteSpeed - 1]}ms`
    );
    if (giftRouletteSpeed !== previousSpeed) {
        startGiftRouletteIdleAnimations();
    }
}

function startGiftRouletteIdleAnimations() {
    giftRouletteImages.forEach((image, index) => {
        window.clearInterval(giftRouletteIdleTimers[index]);
        const interval = Math.max(
            35,
            Math.round((260 + index * 40) * ROULETTE_SPIN_DURATIONS[giftRouletteSpeed - 1] / ROULETTE_SPIN_DURATIONS[0])
        );
        giftRouletteIdleTimers[index] = window.setInterval(() => {
            if (image.classList.contains("is-rolling") || image.classList.contains("is-winning")) {
                return;
            }
            let nextIndex = Math.floor(Math.random() * giftRouletteSources.length);
            if (nextIndex === giftRouletteIndices[index]) {
                nextIndex = (nextIndex + 1) % giftRouletteSources.length;
            }
            giftRouletteIndices[index] = nextIndex;
            image.src = giftRouletteSources[nextIndex];
        }, interval);
    });
}

function playGiftRouletteSound(won) {
    const now = Date.now();
    if (giftRouletteVolume === 0 || now - lastGiftRouletteSoundAt < 70) {
        return;
    }
    lastGiftRouletteSoundAt = now;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
            throw new Error("Audio Web indisponible.");
        }
        const context = giftRouletteAudioContext || (giftRouletteAudioContext = new AudioContext());
        if (context.state === "suspended") {
            void context.resume().catch(error => console.warn("Impossible d’activer le son de la roulette :", error));
        }
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime;
        const duration = won ? 0.22 : 0.1;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(won ? 880 : 460, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(giftRouletteVolume * (won ? 0.16 : 0.08), start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + duration);
    } catch (error) {
        if (!giftRouletteAudioWarningShown) {
            console.warn("Son de la roulette indisponible :", error);
            giftRouletteAudioWarningShown = true;
        }
    }
}

function scheduleGiftRouletteAwardRetry() {
    if (giftRouletteAwardRetryTimer) {
        return;
    }
    giftRouletteAwardRetryTimer = window.setTimeout(() => {
        giftRouletteAwardRetryTimer = 0;
        retryGiftRouletteAwards();
    }, 10000);
}

function getGiftRouletteCreditQueue() {
    if (!giftRouletteCreditQueue) {
        giftRouletteCreditQueue = new PrizeCreditQueue({
            storage: localStorage,
            key: GIFT_ROULETTE_CREDIT_STORAGE_KEY,
            award: async prize => {
                if (typeof window.ArcadeStars?.award !== "function") {
                    throw new Error("Portefeuille Griffon Arcade indisponible.");
                }
                return window.ArcadeStars.award({
                    username: prize.username,
                    amount: prize.amount,
                    transactionId: prize.transactionId
                });
            },
            onConfirmed: (prize, player) => {
                window.dispatchEvent(new CustomEvent("coin-pusher-prize-awarded", {
                    detail: {
                        username: prize.username,
                        avatarUrl: player?.avatarUrl || "",
                        amount: prize.amount,
                        kind: "roulette",
                        globalStars: Number(player?.stars) || 0
                    }
                }));
                giftRouletteStatus.textContent = `Gain crédité : ${prize.amount.toLocaleString("fr-FR")} étoile${prize.amount === 1 ? "" : "s"} attribuée${prize.amount === 1 ? "" : "s"} à @${prize.username}.`;
            },
            onError: (prize, error) => {
                console.error(`Crédit en attente pour la roulette de @${prize.username} :`, error);
                giftRouletteStatus.textContent = `Crédit en attente : ${prize.amount.toLocaleString("fr-FR")} étoile${prize.amount === 1 ? "" : "s"} pour @${prize.username}. Nouvelle tentative automatique : ${error.message || "portefeuille indisponible"}.`;
                scheduleGiftRouletteAwardRetry();
            }
        });
    }
    return giftRouletteCreditQueue;
}

function retryGiftRouletteAwards() {
    try {
        void getGiftRouletteCreditQueue().flush().catch(error => {
            console.error("Impossible de traiter la file des gains de la roulette :", error);
            giftRouletteStatus.textContent = `File des gains de la roulette en attente : ${error.message || "erreur inconnue"}.`;
            scheduleGiftRouletteAwardRetry();
        });
    } catch (error) {
        console.error("Impossible de charger la file des gains de la roulette :", error);
        giftRouletteStatus.textContent = `File des gains de la roulette indisponible : ${error.message || "erreur inconnue"}.`;
        scheduleGiftRouletteAwardRetry();
    }
}

function queueGiftRouletteAward(username, amount) {
    if (!/^[a-zA-Z0-9._]{1,32}$/.test(username) || !Number.isSafeInteger(amount) || amount < 1 || amount > 100) {
        const error = new RangeError("Le pseudo ou le montant du gain de roulette est invalide.");
        console.error("Impossible d’enregistrer le gain de la roulette :", error);
        giftRouletteStatus.textContent = `Gain non enregistré : ${error.message}`;
        return;
    }
    try {
        getGiftRouletteCreditQueue().enqueue({ username, amount, kind: "roulette" });
        giftRouletteStatus.textContent = `Gain de ${amount.toLocaleString("fr-FR")} étoile${amount === 1 ? "" : "s"} en cours de crédit pour @${username}.`;
        retryGiftRouletteAwards();
    } catch (error) {
        console.error(`Impossible d’enregistrer le gain de la roulette pour @${username} :`, error);
        giftRouletteStatus.textContent = `Gain non enregistré pour @${username} : ${error.message || "erreur inconnue"}.`;
    }
}

function animateGiftRouletteTurn(username, source) {
    const result = resolveGiftRouletteTurn(giftRouletteCatalog, giftRouletteWinChance);
    let nextIndices;
    if (result.won) {
        const winningIndex = giftRouletteSources.indexOf(result.gift.image);
        nextIndices = Array(giftRouletteImages.length).fill(winningIndex);
    } else {
        nextIndices = Array.from(giftRouletteImages, () => Math.floor(Math.random() * giftRouletteSources.length));
    }
    if (!result.won && nextIndices.every(index => index === nextIndices[0])) {
        nextIndices[nextIndices.length - 1] = (nextIndices[0] + 1) % giftRouletteSources.length;
    }
    giftRouletteImages.forEach((image, index) => {
        giftRouletteIndices[index] = nextIndices[index];
        image.src = giftRouletteSources[giftRouletteIndices[index]];
        image.classList.toggle("is-winning", result.won);
        image.parentElement.classList.toggle("is-winning", result.won);
        image.classList.remove("is-rolling");
        void image.offsetWidth;
        image.classList.add("is-rolling");
    });
    giftRouletteDiamond.classList.toggle("is-winning", result.won);
    playGiftRouletteSound(result.won);
    if (result.won) {
        const amount = result.gift.coinCount;
        const starLabel = `${amount.toLocaleString("fr-FR")} étoile${amount === 1 ? "" : "s"}`;
        giftRouletteStatus.textContent = source.simulation
            ? `Simulation gagnante · ${result.gift.name} (${starLabel}) : aucun crédit.`
            : `Gain réel · @${username} remporte ${result.gift.name} (${starLabel}).`;
        if (!source.simulation && source.creditable) {
            queueGiftRouletteAward(username, amount);
        } else if (!source.simulation) {
            giftRouletteStatus.textContent += " Pseudo TikTok invalide : gain non crédité.";
        }
    }
    window.clearTimeout(giftRouletteSpinTimer);
    giftRouletteSpinTimer = window.setTimeout(() => {
        giftRouletteImages.forEach(image => image.classList.remove("is-rolling"));
    }, ROULETTE_SPIN_DURATIONS[giftRouletteSpeed - 1]);
    window.clearTimeout(giftRouletteResultTimer);
    giftRouletteResultTimer = window.setTimeout(() => {
        giftRouletteImages.forEach(image => {
            image.classList.remove("is-winning");
            image.parentElement.classList.remove("is-winning");
        });
        giftRouletteDiamond.classList.remove("is-winning");
    }, 1000);
}

giftQueuePinButton.addEventListener("click", () => {
    giftQueueSettings.pinned = !giftQueueSettings.pinned;
    applyGiftQueueSettings();
    saveGiftQueueSettings();
});
giftQueueVisibleInput.addEventListener("change", () => {
    giftQueueSettings.visible = giftQueueVisibleInput.checked;
    applyGiftQueueSettings();
    saveGiftQueueSettings();
});
giftQueueWidthInput.addEventListener("input", () => {
    giftQueueSettings.width = Number(giftQueueWidthInput.value);
    applyGiftQueueSettings();
    scheduleGiftQueueSettingsSave();
});
giftQueueHeightInput.addEventListener("input", () => {
    giftQueueSettings.height = Number(giftQueueHeightInput.value);
    applyGiftQueueSettings();
    scheduleGiftQueueSettingsSave();
});
giftQueueHeader.addEventListener("pointerdown", event => {
    if (giftQueueSettings.pinned || event.target.closest("button")) {
        return;
    }
    const bounds = giftQueueElement.getBoundingClientRect();
    giftQueueDrag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - bounds.left,
        offsetY: event.clientY - bounds.top
    };
    giftQueueHeader.setPointerCapture(event.pointerId);
    giftQueueElement.classList.add("is-dragging");
});
giftQueueHeader.addEventListener("pointermove", event => {
    if (!giftQueueDrag || giftQueueDrag.pointerId !== event.pointerId) {
        return;
    }
    giftQueueSettings.left = event.clientX - giftQueueDrag.offsetX;
    giftQueueSettings.top = event.clientY - giftQueueDrag.offsetY;
    applyGiftQueueSettings();
});
function finishGiftQueueDrag(event) {
    if (!giftQueueDrag || giftQueueDrag.pointerId !== event.pointerId) {
        return;
    }
    giftQueueDrag = null;
    giftQueueElement.classList.remove("is-dragging");
    saveGiftQueueSettings();
}
giftQueueHeader.addEventListener("pointerup", finishGiftQueueDrag);
giftQueueHeader.addEventListener("pointercancel", finishGiftQueueDrag);
if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
        if (!giftQueueSettings.visible) {
            return;
        }
        const bounds = giftQueueElement.getBoundingClientRect();
        if (
            Math.round(bounds.width) !== giftQueueSettings.width ||
            Math.round(bounds.height) !== giftQueueSettings.height
        ) {
            giftQueueSettings.width = Math.round(bounds.width);
            giftQueueSettings.height = Math.round(bounds.height);
            applyGiftQueueSettings();
            scheduleGiftQueueSettingsSave();
        }
    }).observe(giftQueueElement);
}
window.addEventListener("resize", () => {
    applyGiftQueueSettings();
    scheduleGiftQueueSettingsSave();
});
window.addEventListener("coin-pusher-coin-spawned", event => {
    const username = event.detail?.username;
    const source = giftRouletteQueue.consumeTurn(username);
    if (!source) {
        return;
    }
    animateGiftRouletteTurn(username, source);
    renderGiftQueue();
});
applyGiftQueueSettings();
renderDiamondCharge();
startGiftRouletteIdleAnimations();
renderGiftQueue();
window.addEventListener("online", retryGiftRouletteAwards);
window.setInterval(retryGiftRouletteAwards, 30000);
retryGiftRouletteAwards();

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
function receiveGift(count, avatar = {}, simulation = false) {
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_GIFT_COIN_COUNT) {
        return 0;
    }
    const profile = avatar && typeof avatar === "object" ? avatar : {};
    const candidate = String(profile.uniqueId || profile.username || "").trim().replace(/^@/, "");
    const creditable = /^[a-zA-Z0-9._]{1,32}$/.test(candidate);
    const username = creditable ? candidate : "Spectateur";
    const queuedCoins = Game.receiveTikTokGift(count, { ...profile, username });
    if (queuedCoins > 0) {
        if (!simulation) {
            addDiamondCharge(queuedCoins);
        }
        giftRouletteQueue.enqueue(username, queuedCoins, { simulation, creditable });
        renderGiftQueue();
    }
    return queuedCoins;
}
window.CoinPusher2000 = {
    startGame: () => Game.startGame(),
    receiveTikTokGift: receiveGift,
    setGiftRouletteSettings,
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
    giftCatalog: giftRouletteCatalog,
    setGiftRouletteSettings,
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