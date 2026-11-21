const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const test = require('node:test');

let connectionInstance;

class MockTikTokLiveConnection extends EventEmitter {
    constructor(username) {
        super();
        this.username = username;
        this.disconnectCalls = 0;
        this.giftRequest = null;
        this.webClient = {
            clientParams: { aid: '1988' },
            getJsonObjectFromWebcastApi: (...args) => {
                this.giftRequest = args;
                return Promise.resolve({
                    statusCode: 0,
                    data: {
                        gifts: [{ id: 123, name: 'Rose', diamond_count: 1 }]
                    }
                });
            }
        };
        connectionInstance = this;
    }

    connect() {
        this.emit('websocketConnected');
        return Promise.resolve({ roomId: 'test-room' });
    }

    disconnect() {
        this.disconnectCalls++;
        return Promise.resolve();
    }
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'tiktok-live-connector') {
        return { TikTokLiveConnection: MockTikTokLiveConnection };
    }
    return originalLoad.apply(this, arguments);
};
let createTikTokSession;
try {
    ({ createTikTokSession } = require('../tiktok-session'));
} finally {
    Module._load = originalLoad;
}

function createHarness() {
    const messages = [];
    let now = 1000;
    let watchdog;
    const originalNow = Date.now;
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;

    Date.now = () => now;
    global.setInterval = (callback, delay) => {
        if (delay === 30_000) {
            watchdog = callback;
            return { unref() {} };
        }
        return originalSetInterval(callback, delay);
    };
    global.clearInterval = () => {};

    const stop = createTikTokSession(message => messages.push(message), 'test_user');
    return {
        messages,
        connection: connectionInstance,
        get now() { return now; },
        set now(value) { now = value; },
        watchdog: () => watchdog(),
        async restore() {
            await stop();
            Date.now = originalNow;
            global.setInterval = originalSetInterval;
            global.clearInterval = originalClearInterval;
        }
    };
}

test('forwards TikTok likes and viewer counts', async () => {
    const harness = createHarness();
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        await new Promise(resolve => setImmediate(resolve));
        const giftsMessage = harness.messages.find(message => message.type === 'AVAILABLE_GIFTS');
        assert.deepEqual(harness.connection.giftRequest, [
            'gift/list/',
            { aid: '1988', room_id: 'test-room' },
            false
        ]);
        assert.deepEqual(giftsMessage.gifts, [{
            id: 123,
            name: 'Rose',
            coinValue: 1,
            imageUrl: ''
        }]);
        harness.connection.emit('roomUser', { viewerCount: 77 });
        harness.connection.emit('like', {
            count: 5,
            common: { msgId: 'like-1' },
            user: { uniqueId: 'viewer1', nickname: 'Viewer' }
        });
        await new Promise(resolve => setImmediate(resolve));

        assert(harness.messages.some(message =>
            message.type === 'viewerCount' && message.viewerCount === 77
        ));
        assert(harness.messages.some(message =>
            message.type === 'like' && message.likeData.likeCount === 5
        ));
    } finally {
        console.warn = originalWarn;
        await harness.restore();
    }
});

test('forwards a gift with its avatar in the same message', async () => {
    const harness = createHarness();
    const originalFetch = global.fetch;
    const originalWarn = console.warn;
    global.fetch = async () => ({
        ok: true,
        headers: {
            get: name => name.toLowerCase() === 'content-type'
                ? 'image/png'
                : String(Buffer.from([137,80,78,71]).length)
        },
        arrayBuffer: async () => Buffer.from([137,80,78,71])
    });
    console.warn = () => {};
    try {
        await new Promise(resolve => setImmediate(resolve));
        harness.connection.emit('gift', {
            common: { msgId: 'gift-avatar-1' },
            giftType: 1,
            repeatEnd: true,
            repeatCount: 1,
            coinValue: 1,
            user: {
                userId: '123',
                displayId: 'winner',
                uniqueId: 'winner',
                nickname: 'Winner',
                avatarLarge: 'https://example.test/avatar.png'
            },
            giftDetails: { giftName: 'Rose', diamondCount: 1 }
        });
        await new Promise(resolve => setTimeout(resolve, 20));
        const gift = harness.messages.find(message =>
            message.type === 'gift' && message.gift?.messageId === 'gift-avatar-1'
        );
        assert(gift);
        assert.match(gift.gift.avatarDataUri, /^data:image\/png;base64,/);
    } finally {
        global.fetch = originalFetch;
        console.warn = originalWarn;
        await harness.restore();
    }
});

test('reconnects after websocket frames stop arriving', async () => {
    const harness = createHarness();
    try {
        await new Promise(resolve => setImmediate(resolve));
        harness.now = 60_000;
        harness.connection.emit('websocketData');
        harness.now += 89_999;
        harness.watchdog();
        assert.equal(harness.connection.disconnectCalls, 0);

        harness.now++;
        harness.watchdog();
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(harness.connection.disconnectCalls, 1);
        assert(harness.messages.some(message =>
            message.type === 'STATUS' && message.message.includes('Flux TikTok silencieux')
        ));
    } finally {
        await harness.restore();
    }
});
