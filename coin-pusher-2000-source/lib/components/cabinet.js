import { BoxGeometry, BufferAttribute, BufferGeometry, Mesh, PlaneGeometry } from "three";
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
import CoinSounds from "./coin-sounds.js";
import SensorGate from "./gadgets/sensor-gate.js";
import Excavator from "./gadgets/excavator.js";
import Tower from "./gadgets/tower.js";
import Stacker from "./gadgets/stacker.js";
import MiniStacker from "./gadgets/mini-stacker.js";
import Sweepers from "./gadgets/sweepers.js";
import CardReader from "./gadgets/card-reader.js";
import TokenSlot from "./gadgets/token-slot.js";
import GiphyCharacter from "./giphy-character.js";
import createTwinklingStars from "./twinkling-stars.js";
import PrizeCreditQueue from "../prize-credit-queue.js";
import { resolveManualPrizeCard, selectPrizeCard } from "../prize-card-selection.js";
import { shouldPlayCoinImpact } from "../coin-impact-filter.js";
import { getPrizeDropPosition } from "../prize-drop-position.js";
import {
    MAX_ACTIVE_PRIZE_OBJECTS,
    getActivePrizeObjectCount
} from "./util/prize-object-capacity.js";

const MIN_POSITION_Y_OBJECTS = -1;
const MANUAL_PRIZE_DROP_HEIGHT = 1.5;
const MODEL_PATH = "./assets/cabinet.glb";
const SENSOR_HEIGHT = 0.2;
const EXCAVATOR_PICKUP_OPENING = {
    minX: 0.38,
    maxX: 0.66,
    minZ: -0.26,
    maxZ: 0.02
};
const DEFAULT_PRIZE_DECK = [
    { stars: 1, count: 200 },
    { stars: 2, count: 125 },
    { stars: 10, count: 25 },
    { stars: 30, count: 35 },
    { stars: 100, count: 8 },
    { stars: 300, count: 2 }
];
const INGOT_STARS = 50;
const IS_LOCAL_PREVIEW = globalThis.location?.hostname === "localhost" ||
    globalThis.location?.hostname === "127.0.0.1";
