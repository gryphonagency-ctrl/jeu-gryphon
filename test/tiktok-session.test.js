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
        connectionInstance = this;
    }

    connect() {
        this.emit('websocketConnected');
        return Promise.resolve({ roomId: 'test-room' });
    }

    fetchAvailableGifts() {
        return Promise.resolve([]);
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
