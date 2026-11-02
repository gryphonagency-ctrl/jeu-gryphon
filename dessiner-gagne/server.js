'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { DRAWINGS } = require('./drawing-library');
const PICTOGRAMS = require('./drawing-catalog.json');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 2_048;
const GAME_TTL_MS = 60 * 60 * 1_000;
const DIFFICULTY_NAMES = ['Facile', 'Intermédiaire', 'Moyen', 'Difficile', 'Expert'];
const DRAWING_CATALOG = [
  ...DRAWINGS.map((drawing, index) => ({
    ...drawing,
    id: `handmade-${index + 1}`,
    theme: 'objets familiers',
    difficulty: 1
  })),
  ...PICTOGRAMS
];

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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function makeDrawingSvg(drawing) {
  const illustration = typeof drawing.svg === 'string'
    ? drawing.svg
    : `<text x="200" y="195" text-anchor="middle" dominant-baseline="central" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif" font-size="230">${escapeXml(drawing.emoji)}</text><path d="M126 317q74 18 148 0" fill="none" stroke="#bb8069" stroke-width="5" stroke-linecap="round" opacity=".6"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><pattern id="paper" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r="1" fill="#b9a98c" opacity=".12"/></pattern></defs><rect width="400" height="400" fill="#fffdf8"/><rect width="400" height="400" fill="url(#paper)"/>${illustration}</svg>`;
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

function validateCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new TypeError('The drawing catalog must contain at least one drawing.');
  }
  const ids = new Set();
  const words = new Set();
  for (const drawing of catalog) {
    const word = normalizeWord(drawing?.word);
    if (!drawing || !drawing.id || !word || word.length > 50 ||
      typeof drawing.theme !== 'string' ||
      !Number.isInteger(drawing.difficulty) || drawing.difficulty < 1 || drawing.difficulty > 5 ||
      (typeof drawing.svg !== 'string' && typeof drawing.emoji !== 'string')) {
      throw new TypeError('The drawing catalog contains an invalid entry.');
    }
    if (ids.has(drawing.id) || words.has(word)) {
      throw new TypeError('Drawing IDs and answers must be unique.');
    }
    ids.add(drawing.id);
    words.add(word);
  }
}

function createServer({
  tiktokConnectorUrl = process.env.TIKTOK_CONNECTOR_URL || 'wss://jeu6boite.onrender.com',
  catalog = DRAWING_CATALOG,
  random = Math.random,
  clock = Date.now
} = {}) {
  validateCatalog(catalog);
  const games = new Map();
  const usedByDifficulty = new Map();

  function pruneGames() {
    const now = clock();
    for (const [id, game] of games) {
      if (now - game.createdAt > GAME_TTL_MS) games.delete(id);
    }
  }

  function selectDrawing(difficulty) {
    const candidates = catalog.filter(drawing => drawing.difficulty === difficulty);
    if (!candidates.length) {
      throw new Error(`No drawings are configured for difficulty ${difficulty}.`);
    }

    let used = usedByDifficulty.get(difficulty);
    if (!used) {
      used = new Set();
      usedByDifficulty.set(difficulty, used);
    }
    if (used.size >= candidates.length) used.clear();

    const available = candidates.filter(drawing => !used.has(drawing.id));
    const handDrawn = difficulty === 1
      ? available.filter(drawing => drawing.id.startsWith('handmade-'))
      : [];
    const selectionPool = handDrawn.length ? handDrawn : available;
    const randomValue = random();
    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
      throw new RangeError('The drawing selector must return a number from 0 up to, but not including, 1.');
    }
    const drawing = selectionPool[Math.floor(randomValue * selectionPool.length)];
    used.add(drawing.id);
    return drawing;
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {
        ok: true,
        aiRequired: false,
        drawingCount: catalog.length,
        difficultyLevels: DIFFICULTY_NAMES.length
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
      try {
        pruneGames();
        const body = await readJson(request);
        if (body.difficulty !== undefined &&
          (!Number.isInteger(body.difficulty) || body.difficulty < 1 || body.difficulty > DIFFICULTY_NAMES.length)) {
          sendJson(response, 400, { error: 'Le niveau de difficulté demandé est invalide.' });
          return;
        }
        const difficulty = body.difficulty || 1;
        const drawing = selectDrawing(difficulty);
        const id = crypto.randomUUID();
        const svg = makeDrawingSvg(drawing);
        games.set(id, {
          answer: normalizeWord(drawing.word),
          word: drawing.word,
          createdAt: clock(),
          winner: null
        });
        sendJson(response, 201, {
          gameId: id,
          image: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
          hint: Array.from(drawing.word, character => character === ' ' ? '  ' : '_').join(' '),
          wordLength: Array.from(drawing.word).filter(character => character !== ' ').length,
          theme: drawing.theme,
          difficulty,
          difficultyName: DIFFICULTY_NAMES[difficulty - 1]
        });
      } catch (error) {
        console.error('Game creation failed:', error);
        sendJson(response, error.statusCode || 503, {
          error: error.statusCode === 400
            ? 'La demande de dessin est invalide.'
            : 'Impossible de préparer un dessin. Réessaie.'
        });
      }
      return;
    }

    const guessMatch = request.method === 'POST' && url.pathname.match(/^\/api\/games\/([0-9a-f-]{36})\/guess$/i);
    if (guessMatch) {
      try {
        pruneGames();
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

module.exports = { createServer, normalizeWord, DRAWING_CATALOG };
