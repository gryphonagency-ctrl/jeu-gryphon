import test from "node:test";
import assert from "node:assert/strict";
import getCachedAvatar from "../../tiktok-avatar-cache.js";

test("un avatar absent est retiré du cache pour permettre un nouvel essai", async () => {
    const cache = new Map();
    let attempts = 0;
    await assert.rejects(getCachedAvatar(cache, "photo", async () => {
        attempts++;
        return null;
    }), /Réponse image invalide/);
    assert.equal(cache.has("photo"), false);

    const avatar = await getCachedAvatar(cache, "photo", async () => {
        attempts++;
        return "data:image/png;base64,AAAA";
    });
    assert.equal(avatar, "data:image/png;base64,AAAA");
    assert.equal(attempts, 2);
});

test("une erreur temporaire est réessayée avant d’abandonner l’avatar", async () => {
    const cache = new Map();
    let attempts = 0;
    const avatar = await getCachedAvatar(cache, "photo", async () => {
        attempts++;
        return attempts === 1 ? null : "data:image/png;base64,AAAA";
    }, 1);
    assert.equal(avatar, "data:image/png;base64,AAAA");
    assert.equal(attempts, 2);
});

test("les téléchargements d’avatar concurrents partagent la même requête", async () => {
    const cache = new Map();
    let attempts = 0;
    let resolveAvatar;
    const load = () => {
        attempts++;
        return new Promise(resolve => { resolveAvatar = resolve; });
    };
    const first = getCachedAvatar(cache, "photo", load);
    const second = getCachedAvatar(cache, "photo", load);
    await Promise.resolve();
    resolveAvatar("data:image/png;base64,AAAA");
    assert.deepEqual(await Promise.all([first, second]), [
        "data:image/png;base64,AAAA",
        "data:image/png;base64,AAAA"
    ]);
    assert.equal(attempts, 1);
});
