const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const faceAvatarRig = require('../avatar-face-tracker/face-avatar-rig');

const source = fs.readFileSync(path.join(__dirname, '..', 'serveur.js'), 'utf8');
const start = source.indexOf('function parseFaceAvatarOverlayGlb(buffer)');
const end = source.indexOf('\nfunction sendFaceAvatarOverlayJson', start);
assert(start >= 0 && end > start, 'GLB validation helpers are present');

const context = { Buffer, faceAvatarRig };
vm.runInNewContext(
    `${source.slice(start, end)}; globalThis.validation = {
        parseFaceAvatarOverlayGlb,
        hasFaceAvatarOverlayRig
    };`,
    context
);
const { parseFaceAvatarOverlayGlb, hasFaceAvatarOverlayRig } = context.validation;

function makeGlb(document) {
    const json = Buffer.from(JSON.stringify(document));
    const padding = (4 - (json.length % 4)) % 4;
    const jsonChunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
    const result = Buffer.alloc(20 + jsonChunk.length);
    result.write('glTF', 0, 'ascii');
    result.writeUInt32LE(2, 4);
    result.writeUInt32LE(result.length, 8);
    result.writeUInt32LE(jsonChunk.length, 12);
    result.writeUInt32LE(0x4e4f534a, 16);
    jsonChunk.copy(result, 20);
    return result;
}

test('GLB with named face morph targets passes validation', () => {
    const model = makeGlb({
        asset: { version: '2.0' },
        meshes: [{
            primitives: [{ targets: [{}, {}] }],
            extras: { targetNames: ['jawOpen', 'eyeBlinkLeft'] }
        }]
    });

    assert.equal(parseFaceAvatarOverlayGlb(model).asset.version, '2.0');
    assert.equal(hasFaceAvatarOverlayRig(model), true);
});

test('VRM expressions pass validation while models without facial rigs are rejected', () => {
    const vrm = makeGlb({
        asset: { version: '2.0' },
        extensions: {
            VRMC_vrm: {
                expressions: {
                    preset: {
                        aa: { morphTargetBinds: [{ node: 0, index: 0, weight: 1 }] }
                    }
                }
            }
        }
    });
    const vrm0 = makeGlb({
        asset: { version: '2.0' },
        extensions: {
            VRM: {
                blendShapeMaster: {
                    blendShapeGroups: [{
                        presetName: 'Blink',
                        binds: [{ mesh: 0, index: 0, weight: 1 }]
                    }]
                }
            }
        }
    });
    const noFaceRig = makeGlb({ asset: { version: '2.0' }, meshes: [{ primitives: [{}] }] });
    const mismatchedNames = makeGlb({
        asset: { version: '2.0' },
        meshes: [{
            primitives: [{ targets: [{}] }],
            extras: { targetNames: ['jawOpen', 'eyeBlinkLeft'] }
        }]
    });

    assert.equal(hasFaceAvatarOverlayRig(vrm), true);
    assert.equal(hasFaceAvatarOverlayRig(vrm0), true);
    assert.equal(hasFaceAvatarOverlayRig(noFaceRig), false);
    assert.equal(hasFaceAvatarOverlayRig(mismatchedNames), false);
});

