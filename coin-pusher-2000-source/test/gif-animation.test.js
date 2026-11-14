import test from "node:test";
import assert from "node:assert/strict";
import { createGifAnimation } from "../lib/gif-animation.js";
import GiphyCharacter from "../lib/components/giphy-character.js";

const gif = Buffer.from(
    "R0lGODlhAwACAIEAAAAAAP8AAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQJBwAAACwAAAAAAwACAAAIBwADABg4MCAAIfkECQwAAAAsAgAAAAEAAQCBAAAAAAD/AAAAAAAACAQAAwQEADs=",
    "base64"
);

class Canvas {
    #width = 0;
    #height = 0;
    pixels = new Uint8ClampedArray();
    get width() { return this.#width; }
    set width(value) { this.#width = value; this.#resize(); }
    get height() { return this.#height; }
    set height(value) { this.#height = value; this.#resize(); }
    #resize() { this.pixels = new Uint8ClampedArray(this.#width * this.#height * 4); }
    getContext() {
        return {
            createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
            getImageData: () => ({ width: this.width, height: this.height, data: this.pixels.slice() }),
            putImageData: (image, left, top) => this.#copy(image, left, top, false),
            drawImage: (canvas, left, top) => this.#copy({ width: canvas.width, height: canvas.height, data: canvas.pixels }, left, top, true),
            clearRect: (left, top, width, height) => {
                for (let y = top; y < top + height; y++) {
                    for (let x = left; x < left + width; x++) this.pixels.fill(0, (y * this.width + x) * 4, (y * this.width + x + 1) * 4);
                }
            }
        };
    }
    #copy(image, left, top, blend) {
        for (let y = 0; y < image.height; y++) {
            for (let x = 0; x < image.width; x++) {
                const source = (y * image.width + x) * 4;
                if (!blend || image.data[source + 3]) {
                    this.pixels.set(image.data.subarray(source, source + 4), ((top + y) * this.width + left + x) * 4);
                }
            }
        }
    }
}

test("le GIF avance selon ses durées, nettoie ses anciens pixels et boucle", () => {
    const animation = createGifAnimation(gif, () => new Canvas());
    const pixel = x => [...animation.canvas.pixels.slice(x * 4, x * 4 + 4)];
    assert.deepEqual(pixel(0), [255, 0, 0, 255]);
    assert.equal(animation.update(0), false);
    assert.equal(animation.update(69), false);
    assert.equal(animation.update(70), true);
    assert.deepEqual(pixel(0), [0, 0, 0, 0]);
    assert.deepEqual(pixel(2), [0, 0, 255, 255]);
    assert.equal(animation.update(189), false);
    assert.equal(animation.update(190), true);
    assert.deepEqual(pixel(0), [255, 0, 0, 255]);
    assert.deepEqual(pixel(2), [0, 0, 0, 0]);
});

test("le personnage utilise le GIF animé et conserve sa taille et sa position", async () => {
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    const statuses = [];
    let url;
    let mesh;
    globalThis.document = { createElement: () => new Canvas() };
    globalThis.fetch = async value => {
        url = value;
        return { ok: true, arrayBuffer: async () => gif };
    };
    try {
        const character = new GiphyCharacter({
            scene: { addObject: object => { mesh = object; } },
            onStatus: message => statuses.push(message)
        });
        character.setScale(2);
        character.setPosition({ horizontalPercent: 100, depthPercent: 100 });
        await character.initialize();
        assert.match(url, /cCbM9ESE21PRbngTFj\/giphy\.gif$/);
        assert.equal(statuses.at(-1), "Personnage animé ajouté dans le bac.");
        assert.equal(mesh.scale.y, 0.48);
        assert.equal(mesh.position.z, 0.95);
        assert.equal(mesh.material.depthTest, false);
        const version = mesh.material.map.version;
        character.update(0);
        character.update(70);
        assert.ok(mesh.material.map.version > version);
        assert.throws(() => character.setPosition({ horizontalPercent: -1, depthPercent: 50 }), RangeError);
    } finally {
        globalThis.document = previousDocument;
        globalThis.fetch = previousFetch;
    }
});

test("une erreur de chargement du GIF est signalée dans le panneau", async () => {
    const previousFetch = globalThis.fetch;
    const previousError = console.error;
    const statuses = [];
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    console.error = () => {};
    try {
        const character = new GiphyCharacter({
            scene: { addObject() { assert.fail("Aucun personnage ne doit être ajouté"); } },
            onStatus: message => statuses.push(message)
        });
        await character.initialize();
        assert.match(statuses.at(-1), /Personnage indisponible/);
    } finally {
        globalThis.fetch = previousFetch;
        console.error = previousError;
    }
});
