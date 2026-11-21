import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class Element {
    constructor(id, document) {
        this.id = id;
        this.ownerDocument = document;
        this.style = {};
        this.dataset = {};
        this.children = [];
        this.listeners = {};
        this.value = "";
        this.hidden = false;
        this.checked = false;
        this.classList = { add() {}, remove() {}, toggle() {} };
    }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    dispatch(type, properties = {}) {
        const event = { type, target: this, preventDefault() {}, ...properties };
        for (const listener of this.listeners[type] || []) listener(event);
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
    getAttribute(name) { return this.attributes?.[name] ?? null; }
    removeAttribute() {}
    pause() {}
    load() {}
    play() { return Promise.resolve(); }
    focus() {}
    setPointerCapture() {}
    getBoundingClientRect() { return { left: 12, top: 12, width: 310, height: 500 }; }
    querySelector(selector) { return this[selector] ||= new Element(selector, this.ownerDocument); }
}

test("overlay controls persist, restore and show confirmed winners", async () => {
    const storage = new Map();
    globalThis.localStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value)
    };
    globalThis.location = { hostname: "localhost" };
    const { default: initialize } = await import("../lib/tiktok-bridge.js");
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    assert.doesNotMatch(html, /gift-roulette|scene-brand|symbols-controls|diamond-|demo-count|test-gift|manual-gift-select|manual-gift-trigger|manual-gift-username/);
    assert.match(html, /id="test-1000-coins"/);
    assert.match(html, /id="coin-volume"/);
    assert.match(html, /id="game-background-input"/);
    assert.match(html, /id="screen-video"/);
    assert.match(html, /id="prize-card-table"/);
    assert.match(html, /id="star-leaderboard-drag-handle"/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    let machineState;
    const machinePresses = [];
    const prizeConfigs = [];
    const droppedCards = [];
    const droppedIngots = [];
    const soundVolumes = [];
    const sceneOffsets = [];
    const giftCalls = [];
    function start() {
        machineState = { buttons: { start: true }, coins: 0 };
        const document = { createElement: tag => new Element(tag, document) };
        document.documentElement = new Element("html", document);
        document.documentElement.style.setProperty = (name, value) => {
            document.documentElement.style[name] = value;
        };
        const elements = Object.fromEntries(ids.map(id => [id, new Element(id, document)]));
        for (const [id, value] of Object.entries({
            "character-scale": "100",
            "character-horizontal": "15",
            "character-depth": "30",
            "coin-volume": "45",
            "leaderboard-x": "5",
            "leaderboard-y": "55"
        })) {
            elements[id].value = value;
        }
        document.getElementById = id => {
            assert.ok(elements[id], `Missing HTML control: ${id}`);
            return elements[id];
        };
        document.addEventListener = () => {};
        globalThis.document = document;
        globalThis.window = {
            innerWidth: 1200, innerHeight: 800, listeners: {},
            CoinPusher2000: { setCoinVolume(volume) { soundVolumes.push(volume); } },
            addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
            dispatch(type, detail) { for (const listener of this.listeners[type] || []) listener({ detail }); },
            setTimeout() { return 1; }, clearTimeout() {}, setInterval() {}
        };
        initialize({
            receiveGift(count, profile, simulation) {
                giftCalls.push({ count, profile, simulation });
                return count;
            },
            updateGiftAvatar() {}, getPendingCoins() { return 0; },
            startGame() {}, getMachineControls() { return machineState; },
            pressMachineButton(name) {
                machinePresses.push(name);
                machineState = { buttons: { center: true }, coins: 100 };
                return true;
            }, setScreenVideo() {}, setCharacterScale() {},
            setSceneHorizontalOffset(offset) { sceneOffsets.push(offset); },
            setCharacterPosition() {}, dropPrizeCard(username, stars) { droppedCards.push({ username, stars }); },
            dropPrizeIngot(username) { droppedIngots.push(username); },
            setPrizeConfig(config) { prizeConfigs.push(config); }
        });
        return elements;
    }

    let elements = start();
    const openSceneOffset = sceneOffsets.at(-1);
    assert.ok(openSceneOffset > 0);
    assert.equal(document.documentElement.style["--scene-horizontal-offset"], `${openSceneOffset}px`);
    elements["toggle-live-panel"].dispatch("click");
    assert.equal(sceneOffsets.at(-1), 0);
    assert.equal(document.documentElement.style["--scene-horizontal-offset"], "0px");
    elements["show-live-panel"].dispatch("click");
    assert.equal(sceneOffsets.at(-1), openSceneOffset);
    assert.equal(document.documentElement.style["--scene-horizontal-offset"], `${openSceneOffset}px`);
    assert.deepEqual(prizeConfigs[0].cards, [
        { stars: 1, count: 200 }, { stars: 2, count: 125 },
        { stars: 10, count: 25 }, { stars: 30, count: 35 },
        { stars: 100, count: 8 }, { stars: 300, count: 2 }
    ]);
    assert.equal(elements["manual-card-stars"].value, "300");
    elements["manual-card-username"].value = "alice";
    elements["drop-prize-card"].dispatch("click");
    assert.deepEqual(droppedCards, [{ username: "alice", stars: 300 }]);
    elements["drop-prize-ingot"].dispatch("click");
    assert.deepEqual(droppedIngots, ["alice"]);
    assert.equal(JSON.parse(storage.get("coin-pusher-2000-live-panel-v1")).manualCardStars, 300);
    assert.equal(elements["machine-start"].disabled, false);
    assert.equal(elements["machine-center"].disabled, true);
    elements["machine-start"].dispatch("click");
    assert.deepEqual(machinePresses, ["start"]);
    assert.equal(elements["machine-start"].disabled, true);
    assert.equal(elements["machine-center"].disabled, false);
    assert.equal(elements["machine-coins"].textContent, "100");
    elements["coin-volume"].value = "72";
    elements["coin-volume"].dispatch("input");
    assert.equal(elements["coin-volume-value"].value, "72 %");
    assert.equal(soundVolumes.at(-1), 0.72);
    assert.equal(storage.get("coin-pusher-2000-coin-volume-v1"), "72");
    elements["test-1000-coins"].dispatch("click");
    assert.deepEqual(giftCalls.at(-1), {
        count: 1000,
        profile: { username: "test", uniqueId: "test" },
        simulation: true
    });
    assert.match(elements["test-coins-status"].textContent, /pièces ajoutées à la file/);
    elements["leaderboard-x"].value = "80";
    elements["leaderboard-x"].dispatch("input");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -55%)");
    elements["leaderboard-y"].value = "40";
    elements["leaderboard-y"].dispatch("input");
    elements["star-leaderboard"].getBoundingClientRect = () => ({
        left: 600, top: 200, right: 900, bottom: 380, width: 300, height: 180
    });
    elements["star-leaderboard-drag-handle"].dispatch("pointerdown", {
        button: 0, pointerId: 6, clientX: 750, clientY: 290
    });
    for (const listener of window.listeners.pointermove) {
        listener({ pointerId: 6, clientX: 900, clientY: 500 });
    }
    assert.equal(elements["leaderboard-x"].value, "75");
    assert.equal(elements["leaderboard-y"].value, "63");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-75%, -63%)");
    for (const listener of window.listeners.pointerup) {
        listener({ pointerId: 6 });
    }
    const draggedLeaderboardSetup = JSON.parse(storage.get("coin-pusher-2000-live-panel-v1"));
    assert.equal(draggedLeaderboardSetup.leaderboardX, 75);
    assert.equal(draggedLeaderboardSetup.leaderboardY, 63);
    const handleVisibility = [];
    elements["star-leaderboard"].classList.toggle = (name, value) => {
        if (name === "is-handle-visible") {
            handleVisibility.push(value);
        }
    };
    for (const listener of window.listeners.pointermove) {
        listener({ pointerId: 10, pointerType: "mouse", clientX: 700, clientY: 300 });
    }
    assert.equal(handleVisibility.at(-1), true);
    for (const listener of window.listeners.pointermove) {
        listener({ pointerId: 10, pointerType: "mouse", clientX: 10, clientY: 10 });
    }
    assert.equal(handleVisibility.at(-1), false);
    elements["leaderboard-x"].value = "80";
    elements["leaderboard-x"].dispatch("input");
    elements["leaderboard-y"].value = "40";
    elements["leaderboard-y"].dispatch("input");
    elements["leaderboard-scale"].value = "60";
    elements["leaderboard-scale"].dispatch("input");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -40%) scale(0.6)");
    elements["show-star-leaderboard"].checked = true;
    elements["show-star-leaderboard"].dispatch("change");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -40%) scale(0.6)");
    const legacySetup = JSON.parse(storage.get("coin-pusher-2000-live-panel-v1"));
    assert.equal(legacySetup.leaderboardScalePercent, 60);
    legacySetup.showSceneBrand = false;
    legacySetup.sceneBrandText = "MON TEXTE";
    storage.set("coin-pusher-2000-live-panel-v1", JSON.stringify(legacySetup));
    window.dispatch("coin-pusher-prize-awarded", {
        username: "alice", amount: 25, avatarUrl: "https://example.com/avatar.png", globalStars: 25
    });
    const rows = elements["star-leaderboard-list"].children;
    assert.equal(rows[0].children[1].children[1].src, "https://example.com/avatar.png");
    assert.equal(rows[0].children[3].textContent, "25 ⭐");

    legacySetup.demoCount = 12;
    legacySetup.manualGiftId = "falcon";
    legacySetup.manualGiftUsername = "alice";
    storage.set("coin-pusher-2000-live-panel-v1", JSON.stringify(legacySetup));
    elements = start();
    assert.equal(elements["manual-card-stars"].value, "300");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -40%) scale(0.6)");
    assert.equal(elements["star-leaderboard-list"].children[0].children[3].textContent, "25 ⭐");

    storage.set("coin-pusher-2000-live-panel-v1", JSON.stringify({
        version: 1,
        prizeCards: [
            { stars: 1, count: 5 }, { stars: 2, count: 7 }, { stars: 10, count: 3 },
            { stars: 30, count: 4 }, { stars: 100, count: 1 }, { stars: 300, count: 1 }
        ]
    }));
    elements = start();
    const migratedCards = [
        { stars: 1, count: 105 }, { stars: 2, count: 32 }, { stars: 10, count: 3 },
        { stars: 30, count: 14 }, { stars: 100, count: 4 }, { stars: 300, count: 2 }
    ];
    assert.deepEqual(prizeConfigs.at(-1).cards, migratedCards);
    const savedSetup = JSON.parse(storage.get("coin-pusher-2000-live-panel-v1"));
    assert.equal(savedSetup.prizeStockAdditionVersion, 1);
    assert.deepEqual(savedSetup.prizeCards, migratedCards);
    start();
    assert.deepEqual(prizeConfigs.at(-1).cards, migratedCards);
    storage.set("coin-pusher-2000-live-panel-v1", JSON.stringify({
        ...JSON.parse(storage.get("coin-pusher-2000-live-panel-v1")),
        gameBackground: {
            name: "fond.png",
            type: "image",
            dataUrl: "data:image/png;base64,AAAA",
            storageKey: null
        }
    }));
    elements = start();
    assert.equal(elements["game-background-media"].hidden, false);
    assert.equal(elements["game-background-image"].hidden, false);
    assert.equal(elements["game-background-image"].src, "data:image/png;base64,AAAA");
    assert.equal(elements["game-background-video"].hidden, true);
    elements["manual-card-stars"].dispatch("change");
    assert.deepEqual(JSON.parse(storage.get("coin-pusher-2000-live-panel-v1")).gameBackground, {
        name: "fond.png",
        type: "image",
        dataUrl: "data:image/png;base64,AAAA",
        storageKey: null
    });
    storage.set("coin-pusher-2000-live-panel-v1", JSON.stringify({
        ...JSON.parse(storage.get("coin-pusher-2000-live-panel-v1")),
        gameBackground: {
            name: "fond.webm",
            type: "video",
            dataUrl: "data:video/webm;base64,AAAA",
            storageKey: null
        }
    }));
    elements = start();
    assert.equal(elements["game-background-media"].hidden, false);
    assert.equal(elements["game-background-image"].hidden, true);
    assert.equal(elements["game-background-video"].hidden, false);
    assert.equal(elements["game-background-video"].src, "data:video/webm;base64,AAAA");
});
