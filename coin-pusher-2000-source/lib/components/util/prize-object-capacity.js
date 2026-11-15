export const MAX_ACTIVE_PRIZE_OBJECTS = 48;
export const MAX_PENDING_BONUS_OBJECTS = 500;
export const BONUS_OBJECTS_PER_FRAME = 3;

export function getActivePrizeObjectCount(Cards, Ingots) {
    return Cards.dynamicBodies.length + Ingots.dynamicBodies.length;
}
