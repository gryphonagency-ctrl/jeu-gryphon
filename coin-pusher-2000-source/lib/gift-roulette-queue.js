export const MAX_GIFT_COIN_COUNT = 44000;

function normalizeUsername(username) {
    const normalized = String(username || "").trim().replace(/^@/, "").slice(0, 32);
    return /^[a-zA-Z0-9._]{1,32}$/.test(normalized) ? normalized : "";
}

export default class GiftRouletteQueue {
    #entries = [];

    enqueue(username, turns, metadata = {}) {
        const normalizedUsername = normalizeUsername(username) || "Spectateur";
        if (!Number.isSafeInteger(turns) || turns < 1 || turns > MAX_GIFT_COIN_COUNT) {
            throw new RangeError(`Un cadeau doit contenir entre 1 et ${MAX_GIFT_COIN_COUNT.toLocaleString("fr-FR")} tours.`);
        }
        const entry = this.#entries.find(item => item.username.toLowerCase() === normalizedUsername.toLowerCase());
        const simulation = metadata?.simulation === true;
        const creditable = metadata?.creditable !== false;
        if (entry) {
            const total = entry.remaining + turns;
            if (!Number.isSafeInteger(total)) {
                throw new RangeError("Le nombre de tours en attente dépasse la limite sûre.");
            }
            entry.remaining = total;
            const lastSource = entry.sources.at(-1);
            if (lastSource?.simulation === simulation && lastSource.creditable === creditable) {
                lastSource.remaining += turns;
            } else {
                entry.sources.push({ remaining: turns, simulation, creditable });
            }
        } else {
            this.#entries.push({
                username: normalizedUsername,
                remaining: turns,
                sources: [{ remaining: turns, simulation, creditable }]
            });
        }
    }

    consume(username) {
        return this.consumeTurn(username) !== null;
    }

    consumeTurn(username) {
        const normalizedUsername = normalizeUsername(username);
        if (!normalizedUsername) {
            return null;
        }
        const index = this.#entries.findIndex(item => item.username.toLowerCase() === normalizedUsername.toLowerCase());
        if (index < 0) {
            return null;
        }
        const entry = this.#entries[index];
        const source = entry.sources[0];
        source.remaining--;
        if (source.remaining === 0) {
            entry.sources.shift();
        }
        entry.remaining--;
        if (entry.remaining === 0) {
            this.#entries.splice(index, 1);
        }
        return { simulation: source.simulation, creditable: source.creditable };
    }

    get entries() {
        return this.#entries.map(({ username, remaining }) => ({ username, remaining }));
    }

    get pendingTurns() {
        return this.#entries.reduce((total, entry) => total + entry.remaining, 0);
    }
}
