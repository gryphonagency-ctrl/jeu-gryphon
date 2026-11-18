const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const test = require('node:test');

let connectionInstance;

class MockTikTokLiveConnection extends EventEmitter {
    constructor(username) {
        super();
        this.username = username;
        this.connectCalls = 0;
        this.disconnectCalls = 0;
        connectionInstance = this;
    }

    connect() {
        this.connectCalls++;
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

function createHarness({ diagnostics = false, username = 'test_user' } = {}) {
    const messages = [];
    let now = 1000;
    let watchdog;
    let reconnect;
    const originalNow = Date.now;
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;

    Date.now = () => now;
    global.setInterval = (callback, delay) => {
        if (delay === 30_000) {
            watchdog = callback;
            return { unref() {} };
        }
        return originalSetInterval(callback, delay);
    };
    global.clearInterval = () => {};
    global.setTimeout = (callback, delay, ...args) => {
        if (delay === 30_000) {
            reconnect = callback;
            return { unref() {} };
        }
        return originalSetTimeout(callback, delay, ...args);
    };
    global.clearTimeout = () => {};

    const stop = createTikTokSession(message => messages.push(message), username, undefined, { diagnostics });
    return {
        messages,
        connection: connectionInstance,
        get now() { return now; },
        set now(value) { now = value; },
        watchdog: () => watchdog(),
        runReconnect: () => {
            assert.equal(typeof reconnect, 'function');
            const callback = reconnect;
            reconnect = null;
            callback();
        },
        async restore() {
            await stop();
            Date.now = originalNow;
            global.setInterval = originalSetInterval;
            global.clearInterval = originalClearInterval;
            global.setTimeout = originalSetTimeout;
            global.clearTimeout = originalClearTimeout;
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

test('enables diagnostics for the monitored TikTok account', async () => {
    const previousMonitor = process.env.LIVE_TIKTOK_MONITOR_USERNAME;
    const previousDiagnostics = process.env.LIVE_TIKTOK_DIAGNOSTICS;
    const originalInfo = console.info;
    const logs = [];
    process.env.LIVE_TIKTOK_MONITOR_USERNAME = 'test_user';
    process.env.LIVE_TIKTOK_DIAGNOSTICS = 'false';
    console.info = (...values) => logs.push(values.join(' '));
    const harness = createHarness({ diagnostics: true });

    try {
        await new Promise(resolve => setImmediate(resolve));
        assert(logs.some(line =>
            line.includes('[TikTok diagnostic] connexion') &&
            line.includes('"state":"connectee"')
        ));
    } finally {
        console.info = originalInfo;
        await harness.restore();
        if (previousMonitor === undefined) delete process.env.LIVE_TIKTOK_MONITOR_USERNAME;
        else process.env.LIVE_TIKTOK_MONITOR_USERNAME = previousMonitor;
        if (previousDiagnostics === undefined) delete process.env.LIVE_TIKTOK_DIAGNOSTICS;
        else process.env.LIVE_TIKTOK_DIAGNOSTICS = previousDiagnostics;
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

test('disconnects and reconnects after a live stream ends', async () => {
    const harness = createHarness();
    try {
        await new Promise(resolve => setImmediate(resolve));
        harness.connection.emit('streamEnd', { action: 3 });
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(harness.connection.disconnectCalls, 1);
        assert(harness.messages.some(message =>
            message.type === 'STATUS' && message.message.includes('Direct TikTok terminé')
        ));
        assert(harness.messages.some(message => message.type === 'LIVE_END'));

        harness.runReconnect();
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(harness.connection.connectCalls, 2);
        assert(harness.messages.some(message =>
            message.type === 'STATUS' && message.message.includes('Direct TikTok connecté')
        ));
    } finally {
        await harness.restore();
    }
});
