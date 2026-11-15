export function getUpperDeckRenderInterval(activePrizeObjects) {
    if (activePrizeObjects >= 96) return 4;
    if (activePrizeObjects >= 48) return 3;
    if (activePrizeObjects >= 24) return 2;
    return 1;
}
