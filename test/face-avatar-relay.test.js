const assert = require('node:assert/strict');
const test = require('node:test');
const {
    createDefaultFaceAvatarTracking,
    normalizeFaceAvatarTracking
} = require('../face-avatar-relay');

function makeTrackingRequest() {
    const defaults = createDefaultFaceAvatarTracking();
    return {
        type: 'FACE_AVATAR_TRACKING',
        active: true,
        scores: defaults.scores,
        rotation: { x: 0.1, y: -0.2, z: 0.3 }
    };
}

test('face avatar relay normalizes scores and bounds facial rotation', () => {
    const request = makeTrackingRequest();
    request.scores.jawOpen = 1.4;
    request.scores.eyeBlinkLeft = -0.2;
    request.rotation.x = Math.PI * 2;

    const tracking = normalizeFaceAvatarTracking(request);

    assert.equal(tracking.type, 'FACE_AVATAR_STATE');
    assert.equal(tracking.active, true);
    assert.equal(tracking.scores.jawOpen, 1);
    assert.equal(tracking.scores.eyeBlinkLeft, 0);
    assert.equal(tracking.rotation.x, Math.PI);
    assert.equal(tracking.rotation.y, -0.2);
});

test('face avatar relay rejects malformed and incomplete tracking data', () => {
    const missingScore = makeTrackingRequest();
    delete missingScore.scores.jawOpen;
    const invalidRotation = makeTrackingRequest();
    invalidRotation.rotation.y = Number.NaN;

    assert.equal(normalizeFaceAvatarTracking(null), null);
    assert.equal(normalizeFaceAvatarTracking({ ...makeTrackingRequest(), type: 'OTHER' }), null);
    assert.equal(normalizeFaceAvatarTracking(missingScore), null);
    assert.equal(normalizeFaceAvatarTracking(invalidRotation), null);
});

test('face avatar relay default state is neutral', () => {
    const tracking = createDefaultFaceAvatarTracking();

    assert.equal(tracking.active, false);
    assert.equal(tracking.scores.jawOpen, 0);
    assert.deepEqual(tracking.rotation, { x: 0, y: 0, z: 0 });
});