const HIDDEN_CABINET_LABELS = new Set([
    "label-coins-in-play",
    "coins-in-play",
    "label-score",
    "label-points",
    "label-coins"
]);
const CABINET_SURFACE_COVERS = [
    { position: [0, 0.16125, 1.25], width: 1.5, height: 0.008, depth: 0.24, rotation: [2 * Math.PI + Math.PI / 10, 0, 0] },
];
const CABINET_PANEL_COVERS = [
    { position: [-0.785, 0.22, 0.795], width: 0.22, height: 0.14 },
    { position: [-0.69, 0.245, -0.319], width: 0.38, height: 0.1 }
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
        position: [-0.69, 0.355, -0.319],
        width: 0.32,
        height: 0.13,
        u: [0.0792, 0.2376],
        v: [0.7748, 0.8919]
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
        scene.setCollisionHandler((first, second) => {
            if (shouldPlayCoinImpact(first, second, Coins.TYPE, index => Coins.getCoin({ index }))) {
                CoinSounds.playImpact();
            }
        });
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
            const object = this.getObject(userData);
            const prize = object && this.#prizeAssignments.get(object);
            if (prize) {
                this.#prizeAssignments.delete(object);
                this.#awardPrize(prize);
            }
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
    #prizeAssignments = new WeakMap();
    #prizeDeck = DEFAULT_PRIZE_DECK.map(card => ({ ...card }));
    #creditQueue;
    #creditOwner = "";
    #unstoredPrizes = [];
    #pendingIngots = [];
    #pendingClawPrizePlayers = [];
    #ingotFrequency = 10;
    #prizeCardsWon = 0;
    #controlPanel;
    #pusher;
    #sensorGate;
    #collisionsDetector;
    #excavator;
    #leftTower;
    #rightTower;
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
    #twinklingStars;

    async initialize() {
        const scene = this.#scene;
        const { parts, backgroundTexture, twinklingStars } = await initializeModel({
            scene,
            DEBUG_HIDE_CABINET: this.DEBUG_HIDE_CABINET
        });
        this.#parts = parts;
        this.#twinklingStars = twinklingStars;
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
            onBonusWon: player => {
                const hasPlayer = typeof player?.username === "string" && player.username.trim().length > 0;
                const random = Math.random();
                if (this.DEBUG_AUTOPLAY) {
                    if (hasPlayer) {
                        this.#deliverPrize(player);
                    }
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
                    if (random < 1 / 5 && hasPlayer) {
                        this.#pendingClawPrizePlayers.push({
                            username: player.username,
                            avatarUrl: player.avatarUrl || "",
                            avatarDataUri: player.avatarDataUri || "",
                            simulation: player.simulation === true
                        });
                        this.#excavator.pick();
                    } else {
                        if (hasPlayer) {
                            this.#deliverPrize(player);
                        }
                        if (random < 2 / 5) {
                            this.#leftTower.shootCoins();
                            this.#rightTower.shootCoins();
                        } else if (random < 3 / 5) {
                            this.#leftStacker.deliver({ levels: 30 });
                            this.#rightStacker.deliver({ levels: 30 });
                        } else if (random < 4 / 5) {
                            this.#sweepers.sweepFloor({ level: 5 });
                        } else {
                            this.#stacker.deliver({ stacks: 7, levels: 15 });
                        }
                    }
                }
            }
        });
        this.#excavator = new Excavator({
            scene,
            cabinet: this,
            onPick: dropPosition => {
                const player = this.#pendingClawPrizePlayers.shift();
                if (player) {
                    this.#deliverPrize(player, false, null, dropPosition);
                }
                const tokens = [];
                for (let i = 0; i < 1; i++) {
                    if (Math.random() < 0.5) {
                        tokens.push({ type: Math.floor(Math.random() * (Tokens.TYPES - 1)) });
                    }
                }
                return this.#objectsDistributor.deposit(dropPosition, [.12, .12], new Map([
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
        this.#stacker = new Stacker({
            scene,
            cabinet: this,
            onInitializeCoin: ({ position, rotation, impulse }) => Coins.deposit({ position, rotation, impulse }),
            hasCoinCapacity: () => Coins.hasAvailableInstances(2),
            groups: GROUPS
        });
        this.#leftStacker = new MiniStacker({
            scene,
            cabinet: this,
            onInitializeCoin: ({ position, rotation, impulse }) => Coins.deposit({ position, rotation, impulse }),
            hasCoinCapacity: () => Coins.hasAvailableInstances(2),
            offsetX: -0.4,
            groups: GROUPS
        });
        this.#rightStacker = new MiniStacker({
            scene,
            cabinet: this,
            onInitializeCoin: ({ position, rotation, impulse }) => Coins.deposit({ position, rotation, impulse }),
            hasCoinCapacity: () => Coins.hasAvailableInstances(2),
            offsetX: 0.4,
            groups: GROUPS
        });
        this.#sweepers = new Sweepers({
            scene,
            cabinet: this,
            groups: GROUPS
        });
        this.#screen = new Screen({ scene, backgroundTexture });
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
        this.#objectsDistributor = new ObjectsDistributor({
            Coins,
            Tokens,
            Cards,
            Ingots,
            onPendingLimitReached: () => this.#dispatchPrizeStatus(
                "File bonus pleine : les objets dépassant la limite de 500 ne tomberont pas; pièces et runs continuent.",
                "warning"
            )
        });
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
                onSpawnedCoin: instance => {
                    Coins.enableCcd(instance, true);
                },
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
        Cards.update();
        Coins.update();
        this.#scene.checkCollisionStarts(Coins.TYPE);
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
        this.#stacker.update();
        this.#leftStacker.update();
        this.#rightStacker.update();
        this.#screen.update();
        this.#cardReader.update();
        this.#tokenSlot.update();
        this.#runs.update(time);
        this.dynamicBodies.forEach(({ object, objects }) => {
            if (object.position.y < MIN_POSITION_Y_OBJECTS) {
                this.#returnPrize(object);
                objects.recycle(object);
                this.#deliverPendingIngots();
            }
        });
        this.#objectsDistributor.update();
        if (this.DEBUG_AUTOPLAY) {
            this.#autoplay();
        }
    }

    refresh(time) {
        this.#character.update(time);
        this.#twinklingStars?.update(1 / 60);
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
        this.#stacker.refresh();
        this.#leftStacker.refresh();
        this.#rightStacker.refresh();
        this.#screen.refresh(getActivePrizeObjectCount(Cards, Ingots));
        this.#cardReader.refresh();
        this.#tokenSlot.refresh();
        this.#runs.refresh();
    }

    sensorColliders() {
        return [
            ...this.#sensorColliders.values(),
            ...this.#excavator.sensorColliders(),
            ...this.#sensorGate.sensorColliders()
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

    clearInitialUnownedPrizes() {
        for (const { object } of Cards.dynamicBodies) {
            Cards.recycle(object);
        }
        for (const { object } of Ingots.dynamicBodies) {
            Ingots.recycle(object);
        }
    }

    startGame() {
        this.#startGame();
    }

    getMachineControls() {
        const coins = this.#cabinet.state.coins;
        const buttons = this.#controlPanel.getButtonStates();
        if (coins <= 0) {
            buttons.center = false;
        }
        return { buttons, coins };
    }

    pressMachineButton(name) {
        const { buttons } = this.getMachineControls();
        if (!Object.hasOwn(buttons, name)) {
            throw new RangeError("Bouton de la machine inconnu.");
        }
        return buttons[name] && this.#controlPanel.pressButton(name);
    }

    setScreenVideo(url) {
        this.#screen.setVideo(url);
    }

    setCharacterScale(scale) {
        this.#character.setScale(scale);
    }

    setCharacterPosition(position) {
        this.#character.setPosition(position);
    }

    dropPrizeCard(username, stars) {
        const target = String(username || "").trim().replace(/^@/, "");
        if (!/^[a-zA-Z0-9._]{1,32}$/.test(target)) {
            this.#dispatchPrizeStatus("Indique un pseudo TikTok valide pour la carte.", "error");
            return false;
        }
        if (!Number.isSafeInteger(stars) || stars < 1 || stars > 250000) {
            this.#dispatchPrizeStatus("Indique une valeur de carte valide entre 1 et 250 000 étoiles.", "error");
            return false;
        }
        return this.#deliverPrize({ username: target }, true, stars);
    }

    dropPrizeIngot(username) {
        const target = String(username || "").trim().replace(/^@/, "");
        if (!/^[a-zA-Z0-9._]{1,32}$/.test(target)) {
            this.#dispatchPrizeStatus("Indique un pseudo TikTok valide pour le lingot.", "error");
            return false;
        }
        const canCredit = Boolean(this.#creditQueue && !this.#unstoredPrizes.length);
        const preview = IS_LOCAL_PREVIEW && !canCredit;
        if (!canCredit && !preview) {
            this.#dispatchPrizeStatus("Récompenses suspendues : portefeuille ou sauvegarde indisponible.", "error");
            return false;
        }
        const queued = getActivePrizeObjectCount(Cards, Ingots) >= MAX_ACTIVE_PRIZE_OBJECTS ||
            this.#pendingIngots.length > 0;
        this.#pendingIngots.push({ username: target, avatarUrl: "", manual: true, preview });
        this.#deliverPendingIngots();
        this.#dispatchPrizeStatus(
            preview
                ? `Aperçu local : lingot lâché pour @${target} ; aucune étoile ne sera créditée.${queued ? " Il tombera dès qu’une place se libérera." : ""}`
                : queued
                    ? `Lingot de ${INGOT_STARS} étoiles mis en attente pour @${target} ; il tombera dès qu’une place se libérera.`
                    : `Lingot de ${INGOT_STARS} étoiles lâché pour @${target} ; crédit à la sortie du plateau.`,
            preview || queued ? "warning" : ""
        );
        return true;
    }

    setPrizeConfig({ cards, ingotFrequency }) {
        if (
            !Array.isArray(cards) ||
            cards.length > 50 ||
            !Number.isSafeInteger(ingotFrequency) ||
            ingotFrequency < 0 ||
            ingotFrequency > 1000
        ) {
            throw new Error("Configuration des récompenses invalide.");
        }
        const total = cards.reduce((sum, card) => {
            if (
                !card ||
                !Number.isSafeInteger(card.stars) ||
                card.stars < 1 ||
                card.stars > 250000 ||
                !Number.isSafeInteger(card.count) ||
                card.count < 0 ||
                card.count > 10000
            ) {
                throw new Error("Valeur ou stock de carte invalide.");
            }
            return sum + card.count;
        }, 0);
        if (total > 100000) {
            throw new Error("Le stock de cartes ne peut pas dépasser 100 000.");
        }
        this.#prizeDeck = cards.map(card => ({ stars: card.stars, count: card.count }));
        this.#ingotFrequency = ingotFrequency;
    }

    receiveTikTokGift(count, avatar) {
        const queuedCoins = Coins.dropCoins({
            count,
            avatarKey: avatar?.avatarKey,
            avatarDataUri: avatar?.avatarDataUri,
            username: avatar?.username,
            avatarUrl: avatar?.avatarUrl,
            simulation: avatar?.simulation === true
        });
        if (queuedCoins === 0) {
            return 0;
        }
        if (!this.#runs.started) {
            this.#startGame();
        }
        return queuedCoins;
    }

    updateTikTokGiftAvatar(avatarKey, avatarDataUri, avatarUrl) {
        return Coins.setAvatar({ key: avatarKey, dataUri: avatarDataUri, avatarUrl });
    }

    get dynamicBodies() {
        return [
            ...Coins.dynamicBodies,
            ...Tokens.dynamicBodies,
            ...Cards.dynamicBodies,
            ...Ingots.dynamicBodies
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
        data.pendingClawPrizePlayers = this.#pendingClawPrizePlayers.map(player => ({ ...player }));
        data.pendingBonusObjects = this.#objectsDistributor.save();
        Object.assign(data, {
            state: this.#cabinet.state,
            sensorCollidersHandles,
            pusher: this.#pusher.save(),
            sensorGate: this.#sensorGate.save(),
            excavator: this.#excavator.save(),
            leftTower: this.#leftTower.save(),
            rightTower: this.#rightTower.save(),
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
        this.#objectsDistributor.load(cabinet.pendingBonusObjects);
        this.#pendingClawPrizePlayers = Array.isArray(cabinet.pendingClawPrizePlayers)
            ? cabinet.pendingClawPrizePlayers.filter(player =>
                player &&
                typeof player.username === "string" &&
                /^[a-zA-Z0-9._]{1,32}$/.test(player.username) &&
                (typeof player.avatarUrl === "string" || player.avatarUrl === undefined) &&
                (typeof player.avatarDataUri === "string" || player.avatarDataUri === undefined) &&
                (typeof player.simulation === "boolean" || player.simulation === undefined)
            ).map(player => ({
                username: player.username,
                avatarUrl: player.avatarUrl || "",
                avatarDataUri: player.avatarDataUri || "",
                simulation: player.simulation === true
            }))
            : [];
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
            this.#returnPrize(object);
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
            this.#deliverPendingIngots();
        }
    }

    #deliverPrize(player, manual = false, requestedStars = null, position = null) {
        const username = String(player?.username || "").trim().replace(/^@/, "");
        if (!/^[a-zA-Z0-9._]{1,32}$/.test(username)) {
            return false;
        }
        const avatarSource = player.avatarDataUri || player.avatarUrl || "";
        const canCredit = Boolean(this.#creditQueue && !this.#unstoredPrizes.length);
        const preview = player.simulation === true || (manual && IS_LOCAL_PREVIEW && !canCredit);
        if (!canCredit && !preview) {
            this.#dispatchPrizeStatus("Récompenses suspendues : portefeuille ou sauvegarde indisponible.", "error");
            return false;
        }
        const availableCards = this.#prizeDeck.filter(card => card.count > 0);
        const totalCards = availableCards.reduce((sum, card) => sum + card.count, 0);
        if (!manual && !totalCards) {
            this.#dispatchPrizeStatus("Le stock de cartes est vide ou toutes les cartes sont déjà sur le plateau.", "warning");
            return false;
        }
        const manualSelection = manual ? resolveManualPrizeCard(this.#prizeDeck, requestedStars) : null;
        const selected = manualSelection?.card || selectPrizeCard(availableCards);
        if (!selected) {
            return false;
        }
        const cardType = this.#cardTypeForStars(selected.stars);
        const reportAvatarError = error => {
            console.warn("Photo de profil indisponible sur la carte de récompense :", error);
            this.#dispatchPrizeStatus(`Photo de profil indisponible pour @${username} ; le pseudo et les étoiles restent affichés.`, "warning");
        };
        const cardObject = Cards.deposit({
            type: cardType,
            position: getPrizeDropPosition(position || this.#pusher.deliveryPosition, Cards.getSize(), {
                height: manual ? MANUAL_PRIZE_DROP_HEIGHT : 0
            }),
            prize: {
                username,
                amount: selected.stars,
                avatarUrl: avatarSource
            },
            onAvatarError: reportAvatarError
        });
        if (!avatarSource && !preview) {
            void Cards.loadPrizeAvatar(cardObject, username).catch(reportAvatarError);
        }
        const usesStock = manualSelection ? manualSelection.usesStock : true;
        if (usesStock) selected.count--;
        this.#prizeAssignments.set(cardObject, {
            username,
            avatarUrl: avatarSource,
            amount: selected.stars,
            kind: "carte",
            usesStock,
            preview
        });
        if (usesStock) this.#dispatchPrizeDeck();
        this.#deliverPendingIngots();
        if (manual) {
            this.#dispatchPrizeStatus(preview
                ? `Aperçu local : carte de ${selected.stars.toLocaleString("fr-FR")} étoile${selected.stars === 1 ? "" : "s"} lâchée pour @${username} ; aucune étoile ne sera créditée.`
                : `Carte de ${selected.stars.toLocaleString("fr-FR")} étoile${selected.stars === 1 ? "" : "s"} lâchée pour @${username} ; crédit à la sortie du plateau.`);
        }
        return true;
    }

    #cardTypeForStars(stars) {
        const type = this.#prizeDeck
            .slice()
            .sort((a, b) => a.stars - b.stars)
            .findIndex(card => card.stars === stars);
        return type < 0 ? (stars - 1) % Cards.TYPES : type % Cards.TYPES;
    }

    #deliverPendingIngots() {
        while (
            this.#pendingIngots.length &&
            getActivePrizeObjectCount(Cards, Ingots) < MAX_ACTIVE_PRIZE_OBJECTS
        ) {
            const player = this.#pendingIngots[0];
            const ingot = Ingots.deposit({
                position: getPrizeDropPosition(this.#pusher.deliveryPosition, Ingots.getSize(), {
                    height: player.manual ? MANUAL_PRIZE_DROP_HEIGHT : 0
                })
            });
            this.#pendingIngots.shift();
            this.#prizeAssignments.set(ingot, {
                username: player.username,
                avatarUrl: player.avatarUrl || player.avatarDataUri || "",
                amount: INGOT_STARS,
                kind: "lingot",
                manual: player.manual === true,
                preview: player.preview === true || player.simulation === true
            });
        }
    }

    #returnPrize(object) {
        const prize = this.#prizeAssignments.get(object);
        if (!prize) {
            return;
        }
        this.#prizeAssignments.delete(object);
        if (prize.kind === "carte" && prize.usesStock) {
            this.#restoreCard(prize.amount);
        } else if (prize.kind === "lingot") {
            this.#pendingIngots.unshift({
                username: prize.username,
                avatarUrl: prize.avatarUrl,
                manual: prize.manual,
                preview: prize.preview === true
            });
        }
    }

    #dispatchPrizeDeck() {
        window.dispatchEvent(new CustomEvent("coin-pusher-prize-deck-change", {
            detail: {
                cards: this.#prizeDeck.map(card => ({ ...card })),
                ingotFrequency: this.#ingotFrequency
            }
        }));
    }

    #dispatchPrizeStatus(message, state = "") {
        window.dispatchEvent(new CustomEvent("coin-pusher-prize-status", {
            detail: { message, state }
        }));
    }

    configurePrizeCredits(owner) {
        const account = String(owner || "").trim().toLowerCase();
        if (!account) throw new Error("Compte Griffon Arcade non connecté.");
        if (this.#creditQueue) {
            if (this.#creditOwner !== account) {
                throw new Error("Le compte a changé : recharge le jeu avant de continuer.");
            }
            return;
        }
        const queue = new PrizeCreditQueue({
            storage: localStorage,
            key: `coin-pusher-2000-prize-credits:${account}`,
            award: async prize => {
                const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
                if (!response.ok) throw new Error("Impossible de vérifier le compte Griffon Arcade.");
                const session = await response.json();
                if (!session.authenticated || String(session.username || "").toLowerCase() !== account) {
                    throw new Error("Reconnecte le compte Griffon Arcade qui a enregistré ce gain.");
                }
                if (typeof window.ArcadeStars?.award !== "function") {
                    throw new Error("Portefeuille Griffon Arcade indisponible.");
                }
                return window.ArcadeStars.award({
                    username: prize.username,
                    amount: prize.amount,
                    transactionId: prize.transactionId
                });
            },
            onConfirmed: (prize, player) => {
                if (prize.kind === "carte") {
                    this.#prizeCardsWon++;
                    if (this.#ingotFrequency > 0 && this.#prizeCardsWon % this.#ingotFrequency === 0) {
                        this.#pendingIngots.push({ username: prize.username, avatarUrl: prize.avatarUrl });
                        this.#deliverPendingIngots();
                    }
                }
                window.dispatchEvent(new CustomEvent("coin-pusher-prize-awarded", {
                    detail: {
                        username: prize.username,
                        avatarUrl: player.avatarUrl || prize.avatarUrl,
                        amount: prize.amount,
                        kind: prize.kind,
                        globalStars: Number(player.stars) || 0
                    }
                }));
            },
            onError: (prize, error) => this.#reportCreditError(prize, error)
        });
        this.#creditOwner = account;
        this.#creditQueue = queue;
    }

    retryPrizeCredits() {
        if (!this.#creditQueue) return;
        while (this.#unstoredPrizes.length) {
            const prize = this.#unstoredPrizes[0];
            try {
                this.#creditQueue.enqueue(prize);
                this.#unstoredPrizes.shift();
            } catch (error) {
                this.#reportCreditError(prize, error);
                return;
            }
        }
        void this.#creditQueue.flush();
    }

    #reportCreditError(prize, error) {
        console.error("Récompense en attente :", error);
        window.dispatchEvent(new CustomEvent("coin-pusher-prize-error", {
            detail: {
                username: prize.username,
                message: `${error.message || "Portefeuille indisponible."} Gain en attente ; ne ferme pas la page si le stockage est indisponible.`
            }
        }));
    }

    #awardPrize(prize) {
        if (prize.preview) {
            if (prize.kind === "carte") {
                this.#restoreCard(prize.amount);
            }
            this.#dispatchPrizeStatus(`Aperçu local : ${prize.kind} récupéré pour @${prize.username} ; aucun gain n’a été crédité.`, "warning");
            return;
        }
        const pending = {
            ...prize,
            avatarUrl: /^https?:\/\/|^\/(?!\/)/i.test(prize.avatarUrl || "")
                ? prize.avatarUrl.slice(0, 2000)
                : ""
        };
        this.#unstoredPrizes.push(pending);
        if (!this.#creditQueue) {
            this.#reportCreditError(pending, new Error("Portefeuille non connecté."));
            return;
        }
        this.retryPrizeCredits();
    }

    #restoreCard(stars) {
        let card = this.#prizeDeck.find(entry => entry.stars === stars);
        const total = this.#prizeDeck.reduce((sum, entry) => sum + entry.count, 0);
        if (!card && this.#prizeDeck.length < 50) {
            card = { stars, count: 0 };
            this.#prizeDeck.push(card);
        }
        if (!card || card.count >= 10000 || total >= 100000) {
            this.#dispatchPrizeStatus("Impossible de remettre la carte au stock après l’échec du portefeuille.", "error");
            return;
        }
        card.count++;
        this.#dispatchPrizeDeck();
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
            const { material } = child;
            let { geometry } = child;
            if (material.name === "table-obstacle") {
                geometry = createExcavatorPickupOpening(geometry);
                child.geometry = geometry;
            }
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
    let backgroundTexture = null;
    let twinklingStars = null;
    if (!DEBUG_HIDE_CABINET) {
        scene.addObject(mesh);
        ({ backgroundTexture, twinklingStars } = addCabinetSurfaceCovers({ scene, mesh }));
    }
    return {
        parts,
        backgroundTexture,
        twinklingStars
    };
}

