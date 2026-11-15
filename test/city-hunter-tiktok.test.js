const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function createGameHarness() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'city-hunter-tiktok.html'), 'utf8');
    const script = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
        .map(match => match[1])
        .filter(Boolean)
        .at(-1);
    const drawnText = [];
    const frameCallbacks = [];
    const elements = new Map();
    let now = 0;
    let socket;
    let reward;

    const context = new Proxy({
        createLinearGradient: () => ({ addColorStop() {} }),
        createRadialGradient: () => ({ addColorStop() {} }),
        fillText(text, x, y) {
            drawnText.push([String(text), x, y]);
        }
    }, {
        get(target, key) {
            return key in target ? target[key] : () => {};
        },
        set(target, key, value) {
            target[key] = value;
            return true;
        }
    });

    class Element {
        constructor(id) {
            this.id = id;
            this.value = id === 'roundDuration' ? '90' : '';
            this.style = {};
            this.dataset = {};
            this.listeners = {};
            this.hidden = false;
            this.files = [];
        }

        addEventListener(name, callback) {
            this.listeners[name] = callback;
        }

        setAttribute() {}
        removeAttribute() {}
        getContext() { return context; }
        getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540 }; }

        click() {
            if (this.onclick) this.onclick();
            else this.listeners.click?.({});
        }
    }

    const getElement = id => {
        if (!elements.has(id)) elements.set(id, new Element(id));
        return elements.get(id);
    };

    class MockWebSocket {
        constructor() { socket = this; }
        send() {}
        close() {}
    }

    const window = {
        WebSocket: MockWebSocket,
        ArcadeStars: {
            award(value) {
                reward = value;
                return Promise.resolve({ username: value.username, stars: 3 });
            }
        },
        addEventListener() {},
        setTimeout() { return 1; },
        clearTimeout() {},
        innerWidth: 960,
        innerHeight: 540,
        devicePixelRatio: 1
    };
    const document = {
        getElementById: getElement,
        createElement: id => new Element(id),
        querySelectorAll: () => [],
        addEventListener() {},
        documentElement: { requestFullscreen: async () => {} },
        body: new Element('body'),
        fullscreenElement: null
    };

    vm.runInNewContext(script, {
        window,
        document,
        WebSocket: MockWebSocket,
        requestAnimationFrame: callback => frameCallbacks.push(callback),
        performance: { now: () => now },
        Image: class { set src(value) { this._src = value; } },
        crypto: { randomUUID: () => 'fixed-uuid' },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        console,
        Math,
        Date,
        setTimeout: window.setTimeout,
        clearTimeout: window.clearTimeout
    }, { filename: 'city-hunter-tiktok.html' });

    function advanceFrame() {
        now += 50;
        frameCallbacks.shift()(now);
    }

    return {
        elements,
        getElement,
        drawnText,
        advanceFrame,
        get socket() { return socket; },
        get reward() { return reward; }
    };
}

test('all gift values attack a team and the awarded stars use the live wallet', async () => {
    const game = createGameHarness();
    game.getElement('go').click();
    game.getElement('soundToggle').click();
    game.getElement('tiktokUser').value = 'cityhunter698';
    game.getElement('con').click();
    game.socket.onopen();

    game.socket.onmessage({
        data: JSON.stringify({
            type: 'gift',
            gift: {
                messageId: 'gift-1',
                username: 'viewer1',
                uniqueId: 'viewer1',
                coinCount: 7,
                user: { uniqueId: 'viewer1' }
            },
            walletPlayer: { playerId: 'id:101', username: 'viewer1' }
        })
    });
    game.advanceFrame();
    assert(game.drawnText.some(([text, x, y]) =>
        text === '7' && x === 30 && y === 76
    ), 'an unassigned viewer’s gift should attack the trailing Wolf side on a tie');

    game.socket.onmessage({
        data: JSON.stringify({
            type: 'comment',
            commentData: { username: 'viewer2', uniqueId: 'viewer2', comment: 'renne' }
        })
    });
    game.socket.onmessage({
        data: JSON.stringify({
            type: 'gift',
            gift: {
                messageId: 'gift-2',
                username: 'viewer2',
                uniqueId: 'viewer2',
                coinCount: 125,
                user: { uniqueId: 'viewer2' }
            },
            walletPlayer: { playerId: 'id:202', username: 'viewer2' }
        })
    });
    game.advanceFrame();
    assert(game.drawnText.some(([text, x, y]) =>
        text === '125' && x === 930 && y === 76
    ), 'a selected Queen-side gift over 30 coins should still attack');

    game.getElement('roundDuration').value = '1';
    game.getElement('applyTimer').click();
    for (let frame = 0; frame < 24; frame++) game.advanceFrame();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(game.reward.playerId, 'id:202');
    assert.equal(game.reward.amount, 26);

    game.socket.onmessage({
        data: JSON.stringify({
            type: 'WALLET_BALANCE',
            player: { username: 'viewer2', stars: 17 }
        })
    });
    assert.equal(game.getElement('walletStars').textContent, '17');
});
