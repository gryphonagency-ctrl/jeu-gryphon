const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

test('star balances and RUN debits stay within each authenticated creator wallet', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'serveur.js'), 'utf8');
    const start = source.indexOf('function getSessionWalletOwners(session)');
    const end = source.indexOf('function sendBalloonGameRole', start);
    assert(start >= 0 && end > start, 'wallet session functions are present');

    const balances = new Map([
        ['creator-one', 8],
        ['creator-two', 3]
    ]);
    const player = { id: 'id:99', username: 'viewer' };
    const store = {
        resolveTikTokPlayer: () => player,
        getWalletBalance: (_player, owner) => balances.get(owner) || 0,
        applyTikTokStarTransaction({ owner, delta }) {
            balances.set(owner, (balances.get(owner) || 0) + delta);
            return { applied: true };
        }
    };
    const clients = ['creator-one', 'creator-two', 'creator-one'].map(owner => ({
        owner,
        readyState: 1,
        messages: [],
        send(message) {
            this.messages.push(JSON.parse(message));
        }
    }));
    const authenticatedClientUsernames = new Map(
        clients.map(client => [client, client.owner])
    );
    const overlay = {
        readyState: 1,
        messages: [],
        send(message) {
            this.messages.push(JSON.parse(message));
        }
    };
    authenticatedClientUsernames.set(overlay, 'creator-one');

    const context = {
        WebSocket: { OPEN: 1 },
        authenticatedClientUsernames,
        overlaySockets: new Set([overlay]),
        treasureOverlaySocketOwners: new Map(),
        store,
        getPublicTikTokPlayer: (value, owner) => ({
            playerId: value.id,
            username: value.username,
            stars: store.getWalletBalance(value, owner)
        }),
        crypto: {
            createHash: () => ({
                update() { return this; },
                digest: () => 'transaction-hash'
            }),
            randomUUID: () => 'transaction-id'
        }
    };
    const walletCode = source.slice(start, end);
    vm.runInNewContext(
        `${walletCode}; globalThis.walletApi = processTikTokWalletCommand;`,
        context
    );

    const session = { username: 'cityhunter698', clients: new Set([...clients, overlay]) };
    const comment = (text, messageId) => ({
        type: 'comment',
        commentData: { comment: text, messageId }
    });

    context.walletApi(session, comment('étoiles', 'stars-1'), player);
    assert.equal(clients[0].messages.at(-1).player.stars, 8);
    assert.equal(clients[1].messages.at(-1).player.stars, 3);
    assert.equal(clients[2].messages.at(-1).player.stars, 8);
    assert.equal(overlay.messages.length, 0);

    context.walletApi(session, comment('run', 'run-1'), player);
    assert.equal(balances.get('creator-one'), 0);
    assert.equal(balances.get('creator-two'), 0);
    assert.equal(clients[0].messages.at(-1).spent, 8);
    assert.equal(clients[1].messages.at(-1).spent, 3);
    assert.equal(overlay.messages.length, 0);
});
