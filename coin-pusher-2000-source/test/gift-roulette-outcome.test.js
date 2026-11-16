import test from "node:test";
import assert from "node:assert/strict";
import { createGiftRouletteCatalog, GIFT_ROULETTE_DEFINITIONS } from "../lib/gift-roulette-catalog.js";
import { resolveGiftRouletteTurn } from "../lib/gift-roulette-outcome.js";

test("catalog includes every reference gift and excludes the initial gifts from wins", () => {
    const catalog = createGiftRouletteCatalog(
        Object.fromEntries(GIFT_ROULETTE_DEFINITIONS.map(gift => [gift.id, gift.id]))
    );
    const ids = new Set(catalog.map(gift => gift.id));
    const initial = catalog.filter(gift => gift.initial);
    const small = catalog.filter(gift => gift.tier === "small");
    const winningGifts = catalog.filter(gift =>
        !gift.initial &&
        Number.isSafeInteger(gift.coinCount) &&
        gift.coinCount >= 1 &&
        gift.coinCount <= 100
    );

    assert.equal(catalog.length, 31);
    assert.equal(ids.size, catalog.length);
    assert.deepEqual(initial.map(gift => gift.id), ["universe", "stars", "lion", "zeus"]);
    assert.equal(small.length, 8);
    assert.ok(small.every(gift => gift.coinCount === 1));
    assert.equal(Math.max(...winningGifts.map(gift => gift.coinCount)), 100);
    assert.equal(catalog.find(gift => gift.id === "falcon").coinCount, 10999);
    assert.throws(() => createGiftRouletteCatalog({}), /Image manquante/);
});

test("uses the reference RTP and the 50-to-15 winning-gift weighting", () => {
    const gifts = [
        { id: "initial", initial: true, coinCount: 1, tier: "small" },
        { id: "small", coinCount: 1, tier: "small" },
        { id: "large", coinCount: 100, tier: "normal" },
        { id: "excluded", coinCount: 101, tier: "normal" }
    ];
    const randomValues = [0.09, 0, 0];
    const win = resolveGiftRouletteTurn(gifts, 0.1, () => randomValues.shift());
    assert.deepEqual(win, { won: true, gift: gifts[1] });

    const noWin = resolveGiftRouletteTurn(gifts, 0.1, () => 0.5);
    assert.deepEqual(noWin, { won: false, gift: null });
    const largerGiftRoll = [0, 0.9, 0];
    assert.deepEqual(
        resolveGiftRouletteTurn(gifts, 1, () => largerGiftRoll.shift()),
        { won: true, gift: gifts[2] }
    );
});

test("rejects invalid win chances and reports an empty winning catalog", () => {
    assert.throws(() => resolveGiftRouletteTurn([], 1.1), RangeError);
    assert.throws(() => resolveGiftRouletteTurn([{ initial: true, coinCount: 1 }], 1), /Aucun cadeau éligible/);
});
