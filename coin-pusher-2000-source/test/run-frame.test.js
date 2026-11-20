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

test("reports a frame error and keeps scheduling when an error handler is provided", () => {
    let scheduled = 0;
    let reported;
    const error = new Error("frame failed");

    runFrame(() => {
        throw error;
    }, () => scheduled++, (caught) => {
        reported = caught;
    });

    assert.equal(reported, error);
    assert.equal(scheduled, 1);
});
