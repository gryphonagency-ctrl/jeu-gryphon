import test from "node:test";
import assert from "node:assert/strict";
import { deleteSetupVideo, loadSetupVideo, saveSetupVideo } from "../lib/setup-video-storage.js";

test("stores, restores and removes setup media", async () => {
    const previousIndexedDB = globalThis.indexedDB;
    const videos = new Map();
    const database = {
        objectStoreNames: { contains: () => true },
        transaction() {
            const transaction = {};
            transaction.objectStore = () => ({
                put(video, key) {
                    videos.set(key, video);
                    queueMicrotask(() => transaction.oncomplete());
                    return { result: key };
                },
                get(key) {
                    const request = { result: videos.get(key) };
                    queueMicrotask(() => transaction.oncomplete());
                    return request;
                },
                delete(key) {
                    videos.delete(key);
                    queueMicrotask(() => transaction.oncomplete());
                    return { result: undefined };
                }
            });
            return transaction;
        },
        close() {}
    };
    globalThis.indexedDB = {
        open() {
            const request = { result: database };
            queueMicrotask(() => request.onsuccess());
            return request;
        }
    };

    try {
        const video = new Blob(["video-data"], { type: "video/webm" });
        await saveSetupVideo("video-test", video);
        assert.equal(await loadSetupVideo("video-test"), video);
        const image = new Blob(["image-data"], { type: "image/png" });
        await saveSetupVideo("background-test", image);
        assert.equal(await loadSetupVideo("background-test"), image);
        await deleteSetupVideo("background-test");
        await deleteSetupVideo("video-test");
        assert.equal(await loadSetupVideo("video-test"), null);
    } finally {
        if (previousIndexedDB === undefined) {
            delete globalThis.indexedDB;
        } else {
            globalThis.indexedDB = previousIndexedDB;
        }
    }
});

test("reports when persistent video storage is unavailable", async () => {
    const previousIndexedDB = globalThis.indexedDB;
    delete globalThis.indexedDB;
    try {
        await assert.rejects(saveSetupVideo("video-test", new Blob()), /n’est pas pris en charge/);
    } finally {
        if (previousIndexedDB !== undefined) {
            globalThis.indexedDB = previousIndexedDB;
        }
    }
});