test('VRM with facial bones in its skin joints passes validation', () => {
    const facialRig = makeGlb({
        asset: { version: '2.0' },
        meshes: [{
            primitives: [{
                attributes: { JOINTS_0: 0, WEIGHTS_0: 1 }
            }]
        }],
        nodes: [
            { name: 'Body', mesh: 0, skin: 0 },
            { name: 'Jaw' },
            { name: 'TL_Eyelid_A' },
            { name: 'BR_Eyelid_A' },
            { name: 'Left_Brow_A' }
        ],
        skins: [{ joints: [1, 2, 3, 4] }]
    });
    const jawOnly = makeGlb({
        asset: { version: '2.0' },
        meshes: [{
            primitives: [{
                attributes: { JOINTS_0: 0, WEIGHTS_0: 1 }
            }]
        }],
        nodes: [
            { name: 'Body', mesh: 0, skin: 0 },
            { name: 'Jaw' }
        ],
        skins: [{ joints: [1] }]
    });
    const unattachedRig = makeGlb({
        asset: { version: '2.0' },
        nodes: [
            { name: 'Jaw' },
            { name: 'TL_Eyelid_A' },
            { name: 'BR_Eyelid_A' }
        ],
        skins: [{ joints: [0] }]
    });

    assert.equal(hasFaceAvatarOverlayRig(facialRig), true);
    assert.equal(hasFaceAvatarOverlayRig(jawOnly), false);
    assert.equal(hasFaceAvatarOverlayRig(unattachedRig), false);
});

test('malformed binary glTF data is rejected', () => {
    const invalid = makeGlb({ asset: { version: '2.0' }, meshes: [] });
    invalid.write('nope', 0, 'ascii');
    const truncated = makeGlb({ asset: { version: '2.0' }, meshes: [] }).subarray(0, 20);

    assert.equal(parseFaceAvatarOverlayGlb(invalid), null);
    assert.equal(hasFaceAvatarOverlayRig(truncated), false);
});

test('bundled Luffy VRM has a facial rig accepted by the overlay', () => {
    const model = fs.readFileSync(
        path.join(__dirname, '..', 'avatar-face-tracker', 'assets', 'luffy.vrm')
    );

    assert.equal(hasFaceAvatarOverlayRig(model), true);
});

test('VRM expression names map MediaPipe eye and mouth scores', () => {
    assert.equal(faceAvatarRig.isRecognizedVrmExpression('blinkLeft'), true);
    assert.equal(faceAvatarRig.vrmExpressionValue({ eyeBlinkLeft: 0.8 }, 'blinkLeft'), 0.8);
    assert.equal(faceAvatarRig.vrmExpressionValue({ jawOpen: 0.6 }, 'aa'), 0.6);
    assert.equal(faceAvatarRig.trackingKeyForMorphTarget('eyeBlink_L'), 'eyeBlinkLeft');
    assert.equal(faceAvatarRig.trackingKeyForMorphTarget('mouthSmile_R'), 'mouthSmile');
});

test('facial bones map eyelids, jaw, brows and lip corners to tracked expressions', () => {
    const jaw = faceAvatarRig.facialBoneAction('Jaw');
    const eyelid = faceAvatarRig.facialBoneAction('TL_Eyelid_A');
    const corner = faceAvatarRig.facialBoneAction('R_Lip_Corner');

    assert.deepEqual(jaw, { type: 'jaw' });
    assert.deepEqual(eyelid, { type: 'upperEyelid', side: 'left' });
    assert.deepEqual(corner, { type: 'lipCorner', side: 'right' });
    assert.equal(faceAvatarRig.hasRecognizedFacialBones([
        'Jaw',
        'TL_Eyelid_A',
        'BR_Eyelid_A'
    ]), true);
    assert.equal(
        faceAvatarRig.facialBoneValue({ jawOpen: 0, mouthClose: 1 }, jaw),
        0
    );
    assert.ok(Math.abs(
        faceAvatarRig.facialBoneValue({ jawOpen: 0.8, mouthClose: 0 }, jaw) - 0.72
    ) < 1e-9);
    assert.equal(
        faceAvatarRig.facialBoneValue({ eyeBlinkLeft: 0.4 }, eyelid),
        0.5
    );
    assert.equal(
        faceAvatarRig.facialBoneValue({ eyeBlinkLeft: 0.8 }, eyelid),
        1
    );
    assert.equal(
        faceAvatarRig.facialBoneValue({
            mouthSmileRight: 0.75,
            mouthFrownRight: 0.15
        }, corner),
        0.6
    );
});
