import test from "node:test";
import assert from "node:assert/strict";
import PrizeCreditQueue from "../lib/prize-credit-queue.js";

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
