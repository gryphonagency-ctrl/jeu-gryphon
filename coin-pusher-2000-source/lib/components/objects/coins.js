import {
    CanvasTexture,
    CircleGeometry,
    DoubleSide,
    InstancedBufferAttribute,
    InstancedMesh,
    Matrix4,
    MeshBasicMaterial,
    Quaternion,
    SRGBColorSpace,
    Vector3,
    Euler
} from "three";

const TYPE = "coin";
const MAX_INSTANCES = 1024;
const RADIUS = 0.03;
const DEPTH = 0.005;
const INITIAL_POSITION_MIN_DELTA_X = 0.015;
const INITIAL_POSITIONS_X = [-0.1125, 0, 0.1125];
const INITIAL_POSITION = [0, .9, -0.32 + DEPTH / 2];
const INITIAL_HIDDEN_POSITION = [0, 0, 0];
const INITIAL_HIDDEN_ROTATION = [0, 0, 0, 1];
const INITIAL_HIDDEN_LINEAR_VELOCITY = new Vector3(0, 0, 0);
const INITIAL_HIDDEN_ANGULAR_VELOCITY = new Vector3(0, 0, 0);
const INITIAL_SCALE = new Vector3(0, 0, 0);
const DEFAULT_SCALE = new Vector3(1, 1, 1);
const EULER_ROTATION = new Euler(Math.PI / 2, 0, 0);
const SPAWN_IMPULSE = new Vector3(0, -0.000025, 0);
const SOFT_CCD_PREDICTION = Math.max(RADIUS, DEPTH);
const ADDITIONAL_SOLVER_ITERATIONS = 1;
const ANGULAR_DAMPING = 0.5;
const LINEAR_DAMPING = 0.5;
const RESTITUTION = 0;
const MODEL_PATH = "./assets/coin.glb";
const SPAWN_TIME_DURATION = 8;
const AVATAR_ATLAS_GRID = 32;
const AVATAR_ATLAS_TILE_SIZE = 32;
const AVATAR_ATLAS_SIZE = AVATAR_ATLAS_GRID * AVATAR_ATLAS_TILE_SIZE;
const AVATAR_TILE_GUTTER = 1;
const AVATAR_RADIUS = RADIUS * 0.82;
const AVATAR_OFFSET = 0.0007;
const MAX_AVATAR_DATA_URI_LENGTH = 700000;

let friction = 0.2;
let density = 1;
const AVATAR_FACE_OFFSET = new Vector3();
const AVATAR_FACE_POSITION = new Vector3();
const AVATAR_FACE_ROTATION = new Quaternion();
const AVATAR_FACE_MATRIX = new Matrix4();
const AVATAR_FACE_FLIP = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
const HIDDEN_AVATAR_MATRIX = new Matrix4().compose(
    new Vector3(),
    new Quaternion(),
    INITIAL_SCALE
);

export default class {

    static TYPE = TYPE;
    static MAX_INSTANCES = MAX_INSTANCES;
    static RADIUS = RADIUS;
    static DEPTH = DEPTH;

    static #scene;
    static #meshes = [];
    static #instances = [];
    static #spawnedCoins = [];
    static #frameLastSpawn = 0;
    static #onSpawnedCoin;
    static #avatarMeshes = [];
    static #avatarContext;
    static #avatarTexture;
    static #avatarRectAttribute;
    static #avatarTiles = new Map();
    static #avatarFreeTiles = [];
    static #avatarImages = new Map();
    static #avatarLoading = new Set();

