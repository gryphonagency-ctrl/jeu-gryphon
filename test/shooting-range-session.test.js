'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

test('shared shooting-range room elects an owner and promotes a participant on disconnect', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'serveur.js'), 'utf8');
    const start = source.indexOf('function sendShootingRangeRole(session, socket)');
    const end = source.indexOf('function detachClient', start);
    assert(start >= 0 && end > start, 'shooting-range room helpers are present');

    const context = {
        WebSocket: { OPEN: 1 },
        MAX_SHOOTING_RANGE_PLAYERS: 30
    };
    vm.runInNewContext(
        `${source.slice(start, end)}; globalThis.roomApi = { addShootingRangeClient, removeShootingRangeClient };`,
        context
    );

    const createClient = () => ({
        readyState: 1,
        messages: [],
        send(message) {
            this.messages.push(JSON.parse(message));
        }
    });
    const host = createClient();
    const participant = createClient();
    const state = { active: true, score: 12 };
    const session = {
        shootingRangeClients: new Set(),
        shootingRangeOwner: null,
        shootingRangeLastState: state
    };

    context.roomApi.addShootingRangeClient(session, host);
    context.roomApi.addShootingRangeClient(session, participant);
    assert.equal(session.shootingRangeOwner, host);
    assert.equal(host.messages[0].owner, true);
    assert.equal(participant.messages[0].owner, false);
    assert.deepEqual(participant.messages[0].state, state);

    context.roomApi.removeShootingRangeClient(session, host);
    assert.equal(session.shootingRangeOwner, participant);
    const promotedRole = participant.messages
        .filter(message => message.type === 'SHOOTING_RANGE_ROLE')
        .at(-1);
    assert.ok(promotedRole);
    assert.equal(promotedRole.owner, true);
    assert.deepEqual(promotedRole.state, state);
});
