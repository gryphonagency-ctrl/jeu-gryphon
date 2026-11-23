(() => {
    const defaultLimitInput = document.getElementById('free-games-default-limit');
    const gamesList = document.getElementById('free-games-list');
    const playersList = document.getElementById('tiktok-free-players-list');
    const status = document.getElementById('tiktok-free-admin-status');
    const form = document.getElementById('free-games-default-limit-form');

    if (!defaultLimitInput || !gamesList || !playersList || !status || !form) return;

    async function request(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            ...options,
            headers: {
                ...(options.headers || {}),
                ...(options.body ? { 'Content-Type': 'application/json' } : {})
            }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Impossible de charger la gestion des jeux gratuits.');
        return result;
    }

    function setStatus(message, failed = false) {
        status.className = failed ? 'checkout-status error' : 'checkout-status';
        status.textContent = message;
    }

    function appendTextCell(row, value) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
        return cell;
    }

    function renderGames(games) {
        gamesList.replaceChildren();
        if (!games.length) {
            const row = document.createElement('tr');
            const cell = appendTextCell(row, 'Aucun jeu gratuit configuré.');
            cell.colSpan = 2;
            gamesList.append(row);
            return;
        }
        for (const game of games) {
            const row = document.createElement('tr');
            appendTextCell(row, game.title);
            appendTextCell(row, game.id);
            gamesList.append(row);
        }
    }

    function renderPlayers(players, defaultLimitMinutes) {
        playersList.replaceChildren();
        if (!players.length) {
            const row = document.createElement('tr');
            const cell = appendTextCell(row, 'Aucun joueur TikTok ne s’est encore connecté.');
            cell.colSpan = 6;
            playersList.append(row);
            return;
        }
        for (const player of players) {
            const row = document.createElement('tr');
            appendTextCell(row, `@${player.username}`);
            appendTextCell(row, player.displayName);
            appendTextCell(row, `${Math.floor(player.usedSeconds / 60)} min ${player.usedSeconds % 60} s`);

            const limitCell = document.createElement('td');
            const limitInput = document.createElement('input');
            limitInput.type = 'number';
            limitInput.min = '1';
            limitInput.max = '1440';
            limitInput.step = '1';
            limitInput.placeholder = `Défaut : ${defaultLimitMinutes} min`;
            limitInput.value = player.limitMinutes === null ? '' : String(player.limitMinutes);
            limitInput.setAttribute('aria-label', `Limite quotidienne de @${player.username}, en minutes`);
            limitCell.append(limitInput);
            row.append(limitCell);

            const accessCell = document.createElement('td');
            const bannedLabel = document.createElement('label');
            const bannedInput = document.createElement('input');
            bannedInput.type = 'checkbox';
            bannedInput.checked = player.banned;
            bannedLabel.append(bannedInput, document.createTextNode(' Banni'));
            accessCell.append(bannedLabel);
            row.append(accessCell);

            const actionCell = document.createElement('td');
            const saveButton = document.createElement('button');
            saveButton.type = 'button';
            saveButton.className = 'button button-secondary';
            saveButton.textContent = 'Enregistrer';
            saveButton.addEventListener('click', async () => {
                saveButton.disabled = true;
                try {
                    const rawLimit = limitInput.value.trim();
                    await request('/api/admin/free-games', {
                        method: 'POST',
                        body: JSON.stringify({
                            action: 'player',
                            id: player.id,
                            limitMinutes: rawLimit ? Number(rawLimit) : null,
                            banned: bannedInput.checked
                        })
                    });
                    setStatus(`Réglages enregistrés pour @${player.username}.`);
                    await refresh();
                } catch (error) {
                    setStatus(error.message, true);
                } finally {
                    saveButton.disabled = false;
                }
            });
            actionCell.append(saveButton);
            row.append(actionCell);
            playersList.append(row);
        }
    }

    async function refresh() {
        const data = await request('/api/admin/free-games');
        defaultLimitInput.value = String(data.defaultLimitMinutes);
        renderGames(data.games, data.defaultLimitMinutes);
        renderPlayers(data.players, data.defaultLimitMinutes);
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const limitMinutes = Number(defaultLimitInput.value);
        if (!Number.isSafeInteger(limitMinutes) || limitMinutes < 1 || limitMinutes > 1440) {
            setStatus('La limite par défaut doit être comprise entre 1 et 1 440 minutes.', true);
            return;
        }
        const saveButton = form.querySelector('button[type="submit"]');
        saveButton.disabled = true;
        try {
            await request('/api/admin/free-games', {
                method: 'POST',
                body: JSON.stringify({ action: 'default-limit', limitMinutes })
            });
            setStatus('Limite quotidienne par défaut enregistrée.');
            await refresh();
        } catch (error) {
            setStatus(error.message, true);
        } finally {
            saveButton.disabled = false;
        }
    });

    void refresh().catch(error => {
        if (!/administrateur connecté/i.test(error.message)) setStatus(error.message, true);
    });
    window.addEventListener('hashchange', () => {
        if (window.location.hash === '#autorisations') {
            void refresh().catch(error => setStatus(error.message, true));
        }
    });
})();