    static async initialize({ scene, onSpawnedCoin, groups }) {
        this.#scene = scene;
        this.#onSpawnedCoin = onSpawnedCoin;
        const { materials, geometries } = await initializeModel({ scene });
        this.#meshes = initializeInstancedMeshes({ scene, materials, geometries });
        const avatarLayer = initializeAvatarMeshes({ scene });
        this.#avatarMeshes = avatarLayer.meshes;
        this.#avatarContext = avatarLayer.context;
        this.#avatarTexture = avatarLayer.texture;
        this.#avatarRectAttribute = avatarLayer.rectAttribute;
        this.#avatarTiles.clear();
        this.#avatarFreeTiles = [];
        for (let index = AVATAR_ATLAS_GRID * AVATAR_ATLAS_GRID - 1; index >= 0; index--) {
            this.#avatarFreeTiles.push(index);
        }
        this.#avatarImages.clear();
        this.#avatarLoading.clear();
        this.#instances = [];
        createInstances({ scene, instances: this.#instances, groups });
    }

    static getCoin({ index }) {
        return this.#instances[index];
    }

    static update() {
        if (this.#spawnedCoins.length) {
            this.#frameLastSpawn++;
            if (this.#frameLastSpawn >= SPAWN_TIME_DURATION) {
                const instance = this.#instances.find(instance => !instance.used);
                if (instance) {
                    const batch = this.#spawnedCoins[0];
                    let slot = batch.slot;
                    if (slot === null) {
                        do {
                            slot = Math.floor(Math.random() * 3);
                        } while (slot === batch.lastSlot);
                        batch.lastSlot = slot;
                    }
                    batch.remaining--;
                    if (batch.remaining === 0) {
                        this.#spawnedCoins.shift();
                    }
                    instance.used = true;
                    instance.avatarKey = batch.avatarKey || null;
                    instance.avatarTile = instance.avatarKey
                        ? this.#avatarTiles.get(instance.avatarKey) ?? null
                        : null;
                    if (instance.avatarTile !== null) {
                        setAvatarRect(this.#avatarRectAttribute, instance.index, instance.avatarTile);
                    }
                    const randomNumber = Math.random();
                    const position = new Vector3(
                        INITIAL_POSITIONS_X[slot] + (randomNumber <= 0.5 ? -INITIAL_POSITION_MIN_DELTA_X : INITIAL_POSITION_MIN_DELTA_X) * Math.random(),
                        INITIAL_POSITION[1],
                        INITIAL_POSITION[2]
                    );
                    const rotation = EULER_ROTATION.clone();
                    rotation.x += Math.random() <= 0.5 ? Math.PI : 0;
                    initializePosition({ instance, slot, position, rotation });
                    instance.body.setEnabled(true);
                    instance.pendingImpulse = SPAWN_IMPULSE;
                    this.#onSpawnedCoin(instance);
                    this.#frameLastSpawn = 0;
                }
            }
        }
        for (const instance of this.#instances) {
            if (instance.used) {
                if (instance.pendingImpulse && instance.body.mass() > 0) {
                    instance.body.applyImpulse(instance.pendingImpulse, true);
                    instance.pendingImpulse = undefined;
                }
                update({
                    instance,
                    meshes: this.#meshes,
                    avatarMeshes: this.#avatarMeshes
                });
            }
        }
    }

    static refresh() {
        this.#meshes.forEach(mesh => mesh.instanceMatrix.needsUpdate = true);
        this.#avatarMeshes.forEach(mesh => mesh.instanceMatrix.needsUpdate = true);
    }

    static getSize() {
        return {
            width: RADIUS * 2,
            height: RADIUS * 2,
            depth: DEPTH
        }
    }

    static deposit({ position, rotation = new Vector3(0, 0, 0), impulse }) {
        const instance = this.#instances.find(instance => !instance.used);
        const previousAvatarKey = instance.avatarKey;
        instance.used = true;
        instance.avatarKey = null;
        instance.avatarTile = null;
        this.#releaseAvatarIfUnused(previousAvatarKey);
        initializePosition({ instance, position, rotation });
        instance.body.setEnabled(true);
        if (impulse) {
            instance.pendingImpulse = impulse.clone();
        }
        return instance;
    }

    static dropCoin({ slot }) {
        this.#spawnedCoins.push({ remaining: 1, slot, lastSlot: null });
    }

    static dropCoins({ count, avatarKey = "", avatarDataUri = "" }) {
        if (!Number.isSafeInteger(count) || count < 1) {
            return 0;
        }
        const normalizedAvatarKey = String(avatarKey || "").trim().toLocaleLowerCase().slice(0, 128);
        this.#spawnedCoins.push({
            remaining: count,
            slot: null,
            lastSlot: null,
            avatarKey: normalizedAvatarKey
        });
        if (normalizedAvatarKey && avatarDataUri) {
            this.setAvatar({ key: normalizedAvatarKey, dataUri: avatarDataUri });
        }
        return count;
    }

    static setAvatar({ key, dataUri }) {
        const normalizedKey = String(key || "").trim().toLocaleLowerCase().slice(0, 128);
        if (
            !normalizedKey ||
            typeof dataUri !== "string" ||
            dataUri.length > MAX_AVATAR_DATA_URI_LENGTH ||
            !/^data:image\/(?:jpeg|png|webp);base64,/i.test(dataUri)
        ) {
            console.warn("Photo de profil TikTok ignorée : format non valide ou trop volumineux.");
            return false;
        }
        if (!this.#hasAvatarReferences(normalizedKey)) {
            return false;
        }
        if (this.#avatarImages.has(normalizedKey) || this.#avatarLoading.has(normalizedKey)) {
            return true;
        }
        const image = new Image();
        this.#avatarLoading.add(normalizedKey);
        image.addEventListener("load", () => {
            this.#avatarLoading.delete(normalizedKey);
            if (!this.#hasAvatarReferences(normalizedKey)) {
                return;
            }
            this.#avatarImages.set(normalizedKey, image);
            this.#assignAvatarTile(normalizedKey);
        }, { once: true });
        image.addEventListener("error", () => {
            this.#avatarLoading.delete(normalizedKey);
            console.warn("Photo de profil TikTok illisible pour une pièce.");
        }, { once: true });
        image.src = dataUri;
        return true;
    }

    static get pendingCoins() {
        return this.#spawnedCoins.reduce((total, batch) => total + batch.remaining, 0);
    }

    static recycle(instance) {
        const previousAvatarKey = instance.avatarKey;
        instance.used = false;
        instance.avatarKey = null;
        instance.avatarTile = null;
        instance.body.setEnabled(false);
        initializePosition({ instance, hidden: true });
        update({ instance, meshes: this.#meshes, avatarMeshes: this.#avatarMeshes });
        this.#releaseAvatarIfUnused(previousAvatarKey);
    }

    static get dynamicBodies() {
        return this.#instances.filter(instance => instance.used).map(instance => ({ object: instance, objects: this, body: instance.body }));
    }

    static get usedCoins() {
        return this.#instances.filter(instance => instance.used).length;
    }

    static save() {
        return this.#instances.map(instance => {
            return {
                position: instance.position.toArray(),
                rotation: instance.rotation.toArray(),
                used: instance.used,
                avatarKey: instance.avatarKey,
                bodyHandle: this.#instances[instance.index].body.handle,
                pendingImpulse: instance.pendingImpulse ? instance.pendingImpulse.toArray() : undefined
            };
        });
    }

    static load(coins) {
        coins.forEach((instance, indexInstance) => {
            const body = this.#scene.worldBodies.get(instance.bodyHandle);
            this.#instances[indexInstance] = {
                ...this.#instances[indexInstance],
                position: new Vector3().fromArray(instance.position),
                rotation: new Quaternion().fromArray(instance.rotation),
                used: instance.used,
                avatarKey: typeof instance.avatarKey === "string" ? instance.avatarKey : null,
                avatarTile: this.#avatarTiles.get(instance.avatarKey) ?? null,
                body,
                pendingImpulse: instance.pendingImpulse ? new Vector3().fromArray(instance.pendingImpulse) : undefined,
            };
            if (this.#instances[indexInstance].avatarTile !== null) {
                setAvatarRect(
                    this.#avatarRectAttribute,
                    indexInstance,
                    this.#instances[indexInstance].avatarTile
                );
            }
            for (let indexCollider = 0; indexCollider < body.numColliders(); indexCollider++) {
                const collider = body.collider(indexCollider);
                collider.userData = {
                    objectType: TYPE,
                    index: indexInstance
                };
            }
            update({
                instance: this.#instances[indexInstance],
                meshes: this.#meshes,
                avatarMeshes: this.#avatarMeshes
            });
        });
    }

