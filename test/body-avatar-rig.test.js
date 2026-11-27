const assert = require('node:assert/strict');
const test = require('node:test');
const bodyAvatarRig = require('../avatar-face-tracker/body-avatar-rig.js');

test('body rig maps limbs and finger bones from the VRM skeleton', () => {
    assert.deepEqual(bodyAvatarRig.bodyBoneAction('Left arm'), {
        type: 'upperArm',
        side: 'left'
    });
    assert.deepEqual(bodyAvatarRig.bodyBoneAction('Right elbow'), {
        type: 'forearm',
        side: 'right'
    });
    assert.deepEqual(bodyAvatarRig.bodyBoneAction('IndexFinger2_L'), {
        type: 'finger',
        finger: 'index',
        joint: 1,
        side: 'left'
    });
    assert.deepEqual(bodyAvatarRig.bodyBoneAction('Thumb0_R'), {
        type: 'finger',
        finger: 'thumb',
        joint: 0,
        side: 'right'
    });
    assert.equal(bodyAvatarRig.sideForUnmirroredCamera('Left'), 'right');
    assert.equal(bodyAvatarRig.sideForUnmirroredCamera('Right'), 'left');
});

test('hand landmarks distinguish straight fingers from curled fingers', () => {
    const landmarks = Array.from({ length: 21 }, (_, index) => ({
        x: index,
        y: 0,
        z: 0
    }));

    for (const chain of [[0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]]) {
        for (let index = 0; index < chain.length; index++) {
            landmarks[chain[index]] = { x: index, y: 0, z: 0 };
        }
    }
    landmarks[1] = { x: 1, y: 0, z: 0 };
    landmarks[2] = { x: 2, y: 0, z: 0 };
    landmarks[3] = { x: 3, y: 0, z: 0 };
    landmarks[4] = { x: 4, y: 0, z: 0 };

    const straight = bodyAvatarRig.fingerJointBends(landmarks);
    assert.ok(straight.index.every(bend => bend < 1e-6));

    landmarks[6] = { x: 1, y: 1, z: 0 };
    const curled = bodyAvatarRig.fingerJointBends(landmarks);
    assert.ok(curled.index[0] > 0);
});
