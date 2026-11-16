import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("le serveur n’injecte pas les overlays dans la télévision mais les conserve sur le jeu", () => {
    const server = read("../../serveur.js");
    const start = server.indexOf("function injectArcadeScripts(");
    const end = server.indexOf("\nfunction normalizeAdminDashboardLayout", start);
    assert.ok(start >= 0 && end > start);
    const inject = runInNewContext(`(${server.slice(start, end).trim()})`);
    const screen = read("../../coin-pusher-2000/views/index.html");
    assert.equal(inject(screen, "/coin-pusher-2000/views/index.html"), screen);
    const game = inject("<html><head></head><body></body></html>", "/coin-pusher-2000.html");
    assert.match(game, /src="\/arcade-effects\.js\?v=coin-pusher-screen-clean"/);
    assert.match(game, /src="\/arcade-stars\.js"/);
    assert.match(game, /src="\/arcade-presence\.js"/);
    assert.match(inject("<html><head></head><body></body></html>", "/autre-jeu.html"), /src="\/arcade-effects\.js"/);
    assert.equal((server.match(/injectArcadeScripts\(content\.toString\('utf8'\), pathname\)/g) || []).length, 2);
});

test("la vidéo masque les éléments de démonstration et le filtre de la télévision", () => {
    const html = read("../../coin-pusher-2000/views/index.html");
    const sourceHtml = read("../public/views/index.html");
    const styles = read("../../coin-pusher-2000/views/styles.css");
    assert.equal(html, sourceHtml);
    assert.equal(styles, read("../public/views/styles.css"));
    assert.doesNotMatch(sourceHtml, /top-banner\.png|class="banner"|updateBannerAnimation|getRandomAnimationProperties/);
    assert.doesNotMatch(styles, /\.banner|@keyframes (rotate|scale|skew|shake|grayscale|contrast|hue-rotate|sepia|fade-in-out|origin)/);
    assert.match(read("../lib/components/output/screen.js"), /screen-logo-removed/);
    assert.match(styles, /body\.video-playing::after\s*\{\s*display:\s*none/);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const classes = new Set();
    const listeners = {};
    const demo = { style: {} };
    const run = { style: {}, querySelector() { return { textContent: "" }; } };
    const video = {
        style: {}, addEventListener() {}, load() {}, play() { return Promise.resolve(); },
        pause() {}, removeAttribute(name) { delete this[name]; }
    };
    const elements = {
        ".background-canvas": {}, ".demo-mode": demo,
        ".run-mode": run, ".screen-video": video
    };
    const parent = { postMessage() {} };
    const location = { origin: "https://example.test" };
    const document = {
        querySelector(selector) { return elements[selector]; },
        body: { classList: { add(value) { classes.add(value); }, remove(value) { classes.delete(value); } } }
    };
    const window = {
        innerWidth: 442, innerHeight: 319,
        addEventListener(type, callback) { listeners[type] = callback; }
    };
    runInNewContext(script, { document, window, parent, location });
    const message = data => listeners.message({ source: parent, origin: location.origin, data });
    message({ type: "setScreenVideo", url: "blob:video" });
    assert.equal(classes.has("video-playing"), true);
    assert.equal(video.style.display, "block");
    assert.equal(demo.style.display, "none");
    assert.equal(run.style.display, "none");
    message({ type: "showRunStart", description: "Test", content: "Test" });
    assert.equal(run.style.display, "none");
    message({ type: "setScreenVideo", url: null });
    assert.equal(classes.has("video-playing"), false);
    assert.equal(video.style.display, "none");
});

test("les effets du jeu restent sous la télévision sans intercepter les commandes", async () => {
    const html = read("../index.html");
    assert.match(html, /id="screen-layout-lock"[^>]*>🔒 Verrouiller les écrans/);
    assert.match(html, /#screen-layout-lock,\s*#screen-rotation-mode\s*\{\s*position:\s*fixed/s);
    assert.match(html, /#arcade-effects-layer,[\s\S]*?#arcade-stars-wallet,[\s\S]*?#arcade-stars-owed,[\s\S]*?\.ae-media-alert-video,[\s\S]*?\.ae-media-alert-unlock,[\s\S]*?\.ae-sound-unlock\s*\{\s*z-index:\s*4\s*!important/);
    assert.match(html, /body\s*>\s*canvas\s*\{/);
    const effects = read("../../arcade-effects.js");
    assert.match(effects, /mediaAlertVideo\.className = 'ae-media-alert-video'/);
    assert.match(effects, /button\.className = 'ae-media-alert-unlock'/);
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const elements = [];
    const containerListeners = {};
    const windowListeners = {};
    const controlListeners = {};
    const buttons = Object.fromEntries(["screen-layout-lock", "screen-rotation-mode"].map(id => [id, {
        dataset: {},
        style: {},
        addEventListener(type, callback) { controlListeners[`${id}:${type}`] = callback; },
        setAttribute(name, value) { this[name] = value; }
    }]));
    globalThis.document = {
        createElement() {
            return { style: {}, appendChild(child) { elements.push(child); } };
        },
        getElementById(id) {
            assert.ok(buttons[id], `Missing screen control: ${id}`);
            return buttons[id];
        }
    };
    globalThis.window = {
        innerWidth: 1280,
        innerHeight: 720,
        addEventListener(type, callback) { windowListeners[type] = callback; }
    };
    try {
        const { default: Screen } = await import("../lib/components/output/screen.js");
        let renderer;
        const containerElement = {
            appendChild(element) { renderer = element; },
            addEventListener(type, callback) { containerListeners[type] = callback; }
        };
        new Screen({ scene: { containerElement } });
        assert.equal(renderer.style.zIndex, "7");
        assert.equal(renderer.style.pointerEvents, "none");
        assert.equal(buttons["screen-layout-lock"].dataset.locked, "false");
        controlListeners["screen-rotation-mode:click"]();
        assert.equal(buttons["screen-rotation-mode"]["aria-pressed"], "true");
        assert.equal(buttons["screen-rotation-mode"].textContent, "✓ Rotation active");
        controlListeners["screen-layout-lock:click"]();
        assert.equal(buttons["screen-layout-lock"].dataset.locked, "true");
        assert.equal(buttons["screen-layout-lock"].textContent, "🔓 Déplacer les écrans");
        assert.equal(buttons["screen-rotation-mode"].disabled, true);
        assert.equal(buttons["screen-rotation-mode"]["aria-pressed"], "false");
        assert.deepEqual(containerListeners, {});
        assert.deepEqual(windowListeners, {});
    } finally {
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
    }
});

test("le canvas transparent révèle un fond arcade au lieu du noir uni", () => {
    const html = read("../index.html");
    const scene = read("../lib/util/scene.js");
    assert.match(html, /radial-gradient\(ellipse at 50% 42%/);
    assert.match(html, /repeating-linear-gradient\(45deg/);
    assert.match(html, /body\s*>\s*canvas\s*\{[^}]*background-color:\s*transparent/s);
    assert.match(scene, /alpha:\s*true/);
    assert.match(scene, /this\.#scene\.background\s*=\s*null/);
    assert.match(scene, /setClearColor\(0x000000,\s*0\)/);
});
