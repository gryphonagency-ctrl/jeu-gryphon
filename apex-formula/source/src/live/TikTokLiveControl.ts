export interface LiveParticipant {
  id: string;
  username: string;
  giftCoins?: number;
  likeCount?: number;
}

declare global {
  interface Window {
    ArcadeEffects?: {
      simulateBigGift(username: string, coins: number): void;
      simulateShare(): void;
    };
  }
}

interface LiveMessage {
  type?: string;
  commentData?: Record<string, unknown>;
  gift?: Record<string, unknown>;
  giftData?: Record<string, unknown>;
  likeData?: Record<string, unknown>;
  [key: string]: unknown;
}

interface CircuitOption {
  id: string;
  name: string;
}

const JOIN_WINDOW_MS = 10_000;
export const MAX_LIVE_PLAYERS = 4;
const USERNAME_PATTERN = /^[A-Za-z0-9._]{1,32}$/;

export class TikTokLiveControl {
  private readonly accountInput: HTMLInputElement;
  private readonly statusLabel: HTMLElement;
  private readonly raceLabel: HTMLElement;
  private readonly playersLabel: HTMLElement;
  private readonly connectButton: HTMLButtonElement;
  private readonly disconnectButton: HTMLButtonElement;
  private readonly lapCountInput: HTMLSelectElement;
  private readonly circuitInput: HTMLSelectElement;
  private readonly volumeInput: HTMLInputElement;
  private readonly volumeLabel: HTMLElement;
  private readonly recoveryButtons: HTMLButtonElement[] = [];
  private readonly participants = new Map<string, LiveParticipant>();
  private readonly seenMessages = new Set<string>();
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private joinTimer: number | null = null;
  private countdownTimer: number | null = null;
  private joinDeadline = 0;
  private raceLocked = false;
  private manuallyDisconnected = false;
  private simulatedPlayerCount = 0;
  private lastSimulatedUser = '';

