import { BoxGeometry, Mesh, PlaneGeometry } from "three";
import Wall from "./wall.js";
import Pusher from "./pusher.js";
import CollisionsDetector from "./util/collisions-detector.js";
import ObjectsDistributor from "./util/objects-distributor.js";
import Buttons from "./input/buttons.js";
import ControlPanel from "./input/control-panel.js";
import Screen from "./output/screen.js";
import Coins from "./objects/coins.js";
import Tokens from "./objects/tokens.js";
import Cards from "./objects/cards.js";
import Ingots from "./objects/ingots.js";
import SensorGate from "./gadgets/sensor-gate.js";
import Excavator from "./gadgets/excavator.js";
import Tower from "./gadgets/tower.js";
import CoinRoller from "./gadgets/coin-roller.js";
import Stacker from "./gadgets/stacker.js";
import MiniStacker from "./gadgets/mini-stacker.js";
import Sweepers from "./gadgets/sweepers.js";
import CardReader from "./gadgets/card-reader.js";
import TokenSlot from "./gadgets/token-slot.js";
import GiphyCharacter from "./giphy-character.js";

const MIN_POSITION_Y_OBJECTS = -1;
const MODEL_PATH = "./assets/cabinet.glb";
const SENSOR_HEIGHT = 0.2;
const HIDDEN_CABINET_LABELS = new Set([
    "label-coins-in-play",
    "coins-in-play",
    "label-score",
    "label-points",
    "label-coins"
]);
const CABINET_SURFACE_COVERS = [
    { position: [0, 0.16125, 1.25], width: 1.5, height: 0.008, depth: 0.24, rotation: [2 * Math.PI + Math.PI / 10, 0, 0] },
    { position: [0.85, 0.2, 0.785], width: 0.15, height: 0.006, depth: 0.1, rotation: [Math.PI / 2, 0, 0] }
];
const CABINET_PANEL_COVERS = [
    { position: [-0.785, 0.22, 0.795], width: 0.22, height: 0.14 }
];
const WALL_BACKGROUND_PATCHES = [
    {
        position: [-0.6925, 0.825, -0.319],
        width: 0.385,
        height: 0.34,
        u: [0.062, 0.252],
        v: [0.261, 0.559]
    },
    {
        position: [-0.21, 1.15, -0.319],
        width: 0.38,
        height: 0.17,
        u: [0.302, 0.49],
        v: [0.041, 0.194]
    },
    {
        position: [0.25, 1.15, -0.319],
        width: 0.3,
        height: 0.17,
        u: [0.55, 0.698],
        v: [0.041, 0.194]
    },
    {
        position: [0.85, 1.15, -0.319],
        width: 0.24,
        height: 0.17,
        u: [0.861, 0.98],
        v: [0.041, 0.194]
    }
];
const GROUPS = {
    OBJECTS:
        0b00000000000000001,
    CABINET:
        0b00000000000000010,
    EXCAVATOR:
        0b00000000000000100,
    EXCAVATOR_JAW1:
        0b00000000000001000,
    EXCAVATOR_JAW2:
        0b00000000000010000,
    EXCAVATOR_JAW3:
        0b00000000000100000,
    EXCAVATOR_JAW4:
        0b00000000001000000,
    TOWER:
        0b00000000010000000,
    COIN_ROLLER:
        0b00000000100000000,
    PUSHER:
        0b00000001000000000,
    FLOOR:
        0b00000010000000000,
    STACKER:
        0b00000100000000000,
    MINI_STACKER:
        0b00001000000000000,
    SWEEPERS:
        0b00010000000000000,
    WALL:
        0b00100000000000000,
    ALL:
        0b00111111111111111
};

export default class {

    DEBUG_AUTOPLAY = false;
    DEBUG_HIDE_CABINET = false;

    constructor({ scene, Runs, onCharacterStatus }) {
        this.#scene = scene;
        this.#Runs = Runs;
        this.#onCharacterStatus = onCharacterStatus;
    }

