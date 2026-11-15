import { InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";

const HIDDEN_MATRIX = new Matrix4().compose(new Vector3(), new Quaternion(), new Vector3());

export function expandInstancedMeshes({ scene, meshes, capacity, upperDeck = false }) {
    return meshes.map(mesh => {
        if (mesh.count >= capacity) return mesh;

        const expanded = new InstancedMesh(mesh.geometry, mesh.material, capacity);
        const matrix = new Matrix4();
        for (let index = 0; index < mesh.count; index++) {
            mesh.getMatrixAt(index, matrix);
            expanded.setMatrixAt(index, matrix);
        }
        for (let index = mesh.count; index < capacity; index++) {
            expanded.setMatrixAt(index, HIDDEN_MATRIX);
        }
        expanded.instanceMatrix.needsUpdate = true;

        scene.removeObject(mesh);
        mesh.dispose();
        scene.addObject(expanded, { upperDeck });
        return expanded;
    });
}
