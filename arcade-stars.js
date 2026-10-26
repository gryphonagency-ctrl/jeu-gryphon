(() => {
    const nativeWebSocket = window.WebSocket;
    const walletEvent = (name, detail) => window.dispatchEvent(
        new CustomEvent(name, { detail })
    );
    let profileCard;
    let avatar;
    let playerName;
    let balance;
    let status;
    let hideTimer;

    function displayPlayer(player, message = '') {
        if (!player) return;
        if (!profileCard) {
            profileCard = document.createElement('aside');
            profileCard.id = 'arcade-stars-wallet';
            profileCard.setAttribute('aria-live', 'polite');
            profileCard.innerHTML = '<img alt="" hidden><div><strong></strong><span></span></div>';
            document.body.append(profileCard);
            avatar = profileCard.querySelector('img');
            playerName = profileCard.querySelector('strong');
            balance = profileCard.querySelector('span');
        }
        playerName.textContent = `@${player.username || player.uniqueId || 'Spectateur'}`;
        balance.textContent = `${Number(player.stars || 0).toLocaleString('fr-FR')} étoiles`;
        if (player.avatarUrl) {
            avatar.src = player.avatarUrl;
            avatar.hidden = false;
        } else {
            avatar.removeAttribute('src');
            avatar.hidden = true;
        }
        profileCard.dataset.message = message;
        profileCard.title = message || playerName.textContent;
        profileCard.hidden = false;
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
            if (profileCard) profileCard.hidden = true;
        }, 8000);
        walletEvent('arcade:wallet', { player, message });
    }

    function displayRunRejection(message) {
        if (!profileCard) return;
        if (!status) {
            status = document.createElement('span');
            status.className = 'arcade-stars-status';
            profileCard.append(status);
        }
        status.textContent = message;
        profileCard.hidden = false;
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
            if (profileCard) profileCard.hidden = true;
        }, 8000);
    }

    function handleWalletMessage(event) {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }
        if (data.type === 'WALLET_BALANCE') {
            displayPlayer(data.player, 'Solde global consulté dans le chat.');
        } else if (data.type === 'WALLET_RUN') {
            displayPlayer(data.player, `${Number(data.spent || 0).toLocaleString('fr-FR')} étoiles dépensées.`);
            walletEvent('arcade:wallet-run', data);
        } else if (data.type === 'WALLET_RUN_REJECTED') {
            displayPlayer(data.player, data.message || 'RUN impossible.');
            displayRunRejection(data.message || 'Solde insuffisant.');
            walletEvent('arcade:wallet-run-rejected', data);
        }
    }

    class ArcadeWebSocket extends nativeWebSocket {
        constructor(...args) {
            super(...args);
            this.addEventListener('message', handleWalletMessage);
        }
    }

    window.WebSocket = ArcadeWebSocket;

    // Enregistre un gain local d'un jeu dans le portefeuille serveur (total dû). Les erreurs ne gênent jamais le jeu.
    const PENDING_KEY = 'arcade-stars-pending';
    const CARRY_KEY = 'arcade-stars-carry';
    const readJson = (key, fallback) => {
        try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
    };
    const writeJson = (key, value) => {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage plein ou bloqué */ }
    };
    let flushing = false;
    async function flushPending() {
        if (flushing) return;
        flushing = true;
        try {
            let queue = readJson(PENDING_KEY, []);
            while (queue.length) {
                const entry = queue[0];
                let drop = true;
                try {
                    const response = await fetch('/api/tiktok-stars', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'award',
                            username: entry.username,
                            amount: entry.amount,
                            gameId: window.location.pathname,
                            transactionId: entry.id
                        })
                    });
                    // Réseau ou serveur indisponible : on réessaiera plus tard.
                    if (response.status >= 500 || response.status === 429) drop = false;
                } catch {
                    drop = false;
                }
                if (!drop) {
                    entry.tries = (entry.tries || 0) + 1;
                    if (entry.tries < 20) break;
                }
                queue = readJson(PENDING_KEY, []).filter(item => item.id !== entry.id);
                writeJson(PENDING_KEY, queue);
            }
        } finally {
            flushing = false;
            writeJson(PENDING_KEY, readJson(PENDING_KEY, []).slice(-300));
        }
        if (typeof refreshOwedTotal === 'function') refreshOwedTotal();
    }
    function record(username, amount) {
        const name = String(username || '').trim().replace(/^@/, '');
        const value = Number(amount);
        if (!name || !Number.isFinite(value) || value <= 0) return;
        const key = name.toLowerCase();
        const carry = readJson(CARRY_KEY, {});
        const total = (carry[key] || 0) + value;
        const whole = Math.floor(total + 1e-9);
        carry[key] = Math.round((total - whole) * 100) / 100;
        writeJson(CARRY_KEY, carry);
        if (whole < 1) return;
        const queue = readJson(PENDING_KEY, []);
        queue.push({ id: crypto.randomUUID(), username: name, amount: Math.min(whole, 250000) });
        writeJson(PENDING_KEY, queue);
        flushPending();
    }
    window.addEventListener('online', flushPending);
    window.addEventListener('DOMContentLoaded', () => window.setTimeout(flushPending, 2000));

    window.ArcadeStars = Object.freeze({
        record,
        async getBalance(player) {
            const response = await fetch(`/api/tiktok-stars?player=${encodeURIComponent(player)}`, {
                credentials: 'same-origin',
                cache: 'no-store'
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Impossible de lire le solde.');
            displayPlayer(result.player);
            return result.player;
        },
        async award({ playerId, username, amount, transactionId = crypto.randomUUID() }) {
            try {
                const response = await fetch('/api/tiktok-stars', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'award',
                        playerId,
                        username,
                        amount,
                        gameId: window.location.pathname,
                        transactionId
                    })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message || 'Impossible d’enregistrer les étoiles.');
                displayPlayer(result.player, `${Number(amount).toLocaleString('fr-FR')} étoiles ajoutées.`);
                return result.player;
            } catch (error) {
                displayPlayer({ username: username || 'Portefeuille', stars: 0 }, 'Récompense non confirmée.');
                displayRunRejection(error.message);
                throw error;
            }
        }
    });

    // Badge réservé à l'administrateur : total des étoiles dues à tous les joueurs.
    let owedBadge;
    async function refreshOwedTotal() {
        try {
            const response = await fetch('/api/tiktok-stars/leaderboard?scope=total', {
                credentials: 'same-origin',
                cache: 'no-store'
            });
            if (!response.ok) return;
            const result = await response.json();
            if (result.scope !== 'total' || !document.body) return;
            if (!owedBadge) {
                owedBadge = document.createElement('div');
                owedBadge.id = 'arcade-stars-owed';
                owedBadge.title = 'Total des étoiles dues à tous les joueurs (visible par toi seul)';
                document.body.append(owedBadge);
            }
            owedBadge.textContent = `⭐ Dû aux joueurs : ${Number(result.totalOwed || 0).toLocaleString('fr-FR')}`;
        } catch {
            // Hors connexion ou non administrateur : rien à afficher.
        }
    }
    window.addEventListener('DOMContentLoaded', refreshOwedTotal);
    window.addEventListener('arcade:wallet', () => window.setTimeout(refreshOwedTotal, 800));
    window.setInterval(refreshOwedTotal, 30000);

    const style = document.createElement('style');
    style.textContent = `
        #arcade-stars-wallet{position:fixed;z-index:2147483000;right:16px;bottom:16px;display:flex;align-items:center;gap:10px;max-width:min(360px,calc(100vw - 32px));padding:10px 14px;border:1px solid #f5d36b;border-radius:14px;background:rgba(9,17,36,.96);box-shadow:0 8px 30px #0008;color:#fff;font:700 13px/1.35 system-ui,sans-serif}
        #arcade-stars-owed{position:fixed;z-index:2147483000;left:50%;bottom:6px;transform:translateX(-50%);padding:4px 12px;border:1px solid #f5d36b;border-radius:999px;background:rgba(9,17,36,.9);color:#ffe17d;font:800 12px/1.3 system-ui,sans-serif;pointer-events:none}
        #arcade-stars-wallet[hidden],#arcade-stars-wallet img[hidden]{display:none}
        #arcade-stars-wallet img{width:38px;height:38px;flex:none;border-radius:50%;object-fit:cover}
        #arcade-stars-wallet div{display:grid;gap:3px;min-width:0}
        #arcade-stars-wallet strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #arcade-stars-wallet div span{color:#ffe17d}
        #arcade-stars-wallet .arcade-stars-status{color:#9eeeff;font-size:11px}
    `;
    document.head.append(style);
})();
