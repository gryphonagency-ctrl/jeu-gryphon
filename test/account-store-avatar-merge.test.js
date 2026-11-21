const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'account-store.js'), 'utf8');

function upsertPlayer(store, profile) {
    const start = source.indexOf('function upsertTikTokPlayer(profile)');
    const end = source.indexOf('\nfunction resolveTikTokPlayer', start);
    assert(start >= 0 && end > start, 'TikTok player upsert function is present');

    const context = {
        updateStore: mutator => mutator(store)
    };
    vm.runInNewContext(
        `${source.slice(start, end)}; globalThis.upsertTikTokPlayer = upsertTikTokPlayer;`,
        context
    );
    return context.upsertTikTokPlayer(profile);
}

function createStore(targetAvatar = { avatarKey: '', avatarType: '' }) {
    return {
        tiktokPlayers: {
            'handle:alice': {
                id: 'handle:alice',
                stars: 7,
                avatarKey: 'a'.repeat(64),
                avatarType: 'image/png',
                uniqueId: 'alice',
                username: 'alice',
                wallets: {}
            },
            'id:99': {
                id: 'id:99',
                stars: 2,
                ...targetAvatar,
                uniqueId: 'alice',
                username: 'alice',
                wallets: {}
            }
        },
        tiktokStarTransactions: {
            transaction: { playerId: 'handle:alice' }
        },
        tiktokPlayerAliases: {
            alice: 'handle:alice'
        }
    };
}

test('merging a handle player preserves its avatar when the ID record has none', () => {
    const store = createStore();
    const player = upsertPlayer(store, {
        userId: '99',
        uniqueId: 'alice',
        username: 'alice'
    });

    assert.equal(player.avatarKey, 'a'.repeat(64));
    assert.equal(player.avatarType, 'image/png');
    assert.equal(player.stars, 9);
    assert.equal(store.tiktokPlayers['handle:alice'], undefined);
    assert.equal(store.tiktokPlayerAliases.alice, 'id:99');
    assert.equal(store.tiktokStarTransactions.transaction.playerId, 'id:99');
});

test('merging keeps the ID record avatar when it already has one', () => {
    const store = createStore({
        avatarKey: 'b'.repeat(64),
        avatarType: 'image/jpeg'
    });
    const player = upsertPlayer(store, {
        userId: '99',
        uniqueId: 'alice',
        username: 'alice'
    });

    assert.equal(player.avatarKey, 'b'.repeat(64));
    assert.equal(player.avatarType, 'image/jpeg');
});
