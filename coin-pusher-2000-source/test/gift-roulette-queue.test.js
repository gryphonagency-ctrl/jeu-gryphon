import test from "node:test";
import assert from "node:assert/strict";
import GiftRouletteQueue, { MAX_GIFT_COIN_COUNT } from "../lib/gift-roulette-queue.js";

test("tracks one symbol turn for each gift coin, including the 44,000 coin maximum", () => {
    const queue = new GiftRouletteQueue();
    queue.enqueue("alice", 100);
    queue.enqueue("bob", MAX_GIFT_COIN_COUNT);

    assert.equal(queue.pendingTurns, 44100);
    assert.deepEqual(queue.entries, [
        { username: "alice", remaining: 100 },
        { username: "bob", remaining: 44000 }
    ]);

    for (let turn = 0; turn < 100; turn++) {
        assert.equal(queue.consume("alice"), true);
    }
    assert.equal(queue.consume("alice"), false);
    assert.equal(queue.pendingTurns, MAX_GIFT_COIN_COUNT);
});

test("combines repeat gifts by username and ignores non-gift coin spawns", () => {
    const queue = new GiftRouletteQueue();
    queue.enqueue("@Alice", 1);
    queue.enqueue("alice", 2);

    assert.equal(queue.consume(""), false);
    assert.equal(queue.consume("unknown"), false);
    assert.deepEqual(queue.entries, [{ username: "Alice", remaining: 3 }]);
    assert.equal(queue.consume("ALICE"), true);
    assert.equal(queue.pendingTurns, 2);
});

test("keeps simulated and real turns distinguishable when gifts share a username", () => {
    const queue = new GiftRouletteQueue();
    queue.enqueue("alice", 2, { simulation: true });
    queue.enqueue("alice", 1, { creditable: false });
    queue.enqueue("alice", 2);

    assert.deepEqual(queue.entries, [{ username: "alice", remaining: 5 }]);
    assert.deepEqual(queue.consumeTurn("alice"), { simulation: true, creditable: true });
    assert.deepEqual(queue.consumeTurn("alice"), { simulation: true, creditable: true });
    assert.deepEqual(queue.consumeTurn("alice"), { simulation: false, creditable: false });
    assert.deepEqual(queue.consumeTurn("alice"), { simulation: false, creditable: true });
    assert.deepEqual(queue.consumeTurn("alice"), { simulation: false, creditable: true });
    assert.equal(queue.consumeTurn("alice"), null);
});

test("rejects gift counts outside the supported range", () => {
    const queue = new GiftRouletteQueue();

    assert.throws(() => queue.enqueue("alice", 0), RangeError);
    assert.throws(() => queue.enqueue("alice", MAX_GIFT_COIN_COUNT + 1), RangeError);
});
