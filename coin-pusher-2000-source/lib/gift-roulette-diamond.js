export const DIAMOND_CHARGE_TARGET = 1000;

export function advanceDiamondCharge(progress, coins) {
    if (
        !Number.isSafeInteger(progress) ||
        progress < 0 ||
        progress >= DIAMOND_CHARGE_TARGET ||
        !Number.isSafeInteger(coins) ||
        coins < 1
    ) {
        throw new RangeError("Progression du diamant invalide.");
    }
    const total = progress + coins;
    if (!Number.isSafeInteger(total)) {
        throw new RangeError("La progression du diamant dépasse la limite sûre.");
    }
    return {
        progress: total % DIAMOND_CHARGE_TARGET,
        milestones: Math.floor(total / DIAMOND_CHARGE_TARGET)
    };
}
