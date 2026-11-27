const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const gameHtml = fs.readFileSync(path.join(__dirname, '..', 'pont-de-verre.html'), 'utf8');
const functionStart = gameHtml.indexOf('function normalizeLiveName(');
const functionEnd = gameHtml.indexOf('\nfunction handleLiveMessage(', functionStart);
assert(functionStart >= 0 && functionEnd > functionStart, 'the LIVE game handlers are present');

function createLiveHarness(){
    const status = { textContent: '' };
    const awarded = [];
    const banners = [];
    const sandbox = {
        alive: ['014', '027', '063'],
        awardedLivePlayers: new Set(),
        liveControllerByPlayer: new Map(),
        liveMoves: [],
        livePlayerAvatars: new Map(),
        livePlayerChoices: new Map(),
        livePlayerNames: new Map(),
        liveSteps: new Map(),
        liveStatus: status,
        pendingGiftChoices: new Map(),
        seenLiveGiftIds: new Set(),
        voiceOn: false,
        voiceTargetPlayer: null,
        window: {
            location: {
                href: 'https://arcade.example/pont-de-verre.html',
                origin: 'https://arcade.example'
            },
            ArcadeStars: {
                award: async details => {
                    awarded.push(details);
                    return { username: details.username, avatarUrl: '' };
                }
            }
        },
        URL,
        console
    };
    vm.createContext(sandbox);
    vm.runInContext(
        `${gameHtml.slice(functionStart, functionEnd)}
        globalThis.liveApi = { handleLiveComment, handleLiveGift, awardLiveWinner };`,
        sandbox
    );
    sandbox.renderLivePanels = () => {};
    sandbox.processLiveMoves = () => {};
    sandbox.showWinnerBanner = (...args) => banners.push(args);
    return { sandbox, status, awarded, banners };
}

test('gift assigns the next available character and grants one directional move', () => {
    const { sandbox } = createLiveHarness();

    sandbox.liveApi.handleLiveGift({ uniqueId: 'Alice', messageId: 'gift-1', repeatEnd: true });
    sandbox.liveApi.handleLiveGift({ uniqueId: 'Bob', messageId: 'gift-2', repeatEnd: true });
    sandbox.liveApi.handleLiveComment({ uniqueId: 'Alice', comment: 'droite' });
    sandbox.liveApi.handleLiveComment({ uniqueId: 'Alice', comment: 'gauche' });
    sandbox.liveApi.handleLiveComment({ uniqueId: 'Bob', comment: 'gauche' });

    assert.equal(sandbox.liveMoves.length, 2);
    assert.equal(sandbox.liveMoves[0].player, '014');
    assert.equal(sandbox.liveMoves[0].side, 'right');
    assert.equal(sandbox.liveMoves[1].player, '027');
    assert.equal(sandbox.liveMoves[1].side, 'left');
    assert.equal(sandbox.livePlayerChoices.get('alice'), '014');
});

test('direction without a gift does not enqueue a move', () => {
    const { sandbox, status } = createLiveHarness();

    sandbox.liveApi.handleLiveComment({ uniqueId: 'Alice', comment: 'gauche' });

    assert.equal(sandbox.liveMoves.length, 0);
    assert.match(status.textContent, /envoie un cadeau/i);
});

test('simulated winners never receive real wallet stars', async () => {
    const { sandbox, awarded, banners } = createLiveHarness();
    const move = { username: 'Alice', key: 'alice', player: '014', simulated: true };

    await sandbox.liveApi.awardLiveWinner(move, 'round-1');

    assert.equal(awarded.length, 0);
    assert.equal(banners[0][1], false);
    assert.equal(banners[0][2], true);
});

test('a live winner receives 50 stars with a round-scoped transaction id', async () => {
    const { sandbox, awarded, banners } = createLiveHarness();
    const move = { username: 'Alice', key: 'alice', player: '014', simulated: false };

    await sandbox.liveApi.awardLiveWinner(move, 'round-1');

    assert.equal(awarded.length, 1);
    assert.equal(awarded[0].amount, 50);
    assert.equal(awarded[0].username, 'Alice');
    assert.equal(awarded[0].transactionId, 'pont-de-verre:round-1:014');
    assert.equal(banners[0][1], true);
});