function createExcavatorPickupOpening(geometry) {
    const attributes = Object.entries(geometry.attributes);
    const sourceIndex = geometry.index;
    const vertexCount = sourceIndex ? sourceIndex.count : geometry.getAttribute("position").count;
    const output = new Map(attributes.map(([name]) => [name, []]));

    const readVertex = index => Object.fromEntries(attributes.map(([name, attribute]) => [
        name,
        Array.from({ length: attribute.itemSize }, (_, component) =>
            getAttributeComponent(attribute, index, component))
    ]));
    const appendVertex = vertex => attributes.forEach(([name]) => output.get(name).push(...vertex[name]));

    for (let offset = 0; offset < vertexCount; offset += 3) {
        const triangle = [0, 1, 2].map(index => readVertex(
            sourceIndex ? sourceIndex.getX(offset + index) : offset + index
        ));
        const points = triangle.map(vertex => vertex.position);
        const minY = Math.min(...points.map(point => point[1]));
        const maxY = Math.max(...points.map(point => point[1]));
        const horizontalTableTop = maxY - minY < 0.0001 && maxY >= 0.28;
        const fragments = horizontalTableTop && triangleOverlapsOpening(points)
            ? subtractPickupOpening(triangle)
            : [triangle];

        fragments.forEach(polygon => {
            for (let index = 1; index < polygon.length - 1; index++) {
                appendVertex(polygon[0]);
                appendVertex(polygon[index]);
                appendVertex(polygon[index + 1]);
            }
        });
    }

    const result = new BufferGeometry();
    attributes.forEach(([name, attribute]) => {
        result.setAttribute(name, new BufferAttribute(
            new Float32Array(output.get(name)),
            attribute.itemSize
        ));
    });
    if (sourceIndex) {
        const outputCount = output.get("position").length / geometry.getAttribute("position").itemSize;
        result.setIndex(Array.from({ length: outputCount }, (_, index) => index));
    }
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
}

