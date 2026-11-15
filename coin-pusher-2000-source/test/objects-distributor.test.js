import assert from "node:assert/strict";
import test from "node:test";
import ObjectsDistributor from "../lib/components/util/objects-distributor.js";

function createObjectType(name, size, maximumTypes = 1) {
    const active = [];
    return class {
        static TYPE = name;
        static TYPES = maximumTypes;
        static getSize() {
            return size;
        }
        static get dynamicBodies() {
            return active;
        }
        static deposit(object) {
            const deposited = { ...object };
            active.push(deposited);
            return deposited;
        }
        static recycleAll() {
            active.length = 0;
        }
    };
}

test("bonus cards and ingots are paced while coins keep dropping immediately", () => {
    const Cards = createObjectType("card", { width: 0.1, height: 0.1, depth: 0.01 });
    const Ingots = createObjectType("ingot", { width: 0.1, height: 0.1, depth: 0.01 });
    const Tokens = createObjectType("token", { width: 0.1, height: 0.1, depth: 0.01 });
    const Coins = createObjectType("coin", { width: 0.1, height: 0.1, depth: 0.01 });
    const distributor = new ObjectsDistributor({ Cards, Ingots, Tokens, Coins });
    const reward = new Map([
        [Cards, [{ type: 0 }, { type: 0 }, { type: 0 }, { type: 0 }]],
        [Ingots, { length: 1 }],
        [Coins, { length: 1 }]
    ]);

    distributor.deposit({ x: 0, y: 0, z: 0 }, [0.55, 0.2], reward);

    assert.equal(Cards.dynamicBodies.length + Ingots.dynamicBodies.length, 0);
    assert.equal(Coins.dynamicBodies.length, 1);

    distributor.update();
    assert.equal(Cards.dynamicBodies.length + Ingots.dynamicBodies.length, 3);
    distributor.update();
    assert.equal(Cards.dynamicBodies.length + Ingots.dynamicBodies.length, 5);
});

test("holds excess bonus objects until active prize objects clear and saves the queue", () => {
    const Cards = createObjectType("card", { width: 0.1, height: 0.1, depth: 0.01 });
    const Ingots = createObjectType("ingot", { width: 0.1, height: 0.1, depth: 0.01 });
    const Tokens = createObjectType("token", { width: 0.1, height: 0.1, depth: 0.01 });
    const Coins = createObjectType("coin", { width: 0.1, height: 0.1, depth: 0.01 });
    const distributor = new ObjectsDistributor({ Cards, Ingots, Tokens, Coins });
    const reward = new Map([
        [Cards, Array.from({ length: 3 }, () => ({ type: 0 }))]
    ]);

    for (let index = 0; index < 48; index++) Cards.deposit({});
    distributor.deposit({ x: 0, y: 0, z: 0 }, [0.55, 0.2], reward);
    distributor.update();
    assert.equal(Cards.dynamicBodies.length, 48);
    assert.equal(distributor.save().length, 3);

    Cards.recycleAll();
    distributor.update();
    assert.equal(Cards.dynamicBodies.length, 3);
    assert.equal(distributor.save().length, 0);

    const restored = new ObjectsDistributor({ Cards, Ingots, Tokens, Coins });
    restored.load([
        {
            objectType: "card",
            position: [1, 2, 3],
            type: 0,
            rotation: [0, 0, 0]
        }
    ]);
    assert.equal(restored.save().length, 1);
    restored.update();
    assert.equal(Cards.dynamicBodies.length, 4);
});
