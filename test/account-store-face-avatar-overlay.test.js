const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'account-store.js'), 'utf8');
const start = source.indexOf('function getCreatorAvatarOverlaySettings(username)');
const end = source.indexOf('\nfunction isCreatorServiceEnabled', start);
assert(start >= 0 && end > start, 'face avatar overlay store methods are present');

function createOverlayStore(initialStore = { creatorSettings: {} }) {
    const context = {
        crypto,
        readStore: () => initialStore,
        getCreatorSettings: username => initialStore.creatorSettings[username.toLowerCase()] || {},
        updateStore: mutator => mutator(initialStore)
    };
    vm.runInNewContext(
        `${source.slice(start, end)}; globalThis.overlayStore = {
            getCreatorAvatarOverlaySettings,
            setCreatorAvatarOverlaySettings,
            getCreatorAvatarOverlayOwner
        };`,
        context
    );
    return { store: initialStore, ...context.overlayStore };
}

test('face avatar overlay settings are isolated from other creator overlay settings', () => {
    const { store, getCreatorAvatarOverlaySettings, setCreatorAvatarOverlaySettings } =
        createOverlayStore({
            creatorSettings: {
                alice: {
                    arcadeBigGiftOverlayEnabled: false,
                    progressOverlay: { enabledLike: true },
                    faceAvatarOverlay: {
                        enabled: true,
                        token: 'a'.repeat(64),
                        modelId: 'b'.repeat(32),
                        modelFormat: 'glb'
                    }
                }
            }
        });

    setCreatorAvatarOverlaySettings('ALICE', {
        enabled: false,
        token: 'c'.repeat(64),
        modelId: 'd'.repeat(32),
        modelFormat: 'vrm'
    });

    assert.deepEqual(JSON.parse(JSON.stringify(getCreatorAvatarOverlaySettings('alice'))), {
        enabled: false,
        token: 'c'.repeat(64),
        modelId: 'd'.repeat(32),
        modelFormat: 'vrm'
    });
    assert.equal(store.creatorSettings.alice.arcadeBigGiftOverlayEnabled, false);
    assert.deepEqual(store.creatorSettings.alice.progressOverlay, { enabledLike: true });
});

test('face avatar overlay token resolves only to its creator', () => {
    const token = 'e'.repeat(64);
    const { getCreatorAvatarOverlayOwner } = createOverlayStore({
        creatorSettings: {
            alice: { faceAvatarOverlay: { token } },
            bob: { faceAvatarOverlay: { token: 'f'.repeat(64) } }
        }
    });

    assert.equal(getCreatorAvatarOverlayOwner(token), 'alice');
    assert.equal(getCreatorAvatarOverlayOwner('invalid'), '');
});

test('invalid face avatar metadata is rejected', () => {
    const { setCreatorAvatarOverlaySettings } = createOverlayStore();

    assert.throws(() => setCreatorAvatarOverlaySettings('alice', {
        enabled: true,
        token: 'invalid',
        modelId: null,
        modelFormat: null
    }), /settings are invalid/i);
    assert.throws(() => setCreatorAvatarOverlaySettings('alice', {
        enabled: true,
        token: null,
        modelId: 'not-an-id',
        modelFormat: 'glb'
    }), /settings are invalid/i);
    assert.throws(() => setCreatorAvatarOverlaySettings('alice', {
        enabled: true,
        token: null,
        modelId: 'd'.repeat(32),
        modelFormat: 'png'
    }), /settings are invalid/i);
});
