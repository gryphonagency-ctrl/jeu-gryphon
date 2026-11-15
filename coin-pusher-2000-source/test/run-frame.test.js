import assert from "node:assert/strict";
import test from "node:test";
import runFrame from "../lib/run-frame.js";

test("schedules the next frame when the update succeeds", () => {
    let scheduled = 0;
    runFrame(() => {}, () => scheduled++);
    assert.equal(scheduled, 1);
});

test("schedules the next frame and preserves the error when the update fails", () => {
    let scheduled = 0;
    const error = new Error("frame failed");

    assert.throws(() => runFrame(() => {
        throw error;
    }, () => scheduled++), error);
    assert.equal(scheduled, 1);
});