    static #hasAvatarReferences(key) {
        return this.#spawnedCoins.some(batch => batch.avatarKey === key && batch.remaining > 0) ||
            this.#instances.some(instance => instance.used && instance.avatarKey === key);
    }

    static #assignAvatarTile(key) {
        if (this.#avatarTiles.has(key)) {
            return true;
        }
        const image = this.#avatarImages.get(key);
        const tile = this.#avatarFreeTiles.pop();
        if (!image || tile === undefined) {
            return false;
        }
        this.#avatarTiles.set(key, tile);
        const x = (tile % AVATAR_ATLAS_GRID) * AVATAR_ATLAS_TILE_SIZE;
        const y = Math.floor(tile / AVATAR_ATLAS_GRID) * AVATAR_ATLAS_TILE_SIZE;
        const context = this.#avatarContext;
        context.clearRect(x, y, AVATAR_ATLAS_TILE_SIZE, AVATAR_ATLAS_TILE_SIZE);
        context.save();
        context.beginPath();
        context.arc(
            x + AVATAR_ATLAS_TILE_SIZE / 2,
            y + AVATAR_ATLAS_TILE_SIZE / 2,
            AVATAR_ATLAS_TILE_SIZE / 2 - AVATAR_TILE_GUTTER,
            0,
            Math.PI * 2
        );
        context.clip();
        const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
        context.drawImage(
            image,
            (image.naturalWidth - sourceSize) / 2,
            (image.naturalHeight - sourceSize) / 2,
            sourceSize,
            sourceSize,
            x + AVATAR_TILE_GUTTER,
            y + AVATAR_TILE_GUTTER,
            AVATAR_ATLAS_TILE_SIZE - AVATAR_TILE_GUTTER * 2,
            AVATAR_ATLAS_TILE_SIZE - AVATAR_TILE_GUTTER * 2
        );
        context.restore();
        this.#avatarTexture.needsUpdate = true;
        this.#instances.forEach(instance => {
            if (instance.used && instance.avatarKey === key) {
                instance.avatarTile = tile;
                setAvatarRect(this.#avatarRectAttribute, instance.index, tile);
            }
        });
        return true;
    }

    static #activateWaitingAvatars() {
        if (!this.#avatarFreeTiles.length) {
            return;
        }
        for (const key of this.#avatarImages.keys()) {
            if (this.#avatarFreeTiles.length && this.#hasAvatarReferences(key)) {
                this.#assignAvatarTile(key);
            }
        }
    }

    static #releaseAvatarIfUnused(key) {
        if (!key || this.#hasAvatarReferences(key)) {
            return;
        }
        const tile = this.#avatarTiles.get(key);
        if (tile !== undefined) {
            this.#avatarTiles.delete(key);
            this.#avatarFreeTiles.push(tile);
            const x = (tile % AVATAR_ATLAS_GRID) * AVATAR_ATLAS_TILE_SIZE;
            const y = Math.floor(tile / AVATAR_ATLAS_GRID) * AVATAR_ATLAS_TILE_SIZE;
            this.#avatarContext.clearRect(x, y, AVATAR_ATLAS_TILE_SIZE, AVATAR_ATLAS_TILE_SIZE);
            this.#avatarTexture.needsUpdate = true;
        }
        this.#avatarImages.delete(key);
        this.#activateWaitingAvatars();
    }

    static enableCcd(instance, enabled) {
        if (instance && instance.body) {
            instance.body.enableCcd(enabled);
        }
    }

    static get friction() {
        return friction;
    }

    static set friction(value) {
        friction = value;
        this.#instances.forEach(instance => {
            instance.body.collider(0).setFriction(value);
        });
    }

    static get density() {
        return density;
    }

    static set density(value) {
        density = value;
        this.#instances.forEach(instance => {
            instance.body.collider(0).setDensity(value);
        });
    }
}

