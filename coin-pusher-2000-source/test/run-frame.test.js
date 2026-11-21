import assert from "node:assert/strict";
import test from "node:test";
import runFrame, { advanceFixedSteps } from "../lib/run-frame.js";

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

test("fixed simulation steps catch up after slower rendered frames", () => {
    const stepTime = 1000 / 60;
    const firstFrame = advanceFixedSteps(0, 1000 / 30, stepTime, 4);

    assert.equal(firstFrame.steps, 2);
    assert.ok(firstFrame.remainingTime < 0.001);
});

test("keeps the simulation at 60 Hz when rendering runs at 54 Hz", () => {
    const stepTime = 1000 / 60;
    let remainingTime = 0;
    let totalSteps = 0;

    for (let frame = 0; frame < 54; frame++) {
        const result = advanceFixedSteps(remainingTime, 1000 / 54, stepTime, 4);
        totalSteps += result.steps;
        remainingTime = result.remainingTime;
    }

    assert.equal(totalSteps, 60);
    assert.ok(remainingTime < 0.001);
});

test("fixed simulation steps cap catch-up after a long pause", () => {
    const frame = advanceFixedSteps(0, 1000, 1000 / 60, 4);

    assert.equal(frame.steps, 4);
    assert.equal(frame.remainingTime, 0);
});
