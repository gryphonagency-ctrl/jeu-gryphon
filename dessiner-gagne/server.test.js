'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { createServer } = require('./server');

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

test('health endpoint reports readiness without revealing secrets', async t => {
  const app = await startServer({ apiKey: '' });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    imageGenerationReady: false,
    dailyDrawLimit: 10
  });
});

test('draws a unique topic, hides the answer, and validates guesses server-side', async t => {
  const requests = [];
  const app = await startServer({
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      if (url.endsWith('/chat/completions')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ word: 'Parapluie' }) } }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from('mock-png-image-data'.repeat(10)).toString('base64') }]
      }), { status: 200 });
    }
  });
  t.after(() => app.close());

  const newGame = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(newGame.status, 201);
  const game = await newGame.json();
  assert.equal(game.hint, '_ _ _ _ _ _ _ _ _');
  assert.match(game.image, /^data:image\/png;base64,/);
  assert.equal('word' in game, false);
  assert.equal(requests.length, 2);
  assert.match(requests[1].body.prompt, /child.*mouse/i);

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

test('refuses game generation when the OpenAI key is missing', async t => {
  const app = await startServer({ apiKey: '' });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /secrets Render/);
});

test('reports actionable guidance when OpenAI denies access to the drawing model', async t => {
  const app = await startServer({
    apiKey: 'test-key',
    fetchImpl: async url => url.endsWith('/chat/completions')
      ? new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ word: 'Parapluie' }) } }]
      }), { status: 200 })
      : new Response(JSON.stringify({ error: { code: 'model_not_found' } }), { status: 403 })
  });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'La clé API OpenAI n’a pas accès au modèle de dessin. Vérifie les droits du compte.'
  });
});

test('reports the rejected parameter when OpenAI returns a bad request', async t => {
  const app = await startServer({
    apiKey: 'test-key',
    fetchImpl: async url => url.endsWith('/chat/completions')
      ? new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ word: 'Parapluie' }) } }]
      }), { status: 200 })
      : new Response(JSON.stringify({
        error: { code: 'unsupported_value', param: 'quality', message: 'Not shown to players' }
      }), { status: 400 })
  });
  t.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'OpenAI refuse la requête de dessin (code unsupported_value, paramètre quality). Vérifie le modèle et les options.'
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

test('applies a daily image-generation limit', async t => {
  const app = await startServer({
    apiKey: 'test-key',
    maxDailyDraws: 1,
    fetchImpl: async url => url.endsWith('/chat/completions')
      ? new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ word: 'Pomme' }) } }]
      }), { status: 200 })
      : new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from('mock-png-image-data'.repeat(10)).toString('base64') }]
      }), { status: 200 })
  });
  t.after(() => app.close());

  const first = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(first.status, 201);
  const second = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
  assert.equal(second.status, 429);
  assert.match((await second.json()).error, /limite quotidienne/);
});

test('allows consecutive automatic rounds within the daily limit', async t => {
  let topic = 0;
  const app = await startServer({
    apiKey: 'test-key',
    maxDailyDraws: 5,
    fetchImpl: async url => url.endsWith('/chat/completions')
      ? new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ word: `Sujet${++topic}` }) } }]
      }), { status: 200 })
      : new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from('mock-png-image-data'.repeat(10)).toString('base64') }]
      }), { status: 200 })
  });
  t.after(() => app.close());

  for (let round = 0; round < 4; round += 1) {
    const response = await fetch(`${app.baseUrl}/api/games`, { method: 'POST' });
    assert.equal(response.status, 201);
  }
});