  constructor(
    root: HTMLElement,
    private readonly onRaceStart: (participants: LiveParticipant[], laps: 3 | 5, circuitId: string) => void,
    private readonly onGift: (userId: string, username: string, coinCount: number) => string,
    private readonly onLike: (userId: string, username: string, likeCount: number) => string,
    private readonly onUnstickPlayer: (screenIndex: number) => string,
    initialVolume: number,
    initialLaps: 3 | 5,
    circuits: readonly CircuitOption[],
    private readonly onVolumeChange: (volume: number) => number,
  ) {
    const panel = document.createElement('details');
    panel.className = 'apex-live-panel';
    panel.open = true;
    panel.innerHTML = `
      <summary>GRYPHON ARCADE · TIKTOK LIVE</summary>
      <div class="apex-live-content">
        <label for="apex-live-account">Pseudo du compte en direct</label>
        <div class="apex-live-row">
          <input id="apex-live-account" type="text" maxlength="32" placeholder="pseudo_tiktok" autocomplete="off">
          <button type="button" class="apex-live-connect">Connecter</button>
          <button type="button" class="apex-live-disconnect" disabled>Déconnecter</button>
        </div>
        <div class="apex-live-status" role="status" aria-live="polite">Connecte le compte TikTok de ton direct.</div>
        <div class="apex-live-race" role="status" aria-live="polite">En attente du mot « go ».</div>
        <div class="apex-live-players">0 / ${MAX_LIVE_PLAYERS} joueurs</div>
        <div class="apex-live-recovery">
          <div>Débloquer un joueur et le remettre au centre</div>
          <div class="apex-live-recovery-grid"></div>
        </div>
        <div class="apex-live-volume">
          <span>Volume du jeu</span>
          <input class="apex-live-volume-input" type="range" min="0" max="1" step="0.05" value="${initialVolume}" aria-label="Volume du jeu">
          <output class="apex-live-volume-value">${Math.round(initialVolume * 100)} %</output>
        </div>
        <label class="apex-live-laps">Tours de la course
          <select class="apex-live-laps-input" aria-label="Nombre de tours">
            <option value="3"${initialLaps === 3 ? ' selected' : ''}>3 tours</option>
            <option value="5"${initialLaps === 5 ? ' selected' : ''}>5 tours</option>
          </select>
        </label>
        <label class="apex-live-circuit">Circuit de la course
          <select class="apex-live-circuit-input" aria-label="Circuit de la course"></select>
        </label>
        <div class="apex-live-row apex-live-simulators">
          <button type="button" class="apex-live-sim-go">Tester « go »</button>
          <button type="button" class="apex-live-sim-like">Tester like</button>
          <button type="button" class="apex-live-sim-gift">Tester cadeau · 10 pièces</button>
          <button type="button" class="apex-live-sim-share">Tester partage</button>
        </div>
      </div>`;
    const eyeButton = document.createElement('button');
    eyeButton.className = 'apex-live-toggle';
    eyeButton.type = 'button';
    eyeButton.setAttribute('aria-label', 'Masquer le panneau de configuration');
    eyeButton.title = 'Masquer le panneau de configuration';
    const eyeOpen = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
    const eyeClosed = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1.4 0 2.6-.3 3.7-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
    eyeButton.innerHTML = eyeOpen;
    const style = document.createElement('style');
    style.textContent = `
      .apex-live-panel{position:fixed;z-index:20;top:58px;right:12px;width:min(410px,calc(100vw - 24px));max-height:calc(100vh - 70px);overflow:auto;color:#f5f7fb;background:rgba(9,14,24,.94);border:1px solid #526076;border-radius:10px;font:12px/1.45 system-ui,sans-serif;box-shadow:0 8px 32px #0008}
      .apex-live-panel summary{cursor:pointer;padding:10px 12px;font-weight:700;letter-spacing:.08em}
      .apex-live-content{padding:0 12px 12px}
      .apex-live-content label{display:block;margin:4px 0}
      .apex-live-row{display:flex;gap:6px;flex-wrap:wrap}
      .apex-live-panel input,.apex-live-panel select,.apex-live-panel button{box-sizing:border-box;min-height:32px;border:1px solid #65738a;border-radius:5px;color:inherit;background:#182234;padding:5px 8px;font:inherit}
      .apex-live-panel input[type="text"]{min-width:120px;flex:1}
      .apex-live-panel button{cursor:pointer}
      .apex-live-panel button:disabled{opacity:.55;cursor:default}
      .apex-live-status,.apex-live-race{margin-top:7px;color:#c5d1e4}
      .apex-live-race{color:#8ee4ff}
      .apex-live-players{margin:5px 0;color:#d4dbea}
      .apex-live-recovery{margin-top:8px;color:#d4dbea}
      .apex-live-recovery-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:5px}
      .apex-live-recovery-grid button{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .apex-live-volume{display:flex;align-items:center;gap:8px;margin-top:8px}
      .apex-live-volume span{margin-right:auto}
      .apex-live-volume-input{min-width:80px;max-width:180px;flex:1;accent-color:#e10600}
      .apex-live-volume-value{min-width:42px;text-align:center;font-variant-numeric:tabular-nums}
      .apex-live-laps,.apex-live-circuit{display:flex!important;align-items:center;justify-content:space-between;gap:10px;margin-top:8px!important}
      .apex-live-toggle{position:fixed;z-index:21;top:12px;right:12px;width:38px;height:38px;display:grid;place-items:center;border:1px solid #65738a;border-radius:7px;background:rgba(9,14,24,.94);color:#fff;cursor:pointer}
      .apex-live-toggle svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .apex-live-simulators{margin-top:8px}
      @media(max-width:600px){.apex-live-panel{top:50px;right:6px;width:min(360px,calc(100vw - 12px));max-height:calc(45vh - 50px)}.apex-live-toggle{top:6px;right:6px}.apex-live-simulators{display:none}}
    `;
    root.append(style, panel, eyeButton);

    this.accountInput = panel.querySelector('#apex-live-account') as HTMLInputElement;
    this.statusLabel = panel.querySelector('.apex-live-status') as HTMLElement;
    this.raceLabel = panel.querySelector('.apex-live-race') as HTMLElement;
    this.playersLabel = panel.querySelector('.apex-live-players') as HTMLElement;
    this.connectButton = panel.querySelector('.apex-live-connect') as HTMLButtonElement;
    this.disconnectButton = panel.querySelector('.apex-live-disconnect') as HTMLButtonElement;
    this.lapCountInput = panel.querySelector('.apex-live-laps-input') as HTMLSelectElement;
    this.circuitInput = panel.querySelector('.apex-live-circuit-input') as HTMLSelectElement;
    for (const circuit of circuits) {
      const option = document.createElement('option');
      option.value = circuit.id;
      option.textContent = circuit.name;
      this.circuitInput.appendChild(option);
    }
    this.volumeInput = panel.querySelector('.apex-live-volume-input') as HTMLInputElement;
    this.volumeLabel = panel.querySelector('.apex-live-volume-value') as HTMLElement;
    const recoveryGrid = panel.querySelector('.apex-live-recovery-grid') as HTMLElement;
    for (let screenIndex = 0; screenIndex < MAX_LIVE_PLAYERS; screenIndex++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => this.setRaceStatus(this.onUnstickPlayer(screenIndex)));
      this.recoveryButtons.push(button);
      recoveryGrid.appendChild(button);
    }
    this.updateRecoveryButtons();

