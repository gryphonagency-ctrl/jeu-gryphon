'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 2_048;
const GAME_TTL_MS = 60 * 60 * 1_000;
const RATE_WINDOW_MS = 10 * 60 * 1_000;
const MAX_REQUESTS_PER_IP = 10;
const IMAGE_PROMPT = [
  'Make a very simple, charming child-made computer drawing of: ',
  '. It should look like a young child slowly drew it with a mouse in a basic paint program: ',
  'slightly wobbly freehand black outlines, a few broad hand-filled pastel colors, ',
  'simple recognizable shape, imperfect but clear. Show only the single subject, ',
  'large and centered on a plain white canvas. Use very few strokes and almost no detail. ',
  'No letters, words, labels, frame, extra objects, gradients, realism, or polished vector art.'
].join('');

function normalizeWord(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/œ/g, 'oe')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

async function readJson(request) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function getClientAddress(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const addresses = forwarded.split(',').map(value => value.trim()).filter(Boolean);
    if (addresses.length) return addresses[addresses.length - 1];
  }
  return request.socket.remoteAddress || 'unknown';
}

function createServer({
  apiKey = process.env.OPENAI_API_KEY,
  textModel = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini',
  imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
  tiktokConnectorUrl = process.env.TIKTOK_CONNECTOR_URL || 'wss://jeu6boite.onrender.com',
  maxDailyDraws = Number(process.env.MAX_DAILY_DRAWS) || 10,
  fetchImpl = globalThis.fetch,
  clock = Date.now
} = {}) {
  const games = new Map();
  const usedWords = new Set();
  const requestsByAddress = new Map();
  let dailyDrawCount = 0;
  let currentUtcDate = new Date(clock()).toISOString().slice(0, 10);

  function pruneState() {
    const now = clock();
    for (const [id, game] of games) {
      if (now - game.createdAt > GAME_TTL_MS) games.delete(id);
    }
    for (const [address, requests] of requestsByAddress) {
      const active = requests.filter(timestamp => now - timestamp < RATE_WINDOW_MS);
      if (active.length) requestsByAddress.set(address, active);
      else requestsByAddress.delete(address);
    }
  }

  function checkRateLimit(request, response) {
    pruneState();
    const now = clock();
    const address = getClientAddress(request);
    const requests = requestsByAddress.get(address) || [];
    if (requests.length >= MAX_REQUESTS_PER_IP) {
      sendJson(response, 429, { error: 'Trop de dessins demandés. Réessaie dans quelques minutes.' });
      return false;
    }
    requests.push(now);
    requestsByAddress.set(address, requests);

    const date = new Date(now).toISOString().slice(0, 10);
    if (date !== currentUtcDate) {
      currentUtcDate = date;
      dailyDrawCount = 0;
    }
    if (dailyDrawCount >= maxDailyDraws) {
      sendJson(response, 429, { error: 'La limite quotidienne de dessins IA est atteinte.' });
      return false;
    }
    dailyDrawCount += 1;
    return true;
  }

  async function openAiRequest(endpoint, payload) {
    let result;
    try {
      result = await fetchImpl(`https://api.openai.com/v1/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000)
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      console.error(`OpenAI ${endpoint} request failed: ${detail}`);
      const error = new Error('Le serveur ne parvient pas à contacter OpenAI. Réessaie plus tard.');
      error.statusCode = 502;
      throw error;
    }
    if (!result.ok) {
      let upstreamError;
      try {
        const body = await result.json();
        if (body.error && typeof body.error === 'object') upstreamError = body.error;
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        console.error(`OpenAI ${endpoint} returned an unreadable error response: ${detail}`);
      }
      const code = typeof upstreamError?.code === 'string' ? upstreamError.code : '';
      const param = typeof upstreamError?.param === 'string' ? upstreamError.param : '';
      console.error(`OpenAI ${endpoint} returned HTTP ${result.status}${code ? ` (${code})` : ''}${param ? ` for ${param}` : ''}`);
      const messages = {
        401: 'La clé API OpenAI du serveur est invalide ou expirée.',
        403: 'La clé API OpenAI n’a pas accès au modèle de dessin. Vérifie les droits du compte.',
        404: 'Le modèle ou la route de génération OpenAI est introuvable.',
        429: 'Le quota OpenAI est épuisé ou la limite temporaire de requêtes est atteinte.'
      };
      const detail = [code && `code ${code}`, param && `paramètre ${param}`].filter(Boolean).join(', ');
      let message;
      if (result.status === 400 && param === 'model') {
        const setting = endpoint === 'images/generations' ? 'OPENAI_IMAGE_MODEL' : 'OPENAI_TEXT_MODEL';
        const model = endpoint === 'images/generations' ? imageModel : textModel;
        message = `OpenAI rejette le modèle « ${model} ». Vérifie ${setting} et l’accès de l’organisation à ce modèle.`;
      } else if (result.status === 400) {
        message = `OpenAI refuse la requête ${endpoint === 'images/generations' ? 'de dessin' : 'de choix du sujet'}${detail ? ` (${detail})` : ''}. Vérifie le modèle et les options.`;
      } else {
        message = messages[result.status] || `Le service de dessin IA a répondu avec une erreur HTTP ${result.status}.`;
      }
      const error = new Error(message);
      error.statusCode = result.status === 429 ? 503 : 502;
      throw error;
    }
    return result.json();
  }

  async function chooseWord() {
    const excluded = [...usedWords].slice(-100);
    const response = await openAiRequest('chat/completions', {
      model: textModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Tu choisis des sujets simples et concrets pour un jeu de dessin familial en français. Réponds uniquement en JSON avec la forme {"word":"..."} : un nom commun court, singulier, facile à dessiner et à deviner. Choisis un sujet différent de la liste d’exclusion.'
        },
        {
          role: 'user',
          content: `Choisis un sujet concret que les spectateurs peuvent reconnaître dans un dessin très simple. Exclusions récentes : ${JSON.stringify(excluded)}`
        }
      ],
      temperature: 1
    });
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Réponse de sujet invalide.');
    const parsed = JSON.parse(content);
    const word = String(parsed.word || '').trim();
    const normalized = normalizeWord(word);
    if (!normalized || normalized.length > 50 || normalized.split(' ').length > 5) {
      throw new Error('Sujet choisi invalide.');
    }
    if (usedWords.has(normalized)) throw new Error('Le sujet choisi a déjà été utilisé.');
    usedWords.add(normalized);
    if (usedWords.size > 1_000) usedWords.delete(usedWords.values().next().value);
    return word;
  }

  async function drawWord(word) {
    const result = await openAiRequest('images/generations', {
      model: imageModel,
      prompt: `${IMAGE_PROMPT}${word}.`,
      size: '1024x1024',
      quality: 'low',
      n: 1
    });
    const image = result.data?.[0]?.b64_json;
    if (typeof image !== 'string' || image.length < 100) {
      throw new Error('Le service IA n’a pas renvoyé de dessin valide.');
    }
    return `data:image/png;base64,${image}`;
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {
        ok: true,
        imageGenerationReady: Boolean(apiKey),
        imageModel,
        dailyDrawLimit: maxDailyDraws
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/config') {
      sendJson(response, 200, { tiktokConnectorUrl });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      });
      response.end(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/games') {
      if (!apiKey) {
        sendJson(response, 503, { error: 'La clé OpenAI doit être configurée dans les secrets Render.' });
        return;
      }
      if (!checkRateLimit(request, response)) return;
      try {
        const word = await chooseWord();
        const image = await drawWord(word);
        const id = crypto.randomUUID();
        games.set(id, { answer: normalizeWord(word), word, createdAt: clock(), winner: null });
        sendJson(response, 201, {
          gameId: id,
          image,
          hint: Array.from(word, character => character === ' ' ? '  ' : '_').join(' '),
          wordLength: Array.from(word).length
        });
      } catch (error) {
        console.error('Game generation failed:', error.message);
        sendJson(response, error.statusCode || 502, {
          error: error.statusCode ? error.message : 'Impossible de générer le sujet et son dessin. Réessaie.'
        });
      }
      return;
    }

    const guessMatch = request.method === 'POST' && url.pathname.match(/^\/api\/games\/([0-9a-f-]{36})\/guess$/i);
    if (guessMatch) {
      try {
        const body = await readJson(request);
        const game = games.get(guessMatch[1]);
        const guess = String(body.guess || '').slice(0, 100);
        const username = String(body.username || 'spectateur').trim().replace(/^@/, '').slice(0, 40) || 'spectateur';
        if (!game) {
          sendJson(response, 404, { error: 'Cette manche n’existe plus.' });
          return;
        }
        if (game.winner) {
          sendJson(response, 200, { correct: false, finished: true });
          return;
        }
        if (normalizeWord(guess) !== game.answer) {
          sendJson(response, 200, { correct: false });
          return;
        }
        game.winner = username;
        sendJson(response, 200, { correct: true, winner: username, answer: game.word });
      } catch (error) {
        sendJson(response, error.statusCode || 400, { error: 'Réponse de jeu invalide.' });
      }
      return;
    }

    sendJson(response, 404, { error: 'Page introuvable.' });
  });

  return server;
}

if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT) || 10000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Dessiner, c’est gagné écoute sur le port ${port}.`);
  });
}

module.exports = { createServer, normalizeWord };
