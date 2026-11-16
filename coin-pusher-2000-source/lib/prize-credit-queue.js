export default class PrizeCreditQueue {
    #storage;
    #key;
    #award;
    #onConfirmed;
    #onError;
    #items;
    #flushing = false;

    constructor({ storage, key, award, onConfirmed, onError }) {
        this.#storage = storage;
        this.#key = key;
        this.#award = award;
        this.#onConfirmed = onConfirmed;
        this.#onError = onError;
        const raw = storage.getItem(key);
        const items = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(items) || items.some(item =>
            !item || typeof item.transactionId !== "string" ||
            typeof item.username !== "string" ||
            !Number.isSafeInteger(item.amount) || item.amount < 1 ||
            !["carte", "lingot", "roulette"].includes(item.kind)
        )) {
            throw new Error("La file des récompenses enregistrées est invalide.");
        }
        this.#items = items;
    }

    enqueue(prize) {
        const item = { ...prize, transactionId: `coin-pusher:${crypto.randomUUID()}` };
        const items = [...this.#items, item];
        this.#storage.setItem(this.#key, JSON.stringify(items));
        this.#items = items;
        return item;
    }

    async flush() {
        if (this.#flushing) return;
        this.#flushing = true;
        try {
            while (this.#items.length) {
                const item = this.#items[0];
                let player;
                try {
                    player = await this.#award(item);
                } catch (error) {
                    this.#onError(item, error);
                    break;
                }
                const remaining = this.#items.slice(1);
                try {
                    this.#storage.setItem(this.#key, JSON.stringify(remaining));
                } catch (error) {
                    this.#onError(item, error);
                    break;
                }
                this.#items = remaining;
                this.#onConfirmed(item, player);
            }
        } finally {
            this.#flushing = false;
        }
    }
}
