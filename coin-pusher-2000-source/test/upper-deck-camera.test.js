import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import createUpperDeckCamera from "../lib/components/output/upper-deck-camera.js";

test("the hidden camera looks straight down at the upper pusher", () => {
    const camera = createUpperDeckCamera(442 / 319);
    const direction = camera.getWorldDirection(new Vector3());

    assert.ok(camera.position.y > 0.24);
    assert.ok(camera.fov <= 30);
    assert.equal(camera.up.z, -1);
    assert.equal(camera.layers.mask, 1 << 1);
    assert.ok(direction.y < -0.99);
    assert.ok(Math.abs(direction.x) < 0.001);
    assert.ok(Math.abs(direction.z) < 0.001);
});