    #scene;
    #Runs;
    #cabinet = {
        state: {
            score: 0,
            points: 0,
            coins: 0
        }
    };
    #sensorColliders;
    #sensorListeners = {
        "left-trap": userData => this.recycleObject(userData),
        "right-trap": userData => this.recycleObject(userData),
        "gutter": (userData) => {
            this.recycleObject(userData);
            if (this.#runs.started) {
                if (userData.objectType === Coins.TYPE) {
                    this.#cabinet.state.score++;
                    this.#cabinet.state.points++;
                    this.#cabinet.state.coins++;
                }
                if (userData.objectType === Tokens.TYPE) {
                    this.#tokenSlot.readToken(this.getToken(userData));
                }
                if (userData.objectType === Cards.TYPE) {
                    this.#cardReader.readCard(this.getCard(userData));
                }
            }
        }
    };
    #floorAccessRules = new Map();
    #controlPanel;
    #pusher;
    #sensorGate;
    #collisionsDetector;
    #excavator;
    #leftTower;
    #rightTower;
    #coinRoller;
    #stacker;
    #leftStacker;
    #rightStacker;
    #sweepers;
    #screen;
    #character;
    #onCharacterStatus;
    #cardReader;
    #tokenSlot;
    #runs;
    #objectsDistributor;
    #parts;

    async initialize() {
        const scene = this.#scene;
        const { parts } = await initializeModel({
            scene,
            DEBUG_HIDE_CABINET: this.DEBUG_HIDE_CABINET
        });
        this.#parts = parts;
        this.#character = new GiphyCharacter({ scene, onStatus: this.#onCharacterStatus });
        void this.#character.initialize();
        const { sensorColliders } = initializeColliders({
            scene,
            sensorListeners: this.#sensorListeners,
            parts
        });
        this.#sensorColliders = sensorColliders;
        const wall = new Wall({ scene, groups: GROUPS });
        this.#controlPanel = new ControlPanel({
            onPressDropButton: slot => {
                if (this.#cabinet.state.coins) {
                    Coins.dropCoin({ slot });
                    this.#cabinet.state.coins--;
                }
            },
            onPressShootButton: () => {
                this.#coinRoller.triggerCoin();
            },
            onPressStartButton: () => this.#startGame(),
            onPressHoldButton: () => {
                this.#pusher.hold();
            }
        });
        this.#pusher = new Pusher({
            scene,
            onDeliverBonus: ({ position, reward }) => this.#objectsDistributor.deposit(position, [.55, .2], reward),
            onEnableHold: () => {
                if (this.#runs.started) {
                    this.#controlPanel.enableHoldButton();
                }
            },
            onDisableHold: () => {
                this.#controlPanel.disableHoldButton();
            },
            groups: GROUPS
        });
        this.#collisionsDetector = new CollisionsDetector({ scene, cabinet: this });
        this.#sensorGate = new SensorGate({
            scene,
            Coins,
            onFallenCoin: instance => Coins.enableCcd(instance, false),
            onBonusWon: () => {
                const random = Math.random();
                if (this.DEBUG_AUTOPLAY) {
                    const tokens = [];
                    const cards = [];
                    for (let i = 0; i < 5; i++) {
                        if (Math.random() < 0.5) {
                            tokens.push({ type: Math.floor(Math.random() * (Tokens.TYPES - 1)) });
                        }
                    }
                    for (let i = 0; i < 3; i++) {
                        if (Math.random() < 0.5) {
                            cards.push({ type: Math.floor(Math.random() * (Cards.TYPES - 1)) });
                        }
                    }
                    this.#pusher.deliverBonus(new Map([
                        [Coins, { length: 20 + Math.floor(Math.random() * 30) }],
                        [Tokens, tokens],
                        [Cards, cards],
                        [Ingots, { length: Math.random() < 0.5 ? 1 : 0 }]
                    ]));
                } else {
                    if (random < 1 / 6) {
                        this.#excavator.pick();
                    } else if (random < 2 / 6) {
                        this.#controlPanel.enableShootButton();
                        this.#coinRoller.shootCoin();
                    } else if (random < 3 / 6) {
                        this.#leftTower.shootCoins();
                        this.#rightTower.shootCoins();
                    } else if (random < 4 / 6) {
                        this.#leftStacker.deliver({ levels: 30 });
                        this.#rightStacker.deliver({ levels: 30 });
                    } else if (random < 5 / 6) {
                        this.#sweepers.sweepFloor({ level: 5 });
                    } else {
                        this.#stacker.deliver({ stacks: 7, levels: 15 });
                    }
                }
            }
        });
        this.#excavator = new Excavator({
            scene,
            cabinet: this,
            onPick: dropPosition => {
                const tokens = [];
                for (let i = 0; i < 1; i++) {
                    if (Math.random() < 0.5) {
                        tokens.push({ type: Math.floor(Math.random() * (Tokens.TYPES - 1)) });
                    }
                }
                return this.#objectsDistributor.deposit(dropPosition, [0, 0], new Map([
                    [Coins, { length: 30 + Math.floor(Math.random() * 10) }],
                    [Tokens, tokens]
                ]), { compacted: true, randomRotation: true, randomPosition: true });
            },
            groups: GROUPS
        });
        this.#leftTower = new Tower({
            scene,
            cabinet: this,
            offsetX: -.25,
            oscillationDirection: 1,
            onShootCoin: ({ position, impulse }) => Coins.deposit({ position, impulse }),
            groups: GROUPS
        });
        this.#rightTower = new Tower({
            scene,
            cabinet: this,
            offsetX: .25,
            oscillationDirection: -1,
            onShootCoin: ({ position, impulse }) => Coins.deposit({ position, impulse }),
            groups: GROUPS
        });
        this.#coinRoller = new CoinRoller({
            scene,
            cabinet: this,
            onInitializeCoin: ({ position, rotation }) => Coins.deposit({ position, rotation }),
            onGameLost: () => this.#controlPanel.disableShootButton(),
            onBonusWon: bonus => {
                Coins.dropCoins({ count: Math.pow(bonus + 1, 2) * 5 });
                this.#controlPanel.disableShootButton();
            },
            groups: GROUPS
        });
        this.#stacker = new Stacker({
            scene,
            cabinet: this,
            onInitializeCoin: ({ position, rotation, impulse }) => Coins.deposit({ position, rotation, impulse }),
            groups: GROUPS
        });
        this.#leftStacker = new MiniStacker({
            scene,
            cabinet: this,
            onInitializeCoin: ({ position, rotation, impulse }) => Coins.deposit({ position, rotation, impulse }),
            offsetX: -0.4,
            groups: GROUPS
        });
        this.#rightStacker = new MiniStacker({
            scene,
            cabinet: this,
            onInitializeCoin: ({ position, rotation, impulse }) => Coins.deposit({ position, rotation, impulse }),
            offsetX: 0.4,
            groups: GROUPS
        });
        this.#sweepers = new Sweepers({
            scene,
            cabinet: this,
            groups: GROUPS
        });
        this.#screen = new Screen({ scene });
        this.#cardReader = new CardReader({
            scene,
            cabinet: this,
            onRetrieveCard: ({ type, position, rotation }) => Cards.deposit({ type, position, rotation }),
            onReadCard: card => {
                if (this.#runs.started) {
                    this.#cabinet.state.score += 50;
                    this.#cabinet.state.points += 50;
                }
            }
        });
        this.#tokenSlot = new TokenSlot({
            scene,
            cabinet: this,
            onRetrieveToken: ({ type, position, rotation }) => Tokens.deposit({ type, position, rotation }),
            onReadToken: token => {
                if (this.#runs.started) {
                    this.#cabinet.state.score += 20;
                    this.#cabinet.state.points += 20;
                }
            }
        });
        this.#runs = new this.#Runs({
            state: this.#cabinet.state,
            screen: this.#screen,
            onStartedGame: () => {
                this.#cabinet.state.coins = 100;
                this.#cabinet.state.score = 0;
                this.#cabinet.state.points = 0;
            },
            onFinishedGame: () => {
                this.#cabinet.state.coins = 0;
                this.#controlPanel.enableStartButton();
                this.#controlPanel.disableDropButtons();
                this.#controlPanel.disableHoldButton();
            }
        });
        this.#objectsDistributor = new ObjectsDistributor({ Coins, Tokens, Cards, Ingots });
        this.#floorAccessRules.set(this.#leftStacker, new Set([this.#sweepers]));
        this.#floorAccessRules.set(this.#rightStacker, new Set([this.#sweepers]));
        this.#floorAccessRules.set(this.#stacker, new Set([this.#sweepers, this.#excavator]));
        this.#floorAccessRules.set(this.#sweepers, null);
        this.#floorAccessRules.set(this.#excavator, new Set([this.#sweepers, this.#stacker]));
        this.#floorAccessRules.set(this.#leftTower, new Set([this.#sweepers]));
        this.#floorAccessRules.set(this.#rightTower, new Set([this.#sweepers]));
        await Promise.all([
            Cards.initialize({ scene, groups: GROUPS }),
            Coins.initialize({
                scene,
                onSpawnedCoin: instance => Coins.enableCcd(instance, true),
                groups: GROUPS
            }),
            Tokens.initialize({ scene, groups: GROUPS }),
            Ingots.initialize({ scene, groups: GROUPS }),
            Buttons.initialize({ scene })
        ]);
        await Promise.all([
            wall.initialize(),
            this.#controlPanel.initialize(),
            this.#pusher.initialize(),
            this.#sensorGate.initialize(),
            this.#excavator.initialize(),
            this.#leftTower.initialize(),
            this.#rightTower.initialize(),
            this.#coinRoller.initialize(),
            this.#stacker.initialize(),
            this.#leftStacker.initialize(),
            this.#rightStacker.initialize(),
            this.#sweepers.initialize(),
            this.#screen.initialize(),
            this.#cardReader.initialize(),
            this.#tokenSlot.initialize(),
            this.#runs.initialize()
        ]);
        Buttons.hideAll();
        await this.#collisionsDetector.initialize();
        this.#controlPanel.enableStartButton();
    }

    #startGame() {
        if (this.#runs.started) {
            return;
        }
        this.#controlPanel.disableStartButton();
        this.#controlPanel.enableDropButtons();
        this.#controlPanel.enableHoldButton();
        this.#sensorGate.reset();
        this.#runs.start();
    }

    update(time) {
        this.#character.update(time);
        Cards.update();
        Coins.update();
        Tokens.update();
        Buttons.update();
        Ingots.update();
        this.#pusher.update();
        this.#collisionsDetector.update();
        this.#controlPanel.update();
        this.#sensorGate.update();
        this.#sweepers.update();
        this.#excavator.update();
        this.#leftTower.update();
        this.#rightTower.update();
        this.#coinRoller.update();
        this.#stacker.update();
        this.#leftStacker.update();
        this.#rightStacker.update();
        this.#screen.update();
        this.#cardReader.update();
        this.#tokenSlot.update();
        this.#runs.update(time);
        this.dynamicBodies.forEach(({ object, objects }) => {
            if (object.position.y < MIN_POSITION_Y_OBJECTS) {
                console.warn("object recycled", object, structuredClone(object.position), structuredClone(object.rotation));
                objects.recycle(object);
            }
        });
        if (this.DEBUG_AUTOPLAY) {
            this.#autoplay();
        }
    }

    refresh() {
        Cards.refresh();
        Coins.refresh();
        Tokens.refresh();
        Buttons.refresh();
        Ingots.refresh();
        this.#pusher.refresh();
        this.#controlPanel.refresh();
        this.#sensorGate.refresh();
        this.#sweepers.refresh();
        this.#excavator.refresh();
        this.#leftTower.refresh();
        this.#rightTower.refresh();
        this.#coinRoller.refresh();
        this.#stacker.refresh();
        this.#leftStacker.refresh();
        this.#rightStacker.refresh();
        this.#screen.refresh();
        this.#cardReader.refresh();
        this.#tokenSlot.refresh();
        this.#runs.refresh();
    }

    sensorColliders() {
        return [
            ...this.#sensorColliders.values(),
            ...this.#excavator.sensorColliders(),
            ...this.#sensorGate.sensorColliders(),
            ...this.#coinRoller.sensorColliders(),
        ];
    }

    resize(width, height) {
        this.#screen.resize(width, height);
    }

    get interactiveObjects() {
        return this.#controlPanel.interactiveObjects;
    }

    get joints() {
        return this.#excavator.joints;
    }

    get coinsInPlay() {
        return Coins.usedCoins;
    }

    get pendingCoins() {
        return Coins.pendingCoins;
    }

    startGame() {
        this.#startGame();
    }

    setScreenVideo(url) {
        this.#screen.setVideo(url);
    }

    setCharacterScale(scale) {
        this.#character.setScale(scale);
    }

    receiveTikTokGift(count, avatar) {
        const queuedCoins = Coins.dropCoins({
            count,
            avatarKey: avatar?.avatarKey,
            avatarDataUri: avatar?.avatarDataUri
        });
        if (queuedCoins === 0) {
            return 0;
        }
        if (!this.#runs.started) {
            this.#startGame();
        }
        return queuedCoins;
    }

    updateTikTokGiftAvatar(avatarKey, avatarDataUri) {
        return Coins.setAvatar({ key: avatarKey, dataUri: avatarDataUri });
    }

    get dynamicBodies() {
        return [
            ...Coins.dynamicBodies,
            ...Tokens.dynamicBodies,
            ...Cards.dynamicBodies
        ];
    }

    async save() {
        const sensorCollidersHandles = {};
        this.#sensorColliders.forEach((collider, key) => sensorCollidersHandles[key] = collider.handle);
        const data = {};
        data.cards = Cards.save();
        data.coins = Coins.save();
        data.tokens = Tokens.save();
        data.buttons = Buttons.save();
        data.ingots = Ingots.save();
        Object.assign(data, {
            state: this.#cabinet.state,
            sensorCollidersHandles,
            pusher: this.#pusher.save(),
            sensorGate: this.#sensorGate.save(),
            excavator: this.#excavator.save(),
            leftTower: this.#leftTower.save(),
            rightTower: this.#rightTower.save(),
            coinRoller: this.#coinRoller.save(),
            stacker: this.#stacker.save(),
            leftStacker: this.#leftStacker.save(),
            rightStacker: this.#rightStacker.save(),
            sweepers: this.#sweepers.save(),
            cardReader: this.#cardReader.save(),
            tokenSlot: this.#tokenSlot.save(),
            runs: this.#runs.save(),
            scene: await this.#scene.save()
        });
        return data;
    }

    async load(cabinet) {
        await this.#scene.load(cabinet.scene);
        Cards.load(cabinet.cards);
        Coins.load(cabinet.coins);
        Tokens.load(cabinet.tokens);
        Buttons.load(cabinet.buttons);
        Ingots.load(cabinet.ingots);
        this.#sensorColliders = new Map();
        this.#parts.forEach(partData => {
            partData.meshes.forEach(({ data }) => {
                data.traverse((child) => {
                    if (child.isMesh) {
                        const userData = child.material.userData;
                        const objectType = child.material.name;
                        if (userData.sensor) {
                            const colliderHandle = cabinet.sensorCollidersHandles[objectType];
                            const collider = this.#scene.worldColliders.get(colliderHandle);
                            collider.userData = {
                                objectType,
                                onIntersect: this.#sensorListeners[objectType]
                            };
                            this.#sensorColliders.set(objectType, collider);
                        }
                    }
                });
            });
        });
        this.#cabinet.state.score = cabinet.state.score;
        this.#cabinet.state.points = cabinet.state.points;
        this.#cabinet.state.coins = cabinet.state.coins;
        this.#pusher.load(cabinet.pusher);
        this.#sensorGate.load(cabinet.sensorGate);
        this.#excavator.load(cabinet.excavator);
        this.#leftTower.load(cabinet.leftTower);
        this.#rightTower.load(cabinet.rightTower);
        this.#coinRoller.load(cabinet.coinRoller);
        this.#stacker.load(cabinet.stacker);
        this.#leftStacker.load(cabinet.leftStacker);
        this.#rightStacker.load(cabinet.rightStacker);
        this.#sweepers.load(cabinet.sweepers);
        this.#cardReader.load(cabinet.cardReader);
        this.#tokenSlot.load(cabinet.tokenSlot);
        this.#runs.load(cabinet.runs);
        this.#collisionsDetector.initialize();
    }

    getObject(userData) {
        if (userData.objectType === Coins.TYPE) {
            return this.getCoin(userData);
        } else if (userData.objectType === Tokens.TYPE) {
            return this.getToken(userData);
        } else if (userData.objectType === Cards.TYPE) {
            return this.getCard(userData);
        } else if (userData.objectType === Ingots.TYPE) {
            return this.getIngot(userData);
        }
    }

    getCoin({ index }) {
        return Coins.getCoin({ index });
    }

    getToken({ index, type }) {
        return Tokens.getToken({ index, type });
    }

    getCard({ index, type }) {
        return Cards.getCard({ index, type });
    }

    getIngot({ index }) {
        return Ingots.getIngot({ index });
    }

    recycleObject(userData) {
        const object = this.getObject(userData);
        if (object) {
            if (object.objectType === Coins.TYPE) {
                Coins.recycle(object);
            }
            if (object.objectType === Tokens.TYPE) {
                Tokens.recycle(object);
            }
            if (object.objectType === Cards.TYPE) {
                Cards.recycle(object);
            }
            if (object.objectType === Ingots.TYPE) {
                Ingots.recycle(object);
            }
        }
    }

    canActivate(caller) {
        const info = this.#floorAccessRules.get(caller);
        if (info) {
            const excludedParts = Array.from(info).filter(part => part !== caller);
            return !excludedParts.find(part => part.active);
        } else {
            const otherParts = Array.from(this.#floorAccessRules.keys()).filter(part => part !== caller);
            return !otherParts.find(part => part.active);
        }
    }

    #autoplay() {
        if (this.#pusher.phase > 2 && this.#pusher.phase < 2.05 && this.#pusher.phase > this.lastPhase) {
            Coins.dropCoins({ count: 10 });
        }
        this.lastPhase = this.#pusher.phase;
    }
}

