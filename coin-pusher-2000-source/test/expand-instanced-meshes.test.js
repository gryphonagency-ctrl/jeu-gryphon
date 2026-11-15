import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial } from "three";
import { expandInstancedMeshes } from "../lib/components/objects/expand-instanced-meshes.js";

test("expands prize meshes and preserves existing transforms", () => {
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 2);
    const expected = new Matrix4().makeTranslation(3, 4, 5);
    mesh.setMatrixAt(1, expected);
    const added = [];
    const removed = [];
    const scene = {
        addObject(object, options) {
            added.push({ object, options });
        },
        removeObject(object) {
            removed.push(object);
        }
    };

    const [expanded] = expandInstancedMeshes({
        scene,
        meshes: [mesh],
        capacity: 4,
        upperDeck: true
    });
    const actual = new Matrix4();
    expanded.getMatrixAt(1, actual);

    assert.equal(expanded.count, 4);
    assert.deepEqual(actual.elements, expected.elements);
    assert.equal(removed[0], mesh);
    assert.equal(added[0].object, expanded);
    assert.deepEqual(added[0].options, { upperDeck: true });
    expanded.geometry.dispose();
    expanded.material.dispose();
});
