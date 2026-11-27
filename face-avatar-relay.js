const blendshapeNames = Object.freeze([
    'jawOpen',
    'mouthClose',
    'mouthFunnel',
    'mouthPucker',
    'mouthStretchLeft',
    'mouthStretchRight',
    'mouthSmileLeft',
    'mouthSmileRight',
    'mouthFrownLeft',
    'mouthFrownRight',
    'mouthUpperUpLeft',
    'mouthUpperUpRight',
    'mouthLowerDownLeft',
    'mouthLowerDownRight',
    'eyeBlinkLeft',
    'eyeBlinkRight',
    'browDownLeft',
    'browDownRight',
    'browInnerUp',
    'browOuterUpLeft',
    'browOuterUpRight'
]);

function createDefaultFaceAvatarTracking() {
    return {
        type: 'FACE_AVATAR_STATE',
        active: false,
        scores: Object.fromEntries(blendshapeNames.map(name => [name, 0])),
        rotation: { x: 0, y: 0, z: 0 }
    };
}

function normalizeFaceAvatarTracking(request) {
    if (!request || request.type !== 'FACE_AVATAR_TRACKING' ||
        typeof request.active !== 'boolean' ||
        !request.scores || typeof request.scores !== 'object' || Array.isArray(request.scores) ||
        !request.rotation || typeof request.rotation !== 'object' || Array.isArray(request.rotation)) {
        return null;
    }

    const scores = {};
    for (const name of blendshapeNames) {
        const score = request.scores[name];
        if (typeof score !== 'number' || !Number.isFinite(score)) return null;
        scores[name] = Math.min(1, Math.max(0, score));
    }

    const rotation = {};
    for (const axis of ['x', 'y', 'z']) {
        const value = request.rotation[axis];
        if (typeof value !== 'number' || !Number.isFinite(value)) return null;
        rotation[axis] = Math.min(Math.PI, Math.max(-Math.PI, value));
    }

    return {
        type: 'FACE_AVATAR_STATE',
        active: request.active,
        scores,
        rotation
    };
}

module.exports = {
    createDefaultFaceAvatarTracking,
    normalizeFaceAvatarTracking
};