async function initializeModel({ scene, DEBUG_HIDE_CABINET }) {
    const cabinetModel = await scene.loadModel(MODEL_PATH);
    const mesh = cabinetModel.scene;
    const parts = new Map();
    mesh.traverse((child) => {
        if (HIDDEN_CABINET_LABELS.has(child.name)) {
            child.visible = false;
        }
        if (child.isMesh) {
            const { material, geometry } = child;
            const userData = material.userData;
            const name = userData.name;
            if (userData.collider || userData.sensor) {
                const partData = getPart(parts, name);
                partData.sensor = userData.sensor;
                partData.friction = userData.friction;
                partData.restitution = userData.restitution;
                partData.meshes.push({
                    data: child,
                    geometry
                });
            } else {
                const name = child.userData.name;
                const partData = getPart(parts, name);
                partData.meshes.push({
                    data: child
                });
            }
        }
    });
    if (!DEBUG_HIDE_CABINET) {
        scene.addObject(mesh);
        addCabinetSurfaceCovers({ scene, mesh });
    }
    return {
        parts
    };
}

function addCabinetSurfaceCovers({ scene, mesh }) {
    let tableMaterial;
    let wallBackgroundMaterial;
    mesh.traverse(child => {
        if (!child.isMesh) {
            return;
        }
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        tableMaterial = materials.find(material => material.name === "table") || tableMaterial;
        wallBackgroundMaterial = materials.find(material => material.name === "wall-background") || wallBackgroundMaterial;
    });
    if (!tableMaterial) {
        throw new Error("Unable to find the cabinet table material for the surface covers.");
    }
    if (!wallBackgroundMaterial) {
        throw new Error("Unable to find the cabinet wall material for the background patch.");
    }
    CABINET_SURFACE_COVERS.forEach(({ position, width, height, depth, rotation = [0, 0, 0] }) => {
        const cover = new Mesh(
            new BoxGeometry(width, height, depth),
            tableMaterial.clone()
        );
        cover.position.set(...position);
        cover.rotation.set(...rotation);
        scene.addObject(cover);
    });
    CABINET_PANEL_COVERS.forEach(({ position, width, height }) => {
        const panelPatch = new Mesh(
            new PlaneGeometry(width, height),
            tableMaterial.clone()
        );
        panelPatch.position.set(...position);
        scene.addObject(panelPatch);
    });
    WALL_BACKGROUND_PATCHES.forEach(({ position, width, height, u, v }) => {
        const backgroundGeometry = new PlaneGeometry(width, height);
        const uv = backgroundGeometry.attributes.uv;
        for (let index = 0; index < uv.count; index++) {
            uv.setXY(
                index,
                u[0] + uv.getX(index) * (u[1] - u[0]),
                v[1] - uv.getY(index) * (v[1] - v[0])
            );
        }
        uv.needsUpdate = true;
        const backgroundPatch = new Mesh(backgroundGeometry, wallBackgroundMaterial.clone());
        backgroundPatch.position.set(...position);
        scene.addObject(backgroundPatch);
    });
}

