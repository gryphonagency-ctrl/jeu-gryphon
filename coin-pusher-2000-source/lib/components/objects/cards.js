import { Vector3, Quaternion, Matrix4, Euler, InstancedMesh } from "three";
import { createPrizeCardLabel, lookupPrizeAvatar } from "../../prize-card-label.js";
import { expandInstancedMeshes } from "./expand-instanced-meshes.js";

const TYPE = "card";
const MAX_INSTANCES = 8;
const WIDTH = 0.175;
const HEIGHT = 0.11;
const DEPTH = 0.005;
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
const FRICTION = 0.2;
const RESTITUTION = 0.1;
const DENSITY = 1;
const MODEL_PATH = "./assets/card.glb";
const COLORS = [
    { color: 0xffffff, background: 0x0031e7 },
    { color: 0xffffff, background: 0x00b802 },
    { color: 0xffffff, background: 0xffc107 },
    { color: 0xffffff, background: 0xba0014 },
    { color: 0xffffff, background: 0x5400e7 },
    { color: 0xffffff, background: 0xe74200 },
    { color: 0x000000, background: 0xffffff }
];
const TYPES = COLORS.length;

export default class {

    static TYPE = TYPE;
    static MAX_INSTANCES = MAX_INSTANCES;
    static TYPES = TYPES;

    static #scene;
    static #meshes;
    static #instances;
    static #groups;