    eyeButton.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      const action = panel.hidden ? 'Afficher' : 'Masquer';
      eyeButton.setAttribute('aria-label', `${action} le panneau de configuration`);
      eyeButton.title = `${action} le panneau de configuration`;
      eyeButton.innerHTML = panel.hidden ? eyeClosed : eyeOpen;
    });
    this.connectButton.addEventListener('click', () => this.connect());
    this.disconnectButton.addEventListener('click', () => this.disconnect());
    this.volumeInput.addEventListener('input', () => this.changeVolume(Number(this.volumeInput.value)));
    panel.querySelector('.apex-live-sim-go')?.addEventListener('click', () => {
      this.simulatedPlayerCount++;
      this.lastSimulatedUser = `spectateur_test_${this.simulatedPlayerCount}`;
      this.handleComment({ type: 'comment', commentData: { uniqueId: this.lastSimulatedUser, username: this.lastSimulatedUser, comment: 'go' } });
    });
    panel.querySelector('.apex-live-sim-like')?.addEventListener('click', () => {
      const username = this.lastSimulatedUser || 'spectateur_test';
      this.handleLike({ type: 'like', likeData: { uniqueId: username, username, likeCount: 1, messageId: `sim-like-${Date.now()}` } });
    });
    panel.querySelector('.apex-live-sim-gift')?.addEventListener('click', () => {
      const username = this.lastSimulatedUser || 'spectateur_test';
      window.ArcadeEffects?.simulateBigGift(username, 10);
      this.handleGift({ type: 'gift', gift: { uniqueId: username, username, coinCount: 10 } });
    });
    panel.querySelector('.apex-live-sim-share')?.addEventListener('click', () => window.ArcadeEffects?.simulateShare());
  }

  setRaceStatus(message: string): void {
    this.raceLabel.textContent = message;
  }

  resetForNextRace(): void {
    this.clearJoinTimers();
    this.participants.clear();
    this.raceLocked = false;
    this.updatePlayerCount();
    this.setRaceStatus('Course terminée · écris « go » pour la suivante.');
  }

  dispose(): void {
    this.manuallyDisconnected = true;
    this.clearJoinTimers();
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    const username = this.accountInput.value.trim().replace(/^@/, '');
    if (!USERNAME_PATTERN.test(username)) {
      this.statusLabel.textContent = 'Saisis un pseudo TikTok valide, sans espaces.';
      this.accountInput.focus();
      return;
    }

    this.disconnect(false);
    this.manuallyDisconnected = false;
    this.connectButton.disabled = true;
    this.disconnectButton.disabled = false;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${protocol}//${location.host}`);
    } catch (error) {
      this.connectButton.disabled = false;
      this.disconnectButton.disabled = true;
      this.statusLabel.textContent = `Connexion impossible : ${String(error)}`;
      return;
    }

    this.socket = socket;
    this.statusLabel.textContent = `Connexion au direct de @${username}…`;
    socket.addEventListener('open', () => {
      if (socket !== this.socket) return;
      socket.send(JSON.stringify({ action: 'CONNECT_TIKTOK', username }));
      this.statusLabel.textContent = `Demande envoyée pour @${username} · attente du live…`;
    });
    socket.addEventListener('message', (event) => {
      if (socket !== this.socket || typeof event.data !== 'string') return;
      try {
        this.handleMessage(JSON.parse(event.data) as LiveMessage);
      } catch (error) {
        console.error('Événement TikTok illisible.', error);
        this.statusLabel.textContent = 'Le relais a envoyé un événement illisible.';
      }
    });
    socket.addEventListener('error', () => {
      if (socket === this.socket) this.statusLabel.textContent = 'Relais inaccessible ou session non autorisée.';
    });
    socket.addEventListener('close', () => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.connectButton.disabled = false;
      this.disconnectButton.disabled = true;
      if (this.manuallyDisconnected) return;
      this.statusLabel.textContent = 'Connexion interrompue · nouvelle tentative…';
      this.reconnectTimer = window.setTimeout(() => this.connect(), 3000);
    });
  }

  private disconnect(manual = true): void {
    if (manual) this.manuallyDisconnected = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    this.connectButton.disabled = false;
    this.disconnectButton.disabled = true;
    if (manual) this.statusLabel.textContent = 'Déconnecté du live.';
  }

  private handleMessage(message: LiveMessage): void {
    if (!message || typeof message !== 'object') return;
    const type = String(message.type ?? '').toLowerCase();
    if (type === 'status') {
      this.statusLabel.textContent = String(message.message ?? 'Statut du live mis à jour.');
    } else if (type === 'comment' || type === 'tiktok-comment') {
      this.handleComment(message);
    } else if (type === 'gift' || type === 'tiktok-gift') {
      this.handleGift(message);
    } else if (type === 'like' || type === 'tiktok-like') {
      this.handleLike(message);
    }
  }

  private handleComment(message: LiveMessage): void {
    const comment = message.commentData ?? message;
    const text = String(comment.comment ?? comment.content ?? '').trim().toLowerCase();
    if (text !== 'go') return;
    const username = this.usernameFrom(comment);
    if (!username) {
      this.raceLabel.textContent = 'Inscription refusée : pseudo TikTok absent.';
      return;
    }
    const id = username.toLowerCase();
    if (this.raceLocked) {
      this.raceLabel.textContent = 'La course est en cours · réessaie après l’arrivée.';
      return;
    }
    if (this.participants.has(id)) {
      this.raceLabel.textContent = `@${username} est déjà inscrit.`;
      return;
    }
    if (this.participants.size >= MAX_LIVE_PLAYERS) {
      this.raceLabel.textContent = `La grille est complète (${MAX_LIVE_PLAYERS} joueurs maximum).`;
      return;
    }

    this.participants.set(id, { id, username });
    this.updatePlayerCount();
    if (this.joinTimer === null) {
      this.joinDeadline = Date.now() + JOIN_WINDOW_MS;
      this.joinTimer = window.setTimeout(() => this.startRace(), JOIN_WINDOW_MS);
      this.countdownTimer = window.setInterval(() => this.updateCountdown(), 1000);
    }
    this.updateCountdown();
  }

  private handleLike(message: LiveMessage): void {
    const like = message.likeData ?? message;
    const username = this.usernameFrom(like);
    const likeCount = this.likeCountFrom(like);
    if (!username || likeCount < 1) return;
    const id = String(like.messageId ?? like.msgId ?? '');
    if (id && !this.rememberMessage(id)) return;
    const userId = username.toLowerCase();
    const participant = this.participants.get(userId);
    if (!participant) {
      this.raceLabel.textContent = `@${username} : écris « go » pour inscrire ta voiture avant de liker.`;
      return;
    }
    if (!this.raceLocked) {
      const previousLikes = participant.likeCount ?? 0;
      const nextLikes = Math.min(50, previousLikes + likeCount);
      this.participants.set(userId, { ...participant, likeCount: nextLikes });
      const applied = nextLikes - previousLikes;
      this.raceLabel.textContent = applied > 0
        ? `Likes de @${username} · +${applied} km/h au départ (bonus maximal : +50 km/h).`
        : `@${username} a atteint son bonus maximal de +50 km/h avec les likes. Les cadeaux peuvent encore augmenter sa vitesse.`;
      return;
    }
    this.raceLabel.textContent = this.onLike(userId, username, likeCount);
  }

  private handleGift(message: LiveMessage): void {
    const gift = message.gift ?? message.giftData ?? message;
    const username = this.usernameFrom(gift);
    const coinCount = this.coinCountFrom(gift);
    if (!username || coinCount < 1) return;
    const id = String(gift.messageId ?? '');
    if (id && !this.rememberMessage(id)) return;
    const userId = username.toLowerCase();
    const participant = this.participants.get(userId);
    if (!participant) {
      this.raceLabel.textContent = `@${username} : écris « go » pour inscrire ta voiture.`;
      return;
    }
    if (!this.raceLocked) {
      const giftCoins = Math.min(Number.MAX_SAFE_INTEGER, (participant.giftCoins ?? 0) + coinCount);
      this.participants.set(userId, { ...participant, giftCoins });
      this.raceLabel.textContent = `Cadeau de @${username} enregistré · vitesse augmentée au départ.`;
      return;
    }
    this.raceLabel.textContent = this.onGift(userId, username, coinCount);
  }

  private startRace(): void {
    this.clearJoinTimers();
    this.raceLocked = true;
    this.updateRecoveryButtons();
    const participants = [...this.participants.values()];
    const laps: 3 | 5 = Number(this.lapCountInput.value) === 5 ? 5 : 3;
    const circuitId = this.circuitInput.value;
    this.setRaceStatus(`Départ automatique · ${participants.length} joueur${participants.length > 1 ? 's' : ''} · ${laps} tours.`);
    this.onRaceStart(participants, laps, circuitId);
  }

  private updateCountdown(): void {
    const remaining = Math.max(0, Math.ceil((this.joinDeadline - Date.now()) / 1000));
    const count = this.participants.size;
    this.setRaceStatus(`${count} joueur${count > 1 ? 's' : ''} inscrit${count > 1 ? 's' : ''} · départ dans ${remaining} s.`);
  }

  private updatePlayerCount(): void {
    this.playersLabel.textContent = `${this.participants.size} / ${MAX_LIVE_PLAYERS} joueurs`;
    this.updateRecoveryButtons();
  }

  private updateRecoveryButtons(): void {
    const participants = [...this.participants.values()];
    this.recoveryButtons.forEach((button, screenIndex) => {
      const participant = participants[screenIndex];
      button.disabled = !this.raceLocked || !participant;
      button.textContent = participant
        ? `Débloquer écran ${screenIndex + 1} · @${participant.username}`
        : `Écran ${screenIndex + 1} · libre`;
      button.title = participant
        ? `Remettre @${participant.username} au centre de l’écran ${screenIndex + 1}`
        : `Aucun joueur sur l’écran ${screenIndex + 1}`;
      button.setAttribute('aria-label', button.title);
    });
  }

  private changeVolume(volume: number): void {
    const nextVolume = this.onVolumeChange(volume);
    this.volumeInput.value = String(nextVolume);
    this.volumeLabel.textContent = `${Math.round(nextVolume * 100)} %`;
  }

  private clearJoinTimers(): void {
    if (this.joinTimer !== null) window.clearTimeout(this.joinTimer);
    if (this.countdownTimer !== null) window.clearInterval(this.countdownTimer);
    this.joinTimer = null;
    this.countdownTimer = null;
  }

  private rememberMessage(id: string): boolean {
    if (this.seenMessages.has(id)) return false;
    this.seenMessages.add(id);
    if (this.seenMessages.size > 2000) {
      const oldest = this.seenMessages.values().next().value;
      if (oldest !== undefined) this.seenMessages.delete(oldest);
    }
    return true;
  }

  private usernameFrom(source: Record<string, unknown>): string {
    const value = source.uniqueId ?? source.username ?? source.nickname;
    return typeof value === 'string' ? value.trim().replace(/^@/, '') : '';
  }

  private coinCountFrom(gift: Record<string, unknown>): number {
    const reported = Number(gift.coinCount);
    if (Number.isSafeInteger(reported) && reported > 0) return reported;
    const coinValue = Number(gift.coinValue ?? gift.diamondCount ?? gift.diamonds);
    const repeatCount = Number(gift.repeatCount ?? 1);
    const total = coinValue * repeatCount;
    return Number.isSafeInteger(total) && total > 0 ? total : 0;
  }

  private likeCountFrom(like: Record<string, unknown>): number {
    const count = Math.floor(Number(like.likeCount ?? like.count ?? 1));
    return Number.isSafeInteger(count) && count > 0 ? Math.min(50, count) : 0;
  }
}
