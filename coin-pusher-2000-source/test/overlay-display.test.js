import test from "node:test";
import assert from "node:assert/strict";
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
    assert.deepEqual(element.style, { left: "100%", top: "0%", transform: "translate(-100%, -0%)" });
    setOverlayPosition(element, 0, 100);
    assert.deepEqual(element.style, { left: "0%", top: "100%", transform: "translate(-0%, -100%)" });
    assert.throws(() => setOverlayPosition(element, 101, 0), RangeError);
});

test("shows three ranked profiles, scores and placeholders when profiles are missing", () => {
    const list = new Element("ol", document);
    renderSpectatorLeaderboard(list, [
        { username: "alice", stars: 1200, avatarUrl: "https://example.com/alice.png" },
        { username: "bob", stars: 8, avatarUrl: "" }
    ]);
    assert.equal(list.children.length, 3);
    const [alice, bob, empty] = list.children;
    const [avatar, name, score] = alice.children;
    assert.equal(avatar.children[1].src, "https://example.com/alice.png");
    assert.equal(avatar.children[2].textContent, "1");
    assert.equal(name.textContent, "@alice");
    assert.equal(score.textContent, `${(1200).toLocaleString("fr-FR")} ⭐`);
    avatar.children[1].listeners.load();
    assert.equal(avatar.children[0].hidden, true);
    avatar.children[1].listeners.error();
    assert.equal(avatar.children[0].hidden, false);
    assert.equal(avatar.children[1].hidden, true);
    assert.equal(bob.children[0].children[1].textContent, "2");
    assert.equal(bob.children[2].textContent, "8 ⭐");
    assert.equal(empty.children[0].children[1].textContent, "3");
    assert.equal(empty.children[2].textContent, "—");
});
