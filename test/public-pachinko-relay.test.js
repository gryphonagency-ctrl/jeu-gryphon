const assert = require('node:assert/strict');
const test = require('node:test');
const {
    PUBLIC_PACHINKO_RELAY_PATH,
    PublicPachinkoRelayGate
} = require('../public-pachinko-relay');

function createRequest({ ip = '203.0.113.10', origin = 'https://jeu6boite.onrender.com' } = {}) {
    return {
        headers: {
            host: 'jeu6boite.onrender.com',
            origin,
            'x-forwarded-for': `198.51.100.1, ${ip}`
        },
        socket: { remoteAddress: ip }
    };
}

function relayUrl(path = PUBLIC_PACHINKO_RELAY_PATH) {
    return new URL(`https://jeu6boite.onrender.com${path}`);
}

test('public access is limited to the secure same-origin Pachinko relay', () => {
    const gate = new PublicPachinkoRelayGate();
    const accepted = gate.acquire(createRequest(), relayUrl(), 1);
    assert.equal(accepted.allowed, true);
    accepted.release();

    assert.equal(gate.acquire(createRequest(), relayUrl('/'), 1).status, 403);
    assert.equal(gate.acquire(
        createRequest({ origin: 'https://other.example' }),
        relayUrl(),
        1
    ).status, 403);
    assert.equal(gate.acquire(
        createRequest({ origin: 'http://jeu6boite.onrender.com' }),
        relayUrl(),
        1
    ).status, 403);
});

test('public connections are capped per IP and release their active slots', () => {
    const gate = new PublicPachinkoRelayGate();
    const request = createRequest();
    const first = gate.acquire(request, relayUrl(), 1);
    const second = gate.acquire(request, relayUrl(), 1);

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(gate.acquire(request, relayUrl(), 1).status, 429);

    first.release();
    first.release();
    assert.equal(gate.acquire(request, relayUrl(), 1).allowed, true);
});

test('public connection attempts are limited within a rolling window', () => {
    const gate = new PublicPachinkoRelayGate();
    const request = createRequest();
    for (let attempt = 0; attempt < 10; attempt++) {
        const admission = gate.acquire(request, relayUrl(), 1);
        assert.equal(admission.allowed, true);
        admission.release();
    }

    assert.equal(gate.acquire(request, relayUrl(), 1).status, 429);
    assert.equal(gate.acquire(request, relayUrl(), 600_002).allowed, true);
});

test('public relay has a global active-connection cap', () => {
    const gate = new PublicPachinkoRelayGate();
    const admissions = [];
    for (let connection = 0; connection < 30; connection++) {
        const request = createRequest({ ip: `203.0.113.${connection + 1}` });
        const admission = gate.acquire(request, relayUrl(), 1);
        assert.equal(admission.allowed, true);
        admissions.push(admission);
    }

    assert.equal(gate.acquire(
        createRequest({ ip: '203.0.113.99' }),
        relayUrl(),
        1
    ).status, 429);
    admissions.forEach(admission => admission.release());
});
