(function (root, factory) {
  const rig = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = rig;
  } else {
    root.BodyAvatarRig = rig;
  }
})(globalThis, function () {
  const bodyBones = Object.freeze({
    hips: Object.freeze({ type: "hips" }),
    leftleg: Object.freeze({ type: "thigh", side: "left" }),
    rightleg: Object.freeze({ type: "thigh", side: "right" }),
    leftknee: Object.freeze({ type: "shin", side: "left" }),
    rightknee: Object.freeze({ type: "shin", side: "right" }),
    leftarm: Object.freeze({ type: "upperArm", side: "left" }),
    rightarm: Object.freeze({ type: "upperArm", side: "right" }),
    leftelbow: Object.freeze({ type: "forearm", side: "left" }),
    rightelbow: Object.freeze({ type: "forearm", side: "right" }),
    leftwrist: Object.freeze({ type: "hand", side: "left" }),
    rightwrist: Object.freeze({ type: "hand", side: "right" })
  });
  const fingerNames = Object.freeze({
    thumb: "thumb",
    indexfinger: "index",
    middlefinger: "middle",
    ringfinger: "ring",
    littlefinger: "little"
  });
  const fingerLandmarkChains = Object.freeze({
    thumb: [0, 1, 2, 3, 4],
    index: [0, 5, 6, 7, 8],
    middle: [0, 9, 10, 11, 12],
    ring: [0, 13, 14, 15, 16],
    little: [0, 17, 18, 19, 20]
  });

  function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function bodyBoneAction(name) {
    const normalized = normalizeName(name);
    if (bodyBones[normalized]) return bodyBones[normalized];

    const finger = normalized.match(/^(thumb|indexfinger|middlefinger|ringfinger|littlefinger)([0-3])([lr])$/);
    if (!finger) return null;
    const fingerName = fingerNames[finger[1]];
    const boneNumber = Number(finger[2]);
    if (fingerName !== "thumb" && boneNumber === 0) return null;
    return {
      type: "finger",
      finger: fingerName,
      joint: fingerName === "thumb" ? boneNumber : boneNumber - 1,
      side: finger[3] === "l" ? "left" : "right"
    };
  }

  function sideForUnmirroredCamera(reportedSide) {
    const side = String(reportedSide || "").toLowerCase();
    if (side === "left") return "right";
    if (side === "right") return "left";
    return null;
  }

  function jointBend(landmarks, previous, joint, next, xScale) {
    const before = landmarks[previous];
    const center = landmarks[joint];
    const after = landmarks[next];
    if (!before || !center || !after) return 0;

    const ax = (before.x - center.x) * xScale;
    const ay = before.y - center.y;
    const az = ((before.z || 0) - (center.z || 0)) * xScale;
    const bx = (after.x - center.x) * xScale;
    const by = after.y - center.y;
    const bz = ((after.z || 0) - (center.z || 0)) * xScale;
    const aLength = Math.hypot(ax, ay, az);
    const bLength = Math.hypot(bx, by, bz);
    if (aLength < 1e-6 || bLength < 1e-6) return 0;

    const cosine = Math.max(-1, Math.min(1,
      (ax * bx + ay * by + az * bz) / (aLength * bLength)
    ));
    return Math.max(0, Math.PI - Math.acos(cosine));
  }

  function fingerJointBends(landmarks, xScale = 1) {
    if (!Array.isArray(landmarks) || landmarks.length < 21) return null;
    return Object.fromEntries(
      Object.entries(fingerLandmarkChains).map(([finger, chain]) => [
        finger,
        [
          jointBend(landmarks, chain[0], chain[1], chain[2], xScale),
          jointBend(landmarks, chain[1], chain[2], chain[3], xScale),
          jointBend(landmarks, chain[2], chain[3], chain[4], xScale)
        ]
      ])
    );
  }

  return Object.freeze({ bodyBoneAction, fingerJointBends, sideForUnmirroredCamera });
});
