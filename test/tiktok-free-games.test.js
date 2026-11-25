const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const freeGames = require('../tiktok-free-games');

test('only the games listed as free on the homepage are time-limited', () => {
    assert.equal(freeGames.FREE_GAME_IDS.length, 21);
    const homepage = fs.readFileSync(path.join(__dirname, '..', 'accueil.html'), 'utf8');
    const trialList = homepage.match(/const FREE_TRIAL_GAMES = new Set\((\[[^\]]+\])\);/);
    assert(trialList, 'the homepage free-game catalog is present');
    const homepageGameIds = [...trialList[1].matchAll(/'([^']+)'/g)]
        .map(match => match[1])
        .sort();
    assert.deepEqual([...freeGames.FREE_GAME_IDS].sort(), homepageGameIds);
    assert.equal(freeGames.isFreeGamePath('/pendu'), true);
    assert.equal(freeGames.isFreeGamePath('/pendu.html'), true);
    assert.equal(freeGames.isFreeGamePath('/ambiance-stade-maximale.html'), true);
    assert.equal(freeGames.isFreeGamePath('/petits-chevaux.html'), true);
    assert.equal(freeGames.isFreeGamePath('/bingo-gryphon.html'), false);
    assert.equal(freeGames.isFreeGamePath('/pachinko-live.html'), true);
    assert.equal(freeGames.isFreeGamePath('/live-photo-printer-studio.html'), true);
    assert.equal(freeGames.isFreeGamePath('/live-photo-printer-studio-realiste.html'), false);
});

test('Griffon Arcade members with game access do not need TikTok for free games', () => {
    assert.equal(freeGames.requiresTikTokAccess('/pendu.html', false), true);
    assert.equal(freeGames.requiresTikTokAccess('/pendu.html', true), false);
    assert.equal(freeGames.requiresTikTokAccess('/ambiance-stade-maximale.html', false), true);
    assert.equal(freeGames.requiresTikTokAccess('/ambiance-stade-maximale.html', true), false);
    assert.equal(freeGames.requiresTikTokAccess('/petits-chevaux.html', false), true);
    assert.equal(freeGames.requiresTikTokAccess('/petits-chevaux.html', true), false);
    assert.equal(freeGames.requiresTikTokAccess('/bingo-gryphon.html', true), false);
});

test('TikTok login uses an anti-forgery state and requests the verified username scope', async t => {
    const names = ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI'];
    const previousValues = new Map(names.map(name => [name, process.env[name]]));
    process.env.TIKTOK_CLIENT_KEY = 'test-client-key';
    process.env.TIKTOK_CLIENT_SECRET = 'test-client-secret';
    process.env.TIKTOK_REDIRECT_URI = 'https://jeu6boite.onrender.com/auth/tiktok/callback';
    t.after(() => {
        for (const [name, value] of previousValues) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    });

    const response = {
        headers: {},
        writeHead(status, headers) {
            this.status = status;
            Object.assign(this.headers, headers);
        },
        end(body) {
            this.body = body;
        },
        setHeader(name, value) {
            this.headers[name] = value;
        }
    };
    const req = {
        headers: { 'x-forwarded-proto': 'https' },
        socket: {}
    };
    freeGames.startLogin(req, response, '/pendu.html');

    assert.equal(response.status, 302);
    const authorizeUrl = new URL(response.headers.Location);
    assert.equal(authorizeUrl.origin, 'https://www.tiktok.com');
    assert.equal(authorizeUrl.searchParams.get('scope'), 'user.info.basic,user.info.profile');
    const state = authorizeUrl.searchParams.get('state');
    const stateCookie = response.headers['Set-Cookie'].split(';', 1)[0];
    assert.equal(stateCookie, `gryphon_tiktok_oauth_state=${state}`);

    const callbackResponse = {
        headers: {},
        writeHead(status, headers) {
            this.status = status;
            Object.assign(this.headers, headers);
        },
        end(body) {
            this.body = body;
        },
        setHeader(name, value) {
            this.headers[name] = value;
        }
    };
    await freeGames.completeLogin({
        headers: { cookie: stateCookie, 'x-forwarded-proto': 'https' },
        socket: {}
    }, callbackResponse, new URL(
        `https://jeu6boite.onrender.com/auth/tiktok/callback?state=${state}&error=access_denied`
    ), {});
    assert.equal(callbackResponse.status, 403);
    assert.match(callbackResponse.body, /Connexion TikTok annulée/);
});

test('daily TikTok game time accumulates, clamps at the limit, and respects bans', t => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gryphon-free-games-'));
    const previousDataFile = process.env.GAME_DATA_FILE;
    const accountStorePath = require.resolve('../account-store');
    const dbSyncPath = require.resolve('../db-sync');
    process.env.GAME_DATA_FILE = path.join(temporaryDirectory, 'accounts.json');
    delete require.cache[accountStorePath];
    delete require.cache[dbSyncPath];
    const store = require('../account-store');
    const playerId = 'a'.repeat(64);
    const firstHeartbeat = Date.parse('2026-11-23T12:00:00Z');

    t.after(() => {
        delete require.cache[accountStorePath];
        delete require.cache[dbSyncPath];
        if (previousDataFile === undefined) delete process.env.GAME_DATA_FILE;
        else process.env.GAME_DATA_FILE = previousDataFile;
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    assert.equal(store.getFreeGameDefaultLimitMinutes(), 60);
    store.upsertTikTokFreeGamePlayer({
        id: playerId,
        username: 'joueur.test',
        displayName: 'Joueur test'
    });
    assert.equal(store.recordTikTokFreeGameHeartbeat(
        playerId, '2026-11-23', firstHeartbeat, true
    ).usedSeconds, 0);
    assert.equal(store.recordTikTokFreeGameHeartbeat(
        playerId, '2026-11-23', firstHeartbeat + 10_000, true
    ).usedSeconds, 10);
    assert.equal(store.recordTikTokFreeGameHeartbeat(
        playerId, '2026-11-23', firstHeartbeat + 11_000, true
    ).usedSeconds, 11);

    store.setTikTokFreeGamePlayerAccess(playerId, {
        banned: false,
        limitMinutes: 1
    });
    const nearLimit = store.recordTikTokFreeGameHeartbeat(
        playerId, '2026-11-23', firstHeartbeat + 41_000, true
    );
    assert.equal(nearLimit.usedSeconds, 41);
    const atLimit = store.recordTikTokFreeGameHeartbeat(
        playerId, '2026-11-23', firstHeartbeat + 60_000, true
    );
    assert.equal(atLimit.allowed, false);
    assert.equal(atLimit.remainingSeconds, 0);

    const nextDay = store.getTikTokFreeGameStatus(playerId, '2026-11-24');
    assert.equal(nextDay.usedSeconds, 0);
    assert.equal(nextDay.allowed, true);

    store.setTikTokFreeGamePlayerAccess(playerId, {
        banned: true,
        limitMinutes: 1
    });
    assert.equal(store.getTikTokFreeGameStatus(playerId, '2026-11-24').banned, true);
});
