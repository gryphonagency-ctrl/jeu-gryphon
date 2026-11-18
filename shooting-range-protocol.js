'use strict';

const MAX_TARGETS = 24;
const TARGET_TYPES = new Set([
    'gloop', 'bruno', 'mochi', 'tonko', 'cone', 'zigzag', 'pip', 'rocket'
]);

function isFiniteBetween(value, min, max) {
    return Number.isFinite(value) && value >= min && value <= max;
}

function normalizeShootingRangeState(input) {
    const doubleRewards = input && input.doubleRewards === undefined ? [] : input?.doubleRewards;
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        typeof input.active !== 'boolean' || typeof input.paused !== 'boolean' ||
        !isFiniteBetween(input.speed, 0.5, 2) ||
        !Array.isArray(doubleRewards) || doubleRewards.length > TARGET_TYPES.size ||
        new Set(doubleRewards).size !== doubleRewards.length ||
        doubleRewards.some(type => !TARGET_TYPES.has(type)) ||
        !Array.isArray(input.targets) || input.targets.length > MAX_TARGETS ||
        !Array.isArray(input.recentShots) || input.recentShots.length > 5 ||
        input.recentShots.some(shot => typeof shot !== 'string' || shot.length > 50)) return null;

    const targets = [];
    for (const target of input.targets) {
        if (!target || typeof target !== 'object' || Array.isArray(target) ||
            !Number.isSafeInteger(target.id) || target.id < 0 ||
            !TARGET_TYPES.has(target.type) ||
            !['alive', 'hit', 'falling'].includes(target.state) ||
            typeof target.dead !== 'boolean' ||
            ![-1, 1].includes(target.direction) ||
            !isFiniteBetween(target.x, -5, 5) ||
            !isFiniteBetween(target.y, -5, 5) ||
            !isFiniteBetween(target.speed, -1, 1) ||
            !Number.isSafeInteger(target.stars) || target.stars < 0 || target.stars > 2 ||
            !isFiniteBetween(target.t, 0, 100000) ||
            !isFiniteBetween(target.offY, -5, 5) ||
            !isFiniteBetween(target.rot, -1000, 1000) ||
            !isFiniteBetween(target.sx, 0, 10) ||
            !isFiniteBetween(target.sy, 0, 10) ||
            !isFiniteBetween(target.kx, -1, 1) ||
            !isFiniteBetween(target.vx, -1, 1) ||
            !isFiniteBetween(target.vy, -1, 1) ||
            !isFiniteBetween(target.vr, -100, 100) ||
            !Number.isSafeInteger(target.hitTimer) || target.hitTimer < 0 || target.hitTimer > 100 ||
            (target.zone !== null && !['head', 'body'].includes(target.zone))) return null;

        targets.push({
            id: target.id,
            type: target.type,
            state: target.state,
            dead: target.dead,
            direction: target.direction,
            x: target.x,
            y: target.y,
            speed: target.speed,
            stars: target.stars,
            t: target.t,
            offY: target.offY,
            rot: target.rot,
            sx: target.sx,
            sy: target.sy,
            kx: target.kx,
            vx: target.vx,
            vy: target.vy,
            vr: target.vr,
            hitTimer: target.hitTimer,
            zone: target.zone
        });
    }

    return {
        active: input.active,
        paused: input.paused,
        speed: input.speed,
        doubleRewards: doubleRewards.slice(),
        targets,
        recentShots: input.recentShots.slice()
    };
}

function normalizeShootingRangeShot(input) {
    const hasTarget = Number.isSafeInteger(input?.targetId) && input.targetId >= 0 &&
        ['head', 'body'].includes(input.zone);
    const isMiss = input?.targetId === null && input.zone === null;
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        (!hasTarget && !isMiss) ||
        !isFiniteBetween(input.x, 0, 1) ||
        !isFiniteBetween(input.y, 0, 1)) return null;

    const username = String(input.username || 'Tireur')
        .trim()
        .replace(/^@/, '')
        .replace(/[<>]/g, '')
        .slice(0, 32) || 'Tireur';

    return {
        targetId: input.targetId,
        zone: input.zone,
        x: input.x,
        y: input.y,
        username
    };
}

module.exports = {
    normalizeShootingRangeShot,
    normalizeShootingRangeState
};
