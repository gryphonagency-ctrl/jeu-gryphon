import test from "node:test";
import assert from "node:assert/strict";
import { getAvailableInstances } from "../lib/components/objects/coins.js";

test("coin allocation returns only free instances when enough are available", () => {
    const instances = [{ used: true }, { used: false }, { used: false }];

    assert.deepEqual(getAvailableInstances(instances, 2), [instances[1], instances[2]]);
});

test("coin allocation fails safely when the pool cannot satisfy the full request", () => {
    const instances = [{ used: true }, { used: false }];

    assert.equal(getAvailableInstances(instances, 2), null);
});