async function initializeModel({ scene }) {
    const model = await scene.loadModel(MODEL_PATH);
    model.scene.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
    const mesh = model.scene.children[0];
    const baseColorMaterial = mesh.children[0].material;
    const colorMaterial = mesh.children[1].material;
    const baseColorGeometry = mesh.children[0].geometry;
    const colorGeometry = mesh.children[1].geometry;
    colorMaterial.metalness = .35;
    baseColorMaterial.metalness = .2;
    return {
        materials: [baseColorMaterial, colorMaterial],
        geometries: [baseColorGeometry, colorGeometry]
    };
}

function initializeInstancedMeshes({ scene, materials, geometries }) {
    const meshes = [];
    for (let indexMaterial = 0; indexMaterial < materials.length; indexMaterial++) {
        const mesh = new InstancedMesh(geometries[indexMaterial], materials[indexMaterial], MAX_INSTANCES);
        for (let indexInstance = 0; indexInstance < MAX_INSTANCES; indexInstance++) {
            mesh.setMatrixAt(indexInstance, INITIAL_SCALE);
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.addObject(mesh);
        meshes.push(mesh);
    }
    return meshes;
}

function initializeAvatarMeshes({ scene }) {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_ATLAS_SIZE;
    canvas.height = AVATAR_ATLAS_SIZE;
    const context = canvas.getContext("2d");
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const geometry = new CircleGeometry(AVATAR_RADIUS, 32);
    geometry.rotateX(-Math.PI / 2);
    const rectAttribute = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4);
    geometry.setAttribute("avatarRect", rectAttribute);
    const material = new MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.01,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        side: DoubleSide
    });
    material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                "#include <common>\nattribute vec4 avatarRect;\nvarying vec2 vAvatarUv;"
            )
            .replace(
                "#include <uv_vertex>",
                "#include <uv_vertex>\nvAvatarUv = uv * avatarRect.zw + avatarRect.xy;"
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <common>",
                "#include <common>\nvarying vec2 vAvatarUv;"
            )
            .replace(
                "#include <map_fragment>",
                "vec4 sampledAvatar = texture2D(map, vAvatarUv);\ndiffuseColor *= sampledAvatar;"
            );
    };
    material.customProgramCacheKey = () => "coin-avatar-atlas-v1";
    const meshes = [];
    for (let index = 0; index < 2; index++) {
        const mesh = new InstancedMesh(geometry, material, MAX_INSTANCES);
        for (let instanceIndex = 0; instanceIndex < MAX_INSTANCES; instanceIndex++) {
            mesh.setMatrixAt(instanceIndex, HIDDEN_AVATAR_MATRIX);
        }
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = 1;
        scene.addObject(mesh);
        meshes.push(mesh);
    }
    return { context, texture, rectAttribute, meshes };
}

