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

test('malformed binary glTF data is rejected', () => {
    const invalid = makeGlb({ asset: { version: '2.0' }, meshes: [] });
    invalid.write('nope', 0, 'ascii');
    const truncated = makeGlb({ asset: { version: '2.0' }, meshes: [] }).subarray(0, 20);

    assert.equal(parseFaceAvatarOverlayGlb(invalid), null);
    assert.equal(hasFaceAvatarOverlayRig(truncated), false);
});

test('VRM expression names map MediaPipe eye and mouth scores', () => {
    assert.equal(faceAvatarRig.isRecognizedVrmExpression('blinkLeft'), true);
    assert.equal(faceAvatarRig.vrmExpressionValue({ eyeBlinkLeft: 0.8 }, 'blinkLeft'), 0.8);
    assert.equal(faceAvatarRig.vrmExpressionValue({ jawOpen: 0.6 }, 'aa'), 0.6);
    assert.equal(faceAvatarRig.trackingKeyForMorphTarget('eyeBlink_L'), 'eyeBlinkLeft');
    assert.equal(faceAvatarRig.trackingKeyForMorphTarget('mouthSmile_R'), 'mouthSmile');
});
