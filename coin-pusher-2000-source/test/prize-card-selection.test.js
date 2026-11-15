import test from "node:test";
import assert from "node:assert/strict";
import { resolveManualPrizeCard, selectPrizeCard } from "../lib/prize-card-selection.js";

test("la sélection d’une valeur exacte exige une carte de cette valeur en stock", () => {
    const stock = [
        { stars: 2, count: 125 },
        { stars: 300, count: 2 }
    ];

    assert.deepEqual(selectPrizeCard(stock, 300, () => 0), { stars: 300, count: 2 });
    assert.equal(selectPrizeCard(stock, 100, () => 0), null);
});

test("une carte manuelle accepte une valeur sans stock et ne modifie pas le stock", () => {
    const stock = [{ stars: 100, count: 0 }];

    assert.deepEqual(resolveManualPrizeCard(stock, 137), {
        card: { stars: 137, count: 0 },
        usesStock: false
    });
    assert.equal(stock[0].count, 0);
});

test("une carte manuelle utilise le stock quand la valeur est disponible", () => {
    const card = { stars: 100, count: 2 };

    assert.deepEqual(resolveManualPrizeCard([card], 100), {
        card,
        usesStock: true
    });
});

test("une valeur manuelle invalide est refusée", () => {
    assert.throws(() => resolveManualPrizeCard([], 0), RangeError);
});

test("les gains automatiques conservent le tirage pondéré par le stock", () => {
    const stock = [
        { stars: 2, count: 125 },
        { stars: 300, count: 2 }
    ];

    assert.deepEqual(selectPrizeCard(stock, null, () => 0), { stars: 2, count: 125 });
});