function initializeColliders({ scene, parts, sensorListeners }) {
    const sensorColliders = new Map();
    parts.forEach((partData, name) => {
        const { meshes, sensor, friction, restitution } = partData;
        const body = scene.createFixedBody();
        const geometries = [];
        meshes.forEach(meshData => {
            if (sensor) {
                const collider = scene.createCuboidColliderFromBoundingBox({
                    mesh: meshData.data,
                    height: SENSOR_HEIGHT,
                    userData: {
                        objectType: name,
                        onIntersect: sensorListeners[name]
                    },
                    sensor
                }, body);
                sensorColliders.set(name, collider);
            } else if (meshData.geometry) {
                geometries.push(meshData.geometry);
            }
        });
        if (geometries.length > 0) {
            const { vertices, indices } = scene.mergeGeometries(geometries);
            const collider = scene.createTrimeshCollider({
                vertices,
                indices,
                friction,
                restitution
            }, body);
            collider.setCollisionGroups(GROUPS.CABINET << 16 | GROUPS.OBJECTS);
        }
    });
    return {
        sensorColliders
    };
}

function getPart(parts, name) {
    let partData;
    if (!parts.has(name)) {
        partData = { meshes: [] };
        parts.set(name, partData);
    } else {
        partData = parts.get(name);
    }
    return partData;
}