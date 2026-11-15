import test from "node:test";
import assert from "node:assert/strict";
import { shouldPlayCoinImpact } from "../lib/coin-impact-filter.js";

test("les contacts avec la machine ou entre pièces immobiles restent silencieux", () => {
    const coin = { objectType: "coin", index: 0 };
    const getCoin = () => ({ used: true, body: { linvel: () => ({ y: 0 }) } });

    assert.equal(shouldPlayCoinImpact(coin, { objectType: "cabinet" }, "coin", getCoin), false);
    assert.equal(shouldPlayCoinImpact(coin, { objectType: "coin", index: 1 }, "coin", getCoin), false);
});

test("une collision entre pièces ne sonne que si au moins une tombe", () => {
    const first = { objectType: "coin", index: 0 };
    const second = { objectType: "coin", index: 1 };
    const velocities = new Map([[0, -0.4], [1, 0]]);
    const getCoin = index => ({
        used: true,
        body: { linvel: () => ({ y: velocities.get(index) }) }
    });

    assert.equal(shouldPlayCoinImpact(first, second, "coin", getCoin), true);
    velocities.set(0, 0.4);
    assert.equal(shouldPlayCoinImpact(first, second, "coin", getCoin), false);
});
