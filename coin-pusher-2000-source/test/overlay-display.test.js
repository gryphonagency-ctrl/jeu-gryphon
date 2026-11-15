import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSpectatorLeaderboard, setOverlayPosition } from "../lib/overlay-display.js";

class Element {
    constructor(tag, ownerDocument) {
        this.tag = tag;
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.style = {};
        this.listeners = {};
    }

    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
}

const document = { createElement: tag => new Element(tag, document) };

test("positions overlays at both screen edges without moving them outside the viewport", () => {
    const element = new Element("div", document);
    setOverlayPosition(element, 100, 0);
    assert.deepEqual(element.style, {
        left: "100%",
        top: "0%",
        transformOrigin: "100% 0%",
        transform: "translate(-100%, -0%)"
    });
    setOverlayPosition(element, 0, 100);
    assert.deepEqual(element.style, {
        left: "0%",
        top: "100%",
        transformOrigin: "0% 100%",
        transform: "translate(-0%, -100%)"
    });
    assert.throws(() => setOverlayPosition(element, 101, 0), RangeError);
    setOverlayPosition(element, 50, 25, 70);
    assert.equal(element.style.transform, "translate(-50%, -25%) scale(0.7)");
    assert.throws(() => setOverlayPosition(element, 50, 25, 20), RangeError);
});

test("keeps all podium places visible and fills only confirmed winners", () => {
    const list = new Element("ol", document);
    renderSpectatorLeaderboard(list, [
        { username: "alice", stars: 1200, avatarUrl: "https://example.com/alice.png" },
        { username: "bob", stars: 8, avatarUrl: "" }
    ]);
    assert.equal(list.children.length, 3);
    const [alice, bob, pending] = list.children;
    const [avatar, name, score] = alice.children;
    assert.equal(avatar.children[1].src, "https://example.com/alice.png");
    assert.equal(avatar.children.length, 2);
    assert.equal(name.textContent, "@alice");
    assert.equal(score.textContent, `${(1200).toLocaleString("fr-FR")} ⭐`);
    avatar.children[1].listeners.load();
    assert.equal(avatar.children[0].hidden, true);
    avatar.children[1].listeners.error();
    assert.equal(avatar.children[0].hidden, false);
    assert.equal(avatar.children[1].hidden, true);
    assert.equal(bob.children[0].children.length, 1);
    assert.equal(bob.children[2].textContent, "8 ⭐");
    assert.equal(pending.className, "leaderboard-placeholder");
    assert.equal(pending.children[1].textContent, "En attente");
    assert.equal(pending.children[2].textContent, "");
    assert.equal(pending.children[3].textContent, "3e");
    renderSpectatorLeaderboard(list, []);
    assert.equal(list.children.length, 3);
    assert.ok(list.children.every(row => row.className === "leaderboard-placeholder"));
    renderSpectatorLeaderboard(list, Array.from({ length: 4 }, (_, index) => ({
        username: `user${index}`, stars: index, avatarUrl: ""
    })));
    assert.equal(list.children.length, 3);
});

test("the spectator overlay has no title or background", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const section = html.match(/<section id="star-leaderboard"[\s\S]*?<\/section>/)[0];
    const style = html.match(/\.star-leaderboard\s*\{([^}]*)\}/)[1];
    const avatarStyle = html.match(/\.leaderboard-avatar\s*\{([^}]*)\}/)[1];
    assert.doesNotMatch(section, /<h2|<li/);
    assert.match(style, /background:\s*transparent/);
    assert.match(avatarStyle, /background:\s*transparent/);
    assert.doesNotMatch(style, /border\s*:/);
});

test("the spectator leaderboard places first in the center, second right, third lower left", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    assert.match(html, /\.star-leaderboard li:nth-child\(1\)\s*\{[^}]*grid-column:\s*2[^}]*height:/);
    assert.match(html, /\.star-leaderboard li:nth-child\(2\)\s*\{[^}]*grid-column:\s*3/);
    assert.match(html, /\.star-leaderboard li:nth-child\(3\)\s*\{[^}]*grid-column:\s*1[^}]*height:/);
    assert.match(html, /\.leaderboard-podium-step\s*\{[^}]*background:/);
});
