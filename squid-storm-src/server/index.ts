import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const port = Number(process.env.PORT ?? 3001);

let liveConnection: TikTokLiveConnection | null = null;
let liveUsername: string | null = null;
let connectionRequest = 0;

function publishStatus(status: { connected: boolean; username?: string; connecting?: boolean; error?: string }) {
  io.emit('status', status);
}

async function disconnectTikTok() {
  connectionRequest += 1;
  const connection = liveConnection;
  liveConnection = null;
  liveUsername = null;
  if (connection) await connection.disconnect();
  publishStatus({ connected: false });
}

async function connectTikTok(username: string) {
  const requestId = ++connectionRequest;
  let connection: TikTokLiveConnection | null = null;
  try {
    if (liveConnection) {
      const previousConnection = liveConnection;
      liveConnection = null;
      await previousConnection.disconnect();
    }
    if (requestId !== connectionRequest) return;

    connection = new TikTokLiveConnection(username);
    liveConnection = connection;
    publishStatus({ connected: false, username, connecting: true });

    connection.on(WebcastEvent.GIFT, (data) => {
      if (connection !== liveConnection || (data.giftType === 1 && !data.repeatEnd)) return;
      const repeatCount = data.repeatCount ?? 1;
      io.emit('gift', {
        gift: data.giftName,
        user: data.user?.uniqueId ?? 'visiteur_anonyme',
        repeatCount,
        coinCount: (data.giftDetails?.diamondCount ?? 0) * repeatCount,
      });
    });

    await connection.connect();
    if (requestId !== connectionRequest || connection !== liveConnection) {
      await connection.disconnect();
      return;
    }
    liveUsername = username;
    publishStatus({ connected: true, username });
  } catch (error) {
    if (requestId === connectionRequest && connection === liveConnection) {
      liveConnection = null;
      liveUsername = null;
      publishStatus({
        connected: false,
        error: error instanceof Error ? error.message : 'La connexion TikTok a échoué.',
      });
    } else if (requestId === connectionRequest) {
      publishStatus({
        connected: false,
        error: error instanceof Error ? error.message : 'La connexion TikTok a échoué.',
      });
    }
  }
}

app.get('/health', (_req, res) => res.json({ ok: true, connected: Boolean(liveConnection?.isConnected), username: liveUsername }));
io.on('connection', (socket) => {
  socket.emit('status', { connected: Boolean(liveConnection?.isConnected), username: liveUsername ?? undefined });
  socket.on('tiktok:connect', (data: { username?: unknown }) => {
    const username = typeof data?.username === 'string' ? data.username.trim().replace(/^@/, '') : '';
    if (!/^[\w.]{2,24}$/.test(username)) {
      socket.emit('status', { connected: false, error: 'Nom d’utilisateur TikTok invalide.' });
      return;
    }
    void connectTikTok(username);
  });
  socket.on('tiktok:disconnect', () => {
    void disconnectTikTok().catch((error: unknown) => {
      socket.emit('status', {
        connected: false,
        error: error instanceof Error ? error.message : 'La déconnexion TikTok a échoué.',
      });
    });
  });
});

httpServer.listen(port, () => console.log(`Squid Storm realtime server listening on ${port}`));

if (process.env.TIKTOK_USERNAME) {
  void connectTikTok(process.env.TIKTOK_USERNAME.trim().replace(/^@/, ''));
}
