export function selectPrizeCard(availableCards, requestedStars = null, random = Math.random) {
    if (requestedStars !== null) {
        return availableCards.find(card => card.stars === requestedStars) || null;
    }
    const total = availableCards.reduce((sum, card) => sum + card.count, 0);
    let selection = Math.floor(random() * total);
    return availableCards.find(card => {
        selection -= card.count;
        return selection < 0;
    }) || null;
}

export function resolveManualPrizeCard(prizeDeck, requestedStars) {
    if (!Number.isSafeInteger(requestedStars) || requestedStars < 1) {
        throw new RangeError("La valeur de la carte doit être un nombre entier positif.");
    }
    const stockedCard = prizeDeck.find(card => card.stars === requestedStars && card.count > 0) || null;
    return {
        card: stockedCard || { stars: requestedStars, count: 0 },
        usesStock: stockedCard !== null
    };
}
