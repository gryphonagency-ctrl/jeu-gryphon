export default class CoinSpawnQueue {
    #batches = [];
    #nextBatchIndex = 0;
    #nextSlot = 0;

    enqueue(batch) {
        this.#batches.push(batch);
    }

    takeNext(maximum = 3) {
        const limit = Math.min(Math.max(0, Math.floor(maximum)), this.#batches.length);
        const selectedBatches = new Set();
        const usedSlots = new Set();
        const drops = [];
        while (drops.length < limit) {
            let batchIndex = -1;
            for (let offset = 0; offset < this.#batches.length; offset++) {
                const index = (this.#nextBatchIndex + offset) % this.#batches.length;
                if (!selectedBatches.has(this.#batches[index])) {
                    batchIndex = index;
                    break;
                }
            }
            if (batchIndex < 0) break;

            const batch = this.#batches[batchIndex];
            selectedBatches.add(batch);
            batch.remaining--;
            let slot = Number.isInteger(batch.slot) && batch.slot >= 0 && batch.slot < 3
                ? batch.slot
                : this.#nextSlot;
            for (let offset = 0; usedSlots.has(slot) && offset < 3; offset++) {
                slot = (slot + 1) % 3;
            }
            usedSlots.add(slot);
            this.#nextSlot = (slot + 1) % 3;
            drops.push({ batch, slot });

            if (batch.remaining === 0) {
                this.#batches.splice(batchIndex, 1);
                this.#nextBatchIndex = this.#batches.length ? batchIndex % this.#batches.length : 0;
            } else {
                this.#nextBatchIndex = (batchIndex + 1) % this.#batches.length;
            }
        }
        return drops;
    }

    hasBatch(predicate) {
        return this.#batches.some(predicate);
    }

    get pending() {
        return this.#batches.reduce((total, batch) => total + batch.remaining, 0);
    }
}
