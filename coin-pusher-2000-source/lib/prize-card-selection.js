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
