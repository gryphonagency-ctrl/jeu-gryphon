import PrizeCreditQueue from "./prize-credit-queue.js";

const STORAGE_KEY = "coin-pusher-2000-gift-roulette-credits-v1";

export default function retryLegacyRouletteCredits() {
    let queue;
    let retryTimer;

    function report(message, state) {
        window.dispatchEvent(new CustomEvent("coin-pusher-prize-status", { detail: { message, state } }));
    }

    function scheduleRetry() {
        if (!retryTimer) {
            retryTimer = window.setTimeout(() => {
                retryTimer = 0;
                retry();
            }, 10000);
        }
    }

    function retry() {
        try {
            if (!queue) {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw || raw === "[]") return;
                queue = new PrizeCreditQueue({
                    storage: localStorage,
                    key: STORAGE_KEY,
                    award: prize => {
                        if (typeof window.ArcadeStars?.award !== "function") {
                            throw new Error("Portefeuille Griffon Arcade indisponible.");
                        }
                        return window.ArcadeStars.award({
                            username: prize.username,
                            amount: prize.amount,
                            transactionId: prize.transactionId
                        });
                    },
                    onConfirmed: (prize, player) => {
                        window.dispatchEvent(new CustomEvent("coin-pusher-prize-awarded", {
                            detail: {
                                username: prize.username,
                                avatarUrl: player?.avatarUrl || "",
                                amount: prize.amount,
                                kind: prize.kind,
                                globalStars: Number(player?.stars) || 0
                            }
                        }));
                        report(`Gain précédent crédité à @${prize.username} : ${prize.amount} étoile(s).`, "");
                    },
                    onError: (prize, error) => {
                        console.error(`Crédit précédent en attente pour @${prize.username} :`, error);
                        report(`Gain précédent en attente pour @${prize.username} : ${error.message || "portefeuille indisponible"}.`, "error");
                        scheduleRetry();
                    }
                });
            }
            void queue.flush().catch(error => {
                console.error("Impossible de traiter les gains précédents :", error);
                report(`Gains précédents en attente : ${error.message || "erreur inconnue"}.`, "error");
                scheduleRetry();
            });
        } catch (error) {
            console.error("Impossible de charger les gains précédents :", error);
            report(`Gains précédents indisponibles : ${error.message || "erreur inconnue"}.`, "error");
            scheduleRetry();
        }
    }

    window.addEventListener("online", retry);
    window.addEventListener("coin-pusher-retry-credits", retry);
    window.setInterval(retry, 30000);
    retry();
}
