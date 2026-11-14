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
    assert.match(styles, /body\.video-playing::after\s*\{\s*display:\s*none/);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const classes = new Set();
    const listeners = {};
    const banner = { style: { setProperty() {}, getPropertyValue() { return ""; } } };
    const demo = { style: {} };
    const run = { style: {}, querySelector() { return { textContent: "" }; } };
    const video = {
        style: {}, addEventListener() {}, load() {}, play() { return Promise.resolve(); },
        pause() {}, removeAttribute(name) { delete this[name]; }
    };
    const elements = {
        ".background-canvas": {}, ".banner": banner, ".demo-mode": demo,
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
    assert.match(html, /#arcade-effects-layer,[\s\S]*?#arcade-stars-wallet,[\s\S]*?#arcade-stars-owed,[\s\S]*?\.ae-media-alert-video,[\s\S]*?\.ae-media-alert-unlock,[\s\S]*?\.ae-sound-unlock\s*\{\s*z-index:\s*4\s*!important/);
    assert.match(html, /body\s*>\s*canvas\s*\{/);
    const effects = read("../../arcade-effects.js");
    assert.match(effects, /mediaAlertVideo\.className = 'ae-media-alert-video'/);
    assert.match(effects, /button\.className = 'ae-media-alert-unlock'/);
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const elements = [];
    globalThis.document = {
        createElement() {
            return { style: {}, appendChild(child) { elements.push(child); } };
        }
    };
    globalThis.window = { innerWidth: 1280, innerHeight: 720 };
    try {
        const { default: Screen } = await import("../lib/components/output/screen.js");
        let renderer;
        new Screen({ scene: { containerElement: { appendChild(element) { renderer = element; } } } });
        assert.equal(renderer.style.zIndex, "7");
        assert.equal(renderer.style.pointerEvents, "none");
    } finally {
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
    }
});
