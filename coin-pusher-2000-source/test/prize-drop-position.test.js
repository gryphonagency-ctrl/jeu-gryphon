import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { getPrizeDropPosition } from "../lib/prize-drop-position.js";

test("les cartes sont réparties dans la zone du poussoir supérieur", () => {
    const center = new Vector3(0, 0.5, 1);
    const size = { width: 0.175, height: 0.11 };
    const left = getPrizeDropPosition(center, size, { random: () => 0 });
    const right = getPrizeDropPosition(center, size, { random: () => 1 });

    assert.ok(left.x - center.x >= -0.1875 - 1e-12 && left.x - center.x <= 0.1875 + 1e-12);
    assert.ok(left.z - center.z >= -0.045 - 1e-12 && left.z - center.z <= 0.045 + 1e-12);
    assert.ok(right.x - center.x >= -0.1875 - 1e-12 && right.x - center.x <= 0.1875 + 1e-12);
    assert.ok(right.z - center.z >= -0.045 - 1e-12 && right.z - center.z <= 0.045 + 1e-12);
    assert.equal(left.y, center.y);
    assert.equal(right.y, center.y);
    assert.notDeepEqual(left.toArray(), right.toArray());
});

test("les récompenses manuelles commencent au-dessus de la zone de chute", () => {
    const center = new Vector3(0, 0.18, -0.2);
    const position = getPrizeDropPosition(center, { width: 0.1, height: 0.1 }, {
        random: () => 0.5,
        height: 1.5
    });

    assert.equal(position.y, 1.68);
    assert.equal(position.x, center.x);
    assert.equal(position.z, center.z);
});
