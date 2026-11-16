import test from "node:test";
import assert from "node:assert/strict";
import PrizeCreditQueue from "../lib/prize-credit-queue.js";
import retryLegacyRouletteCredits from "../lib/legacy-roulette-credits.js";

function memoryStorage() {
    const data = new Map();
    return {
        getItem: key => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value)
    };
}

test("retries a lost response using the original transaction id after reload", async () => {
    const storage = memoryStorage();
    const attempts = [];
    const errors = [];
    const confirmed = [];
    const options = {
        storage,
        key: "queue",
        award: async item => {
            attempts.push(item.transactionId);
            if (attempts.length === 1) throw new Error("connexion interrompue");
            return { stars: 10 };
        },
        onConfirmed: item => confirmed.push(item),
        onError: (item, error) => errors.push(error.message)
    };
    const first = new PrizeCreditQueue(options);
    const item = first.enqueue({ username: "test", amount: 10, kind: "carte" });
    await first.flush();
    assert.deepEqual(errors, ["connexion interrompue"]);
    assert.equal(JSON.parse(storage.getItem("queue")).length, 1);
    const second = new PrizeCreditQueue(options);
    await second.flush();
    assert.deepEqual(attempts, [item.transactionId, item.transactionId]);
    assert.equal(confirmed.length, 1);
    assert.deepEqual(JSON.parse(storage.getItem("queue")), []);
});

test("retries roulette awards for the same senders and amounts after reload", async () => {
    const storage = memoryStorage();
    const attempts = [];
    const confirmed = [];
    const options = {
        storage,
        key: "roulette-queue",
        award: async item => {
            attempts.push({
                transactionId: item.transactionId,
                username: item.username,
                amount: item.amount
            });
            if (attempts.length === 1) throw new Error("connexion interrompue");
            return { stars: item.amount };
        },
        onConfirmed: item => confirmed.push(item),
        onError: () => {}
    };
    const first = new PrizeCreditQueue(options);
    const aliceAward = first.enqueue({ username: "alice", amount: 100, kind: "roulette" });
    first.enqueue({ username: "bob", amount: 1, kind: "roulette" });
    await first.flush();

    const second = new PrizeCreditQueue(options);
    await second.flush();

    assert.deepEqual(attempts.map(({ username, amount }) => [username, amount]), [
        ["alice", 100],
        ["alice", 100],
        ["bob", 1]
    ]);
    assert.equal(attempts[0].transactionId, aliceAward.transactionId);
    assert.equal(attempts[1].transactionId, aliceAward.transactionId);
    assert.deepEqual(confirmed.map(({ username, amount }) => [username, amount]), [
        ["alice", 100],
        ["bob", 1]
    ]);
    assert.deepEqual(JSON.parse(storage.getItem("roulette-queue")), []);
});

test("does not submit a reward when it cannot be saved", async () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error("stockage indisponible"); };
    let awards = 0;
    const queue = new PrizeCreditQueue({
        storage,
        key: "queue",
        award: async () => { awards++; },
        onConfirmed: () => {},
        onError: () => {}
    });
    assert.throws(() => queue.enqueue({ username: "test", amount: 1, kind: "carte" }), /stockage indisponible/);
    await queue.flush();
    assert.equal(awards, 0);
});

test("does not submit the same pending reward concurrently", async () => {
    const storage = memoryStorage();
    let awards = 0;
    let finish;
    const queue = new PrizeCreditQueue({
        storage,
        key: "queue",
        award: () => {
            awards++;
            return new Promise(resolve => { finish = resolve; });
        },
        onConfirmed: () => {},
        onError: () => {}
    });
    queue.enqueue({ username: "test", amount: 1, kind: "carte" });
    const first = queue.flush();
    await queue.flush();
    assert.equal(awards, 1);
    finish({ stars: 1 });
    await first;
    assert.deepEqual(JSON.parse(storage.getItem("queue")), []);
});

test("retries previously won roulette credits after removing the roulette", async () => {
    const storage = memoryStorage();
    const key = "coin-pusher-2000-gift-roulette-credits-v1";
    storage.setItem(key, JSON.stringify([
        { transactionId: "coin-pusher:previous", username: "alice", amount: 10, kind: "roulette" }
    ]));
    const attempts = [];
    const events = [];
    let retry;
    globalThis.localStorage = storage;
    globalThis.CustomEvent = class {
        constructor(type, options) { this.type = type; this.detail = options.detail; }
    };
    globalThis.window = {
        ArcadeStars: {
            async award(prize) {
                attempts.push(prize);
                if (attempts.length === 1) throw new Error("connexion interrompue");
                return { stars: 10 };
            }
        },
        dispatchEvent: event => events.push(event),
        addEventListener() {},
        setInterval() {},
        setTimeout: callback => { retry = callback; return 1; }
    };
    const originalError = console.error;
    console.error = () => {};
    try {
        retryLegacyRouletteCredits();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(JSON.parse(storage.getItem(key)).length, 1);
        assert.equal(typeof retry, "function");
        retry();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(attempts.map(item => item.transactionId), [
            "coin-pusher:previous", "coin-pusher:previous"
        ]);
        assert.deepEqual(JSON.parse(storage.getItem(key)), []);
        assert.equal(events.find(event => event.type === "coin-pusher-prize-awarded").detail.username, "alice");
    } finally {
        console.error = originalError;
        delete globalThis.window;
        delete globalThis.localStorage;
        delete globalThis.CustomEvent;
    }
});
