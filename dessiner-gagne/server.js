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
const DRAWING_COLORS = new Set([
  'black', 'white', 'brown', 'red', 'orange', 'yellow', 'green', 'blue',
  'purple', 'pink', 'gray', 'grey', 'cyan'
]);
const MAX_DRAWING_STROKES = 24;
const MAX_DRAWING_POINTS = 240;

function isDrawingColor(value) {
  return DRAWING_COLORS.has(value) || (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value));
}

function invalidDrawing(message) {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
}

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

function makeDrawingSvg(strokes) {
  if (!Array.isArray(strokes) || strokes.length < 3 || strokes.length > MAX_DRAWING_STROKES) {
    throw invalidDrawing('L’IA n’a pas renvoyé un dessin exploitable. Réessaie.');
  }

  let totalPoints = 0;
  const paths = strokes.map(stroke => {
    if (!stroke || typeof stroke !== 'object' || !Array.isArray(stroke.points)) {
      throw invalidDrawing('L’IA n’a pas renvoyé un dessin exploitable. Réessaie.');
    }
    const closed = stroke.closed === true;
    if (stroke.points.length < (closed ? 3 : 2) || stroke.points.length > 40) {
      throw invalidDrawing('L’IA n’a pas renvoyé un dessin exploitable. Réessaie.');
    }

    totalPoints += stroke.points.length;
    if (totalPoints > MAX_DRAWING_POINTS) {
      throw invalidDrawing('L’IA n’a pas renvoyé un dessin exploitable. Réessaie.');
    }

    for (const point of stroke.points) {
      if (!Array.isArray(point) || point.length !== 2 ||
        !point.every(value => Number.isFinite(value) && value >= 30 && value <= 970)) {
        throw invalidDrawing('L’IA n’a pas renvoyé un dessin exploitable. Réessaie.');
      }
    }

    const color = isDrawingColor(stroke.color) ? stroke.color : 'black';
    const fill = isDrawingColor(stroke.fill) ? stroke.fill : 'none';
    const width = Number.isFinite(stroke.width) && stroke.width >= 4 && stroke.width <= 26
      ? Math.round(stroke.width)
      : 12;
    const points = stroke.points.map(([x, y]) => [Math.round(x), Math.round(y)]);
    const path = smoothPath(points, closed);
    return `<path d="${path}" fill="none" stroke="#b37c68" stroke-opacity=".22" stroke-width="${width + 2}" stroke-linecap="round" stroke-linejoin="round" transform="translate(1.5 2)"/><path d="${path}" fill="${closed ? fill : 'none'}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs><pattern id="paper" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r="1" fill="#b9a98c" opacity=".14"/></pattern></defs><rect width="1000" height="1000" fill="#fffdf8"/><rect width="1000" height="1000" fill="url(#paper)"/>${paths.join('')}</svg>`;
}

function smoothPath(points, closed) {
  const [firstX, firstY] = points[0];
  let path = `M${firstX} ${firstY}`;
  const segmentCount = closed ? points.length : points.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const nextIndex = (index + 1) % points.length;
    const previous = points[closed ? (index - 1 + points.length) % points.length : Math.max(0, index - 1)];
    const current = points[index];
    const next = points[nextIndex];
    const after = points[closed ? (index + 2) % points.length : Math.min(points.length - 1, index + 2)];
    const control1 = [
      current[0] + (next[0] - previous[0]) / 6,
      current[1] + (next[1] - previous[1]) / 6
    ];
    const control2 = [
      next[0] - (after[0] - current[0]) / 6,
      next[1] - (after[1] - current[1]) / 6
    ];
    path += ` C${control1[0].toFixed(1)} ${control1[1].toFixed(1)} ${control2[0].toFixed(1)} ${control2[1].toFixed(1)} ${next[0]} ${next[1]}`;
  }
  return closed ? `${path} Z` : path;
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

  async function openAiRequest(endpoint, payload, task = 'dessin') {
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
        message = `OpenAI rejette le modèle texte « ${textModel} ». Vérifie OPENAI_TEXT_MODEL et l’accès de l’organisation à ce modèle.`;
      } else if (result.status === 400) {
        message = `OpenAI refuse la requête ${task}${detail ? ` (${detail})` : ''}. Vérifie le modèle et les options.`;
      } else {
        message = messages[result.status] || `Le service de dessin IA a répondu avec une erreur HTTP ${result.status}.`;
      }
      const error = new Error(message);
      error.statusCode = result.status === 429 ? 503 : 502;
      throw error;
    }
    return result.json();
  }

  async function chooseWordAndDraw() {
    const excluded = [...usedWords].slice(-100);
    const response = await openAiRequest('chat/completions', {
      model: textModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Tu es illustrateur de petits rébus dessinés à la main. Choisis un sujet concret, simple et très reconnaissable en français, puis dessine ce sujet. Réponds uniquement en JSON avec cette forme : {"word":"parapluie","strokes":[{"color":"#3f3945","width":11,"closed":true,"fill":"#f8cb70","points":[[300,300],[600,300],[450,600]]}]}. Le dessin doit ressembler à un vrai joli gribouillage fait par une personne avec un feutre et des crayons : formes arrondies, lignes courbes, légères asymétries, aplats de couleur doux et détails expressifs. Il doit être joli, clair et immédiatement devinable, sans être géométrique ou trop parfait. RÈGLE ESSENTIELLE : compose un seul sujet cohérent et centré, grand et occupant les deux tiers du cadre ; rattache les petits détails à la silhouette principale. Ne dispose jamais des formes séparées en colonne, en rangée ou en pile. Trace d’abord la silhouette principale bien remplie, puis ses éléments et 2 ou 3 indices caractéristiques. Les contours sont foncés et chaleureux, les remplissages pastel mais assez colorés pour rester visibles. Autorisés : black, white, brown, red, orange, yellow, green, blue, purple, pink, gray, grey, cyan ou couleur hexadécimale #RRGGBB. Produit de 6 à 16 traits dans l’ordre arrière-vers-avant. Chaque trait : couleur color, épaisseur width entre 6 et 20, booléen closed, fill (couleur ou none), et points=[[x,y],...] avec 3 à 10 coordonnées [x,y], nombres entre 60 et 940. Traits fermés : au moins 3 points et remplissage coloré ; traits ouverts : fill none. Le dessin ne contient aucun mot, lettre, chiffre, cadre ni décoration isolée. Les courbes passant par les points seront lissées par le jeu, donc fournis des contours organiques. Choisis et dessine le même sujet. N’utilise pas d’objet facile à confondre avec un autre.'
        },
        {
          role: 'user',
          content: `Choisis un seul sujet facile à faire deviner, différent de ceux-ci, et rends immédiatement le mot secret avec son dessin : ${JSON.stringify(excluded)}`
        }
      ],
      temperature: 0.8,
      max_tokens: 1_700
    }, 'du choix du sujet et du dessin');
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw invalidDrawing('L’IA n’a pas renvoyé un dessin exploitable. Réessaie.');
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw invalidDrawing('L’IA a renvoyé un dessin illisible. Réessaie.');
    }
    const word = String(parsed.word || '').trim();
    const normalized = normalizeWord(word);
    if (!normalized || normalized.length > 50 || normalized.split(' ').length > 5) {
      throw invalidDrawing('L’IA n’a pas choisi un sujet exploitable. Réessaie.');
    }
    if (usedWords.has(normalized)) throw invalidDrawing('L’IA a choisi un sujet déjà utilisé. Réessaie.');
    const svg = makeDrawingSvg(parsed.strokes);
    usedWords.add(normalized);
    if (usedWords.size > 1_000) usedWords.delete(usedWords.values().next().value);
    return {
      word,
      image: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
    };
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {
        ok: true,
        drawingGenerationReady: Boolean(apiKey),
        drawingModel: textModel,
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
        const { word, image } = await chooseWordAndDraw();
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
