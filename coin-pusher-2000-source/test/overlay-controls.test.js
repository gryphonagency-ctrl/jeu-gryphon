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
    }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    dispatch(type, detail) { for (const listener of this.listeners[type] || []) listener({ detail }); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    removeAttribute() {}
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
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

    let machineState;
    const machinePresses = [];
    const prizeConfigs = [];
    const droppedCards = [];
    const soundVolumes = [];
    function start() {
        machineState = { buttons: { start: true }, coins: 0 };
        const document = { createElement: tag => new Element(tag, document) };
        const elements = Object.fromEntries(ids.map(id => [id, new Element(id, document)]));
        for (const [id, value] of Object.entries({
            "demo-count": "10",
            "character-scale": "100",
            "character-horizontal": "15",
            "character-depth": "30",
            "coin-volume": "45",
            "scene-brand-x": "5",
            "scene-brand-y": "75",
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
            receiveGift() {}, updateGiftAvatar() {}, getPendingCoins() { return 0; },
            startGame() {}, getMachineControls() { return machineState; },
            pressMachineButton(name) {
                machinePresses.push(name);
                machineState = { buttons: { left: true, center: true, right: true }, coins: 100 };
                return true;
            }, setScreenVideo() {}, setCharacterScale() {},
            setCharacterPosition() {}, dropPrizeCard(username, stars) { droppedCards.push({ username, stars }); },
            setPrizeConfig(config) { prizeConfigs.push(config); }
        });
        return elements;
    }

    let elements = start();
    assert.deepEqual(prizeConfigs[0].cards, [
        { stars: 1, count: 200 }, { stars: 2, count: 125 },
        { stars: 10, count: 25 }, { stars: 30, count: 35 },
        { stars: 100, count: 8 }, { stars: 300, count: 2 }
    ]);
    assert.equal(elements["manual-card-stars"].value, "300");
    elements["manual-card-username"].value = "alice";
    elements["drop-prize-card"].dispatch("click");
    assert.deepEqual(droppedCards, [{ username: "alice", stars: 300 }]);
    assert.equal(JSON.parse(storage.get("coin-pusher-2000-live-panel-v1")).manualCardStars, 300);
    assert.equal(elements["machine-start"].disabled, false);
    assert.equal(elements["machine-left"].disabled, true);
    elements["machine-start"].dispatch("click");
    assert.deepEqual(machinePresses, ["start"]);
    assert.equal(elements["machine-start"].disabled, true);
    assert.equal(elements["machine-left"].disabled, false);
    assert.equal(elements["machine-coins"].textContent, "100");
    assert.equal(elements["scene-brand"].textContent, "GRYPHON AGENCY");
    assert.equal(elements["scene-brand"].hidden, false);
    elements["coin-volume"].value = "72";
    elements["coin-volume"].dispatch("input");
    assert.equal(elements["coin-volume-value"].value, "72 %");
    assert.equal(soundVolumes.at(-1), 0.72);
    assert.equal(storage.get("coin-pusher-2000-coin-volume-v1"), "72");
    const initialBrandTransform = elements["scene-brand"].style.transform;
    elements["leaderboard-x"].value = "80";
    elements["leaderboard-x"].dispatch("input");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -55%)");
    assert.equal(elements["scene-brand"].style.transform, initialBrandTransform);
    elements["scene-brand-x"].value = "90";
    elements["scene-brand-y"].value = "20";
    elements["scene-brand-y"].dispatch("input");
    assert.equal(elements["scene-brand"].style.transform, "translate(-90%, -20%)");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -55%)");
    elements["leaderboard-y"].value = "40";
    elements["leaderboard-y"].dispatch("input");
    elements["scene-brand-scale"].value = "70";
    elements["scene-brand-scale"].dispatch("input");
    assert.equal(elements["scene-brand"].style.transform, "translate(-90%, -20%) scale(0.7)");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -40%)");
    elements["leaderboard-scale"].value = "60";
    elements["leaderboard-scale"].dispatch("input");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -40%) scale(0.6)");
    elements["show-star-leaderboard"].checked = true;
    elements["show-star-leaderboard"].dispatch("change");
    assert.equal(elements["scene-brand"].hidden, false);
    assert.equal(elements["scene-brand"].style.transform, "translate(-90%, -20%) scale(0.7)");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -40%) scale(0.6)");
    const legacySetup = JSON.parse(storage.get("coin-pusher-2000-live-panel-v1"));
    assert.equal(legacySetup.sceneBrandScalePercent, 70);
    assert.equal(legacySetup.leaderboardScalePercent, 60);
    legacySetup.showSceneBrand = false;
    legacySetup.sceneBrandText = "MON TEXTE";
    storage.set("coin-pusher-2000-live-panel-v1", JSON.stringify(legacySetup));
    assert.doesNotMatch(html, /id="(?:show-scene-brand|scene-brand-text)"/);
    window.dispatch("coin-pusher-prize-awarded", {
        username: "alice", amount: 25, avatarUrl: "https://example.com/avatar.png", globalStars: 25
    });
    const rows = elements["star-leaderboard-list"].children;
    assert.equal(rows[0].children[0].children[1].src, "https://example.com/avatar.png");
    assert.equal(rows[0].children[2].textContent, "25 ⭐");

    elements = start();
    assert.equal(elements["manual-card-stars"].value, "300");
    assert.equal(elements["scene-brand"].textContent, "GRYPHON AGENCY");
    assert.equal(elements["scene-brand"].hidden, false);
    assert.equal(elements["scene-brand"].style.transform, "translate(-90%, -20%) scale(0.7)");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -40%) scale(0.6)");
    assert.equal(elements["star-leaderboard-list"].children[0].children[2].textContent, "25 ⭐");

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
});
