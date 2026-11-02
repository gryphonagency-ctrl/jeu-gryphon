'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createServer, DRAWING_CATALOG } = require('./server');

async function startServer(options = {}) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    })
  };
}

async function createGame(baseUrl, difficulty = 1) {
  const response = await fetch(`${baseUrl}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ difficulty })
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function submitGuess(baseUrl, gameId, guess) {
  return fetch(`${baseUrl}/api/games/${gameId}/guess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guess, username: 'joueur' })
  });
}

test('bundles exactly 1,000 different answers across five difficulty levels', () => {
  assert.equal(DRAWING_CATALOG.length, 1_000);
  assert.equal(new Set(DRAWING_CATALOG.map(drawing => drawing.id)).size, 1_000);
  assert.equal(new Set(DRAWING_CATALOG.map(drawing => drawing.word.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr')
    .replace(/œ/g, 'oe').replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, ' '))).size, 1_000);
  assert.deepEqual(
    Object.fromEntries([1, 2, 3, 4, 5].map(level => [
      level,
      DRAWING_CATALOG.filter(drawing => drawing.difficulty === level).length
    ])),
    { 1: 248, 2: 230, 3: 200, 4: 180, 5: 142 }
  );
  assert.ok(new Set(DRAWING_CATALOG.map(drawing => drawing.theme)).size >= 8);
});

test('health endpoint confirms the game works offline without an AI key', async t => {
  const app = await startServer({ random: () => 0 });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    aiRequired: false,
    drawingCount: 1_000,
    difficultyLevels: 5
  });

  const game = await createGame(app.baseUrl);
  assert.equal(game.difficulty, 1);
  assert.equal(game.difficultyName, 'Facile');
  assert.equal(game.theme, 'objets familiers');
  assert.equal(game.hint, '_ _ _ _ _ _');
  assert.equal(game.wordLength, 6);
  assert.equal(game.roundDurationSeconds, 15);
  assert.equal('word' in game, false);
  assert.match(game.image, /^data:image\/svg\+xml;base64,/);

  const svg = Buffer.from(game.image.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<g class="sketch" filter="url\(#rough\)">/);
  assert.match(svg, /<feTurbulence type="fractalNoise"/);
  assert.match(svg, /feColorMatrix type="saturate" values="0"/);
  assert.match(svg, /stroke:#171717/);
  assert.equal(svg.includes('soleil'), false);

  const wrongGuess = await submitGuess(app.baseUrl, game.gameId, 'chat');
  assert.deepEqual(await wrongGuess.json(), { correct: false });

  const rightGuess = await submitGuess(app.baseUrl, game.gameId, 'SOLEIL');
  assert.deepEqual(await rightGuess.json(), {
    correct: true,
    winner: 'joueur',
    answer: 'soleil'
  });
});

test('serves centered pictograms safely as bundled SVG artwork', async t => {
  const pictogram = {
    id: 'test-pictogram',
    word: 'visage test',
    emoji: '<script>alert(1)</script>',
    theme: 'visages et émotions',
    difficulty: 1
  };
  const app = await startServer({ catalog: [pictogram], random: () => 0 });
  t.after(() => app.close());

  const game = await createGame(app.baseUrl);
  const svg = Buffer.from(game.image.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(/<script|onload=|javascript:/i.test(svg), false);
  assert.match(svg, /text-anchor="middle"/);
  assert.match(svg, /<g class="sketch" filter="url\(#rough\)">/);
  assert.match(svg, /feColorMatrix type="saturate" values="0"/);
});

test('starts consecutive rounds instantly without daily or per-IP generation limits', async t => {
  const app = await startServer({ random: () => 0 });
  t.after(() => app.close());

  const images = new Set();
  for (let round = 0; round < 15; round += 1) {
    const game = await createGame(app.baseUrl);
    images.add(game.image);
  }
  assert.equal(images.size, 15);
});

test('serves the requested difficulty and rejects invalid difficulty levels', async t => {
  const catalog = Array.from({ length: 5 }, (_, index) => ({
    id: `level-${index + 1}`,
    word: `niveau ${index + 1}`,
    emoji: '🎨',
    theme: 'objets familiers',
    difficulty: index + 1
  }));
  const app = await startServer({ catalog, random: () => 0 });
  t.after(() => app.close());

  for (let level = 1; level <= 5; level += 1) {
    const game = await createGame(app.baseUrl, level);
    assert.equal(game.difficulty, level);
    assert.equal(game.difficultyName, ['Facile', 'Intermédiaire', 'Moyen', 'Difficile', 'Expert'][level - 1]);
  }

  const invalid = await fetch(`${app.baseUrl}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ difficulty: 6 })
  });
  assert.equal(invalid.status, 400);
});

test('counts letters without spaces in a multi-word answer', async t => {
  const app = await startServer({
    catalog: [{
      id: 'multi-word',
      word: 'chat noir',
      emoji: '🐈‍⬛',
      theme: 'animaux et nature',
      difficulty: 1
    }],
    random: () => 0
  });
  t.after(() => app.close());

  const game = await createGame(app.baseUrl);
  assert.equal(game.wordLength, 8);
  assert.equal((game.hint.match(/_/g) || []).length, 8);
  const response = await submitGuess(app.baseUrl, game.gameId, 'CHAT NOIR');
  assert.deepEqual(await response.json(), {
    correct: true,
    winner: 'joueur',
    answer: 'chat noir'
  });
});

test('expires a round after 15 seconds and rejects late guesses', async t => {
  let now = 1_000;
  const app = await startServer({
    catalog: [{
      id: 'timed-drawing',
      word: 'soleil',
      emoji: '☀️',
      theme: 'objets familiers',
      difficulty: 1
    }],
    random: () => 0,
    clock: () => now
  });
  t.after(() => app.close());

  const game = await createGame(app.baseUrl);
  now += 14_999;
  const inTime = await submitGuess(app.baseUrl, game.gameId, 'soleil');
  assert.equal((await inTime.json()).correct, true);

  const nextGame = await createGame(app.baseUrl);
  now += 15_000;
  const expired = await submitGuess(app.baseUrl, nextGame.gameId, 'soleil');
  assert.deepEqual(await expired.json(), {
    correct: false,
    finished: true,
    expired: true
  });

  const lateGuess = await submitGuess(app.baseUrl, nextGame.gameId, 'soleil');
  assert.deepEqual(await lateGuess.json(), {
    correct: false,
    finished: true,
    expired: true
  });
});
