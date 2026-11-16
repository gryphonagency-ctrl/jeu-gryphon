import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createGiftRouletteCatalog, GIFT_ROULETTE_DEFINITIONS } from "../lib/gift-roulette-catalog.js";

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
    const gameSource = readFileSync(new URL("../../machine-cadeaux.html", import.meta.url), "utf8");
    const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
    const machineControlsMarkup = html.match(
        /<div id="machine-controls-panel"[^>]*>([\s\S]*?)<\/div>\s*<div id="symbols-controls-panel"/
    )?.[1];
    const symbolsControlsMarkup = html.match(
        /<div id="symbols-controls-panel"[^>]*>([\s\S]*?)<\/div>\s*<section class="setup-tools"/
    )?.[1];
    assert.ok(machineControlsMarkup);
    assert.ok(symbolsControlsMarkup);
    assert.match(machineControlsMarkup, /id="coin-volume"/);
    assert.match(machineControlsMarkup, /id="game-background-input"/);
    assert.match(machineControlsMarkup, /id="screen-video"/);
    assert.match(machineControlsMarkup, /id="prize-card-table"/);
    assert.doesNotMatch(machineControlsMarkup, /id="demo-count"|id="gift-roulette-speed-/);
    assert.match(symbolsControlsMarkup, /id="demo-count"/);
    assert.match(symbolsControlsMarkup, /id="manual-gift-select"/);
    assert.match(symbolsControlsMarkup, /id="gift-roulette-speed-1"/);
    assert.match(symbolsControlsMarkup, /id="diamond-x"/);
    assert.doesNotMatch(symbolsControlsMarkup, /id="coin-volume"|id="game-background-input"|id="screen-video"/);
    assert.match(html, /id="machine-controls-tab"[^>]*role="tab" aria-selected="true"/);
    assert.match(html, /id="symbols-controls-panel"[^>]*hidden/);
    assert.match(html, /id="star-leaderboard-drag-handle"[^>]*aria-label="Déplacer le Top 3"/);
    assert.match(html, /\.star-leaderboard-drag-handle\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none/s);
    assert.match(html, /\.star-leaderboard\.is-handle-visible\s+\.star-leaderboard-drag-handle/);
    const queueHeaderMarkup = html.match(
        /<div id="gift-roulette-queue-header"[^>]*>([\s\S]*?)<\/div>/
    )?.[1];
    assert.ok(queueHeaderMarkup);
    assert.doesNotMatch(queueHeaderMarkup, /button|Épingl/i);
    assert.doesNotMatch(html, /id="gift-roulette-queue-pin"/);
    assert.match(html, /id="gift-roulette-queue-pin-panel"/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    const machineGiftFiles = new Set([
        ...[...gameSource.matchAll(/img:\s*D\s*\+\s*'([^']+)'/g)].map(match => match[1]),
        ...[...gameSource.matchAll(/\[\s*'[^']+'\s*,\s*\d+\s*,\s*'([^']+)'/g)].map(match => match[1])
    ]);
    const rouletteGiftFiles = new Set(
        [...indexSource.matchAll(/import gift[A-Za-z]+ from "\.\.\/cadeaux-machine\/([^"]+)";/g)]
            .map(match => match[1])
    );
    assert.deepEqual([...rouletteGiftFiles].sort(), [...machineGiftFiles].sort());

    let machineState;
    const machinePresses = [];
    const prizeConfigs = [];
    const droppedCards = [];
    const droppedIngots = [];
    const soundVolumes = [];
    const sceneOffsets = [];
    const giftCalls = [];
    const rouletteSettings = [];
    const giftCatalog = createGiftRouletteCatalog(
        Object.fromEntries(GIFT_ROULETTE_DEFINITIONS.map(gift => [gift.id, gift.id]))
    );
    function start() {
        machineState = { buttons: { start: true }, coins: 0 };
        const document = { createElement: tag => new Element(tag, document) };
        document.documentElement = new Element("html", document);
        document.documentElement.style.setProperty = (name, value) => {
            document.documentElement.style[name] = value;
        };
        const elements = Object.fromEntries(ids.map(id => [id, new Element(id, document)]));
        for (const [id, value] of Object.entries({
            "demo-count": "10",
            "character-scale": "100",
            "character-horizontal": "15",
            "character-depth": "30",
            "coin-volume": "45",
            "scene-brand-x": "5",
            "scene-brand-y": "75",
            "diamond-x": "5",
            "diamond-y": "85",
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
            giftCatalog,
            setGiftRouletteSettings(settings) { rouletteSettings.push(settings); },
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
    assert.equal(elements["machine-controls-tab"].getAttribute("aria-selected"), "true");
    assert.equal(elements["machine-controls-panel"].hidden, false);
    assert.equal(elements["symbols-controls-tab"].getAttribute("aria-selected"), "false");
    assert.equal(elements["symbols-controls-panel"].hidden, true);
    elements["symbols-controls-tab"].dispatch("click");
    assert.equal(elements["machine-controls-tab"].getAttribute("aria-selected"), "false");
    assert.equal(elements["machine-controls-panel"].hidden, true);
    assert.equal(elements["symbols-controls-tab"].getAttribute("aria-selected"), "true");
    assert.equal(elements["symbols-controls-panel"].hidden, false);
    elements["symbols-controls-tab"].dispatch("keydown", { key: "ArrowLeft" });
    assert.equal(elements["machine-controls-tab"].getAttribute("aria-selected"), "true");
    assert.equal(elements["machine-controls-panel"].hidden, false);
    assert.equal(elements["symbols-controls-tab"].getAttribute("aria-selected"), "false");
    assert.equal(elements["symbols-controls-panel"].hidden, true);
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
    assert.notEqual(elements["scene-brand"].textContent, "GRYPHON AGENCY");
    assert.equal(elements["manual-gift-select"].children.length, 31);
    assert.equal(elements["gift-roulette-speed-1"].getAttribute("aria-pressed"), "true");
    assert.deepEqual(rouletteSettings[0], { speed: 1, winChance: 0.1, volume: 0.45 });
    assert.deepEqual(
        [...html.matchAll(/class="gift-roulette-item" data-gift-image="([^"]+)"/g)].map(match => match[1]),
        [
            "universe.png",
            "stars.png",
            "lion.png",
            "zeus.png",
            "stars.png",
            "zeus.png"
        ]
    );
    assert.match(html, /id="gift-roulette-diamond" class="gift-roulette-center" aria-hidden="true">\s*<svg/);
    assert.match(html, /roulette-diamond-crown/);
    assert.match(html, /\.gift-roulette-ring\s*\{[^}]*grid-template-columns:\s*repeat\(6/);
    assert.match(html, /\.gift-roulette-center\s*\{[^}]*width:\s*clamp\(56px,\s*14\.72vw,\s*104px\)/);
    assert.match(html, /@media \(max-width: 480px\)[\s\S]*?\.gift-roulette-center\s*\{[^}]*width:\s*clamp\(56px,\s*calc\(32vw - 6\.4px\),\s*104px\)/);
    assert.doesNotMatch(html.match(/\.gift-roulette-center\s*\{[^}]*\}/)[0], /background:|border:|box-shadow:/);
    assert.doesNotMatch(html, /gift-roulette-pointer|gift-roulette-spin/);
    assert.doesNotMatch(html, /gift-roulette-spin|gift-roulette-center" aria-hidden="true">★/);
    assert.doesNotMatch(html, /id="machine-(left|right|shoot|a|b)"|Les boutons grisés sont indisponibles/);
    assert.equal(elements["scene-brand"].hidden, false);
    assert.equal(elements["scene-brand-lock"].textContent, "Verrouiller la roulette");
    elements["scene-brand-lock"].dispatch("click");
    assert.equal(elements["scene-brand-x"].disabled, true);
    assert.equal(elements["scene-brand-y"].disabled, true);
    assert.notEqual(elements["diamond-x"].disabled, true);
    assert.notEqual(elements["diamond-y"].disabled, true);
    assert.equal(elements["gift-roulette-diamond"].style.left, "5%");
    assert.equal(elements["gift-roulette-diamond"].style.top, "85%");
    assert.equal(
        JSON.parse(storage.get("coin-pusher-2000-live-panel-v1")).sceneBrandLocked,
        true
    );
    elements = start();
    assert.equal(elements["scene-brand-lock"].textContent, "Déverrouiller la roulette");
    assert.equal(elements["scene-brand-x"].disabled, true);
    const lockedLeft = elements["scene-brand"].style.left;
    elements["scene-brand"].listeners.pointerdown[0]({
        button: 0, pointerId: 8, clientX: 600, clientY: 200, preventDefault() {}
    });
    for (const listener of window.listeners.pointermove) {
        listener({ pointerId: 8, clientX: 720, clientY: 320 });
    }
    assert.equal(elements["scene-brand"].style.left, lockedLeft);
    elements["scene-brand-lock"].dispatch("click");
    assert.equal(elements["scene-brand-x"].disabled, false);
    assert.equal(
        JSON.parse(storage.get("coin-pusher-2000-live-panel-v1")).sceneBrandLocked,
        false
    );
    elements["coin-volume"].value = "72";
    elements["coin-volume"].dispatch("input");
    assert.equal(elements["coin-volume-value"].value, "72 %");
    assert.equal(soundVolumes.at(-1), 0.72);
    assert.equal(storage.get("coin-pusher-2000-coin-volume-v1"), "72");
    elements["gift-roulette-speed-4"].dispatch("click");
    assert.equal(elements["gift-roulette-speed-4"].getAttribute("aria-pressed"), "true");
    assert.equal(elements["gift-roulette-speed-1"].getAttribute("aria-pressed"), "false");
    elements["gift-roulette-win-chance"].value = "25";
    elements["gift-roulette-win-chance"].dispatch("input");
    elements["gift-roulette-volume"].value = "60";
    elements["gift-roulette-volume"].dispatch("input");
    assert.equal(elements["gift-roulette-win-chance-value"].value, "25 %");
    assert.equal(elements["gift-roulette-volume-value"].value, "60 %");
    assert.deepEqual(rouletteSettings.at(-1), { speed: 4, winChance: 0.25, volume: 0.6 });
    elements["diamond-scale"].value = "180";
    elements["diamond-scale"].dispatch("input");
    assert.equal(elements["gift-roulette-diamond"].style.transform, "translate(-50%, -50%) scale(1.8)");
    elements["manual-gift-username"].value = "@alice";
    elements["manual-gift-select"].value = "falcon";
    elements["manual-gift-trigger"].dispatch("click");
    assert.deepEqual(giftCalls.at(-1), {
        count: 10999,
        profile: { username: "alice", uniqueId: "alice" },
        simulation: true
    });
    const rouletteSetup = JSON.parse(storage.get("coin-pusher-2000-live-panel-v1"));
    assert.equal(rouletteSetup.giftRouletteSpeed, 4);
    assert.equal(rouletteSetup.giftRouletteWinChancePercent, 25);
    assert.equal(rouletteSetup.giftRouletteVolumePercent, 60);
    assert.equal(rouletteSetup.diamondScalePercent, 180);
    assert.equal(rouletteSetup.manualGiftId, "falcon");
    assert.equal(rouletteSetup.manualGiftUsername, "alice");
    elements["demo-count"].value = "3";
    elements["test-gift"].dispatch("click");
    assert.deepEqual(giftCalls.at(-1), {
        count: 3,
        profile: { username: "alice", uniqueId: "alice" },
        simulation: true
    });
    const initialBrandTransform = elements["scene-brand"].style.transform;
    elements["leaderboard-x"].value = "80";
    elements["leaderboard-x"].dispatch("input");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -55%)");
    assert.equal(elements["scene-brand"].style.transform, initialBrandTransform);
    elements["scene-brand-x"].value = "90";
    elements["scene-brand-y"].value = "20";
    elements["scene-brand-y"].dispatch("input");
    assert.equal(elements["scene-brand"].style.left, "90%");
    assert.equal(elements["scene-brand"].style.top, "20%");
    assert.equal(elements["scene-brand"].style.transform, "translate(-50%, -50%)");
    const wheelLeftBeforeDiamondDrag = elements["scene-brand"].style.left;
    elements["gift-roulette-diamond"].listeners.pointerdown[0]({
        button: 0, pointerId: 9, clientX: 250, clientY: 300, preventDefault() {}
    });
    for (const listener of window.listeners.pointermove) {
        listener({ pointerId: 9, clientX: 800, clientY: 500 });
    }
    assert.equal(elements["diamond-x"].value, "60");
    assert.equal(elements["diamond-y"].value, "58");
    assert.equal(elements["gift-roulette-diamond"].style.left, "60%");
    assert.equal(elements["gift-roulette-diamond"].style.top, "58%");
    assert.equal(elements["scene-brand"].style.left, wheelLeftBeforeDiamondDrag);
    for (const listener of window.listeners.pointerup) {
        listener({ pointerId: 9 });
    }
    const draggedDiamondSetup = JSON.parse(storage.get("coin-pusher-2000-live-panel-v1"));
    assert.equal(draggedDiamondSetup.diamondX, 60);
    assert.equal(draggedDiamondSetup.diamondY, 58);
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
    elements["scene-brand-scale"].value = "70";
    elements["scene-brand-scale"].dispatch("input");
    assert.equal(elements["scene-brand"].style.transform, "translate(-50%, -50%) scale(0.7)");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -40%)");
    elements["scene-brand"].getBoundingClientRect = () => ({ left: 500, top: 100, width: 200, height: 200 });
    elements["scene-brand"].listeners.pointerdown[0]({
        button: 0, pointerId: 7, clientX: 600, clientY: 200, preventDefault() {}
    });
    for (const listener of window.listeners.pointermove) {
        listener({ pointerId: 7, clientX: 720, clientY: 320 });
    }
    assert.equal(elements["scene-brand-x"].value, "60");
    assert.equal(elements["scene-brand-y"].value, "40");
    assert.equal(elements["scene-brand"].style.left, "60%");
    assert.equal(elements["scene-brand"].style.top, "40%");
    assert.equal(elements["scene-brand"].style.transform, "translate(-50%, -50%) scale(0.7)");
    for (const listener of window.listeners.pointerup) {
        listener({ pointerId: 7 });
    }
    const draggedSetup = JSON.parse(storage.get("coin-pusher-2000-live-panel-v1"));
    assert.equal(draggedSetup.sceneBrandX, 60);
    assert.equal(draggedSetup.sceneBrandY, 40);
    elements["leaderboard-scale"].value = "60";
    elements["leaderboard-scale"].dispatch("input");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -40%) scale(0.6)");
    elements["show-star-leaderboard"].checked = true;
    elements["show-star-leaderboard"].dispatch("change");
    assert.equal(elements["scene-brand"].hidden, false);
    assert.equal(elements["scene-brand"].style.transform, "translate(-50%, -50%) scale(0.7)");
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
    assert.equal(rows[0].children[1].children[1].src, "https://example.com/avatar.png");
    assert.equal(rows[0].children[3].textContent, "25 ⭐");

    elements = start();
    assert.equal(elements["manual-card-stars"].value, "300");
    assert.equal(elements["gift-roulette-speed-4"].getAttribute("aria-pressed"), "true");
    assert.equal(elements["gift-roulette-win-chance"].value, "25");
    assert.equal(elements["gift-roulette-volume"].value, "60");
    assert.equal(elements["diamond-scale"].value, "180");
    assert.equal(elements["manual-gift-select"].value, "falcon");
    assert.equal(elements["manual-gift-username"].value, "alice");
    assert.notEqual(elements["scene-brand"].textContent, "GRYPHON AGENCY");
    assert.equal(elements["scene-brand"].hidden, false);
    assert.equal(elements["scene-brand"].style.transform, "translate(-50%, -50%) scale(0.7)");
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
