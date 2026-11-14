import test from "node:test";
import assert from "node:assert/strict";
import { createPrizeCardLabel, lookupPrizeAvatar } from "../lib/prize-card-label.js";

class Canvas {
    width = 0;
    height = 0;
    calls = [];
    context = {
        fillRect: (...args) => this.calls.push(["fillRect", ...args]),
        save: () => this.calls.push(["save"]),
        beginPath: () => this.calls.push(["beginPath"]),
        arc: (...args) => this.calls.push(["arc", ...args]),
        clip: () => this.calls.push(["clip"]),
        drawImage: (...args) => this.calls.push(["drawImage", ...args]),
        restore: () => this.calls.push(["restore"]),
        fillText: (...args) => this.calls.push(["fillText", ...args]),
        set fillStyle(value) { this._fillStyle = value; },
        get fillStyle() { return this._fillStyle; },
        set textAlign(value) { this._textAlign = value; },
        set textBaseline(value) { this._textBaseline = value; },
        set font(value) { this._font = value; }
    };
    getContext() { return this.context; }
}

test("la carte porte le pseudo et les étoiles en noir sur ses deux faces", () => {
    const previousDocument = globalThis.document;
    const canvases = [];
    globalThis.document = {
        createElement(tag) {
            assert.equal(tag, "canvas");
            const canvas = new Canvas();
            canvases.push(canvas);
            return canvas;
        }
    };
    try {
        const label = createPrizeCardLabel({
            username: "alice", amount: 1250, avatarUrl: "",
            width: 0.175, height: 0.11, depth: 0.005,
            onAvatarError: error => { throw error; }
        });
        const canvas = canvases[0];
        const text = canvas.calls.filter(call => call[0] === "fillText");
        assert.deepEqual(text.map(call => call[1]), ["?", "1 250 ★", "@alice"]);
        assert.equal(canvas.context.fillStyle, "#000000");
        assert.equal(label.group.children.length, 2);
        assert.deepEqual(label.group.children.map(face => face.rotation.x), [Math.PI / 2, -Math.PI / 2]);
        assert.deepEqual(label.group.children.map(face => face.position.y), [0.0035, -0.0035]);
        assert.equal(canvas.width, 640);
        assert.equal(canvas.height, 400);
        label.dispose();
        assert.equal(label.group.parent, null);
    } finally {
        globalThis.document = previousDocument;
    }
});

test("la photo du joueur remplace le repère et les erreurs sont signalées", () => {
    const previousDocument = globalThis.document;
    const previousImage = globalThis.Image;
    const canvases = [];
    class ImageMock {
        listeners = {};
        naturalWidth = 100;
        naturalHeight = 100;
        addEventListener(type, callback) { this.listeners[type] = callback; }
        set src(value) {
            this.url = value;
            this.listeners.load();
        }
    }
    globalThis.Image = ImageMock;
    globalThis.document = { createElement: () => {
        const canvas = new Canvas();
        canvases.push(canvas);
        return canvas;
    } };
    try {
        const errors = [];
        const label = createPrizeCardLabel({
            username: "bob", amount: 50, avatarUrl: "https://example.test/avatar.png",
            width: 0.175, height: 0.11, depth: 0.005,
            onAvatarError: error => errors.push(error)
        });
        const canvas = canvases[0];
        assert.equal(canvas.calls.filter(call => call[0] === "drawImage").length, 1);
        assert.equal(canvas.calls.filter(call => call[0] === "fillText").at(-2)[1], "50 ★");
        assert.deepEqual(errors, []);
        label.dispose();
        const invalid = createPrizeCardLabel({
            username: "carol", amount: 5, avatarUrl: "",
            width: 0.175, height: 0.11, depth: 0.005,
            onAvatarError: error => errors.push(error)
        });
        invalid.setAvatarUrl("javascript:alert(1)");
        assert.match(errors[0].message, /invalide/);
        invalid.dispose();
    } finally {
        globalThis.document = previousDocument;
        globalThis.Image = previousImage;
    }
});

test("la recherche du profil remonte les réponses du portefeuille", async () => {
    const previousFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => ({ player: { avatarUrl: "/api/tiktok-avatars/key" } }) };
    };
    try {
        assert.equal(await lookupPrizeAvatar("@alice"), "/api/tiktok-avatars/key");
        assert.equal(request.url, "/api/tiktok-stars?player=alice");
        assert.equal(request.options.credentials, "same-origin");
        globalThis.fetch = async () => ({ ok: false, status: 404 });
        await assert.rejects(lookupPrizeAvatar("unknown"), /HTTP 404/);
    } finally {
        globalThis.fetch = previousFetch;
    }
});
