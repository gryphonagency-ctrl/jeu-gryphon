import test from "node:test";
import assert from "node:assert/strict";
import { selectPrizeCard } from "../lib/prize-card-selection.js";

test("une carte manuelle garde exactement la valeur demandée même si elle est rare", () => {
    const stock = [
        { stars: 2, count: 125 },
        { stars: 300, count: 2 }
    ];

    assert.deepEqual(selectPrizeCard(stock, 300, () => 0), { stars: 300, count: 2 });
    assert.equal(selectPrizeCard(stock, 100, () => 0), null);
});

test("les gains automatiques conservent le tirage pondéré par le stock", () => {
    const stock = [
        { stars: 2, count: 125 },
        { stars: 300, count: 2 }
    ];

    assert.deepEqual(selectPrizeCard(stock, null, () => 0), { stars: 2, count: 125 });
});