function triangleOverlapsOpening(points) {
    const xs = points.map(point => point[0]);
    const zs = points.map(point => point[2]);
    return Math.min(...xs) < EXCAVATOR_PICKUP_OPENING.maxX &&
        Math.max(...xs) > EXCAVATOR_PICKUP_OPENING.minX &&
        Math.min(...zs) < EXCAVATOR_PICKUP_OPENING.maxZ &&
        Math.max(...zs) > EXCAVATOR_PICKUP_OPENING.minZ;
}

function subtractPickupOpening(triangle) {
    let remaining = triangle;
    const fragments = [];
    const boundaries = [
        { axis: 0, value: EXCAVATOR_PICKUP_OPENING.minX, keepGreater: true },
        { axis: 0, value: EXCAVATOR_PICKUP_OPENING.maxX, keepGreater: false },
        { axis: 2, value: EXCAVATOR_PICKUP_OPENING.minZ, keepGreater: true },
        { axis: 2, value: EXCAVATOR_PICKUP_OPENING.maxZ, keepGreater: false }
    ];

    boundaries.forEach(({ axis, value, keepGreater }) => {
        const outside = clipPolygon(remaining, axis, value, !keepGreater);
        if (outside.length >= 3) {
            fragments.push(outside);
        }
        remaining = clipPolygon(remaining, axis, value, keepGreater);
    });
    return fragments;
}