    static async initialize({ scene, groups }) {
        this.#scene = scene;
        this.#groups = groups;
        const { materials, geometries } = await initializeModel({ scene });
        this.#meshes = initializeInstancedMeshes({ scene, materials, geometries });
        this.#instances = [];
        createInstances({ scene, instances: this.#instances, groups });
    }

    static getCard({ type, index }) {
        return this.#instances[type][index];
    }

    static hasAvailableInstance(type) {
        return this.#instances[type]?.some(instance => !instance.used) === true;
    }

    static async loadPrizeAvatar(instance, username) {
        const label = instance.prizeLabel;
        if (!instance.used || !label) return false;
        const avatarUrl = await lookupPrizeAvatar(username);
        if (instance.used && instance.prizeLabel === label) {
            label.setAvatarUrl(avatarUrl);
            return true;
        }
        return false;
    }

    static update() {
        for (let type = 0; type < TYPES; type++) {
            for (const instance of this.#instances[type]) {
                if (instance.used) {
                    update({
                        instance,
                        meshes: this.#meshes[type]
                    });
                }
            }
        }
    }

    static refresh() {
        for (let type = 0; type < TYPES; type++) {
            this.#meshes[type].forEach(mesh => mesh.instanceMatrix.needsUpdate = true);
        }
    }

    static getSize() {
        return {
            width: WIDTH,
            height: HEIGHT,
            depth: DEPTH
        };
    }

    static deposit({ type, position, rotation, prize, onAvatarError }) {
        let instance = this.#instances[type].find(instance => !instance.used);
        if (!instance) {
            this.#ensureTypeCapacity(type, this.#instances[type].length + 1);
            instance = createInstance({
                scene: this.#scene,
                type,
                instances: this.#instances,
                groups: this.#groups
            });
        }
        instance.used = true;
        if (prize) {
            instance.prizeLabel = createPrizeCardLabel({
                ...prize, width: WIDTH, height: HEIGHT, depth: DEPTH, onAvatarError
            });
            this.#scene.addObject(instance.prizeLabel.group, { upperDeck: true });
            instance.prizeLabel.group.traverse(object => {
                if (object.isMesh) {
                    object.castShadow = false;
                    object.receiveShadow = false;
                }
            });
        }
        initializePosition({ instance, position, rotation });
        instance.body.setEnabled(true);
        update({ instance, meshes: this.#meshes[type] });
        return instance;
    }

    static recycle(instance) {
        instance.prizeLabel?.dispose();
        instance.prizeLabel = null;
        instance.used = false;
        instance.body.setEnabled(false);
        initializePosition({ instance, hidden: true });
        update({
            instance,
            meshes: this.#meshes[instance.type]
        });
    }

    static get dynamicBodies() {
        const instances = [];
        for (let type = 0; type < TYPES; type++) {
            for (const instance of this.#instances[type]) {
                if (instance.used) {
                    instances.push({ object: instance, objects: this, body: instance.body });
                }
            }
        }
        return instances;
    }

    static save() {
        return this.#instances.map(type => {
            return type.map(instance => {
                return {
                    position: instance.position.toArray(),
                    rotation: instance.rotation.toArray(),
                    used: instance.used,
                    bodyHandle: this.#instances[instance.type][instance.index].body.handle
                };
            });
        });
    }

    static load(cards) {
        cards.forEach((type, indexType) => {
            for (const card of this.#instances[indexType]) {
                card.prizeLabel?.dispose();
                card.prizeLabel = null;
            }
            this.#ensureTypeCapacity(indexType, type.length);
            this.#instances[indexType] = [];
            type.forEach((instance, instanceIndex) => {
                const body = this.#scene.worldBodies.get(instance.bodyHandle);
                if (!body) throw new Error(`Impossible de restaurer le corps de la carte ${indexType}:${instanceIndex}.`);
                const card = createInstance({
                    scene: this.#scene,
                    type: indexType,
                    instances: this.#instances,
                    existingBody: body
                });
                card.position.fromArray(instance.position);
                card.rotation.fromArray(instance.rotation);
                card.used = instance.used;
                update({
                    instance: card,
                    meshes: this.#meshes[indexType]
                });
            });
            for (let index = type.length; index < this.#meshes[indexType][0].count; index++) {
                for (const mesh of this.#meshes[indexType]) mesh.setMatrixAt(index, INITIAL_HIDDEN_MATRIX);
            }
            for (const mesh of this.#meshes[indexType]) mesh.instanceMatrix.needsUpdate = true;
        });
    }

    static #ensureTypeCapacity(type, capacity) {
        const meshes = this.#meshes[type];
        const currentCapacity = meshes[0].count;
        if (capacity <= currentCapacity) return;
        this.#meshes[type] = expandInstancedMeshes({
            scene: this.#scene,
            meshes,
            capacity: Math.max(capacity, currentCapacity * 2),
            upperDeck: true
        });
    }
}

async function initializeModel({ scene }) {
    const model = await scene.loadModel(MODEL_PATH);
    const meshes = model.scene.children;
    const materials = [];
    const geometries = [];
    for (let type = 0; type < meshes.length; type++) {
        const mesh = meshes[type];
        const colorMaterial = mesh.children[0].material.clone();
        colorMaterial.color.setHex(COLORS[type].color);
        const backgroundMaterial = mesh.children[1].material.clone();
        backgroundMaterial.color.setHex(COLORS[type].background);
        materials.push([colorMaterial, backgroundMaterial]);
        geometries.push([mesh.children[0].geometry, mesh.children[1].geometry]);
    }
    return {
        materials,
        geometries
    };
}

function initializeInstancedMeshes({ scene, materials, geometries }) {
    const meshes = [];
    for (let type = 0; type < TYPES; type++) {
        const typeMeshes = [];
        for (let indexMaterial = 0; indexMaterial < materials[type].length; indexMaterial++) {
            const mesh = new InstancedMesh(geometries[type][indexMaterial], materials[type][indexMaterial], MAX_INSTANCES);
            for (let indexInstance = 0; indexInstance < MAX_INSTANCES; indexInstance++) {
                mesh.setMatrixAt(indexInstance, INITIAL_HIDDEN_MATRIX);
            }
            scene.addObject(mesh, { upperDeck: true });
            typeMeshes.push(mesh);
        }
        meshes.push(typeMeshes);
    }
    return meshes;
}

function createInstances({ scene, instances, groups }) {
    for (let type = 0; type < TYPES; type++) {
        instances[type] = [];
        for (let indexInstance = instances[type].length; indexInstance < MAX_INSTANCES; indexInstance++) {
            createInstance({ scene, type, instances, groups });
        }
    }
}

function createInstance({ scene, type, instances, groups, existingBody = null }) {
    const body = existingBody ?? scene.createDynamicBody();
    const index = instances[type].length;
    if (existingBody) {
        for (let indexCollider = 0; indexCollider < body.numColliders(); indexCollider++) {
            body.collider(indexCollider).userData = { objectType: TYPE, type, index };
        }
    } else {
        body.setEnabled(false);
        body.setSoftCcdPrediction(SOFT_CCD_PREDICTION);
        body.setAngularDamping(ANGULAR_DAMPING);
        body.setLinearDamping(LINEAR_DAMPING);
        body.setAdditionalSolverIterations(ADDITIONAL_SOLVER_ITERATIONS);
        const collider = scene.createCuboidCollider({
            userData: { objectType: TYPE, type, index },
            width: WIDTH,
            height: DEPTH,
            depth: HEIGHT,
            friction: FRICTION,
            restitution: RESTITUTION,
            density: DENSITY
        }, body);
        collider.setCollisionGroups(groups.OBJECTS << 16 | groups.ALL);
    }
    const instance = {
        objectType: TYPE,
        index,
        type,
        position: new Vector3(),
        rotation: new Quaternion(),
        body,
        matrix: new Matrix4(),
        used: false
    };
    instances[type].push(instance);
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
    if (instance.prizeLabel) {
        instance.prizeLabel.group.position.copy(instance.position);
        instance.prizeLabel.group.quaternion.copy(instance.rotation);
    }
}