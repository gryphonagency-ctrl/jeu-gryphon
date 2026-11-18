'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    normalizeShootingRangeShot,
    normalizeShootingRangeState
} = require('../shooting-range-protocol');

const target = {
    id: 1,
    type: 'gloop',
    state: 'alive',
    dead: false,
    direction: 1,
    x: 0.12,
    y: 0.25,
    speed: 0.01,
    stars: 1,
    t: 1,
    offY: 0,
    rot: 0,
    sx: 1,
    sy: 1,
    kx: 0,
    vx: 0,
    vy: 0,
    vr: 0,
    hitTimer: 0,
    zone: null
};

test('shared state accepts bounded targets and drops unrecognized fields', () => {
    const normalized = normalizeShootingRangeState({
        active: true,
        paused: false,
        speed: 1,
        doubleRewards: ['gloop'],
        targets: [{ ...target, points: 100, ignored: 'extra' }],
        recentShots: [],
        timeLeft: 45,
        score: 100,
        ignored: 'extra'
    });

    assert.equal(normalized.targets[0].ignored, undefined);
    assert.equal(normalized.targets[0].points, undefined);
    assert.equal(normalized.ignored, undefined);
    assert.equal(normalized.timeLeft, undefined);
    assert.equal(normalized.score, undefined);
    assert.equal(normalized.targets[0].id, 1);
    assert.equal(normalized.targets[0].stars, 1);
    assert.deepEqual(normalized.doubleRewards, ['gloop']);
});

test('shared state rejects malformed or oversized target lists', () => {
    const state = {
        active: true,
        paused: false,
        speed: 1,
        doubleRewards: [],
        targets: [target],
        recentShots: []
    };

    assert.equal(normalizeShootingRangeState({ ...state, targets: Array(25).fill(target) }), null);
    assert.equal(normalizeShootingRangeState({
        ...state,
        targets: [{ ...target, x: Number.NaN }]
    }), null);
});

test('shared state defaults old clients to no double rewards and rejects invalid reward types', () => {
    const state = {
        active: true,
        paused: false,
        speed: 1,
        targets: [],
        recentShots: []
    };

    assert.deepEqual(normalizeShootingRangeState(state).doubleRewards, []);
    assert.equal(normalizeShootingRangeState({ ...state, doubleRewards: ['unknown'] }), null);
    assert.equal(normalizeShootingRangeState({ ...state, doubleRewards: ['gloop', 'gloop'] }), null);
});

test('target rewards allow zero, one, or two stars only', () => {
    const state = {
        active: true,
        paused: false,
        speed: 1,
        doubleRewards: [],
        targets: [{ ...target, stars: 0 }],
        recentShots: []
    };

    assert.equal(normalizeShootingRangeState(state).targets[0].stars, 0);
    assert.equal(normalizeShootingRangeState({
        ...state,
        targets: [{ ...target, stars: 2 }]
    }).targets[0].stars, 2);
    assert.equal(normalizeShootingRangeState({
        ...state,
        targets: [{ ...target, stars: 3 }]
    }), null);
});

test('remote shots are normalized and coordinates outside the playfield are rejected', () => {
    assert.deepEqual(normalizeShootingRangeShot({
        targetId: 7,
        zone: 'head',
        x: 0.5,
        y: 0.25,
        username: '@Alice'
    }), {
        targetId: 7,
        zone: 'head',
        x: 0.5,
        y: 0.25,
        username: 'Alice'
    });
    assert.equal(normalizeShootingRangeShot({
        targetId: 7,
        zone: 'head',
        x: 1.01,
        y: 0.25
    }), null);
    assert.deepEqual(normalizeShootingRangeShot({
        targetId: null,
        zone: null,
        x: 0.5,
        y: 0.25
    }), {
        targetId: null,
        zone: null,
        x: 0.5,
        y: 0.25,
        username: 'Tireur'
    });
});
