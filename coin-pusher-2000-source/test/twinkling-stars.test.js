import test from "node:test";
import assert from "node:assert/strict";
import createTwinklingStars from "../lib/components/twinkling-stars.js";

test("les étoiles scintillantes couvrent toute la largeur et la hauteur du plateau arrière", () => {
    let points;
    const stars = createTwinklingStars({
        addObject(object) {
            points = object;
        }
    });
    const positions = points.geometry.attributes.position.array;
    const xPositions = [];
    const yPositions = [];
    for (let index = 0; index < positions.length; index += 3) {
        xPositions.push(positions[index]);
        yPositions.push(positions[index + 1]);
    }
    assert.equal(points.geometry.attributes.position.count, 192);
    assert.ok(Math.min(...xPositions) < -1.25);
    assert.ok(Math.max(...xPositions) > 1.25);
    assert.ok(Math.min(...yPositions) < 0.72);
    assert.ok(Math.max(...yPositions) > 1.54);
    stars.update(0.5);
    assert.equal(points.material.uniforms.uTime.value, 0.5);
});
