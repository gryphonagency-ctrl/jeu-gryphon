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
    function start() {
        machineState = { buttons: { start: true }, coins: 0 };
        const document = { createElement: tag => new Element(tag, document) };
        const elements = Object.fromEntries(ids.map(id => [id, new Element(id, document)]));
        document.getElementById = id => {
            assert.ok(elements[id], `Missing HTML control: ${id}`);
            return elements[id];
        };
        globalThis.document = document;
        globalThis.window = {
            innerWidth: 1200, innerHeight: 800, listeners: {},
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
            setCharacterPosition() {}, dropPrizeCard() {}, setPrizeConfig() {}
        });
        return elements;
    }

    let elements = start();
    assert.equal(elements["machine-start"].disabled, false);
    assert.equal(elements["machine-left"].disabled, true);
    elements["machine-start"].dispatch("click");
    assert.deepEqual(machinePresses, ["start"]);
    assert.equal(elements["machine-start"].disabled, true);
    assert.equal(elements["machine-left"].disabled, false);
    assert.equal(elements["machine-coins"].textContent, "100");
    assert.equal(elements["scene-brand"].textContent, "GRYPHON AGENCY");
    elements["scene-brand-text"].value = "MON TEXTE";
    elements["scene-brand-text"].dispatch("input");
    elements["scene-brand-x"].value = "90";
    elements["scene-brand-y"].value = "20";
    elements["scene-brand-y"].dispatch("input");
    elements["leaderboard-x"].value = "80";
    elements["leaderboard-y"].value = "40";
    elements["leaderboard-y"].dispatch("input");
    elements["show-scene-brand"].checked = false;
    elements["show-scene-brand"].dispatch("change");
    elements["show-star-leaderboard"].checked = true;
    elements["show-star-leaderboard"].dispatch("change");
    assert.equal(elements["scene-brand"].hidden, true);
    assert.equal(elements["scene-brand"].style.transform, "translate(-90%, -20%)");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -40%)");
    window.dispatch("coin-pusher-prize-awarded", {
        username: "alice", amount: 25, avatarUrl: "https://example.com/avatar.png", globalStars: 25
    });
    const rows = elements["star-leaderboard-list"].children;
    assert.equal(rows[0].children[0].children[1].src, "https://example.com/avatar.png");
    assert.equal(rows[0].children[2].textContent, "25 ⭐");

    elements = start();
    assert.equal(elements["scene-brand-text"].value, "MON TEXTE");
    assert.equal(elements["scene-brand"].hidden, true);
    assert.equal(elements["scene-brand"].style.transform, "translate(-90%, -20%)");
    assert.equal(elements["star-leaderboard"].style.transform, "translate(-80%, -40%)");
    assert.equal(elements["star-leaderboard-list"].children[0].children[2].textContent, "25 ⭐");
    elements["show-scene-brand"].checked = true;
    elements["show-scene-brand"].dispatch("change");
    assert.equal(elements["scene-brand"].hidden, false);
});
