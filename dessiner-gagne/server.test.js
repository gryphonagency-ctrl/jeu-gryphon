'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createServer } = require('./server');

const VALID_STROKES = [
  { color: 'black', width: 12, closed: true, fill: 'yellow', points: [[300, 250], [700, 250], [500, 700]] },
  { color: 'black', width: 10, closed: true, fill: 'red', points: [[350, 600], [500, 800], [650, 600]] },
  { color: 'blue', width: 8, closed: false, fill: 'none', points: [[400, 400], [500, 350], [600, 400]] }
];

function createOpenAiFetch({ words = ['Parapluie'], drawing = VALID_STROKES, onRequest } = {}) {
  let wordIndex = 0;
  return async (url, options) => {
    const body = JSON.parse(options.body);
    onRequest?.(url, body);
    const isDrawing = body.messages[0].content.includes('Tu dessines un sujet');
    const content = isDrawing
      ? JSON.stringify({ strokes: drawing })
      : JSON.stringify({ word: words[wordIndex++ % words.length] });
    return new Response(JSON.stringify({
      choices: [{ message: { content } }]
    }), { status: 200 });
  };
}

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

test('health endpoint reports drawing readiness without revealing secrets', async t => {
  const app = await startServer({ apiKey: '' });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    drawingGenerationReady: false,
    drawingModel: 'gpt-4o-mini',
    dailyDrawLimit: 10
  });
});

test('AI draws safe SVG strokes, hides the answer, and validates guesses server-side', async t => {
  const requests = [];
  const app = await startServer({
    apiKey: 'test-key',
    fetchImpl: createOpenAiFetch({ onRequest: (url, body) => requests.push({ url, body }) })
  });
  t.after(() => app.close());

  const newGame = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(newGame.status, 201);
  const game = await newGame.json();
  assert.equal(game.hint, '_ _ _ _ _ _ _ _ _');
  assert.match(game.image, /^data:image\/svg\+xml;base64,/);
  assert.equal('word' in game, false);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.url.endsWith('/chat/completions')));

  const svg = Buffer.from(game.image.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal((svg.match(/<path /g) || []).length, VALID_STROKES.length);
  assert.equal(svg.includes('Parapluie'), false);

  const wrongGuess = await fetch(`${app.baseUrl}/api/games/${game.gameId}/guess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guess: 'chat', username: 'joueur' })
  });
  assert.deepEqual(await wrongGuess.json(), { correct: false });

  const rightGuess = await fetch(`${app.baseUrl}/api/games/${game.gameId}/guess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guess: 'PARAPLUIE', username: '@joueur' })
  });
  assert.deepEqual(await rightGuess.json(), {
    correct: true,
    winner: 'joueur',
    answer: 'Parapluie'
  });
});

test('sanitizes unexpected AI colors rather than embedding markup in the SVG', async t => {
  const app = await startServer({
    apiKey: 'test-key',
    fetchImpl: createOpenAiFetch({
      drawing: [...VALID_STROKES.slice(0, 2), {
        ...VALID_STROKES[2],
        color: 'red" onload="alert(1)',
        width: null
      }]
    })
  });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(response.status, 201);
  const game = await response.json();
  const svg = Buffer.from(game.image.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /stroke="black" stroke-width="12"/);
  assert.equal(/onload=|<script/i.test(svg), false);
});

test('rejects AI strokes that extend outside the drawing canvas', async t => {
  const app = await startServer({
    apiKey: 'test-key',
    fetchImpl: createOpenAiFetch({
      drawing: [
        ...VALID_STROKES.slice(0, 2),
        { ...VALID_STROKES[2], points: [[-1, 200], [600, 400]] }
      ]
    })
  });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'L’IA n’a pas renvoyé un dessin exploitable. Réessaie.');
});

test('refuses game generation when the OpenAI key is missing', async t => {
  const app = await startServer({ apiKey: '' });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /secrets Render/);
});

test('reports actionable guidance when OpenAI denies access to the drawing model', async t => {
  let requestCount = 0;
  const app = await startServer({
    apiKey: 'test-key',
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ word: 'Parapluie' }) } }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: 'model_not_found' } }), { status: 403 });
    }
  });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'La clé API OpenAI n’a pas accès au modèle de dessin. Vérifie les droits du compte.'
  });
});

test('reports the rejected parameter when OpenAI returns a bad request', async t => {
  let requestCount = 0;
  const app = await startServer({
    apiKey: 'test-key',
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ word: 'Parapluie' }) } }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        error: { code: 'unsupported_value', param: 'temperature', message: 'Not shown to players' }
      }), { status: 400 });
    }
  });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'OpenAI refuse la requête de dessin (code unsupported_value, paramètre temperature). Vérifie le modèle et les options.'
  });
});

test('identifies a text model that the OpenAI organization cannot use', async t => {
  const app = await startServer({
    apiKey: 'test-key',
    textModel: 'test-model',
    fetchImpl: async () => new Response(JSON.stringify({
      error: { code: 'invalid_value', param: 'model', message: 'Not shown to players' }
    }), { status: 400 })
  });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'OpenAI rejette le modèle texte « test-model ». Vérifie OPENAI_TEXT_MODEL et l’accès de l’organisation à ce modèle.'
  });
});

test('reports when the server cannot contact OpenAI', async t => {
  const app = await startServer({
    apiKey: 'test-key',
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    }
  });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'Le serveur ne parvient pas à contacter OpenAI. Réessaie plus tard.'
  });
});

test('applies a daily drawing-generation limit', async t => {
  const app = await startServer({
    apiKey: 'test-key',
    maxDailyDraws: 1,
    fetchImpl: createOpenAiFetch({ words: ['Pomme'] })
  });
  t.after(() => app.close());

  const first = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(first.status, 201);
  const second = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(second.status, 429);
  assert.match((await second.json()).error, /limite quotidienne/);
});

test('allows consecutive automatic rounds within the daily limit', async t => {
  const app = await startServer({
    apiKey: 'test-key',
    maxDailyDraws: 5,
    fetchImpl: createOpenAiFetch({ words: ['Sujet1', 'Sujet2', 'Sujet3', 'Sujet4'] })
  });
  t.after(() => app.close());

  for (let round = 0; round < 4; round += 1) {
    const response = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
    assert.equal(response.status, 201);
  }
});
