import assert from "node:assert/strict";
import test from "node:test";
import { getUpperDeckRenderInterval } from "../lib/components/output/upper-deck-render-interval.js";

test("reduces mirror refresh frequency when many prize objects are active", () => {
    assert.equal(getUpperDeckRenderInterval(0), 1);
    assert.equal(getUpperDeckRenderInterval(23), 1);
    assert.equal(getUpperDeckRenderInterval(24), 2);
    assert.equal(getUpperDeckRenderInterval(48), 3);
    assert.equal(getUpperDeckRenderInterval(96), 4);
});
