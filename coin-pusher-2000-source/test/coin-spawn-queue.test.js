import test from "node:test";
import assert from "node:assert/strict";
import CoinSpawnQueue from "../lib/coin-spawn-queue.js";

test("three gifts spawn one coin per player in the same interval on separate slots", () => {
    const queue = new CoinSpawnQueue();
    for (const username of ["alice", "bob", "chris"]) {
        queue.enqueue({ remaining: 1000, username, avatarKey: username, slot: null });
    }

    const drops = queue.takeNext(3);

    assert.deepEqual(drops.map(({ batch }) => batch.username), ["alice", "bob", "chris"]);
    assert.deepEqual(drops.map(({ slot }) => slot), [0, 1, 2]);
    assert.deepEqual(drops.map(({ batch }) => batch.avatarKey), ["alice", "bob", "chris"]);
    assert.equal(queue.pending, 2997);
});

test("more than three players take turns instead of waiting for earlier batches to finish", () => {
    const queue = new CoinSpawnQueue();
    for (const username of ["alice", "bob", "chris", "dana", "eli"]) {
        queue.enqueue({ remaining: 1000, username, slot: null });
    }

    const firstInterval = queue.takeNext(3);
    const secondInterval = queue.takeNext(3);

    assert.deepEqual(firstInterval.map(({ batch }) => batch.username), ["alice", "bob", "chris"]);
    assert.deepEqual(secondInterval.map(({ batch }) => batch.username), ["dana", "eli", "alice"]);
    assert.equal(queue.pending, 4994);
});

test("all thousand coins in a single gift remain scheduled and rotate across the three slots", () => {
    const queue = new CoinSpawnQueue();
    queue.enqueue({ remaining: 1000, username: "alice", slot: null });
    const spawnedSlots = [0, 0, 0];
    let spawned = 0;

    while (queue.pending) {
        const [{ slot }] = queue.takeNext(3);
        spawnedSlots[slot]++;
        spawned++;
    }

    assert.equal(spawned, 1000);
    assert.deepEqual(spawnedSlots, [334, 333, 333]);
    assert.equal(queue.pending, 0);
});
