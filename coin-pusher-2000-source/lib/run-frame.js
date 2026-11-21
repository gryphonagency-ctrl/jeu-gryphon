const FRAME_TIME_EPSILON = 1e-7;

export default function runFrame(update, scheduleNextFrame) {
    try {
        update();
    } finally {
        scheduleNextFrame();
    }
}

export function advanceFixedSteps(accumulatedTime, elapsedTime, stepTime, maxSteps) {
    if (![accumulatedTime, elapsedTime, stepTime, maxSteps].every(Number.isFinite) ||
        accumulatedTime < 0 || elapsedTime < 0 || stepTime <= 0 ||
        !Number.isSafeInteger(maxSteps) || maxSteps < 1) {
        throw new RangeError("Fixed-step timing values are invalid.");
    }

    const maxAccumulatedTime = stepTime * maxSteps;
    const availableTime = Math.min(maxAccumulatedTime, accumulatedTime + elapsedTime);
    const steps = Math.min(
        maxSteps,
        Math.floor((availableTime + FRAME_TIME_EPSILON) / stepTime)
    );
    return {
        steps,
        remainingTime: Math.max(0, availableTime - steps * stepTime)
    };
}
