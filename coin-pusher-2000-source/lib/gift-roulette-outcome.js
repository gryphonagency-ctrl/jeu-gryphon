export function resolveGiftRouletteTurn(gifts, winChance, random = Math.random) {
    if (!Array.isArray(gifts) || !Number.isFinite(winChance) || winChance < 0 || winChance > 1) {
        throw new RangeError("Réglage de victoire invalide.");
    }
    if (random() >= winChance) {
        return { gift: null, won: false };
    }
    return { gift: drawWeightedGift(gifts, random), won: true };
}

function drawWeightedGift(gifts, random) {
    const eligible = gifts.filter(gift =>
        !gift.initial &&
        Number.isSafeInteger(gift.coinCount) &&
        gift.coinCount >= 1 &&
        gift.coinCount <= 100
    );
    const small = eligible.filter(gift => gift.tier === "small");
    const others = eligible.filter(gift => gift.tier !== "small");
    if (!eligible.length) {
        throw new Error("Aucun cadeau éligible pour un gain de la roulette.");
    }
    const pool = small.length && others.length
        ? random() * 65 < 50 ? small : others
        : small.length ? small : others;
    return pool[Math.floor(random() * pool.length)];
}
