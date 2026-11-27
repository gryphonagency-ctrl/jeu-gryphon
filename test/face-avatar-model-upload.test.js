const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const faceAvatarRig = require('../avatar-face-tracker/face-avatar-rig');

const source = fs.readFileSync(path.join(__dirname, '..', 'serveur.js'), 'utf8');
const start = source.indexOf('function getFaceAvatarOverlayModelPath(owner, modelId, modelFormat)');
const end = source.indexOf('\nfunction getFaceAvatarOverlayUser', start);
assert(start >= 0 && end > start, 'face avatar model upload handlers are present');

function createGlb(targetNames) {
    const json = Buffer.from(JSON.stringify({
        asset: { version: '2.0' },
        meshes: [{
            primitives: [{ targets: targetNames.map(() => ({})) }],
            extras: { targetNames }
        }]
    }));
    const padding = (4 - (json.length % 4)) % 4;
    const jsonChunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
    const model = Buffer.alloc(20 + jsonChunk.length);
    model.write('glTF', 0, 'ascii');
    model.writeUInt32LE(2, 4);
    model.writeUInt32LE(model.length, 8);
    model.writeUInt32LE(jsonChunk.length, 12);
    model.writeUInt32LE(0x4e4f534a, 16);
    jsonChunk.copy(model, 20);
    return model;
}

function createUploadHarness(t, initialSettings) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'face-avatar-model-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    let settings = { ...initialSettings };
    const context = {
        Buffer,
        crypto,
        faceAvatarOverlayDirectory: directory,
        FACE_AVATAR_OVERLAY_MAX_BYTES: 25 * 1024 * 1024,
        faceAvatarRig,
        fs,
        path,
        store: {
            getCreatorAvatarOverlaySettings: () => ({ ...settings }),
            setCreatorAvatarOverlaySettings: (_username, nextSettings) => {
                settings = { ...nextSettings };
            }
        }
    };
    vm.runInNewContext(
        `${source.slice(start, end)}; globalThis.upload = {
            getFaceAvatarOverlayModelPath,
            receiveFaceAvatarOverlayModel
        };`,
        context
    );
    return {
        directory,
        getSettings: () => settings,
        ...context.upload
    };
}

function sendUpload(handler, model, format = 'glb') {
    const request = new EventEmitter();
    request.headers = {
        'content-type': 'application/octet-stream',
        'x-avatar-format': format
    };
    request.resume = () => {};
    const response = {
        status: null,
        headers: null,
        body: '',
        destroyed: false,
        writableEnded: false,
        writeHead(status, headers) {
            this.status = status;
            this.headers = headers;
        },
        end(body) {
            this.body = body || '';
            this.writableEnded = true;
        }
    };

    handler(request, response, 'alice');
    request.emit('data', model);
    request.emit('end');
    return response;
}

test('model upload replaces only its creator model and preserves link settings', t => {
    const oldModelId = 'a'.repeat(32);
    const initialSettings = {
        enabled: true,
        token: 'b'.repeat(64),
        modelId: oldModelId,
        modelFormat: 'glb'
    };
    const harness = createUploadHarness(t, initialSettings);
    const oldPath = harness.getFaceAvatarOverlayModelPath('alice', oldModelId, 'glb');
    fs.mkdirSync(path.dirname(oldPath), { recursive: true });
    fs.writeFileSync(oldPath, 'previous model');

    const response = sendUpload(
        harness.receiveFaceAvatarOverlayModel,
        createGlb(['jawOpen']),
        'glb'
    );
    const saved = harness.getSettings();
    const newPath = harness.getFaceAvatarOverlayModelPath('alice', saved.modelId, saved.modelFormat);

    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).success, true);
    assert.equal(saved.enabled, true);
    assert.equal(saved.token, initialSettings.token);
    assert.equal(saved.modelFormat, 'glb');
    assert.notEqual(saved.modelId, oldModelId);
    assert.equal(fs.existsSync(oldPath), false);
    assert.deepEqual(fs.readFileSync(newPath), createGlb(['jawOpen']));
});

test('model upload rejects a GLB without supported facial expressions', t => {
    const initialSettings = {
        enabled: false,
        token: null,
        modelId: null,
        modelFormat: null
    };
    const harness = createUploadHarness(t, initialSettings);
    const response = sendUpload(
        harness.receiveFaceAvatarOverlayModel,
        createGlb([]),
        'glb'
    );

    assert.equal(response.status, 400);
    assert.match(JSON.parse(response.body).message, /expressions faciales reconnues/i);
    assert.deepEqual(harness.getSettings(), initialSettings);
    assert.equal(fs.existsSync(path.join(harness.directory, 'alice')), false);
});
