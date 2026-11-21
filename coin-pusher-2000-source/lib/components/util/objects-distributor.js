import { Vector3 } from "three";
import {
    BONUS_OBJECTS_PER_FRAME,
    MAX_ACTIVE_PRIZE_OBJECTS,
    MAX_PENDING_BONUS_OBJECTS,
    getActivePrizeObjectCount
} from "./prize-object-capacity.js";

export default class {
    #objectTypesOrder;
    #Cards;
    #Ingots;
    #pendingPrizeObjects = [];
    #onPendingLimitReached;
    #pendingLimitReported = false;

    constructor({ Coins, Tokens, Cards, Ingots, onPendingLimitReached = () => {} }) {
        this.#Cards = Cards;
        this.#Ingots = Ingots;
        this.#onPendingLimitReached = onPendingLimitReached;
        this.#objectTypesOrder = [
            { Type: Cards, size: Cards.getSize() },
            { Type: Ingots, size: Ingots.getSize() },
            { Type: Tokens, size: Tokens.getSize() },
            { Type: Coins, size: Coins.getSize() }
        ];
    }

    deposit(position, region, objectsData, options = {}) {
        const { x, y, z } = position;
        const [width, height] = region;
        let currentY = y;
        const objects = [];
        for (let indexType = 0; indexType < this.#objectTypesOrder.length; indexType++) {
            const { Type, size } = this.#objectTypesOrder[indexType];
            const objectsType = objectsData.get(Type);
            if (objectsType && objectsType.length) {
                const objectsPerRowX = Math.floor(width / size.width);
                const objectsPerRowZ = Math.floor(height / size.height);
                const actualRowsX = Math.min(objectsPerRowX, objectsType.length);
                const actualRowsZ = Math.min(objectsPerRowZ, Math.ceil(objectsType.length / objectsPerRowX));
                const usedWidth = Math.max(actualRowsX * size.width, size.width);
                const usedHeight = Math.max(actualRowsZ * size.height, size.height);
                const startX = x - usedWidth / 2 + size.width / 2;
                const startZ = z - usedHeight / 2 + size.height / 2;
                let currentX = startX;
                let currentZ = startZ;
                let objectsInCurrentRowX = 0;
                let objectsInCurrentRowZ = 0;
                for (let indexObject = 0; indexObject < objectsType.length; indexObject++) {
                    const type = (objectsType[indexObject] && objectsType[indexObject].type) || 0;
                    const rotation = options.randomRotation ? new Vector3(
                        (Math.random() - 0.5) * Math.PI / 2 + (Math.random() < 0.5 ? Math.PI : 0),
                        (Math.random() - 0.5) * Math.PI / 2,
                        (Math.random() - 0.5) * Math.PI / 2
                    ) : new Vector3(0, 0, 0);
                    const position = options.randomPosition ? new Vector3(
                        currentX + (Math.random() / 100 - 0.005),
                        currentY,
                        currentZ + (Math.random() / 100 - 0.005)
                    ) : new Vector3(currentX, currentY, currentZ);
                    if (Type === this.#Cards || Type === this.#Ingots) {
                        if (this.#pendingPrizeObjects.length >= MAX_PENDING_BONUS_OBJECTS) {
                            if (!this.#pendingLimitReported) {
                                this.#pendingLimitReported = true;
                                this.#onPendingLimitReached();
                            }
                        } else {
                            this.#pendingPrizeObjects.push({ Type, position, type, rotation });
                        }
                    } else {
                        const object = Type.deposit({ position, type, rotation });
                        if (object) {
                            objects.push(object);
                        }
                    }
                    objectsInCurrentRowX++;
                    currentX += size.width;
                    if (objectsInCurrentRowX >= objectsPerRowX) {
                        objectsInCurrentRowX = 0;
                        objectsInCurrentRowZ++;
                        currentX = startX;
                        currentZ += size.height;
                        if (objectsInCurrentRowZ >= objectsPerRowZ) {
                            objectsInCurrentRowZ = 0;
                            currentZ = startZ;
                            if (!options.compacted) {
                                currentY += size.depth;
                            }
                        }
                    }
                }
                currentY += size.depth;
            }
        }
        return objects;
    }

    update() {
        let delivered = 0;
        while (
            this.#pendingPrizeObjects.length &&
            delivered < BONUS_OBJECTS_PER_FRAME &&
            getActivePrizeObjectCount(this.#Cards, this.#Ingots) < MAX_ACTIVE_PRIZE_OBJECTS
        ) {
            const { Type, position, type, rotation } = this.#pendingPrizeObjects.shift();
            Type.deposit({ position, type, rotation });
            delivered++;
        }
        if (this.#pendingPrizeObjects.length < MAX_PENDING_BONUS_OBJECTS) {
            this.#pendingLimitReported = false;
        }
    }

    save() {
        return this.#pendingPrizeObjects.map(({ Type, position, type, rotation }) => ({
            objectType: Type.TYPE,
            position: position.toArray(),
            type,
            rotation: rotation.toArray()
        }));
    }

    load(pending) {
        const types = new Map([
            [this.#Cards.TYPE, this.#Cards],
            [this.#Ingots.TYPE, this.#Ingots]
        ]);
        this.#pendingPrizeObjects = [];
        if (!Array.isArray(pending)) return;
        for (const item of pending.slice(0, MAX_PENDING_BONUS_OBJECTS)) {
            const Type = types.get(item?.objectType);
            if (
                !Type ||
                !Array.isArray(item.position) ||
                item.position.length !== 3 ||
                !item.position.every(Number.isFinite) ||
                !Array.isArray(item.rotation) ||
                item.rotation.length !== 3 ||
                !item.rotation.every(Number.isFinite) ||
                !Number.isSafeInteger(item.type) ||
                item.type < 0 ||
                item.type >= (Type.TYPES || 1)
            ) {
                continue;
            }
            this.#pendingPrizeObjects.push({
                Type,
                position: new Vector3().fromArray(item.position),
                type: item.type,
                rotation: new Vector3().fromArray(item.rotation)
            });
        }
    }
}