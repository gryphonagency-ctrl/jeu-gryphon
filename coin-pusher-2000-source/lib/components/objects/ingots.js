import { Vector3, Quaternion, Matrix4, Euler, InstancedMesh } from "three";
import { expandInstancedMeshes } from "./expand-instanced-meshes.js";

const TYPE = "ingot";
const MAX_INSTANCES = 8;
const WIDTH = 0.15;
const HEIGHT = 0.075;
const DEPTH = 0.02;
const INITIAL_POSITION = [0, .6, .5];
const INITIAL_HIDDEN_POSITION = [0, 0, 0];
const INITIAL_HIDDEN_ROTATION = [0, 0, 0, 1];
const INITIAL_HIDDEN_LINEAR_VELOCITY = new Vector3(0, 0, 0);
const INITIAL_HIDDEN_ANGULAR_VELOCITY = new Vector3(0, 0, 0);
const INITIAL_SCALE = new Vector3(0, 0, 0);
const INITIAL_HIDDEN_MATRIX = new Matrix4().compose(
    new Vector3(...INITIAL_HIDDEN_POSITION),
    new Quaternion().fromArray(INITIAL_HIDDEN_ROTATION),
    INITIAL_SCALE
);
const DEFAULT_SCALE = new Vector3(1, 1, 1);
const EULER_ROTATION = new Euler(0, 0, 0);
const SOFT_CCD_PREDICTION = Math.max(WIDTH, HEIGHT, DEPTH);
const ADDITIONAL_SOLVER_ITERATIONS = 0;
const ANGULAR_DAMPING = 0;
const LINEAR_DAMPING = 0;
const FRICTION = 0.05;
const RESTITUTION = 0;
const DENSITY = 3;
const MODEL_PATH = "./assets/ingot.glb";

export default class {

    static TYPE = TYPE;
    static MAX_INSTANCES = MAX_INSTANCES;

    static #scene;
    static #meshes;
    static #instances;
    static #groups;
    static #colliderData;

    static async initialize({ scene, groups }) {
        this.#scene = scene;
        this.#groups = groups;
        const { materials, geometries } = await initializeModel({ scene });
        this.#meshes = initializeInstancedMeshes({ scene, materials, geometries });
        this.#instances = [];
        this.#colliderData = scene.mergeGeometries(geometries);
        createInstances({
            scene,
            instances: this.#instances,
            colliderData: this.#colliderData,
            groups
        });
    }

    static getIngot({ index }) {
        return this.#instances[index];
    }

    static hasAvailableInstance() {
        return this.#instances.some(instance => !instance.used);
    }

    static update() {
        for (const instance of this.#instances) {
            if (instance.used) {
                update({
                    instance,
                    meshes: this.#meshes
                });
            }
        }
    }

    static refresh() {
        this.#meshes.forEach(mesh => mesh.instanceMatrix.needsUpdate = true);
    }

    static getSize() {
        return {
            width: WIDTH,
            height: HEIGHT,
            depth: DEPTH
        };
    }

    static deposit({ position, rotation }) {
        let instance = this.#instances.find(instance => !instance.used);
        if (!instance) {
            this.#ensureCapacity(this.#instances.length + 1);
            instance = createInstance({
                scene: this.#scene,
                instances: this.#instances,
                colliderData: this.#colliderData,
                groups: this.#groups
            });
        }
        instance.used = true;
        initializePosition({ instance, position, rotation });
        instance.body.setEnabled(true);
        update({ instance, meshes: this.#meshes });
        return instance;
    }

    static recycle(instance) {
        instance.used = false;
        instance.body.setEnabled(false);
        initializePosition({ instance, hidden: true });
        update({
            instance,
            meshes: this.#meshes
        });
    }

    static get dynamicBodies() {
        const instances = [];
        for (const instance of this.#instances) {
            if (instance.used) {
                instances.push({ object: instance, objects: this, body: instance.body });
            }
        }
        return instances;
    }

    static save() {
        return this.#instances.map(instance => {
            return {
                position: instance.position.toArray(),
                rotation: instance.rotation.toArray(),
                used: instance.used,
                bodyHandle: this.#instances[instance.index].body.handle
            };
        });
    }

