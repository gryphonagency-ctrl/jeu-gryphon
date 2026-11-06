import { useCallback, useEffect, useRef, useState } from 'react';
import { Coins, Crown, Settings2, Sparkles, TrendingUp, X, Zap } from 'lucide-react';
import { io } from 'socket.io-client';
import { CHARACTER_REWARD_DISTRIBUTION, CoinPusherEngine, TOTAL_PRIZE_CHARACTERS } from './CoinPusherEngine';

type FeedItem = { id: number; text: string; points: number };
type LiveGift = { gift: string; user: string; repeatCount: number; coinCount: number };
type BigGift = { gift: string; user: string; coinCount: number; simulated?: boolean };
type WheelRound = BigGift & { result: number; rotation: number; settled: boolean; resolution?: string };
type WalletRunDetail = {
  player?: { id?: string; username?: string; uniqueId?: string; nickname?: string };
  spent?: number;
};
type ArcadeStarsClient = {
  award(input: { playerId?: string; username: string; amount: number; transactionId: string }): Promise<unknown>;
};

declare global {
  interface Window {
    ArcadeStars?: ArcadeStarsClient;
  }
}

const WHEEL_OUTCOMES = ['+10 ÉTOILES', 'LE POUSSOIR FAIT TOMBER TOUS LES PERSONNAGES', 'PERDU'] as const;

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const tiktokInputRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<CoinPusherEngine | null>(null);
  const [score, setScore] = useState(0);
  const [charactersOnDeck, setCharactersOnDeck] = useState(24);
  const [charactersRemaining, setCharactersRemaining] = useState(TOTAL_PRIZE_CHARACTERS);
  const [wonTotal, setWonTotal] = useState(0);
  const [gameError, setGameError] = useState('');
  const [feed, setFeed] = useState<FeedItem[]>([
    { id: 1, text: 'Bienvenue sur SQUID STORM', points: 0 },
  ]);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isControlPanelOpen, setIsControlPanelOpen] = useState(false);
  const [tiktokUsername, setTiktokUsername] = useState('');
  const [tiktokUsernameInput, setTiktokUsernameInput] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [connectionBusy, setConnectionBusy] = useState(false);
  const socketRef = useRef<ReturnType<typeof io> | WebSocket | null>(null);
  const feedIdRef = useRef(2);
  const wheelBusyRef = useRef(false);
  const wheelQueueRef = useRef<BigGift[]>([]);
  const wheelTimerRef = useRef<number | null>(null);
  const [wallTravel, setWallTravel] = useState(1);
  const [wallSpeed, setWallSpeed] = useState(1);
  const [wheel, setWheel] = useState<WheelRound | null>(null);

  const creditStars = useCallback(async (username: string, amount: number, transactionId: string, playerId?: string) => {
    if (!window.ArcadeStars) {
      throw new Error('Le portefeuille global d’étoiles est indisponible.');
    }
    await window.ArcadeStars.award({ playerId, username, amount, transactionId });
  }, []);

  const reportAwardFailure = useCallback((username: string, amount: number, purpose: string, error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    const message = `Impossible d’enregistrer ${amount} étoile${amount > 1 ? 's' : ''} ${purpose} pour @${username} : ${reason}`;
    console.error(message, error);
    setGameError(message);
  }, []);

  const startWheel = useCallback((gift: BigGift) => {
    wheelBusyRef.current = true;
    const result = Math.floor(Math.random() * WHEEL_OUTCOMES.length);
    const spins = 5 + Math.floor(Math.random() * 3);
    const rotation = spins * 360 + (360 - (result * 120 + 60));
    setWheel({ ...gift, result, rotation: 0, settled: false });
    window.requestAnimationFrame(() => {
      setWheel((current) => current ? { ...current, rotation } : current);
    });
    wheelTimerRef.current = window.setTimeout(() => {
      void (async () => {
        const engine = engineRef.current;
        let resolution: string = WHEEL_OUTCOMES[result];
        let points = 0;
        if (result === 0) {
          if (engine?.awardWheelBonusStars(10)) {
            setScore(engine.getEarnedStars());
            if (gift.simulated) {
              points = 10;
            } else {
              try {
                await creditStars(gift.user, 10, `squid-storm:wheel:${crypto.randomUUID()}`);
                points = 10;
              } catch (error) {
                reportAwardFailure(gift.user, 10, 'gagnées à la roue', error);
                resolution = 'BONUS NON ENREGISTRÉ';
              }
            }
          } else {
            resolution = 'BONUS NON ENREGISTRÉ';
          }
        }
        if (result === 1) engine?.pushAllCharacters();
        setFeed((items) => [{
          id: feedIdRef.current++,
          text: `${gift.user} · roue : ${resolution}`,
          points,
        }, ...items].slice(0, 6));
        setWheel((current) => current ? { ...current, settled: true, resolution } : current);
      })();
    }, 4800);
  }, [creditStars, reportAwardFailure]);

  const closeWheel = () => {
    setWheel(null);
    const nextGift = wheelQueueRef.current.shift();
    if (nextGift) {
      window.setTimeout(() => startWheel(nextGift), 180);
    } else {
      wheelBusyRef.current = false;
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const engine = new CoinPusherEngine(containerRef.current, {
      onCharacterWon: (character) => {
        setScore((s) => engineRef.current?.getEarnedStars() ?? s + character.rewardStars);
        setWonTotal((w) => engineRef.current?.getWonCount() ?? w + 1);
        const rewardText = character.rewardStars === 1 ? '1 étoile' : `${character.rewardStars} étoiles`;
        const feedId = feedIdRef.current++;
        const username = character.ownerUsername;
        const rewardMessage = character.rewardStars > 0
          ? `${username ? `@${username} · ` : ''}personnage gagné · ${rewardText}${username ? ' · crédit en cours' : ''}`
          : `${username ? `@${username} · ` : ''}personnage gagné · aucune étoile`;
        setFeed((items) => [{ id: feedId, text: rewardMessage, points: 0 }, ...items].slice(0, 6));
        if (username && character.rewardStars > 0) {
          void creditStars(
            username,
            character.rewardStars,
            `squid-storm:character:${character.rewardTransactionId}`,
          ).then(() => {
            setFeed((items) => items.map((item) => item.id === feedId
              ? { ...item, text: `@${username} · personnage gagné · ${rewardText} créditées`, points: character.rewardStars }
              : item));
          }).catch((error: unknown) => {
            reportAwardFailure(username, character.rewardStars, 'gagnées par un personnage', error);
            setFeed((items) => items.map((item) => item.id === feedId
              ? { ...item, text: `@${username} · crédit de ${rewardText} impossible` }
              : item));
          });
        }
      },
      onCharacterSpawn: () => {
        setCharactersOnDeck(engine.getCharacterCount());
      },
      onPrizePoolChange: setCharactersRemaining,
      onPersistenceError: (error) => setGameError(error.message),
    });
    engineRef.current = engine;
    setScore(engine.getEarnedStars());
    setWonTotal(engine.getWonCount());
    setCharactersRemaining(engine.getRemainingCharacterCount());
    const interval = window.setInterval(() => setCharactersOnDeck(engine.getCharacterCount()), 800);
    return () => {
      window.clearInterval(interval);
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
      engine.dispose();
    };
  }, [creditStars, reportAwardFailure]);

  useEffect(() => {
    const handleGift = (gift: LiveGift) => {
      const count = Number.isSafeInteger(gift.repeatCount) && gift.repeatCount > 0 ? gift.repeatCount : 1;
      engineRef.current?.spawnCharacters('gold', count, gift.user);
      setCharactersOnDeck(engineRef.current?.getCharacterCount() ?? count);
      const coinCount = Number.isSafeInteger(gift.coinCount) && gift.coinCount > 0 ? gift.coinCount : 0;
      const multiplier = count > 1 ? ` ×${count}` : '';
      setFeed((items) => [{
        id: feedIdRef.current++,
        text: `${gift.user} · ${gift.gift}${multiplier}${coinCount > 0 ? ` · ${coinCount} pièces` : ''}`,
        points: 0,
      }, ...items].slice(0, 6));
      if (coinCount >= 100) {
        const bigGift = { gift: gift.gift, user: gift.user, coinCount };
        if (wheelBusyRef.current) wheelQueueRef.current.push(bigGift);
        else startWheel(bigGift);
      }
    };

    const realtimeUrl = import.meta.env.VITE_REALTIME_URL;
    if (realtimeUrl || import.meta.env.DEV) {
      const socket = io(realtimeUrl ?? `${window.location.protocol}//${window.location.hostname}:3001`);
      socketRef.current = socket;
      socket.on('status', (status: { connected: boolean; username?: string; error?: string; connecting?: boolean }) => {
        setIsLiveConnected(status.connected);
        if (status.username) {
          setTiktokUsername(status.username);
          setTiktokUsernameInput(status.username);
        }
        setConnectionBusy(Boolean(status.connecting));
        setConnectionError(status.error ?? '');
      });
      socket.on('gift', handleGift);
      socket.on('connect_error', (error: Error) => {
        console.warn('Connexion au serveur de cadeaux impossible :', error.message);
        setIsLiveConnected(false);
      });
      socket.on('disconnect', () => setIsLiveConnected(false));
      return () => { socket.disconnect(); socketRef.current = null; };
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);
    socketRef.current = socket;
    socket.addEventListener('message', (event) => {
      let data: { type?: string; message?: string; gift?: Record<string, unknown> };
      try {
        data = JSON.parse(String(event.data)) as typeof data;
      } catch (error) {
        console.error('Message reçu du serveur TikTok invalide :', error);
        setConnectionError('Réponse du serveur TikTok illisible.');
        return;
      }
      if (data.type === 'STATUS') {
        const message = data.message ?? 'Statut du live mis à jour.';
        setIsLiveConnected(/direct tiktok connecté/i.test(message));
        setConnectionBusy(/connexion tiktok en cours/i.test(message));
        setConnectionError(/erreur|interrompue|invalide|momentanément atteint/i.test(message) ? message : '');
      } else if (data.type === 'gift' && data.gift) {
        const gift = data.gift;
        handleGift({
          gift: String(gift.giftName || 'Cadeau'),
          user: String(gift.username || gift.uniqueId || 'visiteur_anonyme'),
          repeatCount: Number(gift.repeatCount) || 1,
          coinCount: Number(gift.coinCount) || 0,
        });
      }
    });
    socket.addEventListener('error', () => {
      setIsLiveConnected(false);
      setConnectionBusy(false);
      setConnectionError('Connexion au serveur TikTok impossible. Connectez-vous à Gryphon Arcade et réessayez.');
    });
    socket.addEventListener('close', () => {
      setIsLiveConnected(false);
      setConnectionBusy(false);
    });
    return () => { socket.close(); socketRef.current = null; };
  }, [startWheel]);

  useEffect(() => {
    const handleWalletRun = (event: Event) => {
      const { player, spent } = (event as CustomEvent<WalletRunDetail>).detail ?? {};
      const username = player?.username || player?.uniqueId || player?.nickname;
      const amount = Number(spent);
      if (!username || !Number.isSafeInteger(amount) || amount < 1) return;

      const engine = engineRef.current;
      const charactersToPlay = Math.min(amount, engine?.getRemainingCharacterCount() ?? 0);
      if (engine && charactersToPlay > 0) {
        engine.spawnCharacters('gold', charactersToPlay, username);
        setCharactersOnDeck(engine.getCharacterCount());
      }

      const refund = amount - charactersToPlay;
      const feedId = feedIdRef.current++;
      const runMessage = refund > 0
        ? charactersToPlay > 0
          ? `@${username} · RUN : ${charactersToPlay} personnage${charactersToPlay > 1 ? 's' : ''} joué${charactersToPlay > 1 ? 's' : ''}, remboursement de ${refund} étoile${refund > 1 ? 's' : ''} en cours`
          : `@${username} · RUN impossible, remboursement de ${refund} étoile${refund > 1 ? 's' : ''} en cours`
        : `@${username} rejoue ${charactersToPlay} étoile${charactersToPlay > 1 ? 's' : ''} · ${charactersToPlay} personnage${charactersToPlay > 1 ? 's' : ''}`;
      setFeed((items) => [{ id: feedId, text: runMessage, points: 0 }, ...items].slice(0, 6));
      if (refund > 0) {
        void creditStars(username, refund, `squid-storm:run-refund:${crypto.randomUUID()}`, player?.id).then(() => {
          setFeed((items) => items.map((item) => item.id === feedId
            ? { ...item, text: `@${username} · ${refund} étoile${refund > 1 ? 's' : ''} remboursée${refund > 1 ? 's' : ''}` }
            : item));
        }).catch((error: unknown) => {
          reportAwardFailure(username, refund, 'remboursées après le RUN', error);
          setFeed((items) => items.map((item) => item.id === feedId
            ? { ...item, text: `@${username} · remboursement de ${refund} étoile${refund > 1 ? 's' : ''} impossible` }
            : item));
        });
      }
    };

    window.addEventListener('arcade:wallet-run', handleWalletRun);
    return () => window.removeEventListener('arcade:wallet-run', handleWalletRun);
  }, [creditStars, reportAwardFailure]);

  const dropCharacter = useCallback((color: string, count = 1) => {
    engineRef.current?.spawnCharacters(color, count);
    setCharactersOnDeck(engineRef.current?.getCharacterCount() ?? 0);
  }, []);

  const connectTikTok = () => {
    const username = tiktokUsernameInput.trim().replace(/^@/, '');
    if (!/^[\w.]{2,24}$/.test(username)) {
      setConnectionError('Saisissez un nom d’utilisateur TikTok valide (2 à 24 caractères).');
      return;
    }
    const socket = socketRef.current;
    setConnectionError('');
    setConnectionBusy(true);
    setTiktokUsername(username);
    if (socket instanceof WebSocket) {
      if (socket.readyState !== WebSocket.OPEN) {
        setConnectionBusy(false);
        setConnectionError('Le serveur TikTok est indisponible. Réessayez dans quelques instants.');
        return;
      }
      socket.send(JSON.stringify({ action: 'CONNECT_TIKTOK', username }));
    } else if (socket?.connected) {
      socket.emit('tiktok:connect', { username });
    } else {
      setConnectionBusy(false);
      setConnectionError('Le serveur TikTok est indisponible. Réessayez dans quelques instants.');
    }
  };

  const disconnectTikTok = () => {
    const socket = socketRef.current;
    setConnectionBusy(true);
    if (socket instanceof WebSocket) {
      socket.close(1000, 'Déconnexion demandée');
      socketRef.current = null;
    } else if (socket?.connected) {
      socket.emit('tiktok:disconnect');
    } else {
      setConnectionBusy(false);
      setConnectionError('Le serveur TikTok est indisponible. Impossible de se déconnecter.');
    }
  };

  return (
    <main className="app-shell">
      <div className="ambient ambient-a" /><div className="ambient ambient-b" />
      <header className="topbar">
        <div className="brand"><span className="brand-icon"><Coins size={22} /></span><div><b>SQUID STORM</b><small>CADEAU PUSHER 3D</small></div></div>
        <div className="topbar-stats">
          {score > 0 && <div className="stat-pill"><Crown size={13} /> <b>{score.toLocaleString('fr-FR')}</b><span>ÉTOILES</span></div>}
          {wonTotal > 0 && <div className="stat-pill"><TrendingUp size={13} /> <b>{wonTotal}</b><span>GAGNÉES</span></div>}
          {charactersOnDeck > 0 && <div className="stat-pill"><Coins size={13} /> <b>{charactersOnDeck}</b><span>PERSONNAGES</span></div>}
        </div>
        <button
          className="topbar-drop-btn"
          type="button"
          onClick={() => dropCharacter('gold', 10)}
          disabled={charactersRemaining < 10}
          aria-label="Lâcher 10 personnages"
          title="Lâcher 10 personnages"
        >
          <Zap size={14} />
          <span className="topbar-drop-count">×10</span>
          <span className="topbar-drop-label">PERSONNAGES</span>
        </button>
        <div className="topbar-right">
          <span className={`live-dot ${isLiveConnected ? '' : 'live-dot-offline'}`} />
          <span className="live-status-label">{isLiveConnected ? 'LIVE' : 'HORS LIGNE'}</span>
          <form className="topbar-live-form" onSubmit={(event) => {
            event.preventDefault();
            if (isLiveConnected) disconnectTikTok();
            else connectTikTok();
          }}>
            <label className="visually-hidden" htmlFor="topbar-tiktok-username">Nom d’utilisateur TikTok LIVE</label>
            <input
              id="topbar-tiktok-username"
              className="topbar-username"
              value={tiktokUsernameInput}
              onChange={(event) => setTiktokUsernameInput(event.target.value)}
              placeholder="@nom_utilisateur"
              disabled={connectionBusy || isLiveConnected}
              aria-invalid={Boolean(connectionError)}
              aria-describedby={connectionError ? 'topbar-tiktok-error' : undefined}
            />
            <button className={`tiktok-connect-btn topbar-connect-btn ${isLiveConnected ? 'tiktok-disconnect-btn' : ''}`} type="submit" disabled={connectionBusy}>
              {connectionBusy ? '…' : isLiveConnected ? 'Déconnecter' : 'Connecter'}
            </button>
          </form>
          <button className="control-toggle" onClick={() => setIsControlPanelOpen(true)} aria-label="Ouvrir le panneau de contrôle" aria-expanded={isControlPanelOpen}><Settings2 size={17} /><span>CONTRÔLES</span></button>
        </div>
        {connectionError && <p className="topbar-tiktok-error" id="topbar-tiktok-error" role="alert">{connectionError}</p>}
      </header>

      <section className="main-grid">
        <div className="canvas-stage">
          <div className="canvas-container" ref={containerRef} />
        </div>

      </section>

      <button className={`control-backdrop ${isControlPanelOpen ? 'is-open' : ''}`} onClick={() => setIsControlPanelOpen(false)} aria-label="Fermer le panneau de contrôle" tabIndex={isControlPanelOpen ? 0 : -1} />
      <aside className={`control-panel ${isControlPanelOpen ? 'is-open' : ''}`} aria-hidden={!isControlPanelOpen}>
        <div className="control-panel-heading">
          <div className="panel-header"><Settings2 size={17} /><h2>PANNEAU DE CONTRÔLE</h2></div>
          <button className="panel-close" onClick={() => setIsControlPanelOpen(false)} aria-label="Fermer"><X size={18} /></button>
        </div>
        <section className="control-section">
          <div className="panel-header"><Settings2 size={16} /><h2>MOUVEMENT DU MUR</h2></div>
          <label className="wall-setting" htmlFor="wall-travel">
            <span>Distance d’aller-retour</span>
            <output htmlFor="wall-travel">{wallTravel.toFixed(1)}×</output>
          </label>
          <input
            className="wall-slider"
            id="wall-travel"
            type="range"
            min="0.2"
            max="2.4"
            step="0.1"
            value={wallTravel}
            onChange={(event) => {
              const value = Number(event.target.value);
              setWallTravel(value);
              engineRef.current?.setPusherTravel(value);
            }}
          />
          <label className="wall-setting" htmlFor="wall-speed">
            <span>Vitesse du mur</span>
            <output htmlFor="wall-speed">{wallSpeed.toFixed(1)}×</output>
          </label>
          <input
            className="wall-slider"
            id="wall-speed"
            type="range"
            min="0.4"
            max="3"
            step="0.1"
            value={wallSpeed}
            onChange={(event) => {
              const value = Number(event.target.value);
              setWallSpeed(value);
              engineRef.current?.setPusherSpeed(value);
            }}
          />
          <p className="tiktok-note">Réglez la distance d’avancée et de recul, ainsi que la vitesse du cycle.</p>
        </section>
        <section className="control-section">
          <div className="panel-header"><Sparkles size={16} /><h2>SIMULER UN CADEAU</h2></div>
          <button className="coin-btn coin-gold" onClick={() => dropCharacter('gold')}>
            <span className="coin-visual" />
            <div className="coin-info"><b>Personnage</b><small>Sticker animé GIPHY</small></div>
            <span className="coin-cost">TEST</span>
          </button>
          <button className="drop-all-btn" onClick={() => dropCharacter('gold')}><Zap size={16} /> ENVOYER 1 PERSONNAGE</button>
          <button className="drop-all-btn" onClick={() => engineRef.current?.spawnCharacters('gold', 5)}><Zap size={16} /> ENVOYER 5 PERSONNAGES</button>
          <button className="drop-all-btn" onClick={() => startWheel({ gift: 'test', user: 'Simulation', coinCount: 100, simulated: true })}><Sparkles size={16} /> TESTER LA ROUE</button>
        </section>

        <section className="control-section">
          <div className="panel-header"><Crown size={16} /><h2>RÉSERVE DE RÉCOMPENSES</h2></div>
          <p className="tiktok-note">{charactersRemaining.toLocaleString('fr-FR')} personnages restent sur {TOTAL_PRIZE_CHARACTERS.toLocaleString('fr-FR')}.</p>
          <ul className="reward-distribution">
            {CHARACTER_REWARD_DISTRIBUTION.map(({ stars, count }) => (
              <li key={stars}>{count} personnage{count > 1 ? 's' : ''} · {stars} étoile{stars > 1 ? 's' : ''}</li>
            ))}
            <li>{(TOTAL_PRIZE_CHARACTERS - CHARACTER_REWARD_DISTRIBUTION.reduce((sum, reward) => sum + reward.count, 0)).toLocaleString('fr-FR')} personnages · 0 étoile</li>
          </ul>
          {gameError && <p className="tiktok-error" role="alert">{gameError}</p>}
        </section>

        <section className="control-section">
          <div className="panel-header"><span className={`live-dot ${isLiveConnected ? '' : 'live-dot-offline'}`} /><h2>CONNEXION TIKTOK LIVE</h2></div>
          <label className="tiktok-label" htmlFor="tiktok-username">Nom d’utilisateur du LIVE</label>
          <div className="tiktok-input-row">
            <input ref={tiktokInputRef} id="tiktok-username" value={tiktokUsernameInput} onChange={(event) => setTiktokUsernameInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') connectTikTok(); }} placeholder="@nom_utilisateur" disabled={connectionBusy || isLiveConnected} />
            {isLiveConnected ? (
              <button className="tiktok-connect-btn tiktok-disconnect-btn" onClick={disconnectTikTok} disabled={connectionBusy}>Déconnecter</button>
            ) : (
              <button className="tiktok-connect-btn" onClick={connectTikTok} disabled={connectionBusy}>{connectionBusy ? 'Connexion…' : 'Connecter'}</button>
            )}
          </div>
          <p className="tiktok-note">Connecte les cadeaux d’un LIVE public par son nom d’utilisateur. Aucun mot de passe TikTok n’est demandé.</p>
          {connectionError && <p className="tiktok-error" role="alert">{connectionError}</p>}
          {isLiveConnected && tiktokUsername && <p className="tiktok-connected">LIVE connecté : @{tiktokUsername}</p>}
        </section>

        <section className="control-section activity-section">
          <div className="panel-header"><TrendingUp size={16} /><h2>ACTIVITÉ</h2></div>
          <div className="feed-list">
            {feed.map((item) => <div key={item.id} className="feed-item"><span className="feed-dot feed-dot-live" /><span className="feed-text">{item.text}</span>{item.points > 0 && <span className="feed-pts">+{item.points}</span>}</div>)}
          </div>
        </section>
      </aside>

      <footer className="bottom-bar">
        <div className="footer-stats">
          {score > 0 && <span><b>{score.toLocaleString('fr-FR')}</b> étoiles gagnées</span>}
          {score > 0 && wonTotal > 0 && <span className="footer-divider" />}
          {wonTotal > 0 && <span><b>{wonTotal}</b> personnages gagnés</span>}
          {(score > 0 || wonTotal > 0) && charactersOnDeck > 0 && <span className="footer-divider" />}
          {charactersOnDeck > 0 && <span><b>{charactersOnDeck}</b> personnages sur la table</span>}
        </div>
        <div className="footer-hint">
          Les cadeaux du LIVE font tomber les personnages · <a className="asset-credit" href="https://giphy.com/stickers/Pildyk-transparent-etJwkfG5JFf23pPVZQ" target="_blank" rel="noreferrer">Sticker GIPHY par Pildyk</a>
        </div>
      </footer>

      {wheel && (
        <div className="wheel-overlay">
          <section className="wheel-dialog" role="dialog" aria-modal="true" aria-labelledby="wheel-title">
            <button className="wheel-close" onClick={closeWheel} disabled={!wheel.settled} aria-label="Fermer"><X size={20} /></button>
            <p className="wheel-eyebrow">{wheel.user} · {wheel.gift} · {wheel.coinCount} pièces</p>
            <h2 id="wheel-title">ROUE DES CADEAUX</h2>
            <div className="wheel-pointer" aria-hidden="true" />
            <div className={`prize-wheel ${wheel.settled ? 'is-settled' : ''}`} style={{ transform: `rotate(${wheel.rotation}deg)` }}>
              {WHEEL_OUTCOMES.map((outcome, index) => <span className={`wheel-label wheel-label-${index}`} key={outcome}>{outcome}</span>)}
              <span className="wheel-center">SQUID<br />STORM</span>
            </div>
            <p className="wheel-result" aria-live="polite">{wheel.settled ? wheel.resolution : 'La roue tourne…'}</p>
            <button className="drop-all-btn wheel-continue" onClick={closeWheel} disabled={!wheel.settled}>
              {wheel.settled ? 'CONTINUER' : '…'}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