function clipPolygon(polygon, axis, boundary, keepGreater) {
    if (!polygon.length) {
        return [];
    }
    const result = [];
    const coordinate = vertex => vertex.position[axis];
    const isInside = vertex => keepGreater
        ? coordinate(vertex) >= boundary
        : coordinate(vertex) <= boundary;
    const intersection = (start, end) => {
        const amount = (boundary - coordinate(start)) / (coordinate(end) - coordinate(start));
        return Object.fromEntries(Object.keys(start).map(name => [
            name,
            start[name].map((value, index) => value + (end[name][index] - value) * amount)
        ]));
    };

    let previous = polygon[polygon.length - 1];
    polygon.forEach(current => {
        const previousInside = isInside(previous);
        const currentInside = isInside(current);
        if (currentInside !== previousInside) {
            result.push(intersection(previous, current));
        }
        if (currentInside) {
            result.push(current);
        }
        previous = current;
    });
    return result;
}

function getAttributeComponent(attribute, index, component) {
    if (component === 0) {
        return attribute.getX(index);
    }
    if (component === 1) {
        return attribute.getY(index);
    }
    if (component === 2) {
        return attribute.getZ(index);
    }
    return attribute.getW(index);
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
    const twinklingStars = createTwinklingStars(scene);
    return {
        backgroundTexture: wallBackgroundMaterial.map,
        twinklingStars
    };
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