    static load(ingots) {
        this.#ensureCapacity(ingots.length);
        this.#instances = [];
        ingots.forEach((instance, instanceIndex) => {
            const body = this.#scene.worldBodies.get(instance.bodyHandle);
            if (!body) throw new Error(`Impossible de restaurer le corps du lingot ${instanceIndex}.`);
            const ingot = createInstance({
                scene: this.#scene,
                instances: this.#instances,
                existingBody: body
            });
            ingot.position.fromArray(instance.position);
            ingot.rotation.fromArray(instance.rotation);
            ingot.used = instance.used;
            update({
                instance: ingot,
                meshes: this.#meshes
            });
        });
        for (let index = ingots.length; index < this.#meshes[0].count; index++) {
            for (const mesh of this.#meshes) mesh.setMatrixAt(index, INITIAL_HIDDEN_MATRIX);
        }
        for (const mesh of this.#meshes) mesh.instanceMatrix.needsUpdate = true;
    }

    static #ensureCapacity(capacity) {
        const currentCapacity = this.#meshes[0].count;
        if (capacity <= currentCapacity) return;
        this.#meshes = expandInstancedMeshes({
            scene: this.#scene,
            meshes: this.#meshes,
            capacity: Math.max(capacity, currentCapacity * 2),
            upperDeck: true
        });
    }
}

async function initializeModel({ scene }) {
    const model = await scene.loadModel(MODEL_PATH);
    const meshes = model.scene.children[0].children;
    const colorMaterial = meshes[0].material;
    const backgroundMaterial = meshes[1].material;
    return {
        materials: [colorMaterial, backgroundMaterial],
        geometries: [meshes[0].geometry, meshes[1].geometry]
    };
}

function initializeInstancedMeshes({ scene, materials, geometries }) {
    const meshes = [];
    for (let indexMaterial = 0; indexMaterial < materials.length; indexMaterial++) {
        const mesh = new InstancedMesh(geometries[indexMaterial], materials[indexMaterial], MAX_INSTANCES);
        for (let indexInstance = 0; indexInstance < MAX_INSTANCES; indexInstance++) {
            mesh.setMatrixAt(indexInstance, INITIAL_HIDDEN_MATRIX);
        }
        scene.addObject(mesh, { upperDeck: true });
        meshes.push(mesh);
    }
    return meshes;
}

function createInstances({ scene, instances, colliderData, groups }) {
    for (let indexInstance = instances.length; indexInstance < MAX_INSTANCES; indexInstance++) {
        createInstance({ scene, instances, colliderData, groups });
    }
}

function createInstance({ scene, instances, colliderData, groups, existingBody = null }) {
    const body = existingBody ?? scene.createDynamicBody();
    const index = instances.length;
    if (existingBody) {
        for (let indexCollider = 0; indexCollider < body.numColliders(); indexCollider++) {
            body.collider(indexCollider).userData = { objectType: TYPE, index };
        }
    } else {
        const { vertices, indices } = colliderData;
        body.setEnabled(false);
        body.setSoftCcdPrediction(SOFT_CCD_PREDICTION);
        body.setAngularDamping(ANGULAR_DAMPING);
        body.setLinearDamping(LINEAR_DAMPING);
        body.setAdditionalSolverIterations(ADDITIONAL_SOLVER_ITERATIONS);
        const collider = scene.createConvexHullCollider({
            userData: { objectType: TYPE, index },
            vertices,
            indices,
            friction: FRICTION,
            restitution: RESTITUTION,
            density: DENSITY
        }, body);
        collider.setCollisionGroups(groups.OBJECTS << 16 | groups.ALL);
    }
    const instance = {
        objectType: TYPE,
        index,
        position: new Vector3(),
        rotation: new Quaternion(),
        body,
        matrix: new Matrix4(),
        used: false
    };
    instances.push(instance);
    return instance;
}

function initializePosition({ instance, hidden, position, rotation, }) {
    if (hidden) {
        instance.position.fromArray(INITIAL_HIDDEN_POSITION);
        instance.rotation.fromArray(INITIAL_HIDDEN_ROTATION);
        instance.body.setLinvel(INITIAL_HIDDEN_LINEAR_VELOCITY, false);
        instance.body.setAngvel(INITIAL_HIDDEN_ANGULAR_VELOCITY, false);
    } else {
        if (position) {
            instance.position.copy(position);
        } else {
            instance.position.fromArray(INITIAL_POSITION);
        }
        if (rotation) {
            instance.rotation.setFromEuler(new Euler(rotation.x, rotation.y, rotation.z));
        } else {
            instance.rotation.setFromEuler(EULER_ROTATION);
        }
    }
    instance.body.setTranslation(instance.position);
    instance.body.setRotation(instance.rotation);
}

function update({ instance, meshes }) {
    instance.position.copy(instance.body.translation());
    instance.rotation.copy(instance.body.rotation());
    instance.matrix.compose(instance.position, instance.rotation, instance.used ? DEFAULT_SCALE : INITIAL_SCALE);
    meshes.forEach(mesh => mesh.setMatrixAt(instance.index, instance.matrix));
}