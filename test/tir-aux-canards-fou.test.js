const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const gameHtml = fs.readFileSync(path.join(__dirname, '..', 'tir-aux-canards-fou.html'), 'utf8');
const functionStart = gameHtml.indexOf('  function planRunShots(');
const functionEnd = gameHtml.indexOf('\n  function findRunTargetDuck', functionStart);
assert(functionStart >= 0 && functionEnd > functionStart, 'the RUN shot planner is present');

const sandbox = { LANES: [{}, {}, {}] };
vm.runInNewContext(`${gameHtml.slice(functionStart, functionEnd)}\nglobalThis.planRunShots = planRunShots;`, sandbox);

test('RUN batches balance all three lanes and produce an exact deterministic 80/20 sample', () => {
    let randomCall = 0;
    let hitRoll = 0;
    const plan = Array.from(sandbox.planRunShots(1000, () => {
        const positionInLaneShuffle = randomCall++ % 5;
        if (positionInLaneShuffle < 2) return 0.99;
        return hitRoll++ < 800 ? 0.799 : 0.8;
    }));

    assert.equal(plan.length, 1000);
    for (let offset = 0; offset < 999; offset += 3) {
        assert.deepEqual(
            plan.slice(offset, offset + 3).map(shot => shot.laneIndex).sort(),
            [0, 1, 2]
        );
    }
    assert.equal(plan.filter(shot => shot.willHit).length, 800);
    assert.equal(plan.filter(shot => !shot.willHit).length, 200);
});
