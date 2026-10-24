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

    window.ArcadeStars = Object.freeze({
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

    const style = document.createElement('style');
    style.textContent = `
        #arcade-stars-wallet{position:fixed;z-index:2147483000;right:16px;bottom:16px;display:flex;align-items:center;gap:10px;max-width:min(360px,calc(100vw - 32px));padding:10px 14px;border:1px solid #f5d36b;border-radius:14px;background:rgba(9,17,36,.96);box-shadow:0 8px 30px #0008;color:#fff;font:700 13px/1.35 system-ui,sans-serif}
        #arcade-stars-wallet[hidden],#arcade-stars-wallet img[hidden]{display:none}
        #arcade-stars-wallet img{width:38px;height:38px;flex:none;border-radius:50%;object-fit:cover}
        #arcade-stars-wallet div{display:grid;gap:3px;min-width:0}
        #arcade-stars-wallet strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #arcade-stars-wallet div span{color:#ffe17d}
        #arcade-stars-wallet .arcade-stars-status{color:#9eeeff;font-size:11px}
    `;
    document.head.append(style);
})();