function setAvatarRect(attribute, instanceIndex, tile) {
    const column = tile % AVATAR_ATLAS_GRID;
    const row = Math.floor(tile / AVATAR_ATLAS_GRID);
    const innerTileSize = AVATAR_ATLAS_TILE_SIZE - AVATAR_TILE_GUTTER * 2;
    const inverseAtlasSize = 1 / AVATAR_ATLAS_SIZE;
    const offsetX = (column * AVATAR_ATLAS_TILE_SIZE + AVATAR_TILE_GUTTER) * inverseAtlasSize;
    const offsetY = 1 - (row * AVATAR_ATLAS_TILE_SIZE + AVATAR_TILE_GUTTER + innerTileSize) * inverseAtlasSize;
    const scale = innerTileSize * inverseAtlasSize;
    attribute.array.set([offsetX, offsetY, scale, scale], instanceIndex * 4);
    attribute.needsUpdate = true;
}

function createInstances({ scene, instances, groups }) {
    for (let indexInstance = instances.length; indexInstance < MAX_INSTANCES; indexInstance++) {
        createInstance({ scene, instances, groups });
    }
}

function createInstance({ scene, instances, groups }) {
    const body = scene.createDynamicBody();
    body.setEnabled(false);
    body.setSoftCcdPrediction(SOFT_CCD_PREDICTION);
    body.setAngularDamping(ANGULAR_DAMPING);
    body.setLinearDamping(LINEAR_DAMPING);
    body.setAdditionalSolverIterations(ADDITIONAL_SOLVER_ITERATIONS);
    const index = instances.length;
    const collider = scene.createCylinderCollider({
        userData: { objectType: TYPE, index },
        radius: RADIUS,
        height: DEPTH,
        friction: friction,
        restitution: RESTITUTION,
        density: density
    }, body);
    collider.setCollisionGroups(groups.OBJECTS << 16 | groups.ALL);
    const instance = {
        objectType: TYPE,
        index,
        position: new Vector3(),
        rotation: new Quaternion(),
        body,
        matrix: new Matrix4(),
        used: false,
        avatarKey: null,
        avatarTile: null,
        pendingImpulse: undefined
    };
    instances.push(instance);
    return instance;
}

