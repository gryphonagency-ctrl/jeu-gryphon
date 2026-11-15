import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { getPrizeDropPosition } from "../lib/prize-drop-position.js";

test("les cartes sont réparties dans la zone du poussoir supérieur", () => {
    const center = new Vector3(0, 0.5, 1);
    const size = { width: 0.175, height: 0.11 };
    const left = getPrizeDropPosition(center, size, () => 0);
    const right = getPrizeDropPosition(center, size, () => 1);

    assert.ok(left.x - center.x >= -0.1875 - 1e-12 && left.x - center.x <= 0.1875 + 1e-12);
    assert.ok(left.z - center.z >= -0.045 - 1e-12 && left.z - center.z <= 0.045 + 1e-12);
    assert.ok(right.x - center.x >= -0.1875 - 1e-12 && right.x - center.x <= 0.1875 + 1e-12);
    assert.ok(right.z - center.z >= -0.045 - 1e-12 && right.z - center.z <= 0.045 + 1e-12);
    assert.equal(left.y, center.y);
    assert.equal(right.y, center.y);
    assert.notDeepEqual(left.toArray(), right.toArray());
});
