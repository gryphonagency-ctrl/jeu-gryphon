import test from "node:test";
import assert from "node:assert/strict";
import { advanceDiamondCharge, DIAMOND_CHARGE_TARGET } from "../lib/gift-roulette-diamond.js";

test("charges the diamond to each 1,000 real coins and keeps the remainder", () => {
    assert.deepEqual(advanceDiamondCharge(0, 999), { progress: 999, milestones: 0 });
    assert.deepEqual(advanceDiamondCharge(999, 1), { progress: 0, milestones: 1 });
    assert.deepEqual(advanceDiamondCharge(250, 2250), { progress: 500, milestones: 2 });
});

test("rejects invalid diamond progress or coin counts", () => {
    assert.equal(DIAMOND_CHARGE_TARGET, 1000);
    assert.throws(() => advanceDiamondCharge(-1, 1), RangeError);
    assert.throws(() => advanceDiamondCharge(DIAMOND_CHARGE_TARGET, 1), RangeError);
    assert.throws(() => advanceDiamondCharge(0, 0), RangeError);
});