function initializePosition({ instance, hidden, position, rotation }) {
    if (hidden) {
        instance.position.fromArray(INITIAL_HIDDEN_POSITION);
        instance.rotation.fromArray(INITIAL_HIDDEN_ROTATION);
        instance.body.setLinvel(INITIAL_HIDDEN_LINEAR_VELOCITY, false);
        instance.body.setAngvel(INITIAL_HIDDEN_ANGULAR_VELOCITY, false);
    } else {
        if (position) {
            instance.position.copy(position);
        }
        if (rotation) {
            instance.rotation.setFromEuler(new Euler(rotation.x, rotation.y, rotation.z));
        }
    }
    instance.body.setTranslation(instance.position);
    instance.body.setRotation(instance.rotation);
}

function update({ instance, meshes, avatarMeshes }) {
    instance.position.copy(instance.body.translation());
    instance.rotation.copy(instance.body.rotation());
    instance.matrix.compose(instance.position, instance.rotation, instance.used ? DEFAULT_SCALE : INITIAL_SCALE);
    meshes.forEach(mesh => mesh.setMatrixAt(instance.index, instance.matrix));
    if (avatarMeshes) {
        const hasAvatar = instance.used && instance.avatarTile !== null;
        avatarMeshes.forEach((mesh, index) => {
            const direction = index === 0 ? 1 : -1;
            AVATAR_FACE_OFFSET.set(0, direction * (DEPTH / 2 + AVATAR_OFFSET), 0)
                .applyQuaternion(instance.rotation);
            AVATAR_FACE_POSITION.copy(instance.position).add(AVATAR_FACE_OFFSET);
            AVATAR_FACE_ROTATION.copy(instance.rotation);
            if (index === 1) {
                AVATAR_FACE_ROTATION.multiply(AVATAR_FACE_FLIP);
            }
            AVATAR_FACE_MATRIX.compose(
                AVATAR_FACE_POSITION,
                AVATAR_FACE_ROTATION,
                hasAvatar ? DEFAULT_SCALE : INITIAL_SCALE
            );
            mesh.setMatrixAt(instance.index, AVATAR_FACE_MATRIX);
        });
    }
}