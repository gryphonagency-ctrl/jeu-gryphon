(() => {
    const heartbeatIntervalMs = 15_000;
    let remainingSeconds = null;
    let lastSuccessfulRequestAt = Date.now();
    let blocked = false;
    let banner;
    let timer;
    let heartbeatTimer;

    function showBlocked(message, loginRequired = false) {
        if (blocked) return;
        blocked = true;
        clearInterval(timer);
        clearInterval(heartbeatTimer);
        document.body.style.pointerEvents = 'none';
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:rgba(7,12,24,.96);color:#fff;font:16px system-ui,sans-serif;pointer-events:auto';
        const panel = document.createElement('main');
        panel.style.cssText = 'max-width:560px;padding:28px;border:1px solid #37516b;border-radius:16px;background:#17243a';
        const title = document.createElement('h1');
        title.textContent = loginRequired ? 'Connexion TikTok requise' : 'Temps de jeu atteint';
        const text = document.createElement('p');
        text.textContent = message;
        panel.append(title, text);
        if (loginRequired) {
            const link = document.createElement('a');
            link.href = `/auth/tiktok?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
            link.textContent = 'Continuer avec TikTok';
            link.style.color = '#8bdcff';
            panel.append(link);
        } else {
            const home = document.createElement('a');
            home.href = '/#jeux';
            home.textContent = 'Retour à l’accueil';
            home.style.color = '#8bdcff';
            panel.append(home);
        }
        overlay.append(panel);
        document.body.append(overlay);
        document.addEventListener('keydown', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
    }

    function drawBanner() {
        if (!banner || remainingSeconds === null) return;
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = String(remainingSeconds % 60).padStart(2, '0');
        banner.textContent = `@${banner.dataset.username} · Temps gratuit restant aujourd’hui : ${minutes}:${seconds}`;
    }

    function updateStatus(status) {
        lastSuccessfulRequestAt = Date.now();
        if (!status || !status.authenticated) {
            showBlocked('Connecte-toi avec TikTok pour utiliser les jeux gratuits.', true);
            return;
        }
        if (status.banned) {
            showBlocked('L’accès aux jeux gratuits a été bloqué par l’administrateur.');
            return;
        }
        if (!status.allowed) {
            showBlocked('La limite quotidienne de jeu gratuit est atteinte. Réessaie demain (heure de Paris).');
            return;
        }
        remainingSeconds = status.remainingSeconds;
        if (!banner) {
            banner = document.createElement('div');
            banner.dataset.username = status.username;
            banner.setAttribute('role', 'status');
            banner.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:2147483000;padding:7px 10px;border:1px solid rgba(139,220,255,.4);border-radius:8px;background:rgba(12,26,43,.86);color:#fff;font:12px system-ui,sans-serif;pointer-events:none';
            document.body.append(banner);
        }
        drawBanner();
    }

    async function sendHeartbeat(active) {
        if (blocked) return;
        try {
            const response = await fetch('/api/free-games/heartbeat', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active }),
                keepalive: !active
            });
            const result = await response.json();
            if (response.status === 401) {
                showBlocked('La session TikTok a expiré. Reconnecte-toi pour continuer.', true);
                return;
            }
            if (response.status === 403) {
                location.replace(location.pathname + location.search);
                return;
            }
            if (!response.ok) throw new Error(result.message || 'Contrôle de session indisponible.');
            updateStatus(result);
        } catch {
            if (Date.now() - lastSuccessfulRequestAt > heartbeatIntervalMs * 2) {
                showBlocked('La connexion au contrôle du temps est interrompue. Recharge la page pour réessayer.');
            }
        }
    }

    document.addEventListener('visibilitychange', () => {
        void sendHeartbeat(!document.hidden);
    });

    void sendHeartbeat(true);
    timer = setInterval(() => {
        if (document.hidden) return;
        if (remainingSeconds !== null) {
            remainingSeconds = Math.max(0, remainingSeconds - 1);
            drawBanner();
        }
    }, 1000);
    heartbeatTimer = setInterval(() => {
        if (!document.hidden) void sendHeartbeat(true);
    }, heartbeatIntervalMs);
    window.addEventListener('pagehide', () => {
        clearInterval(heartbeatTimer);
        void sendHeartbeat(false);
    }, { once: true });
})();
