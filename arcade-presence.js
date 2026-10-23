(() => {
    const clientId = crypto.randomUUID();
    let stopped = false;
    let timer;

    async function sendPresence(action) {
        const payload = JSON.stringify({
            action,
            clientId,
            game: window.location.pathname
        });
        if (action === 'leave' && navigator.sendBeacon) {
            navigator.sendBeacon('/api/presence', new Blob([payload], {
                type: 'application/json'
            }));
            return;
        }
        try {
            const response = await fetch('/api/presence', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: action === 'leave'
            });
            if (response.status === 401) {
                stopped = true;
                window.clearInterval(timer);
                window.location.replace('/?connexion=requise');
            } else if (!response.ok && !stopped) {
                console.warn('Le serveur a refusé le signal de présence arcade.');
            }
        } catch (error) {
            if (!stopped) console.warn('Impossible d’actualiser la présence arcade :', error.message);
        }
    }

    fetch('/api/session', { credentials: 'same-origin' })
        .then(response => response.ok ? response.json() : null)
        .then(session => {
            if (!session?.authenticated || stopped) return;
            void sendPresence('heartbeat');
            timer = window.setInterval(() => sendPresence('heartbeat'), 15000);
            window.addEventListener('pagehide', () => {
                stopped = true;
                window.clearInterval(timer);
                void sendPresence('leave');
            }, { once: true });
        })
        .catch(error => console.warn('Impossible de démarrer le suivi de présence :', error.message));
})();
