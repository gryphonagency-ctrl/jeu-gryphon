(function (root, factory) {
  const rig = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = rig;
  } else {
    root.FaceAvatarRig = rig;
  }
})(globalThis, function () {
  const morphTargets = Object.freeze({
    a: "jawOpen",
    aa: "jawOpen",
    angry: "browDown",
    browdown: "browDown",
    browdownl: "browDown",
    browdownleft: "browDown",
    browdownr: "browDown",
    browdownright: "browDown",
    browinnerup: "browUp",
    browouterupl: "browUp",
    browouterupleft: "browUp",
    browouterupr: "browUp",
    browouterupright: "browUp",
    browup: "browUp",
    blink: "eyeBlink",
    blinkl: "eyeBlinkLeft",
    blinkleft: "eyeBlinkLeft",
    blinkr: "eyeBlinkRight",
    blinkright: "eyeBlinkRight",
    e: "mouthStretch",
    ee: "mouthStretch",
    eyeblink: "eyeBlink",
    eyeblinkleft: "eyeBlinkLeft",
    eyeblinkright: "eyeBlinkRight",
    eyecloseleft: "eyeBlinkLeft",
    eyecloseright: "eyeBlinkRight",
    eyeblinkl: "eyeBlinkLeft",
    eyelidcloseleft: "eyeBlinkLeft",
    eyelidcloseright: "eyeBlinkRight",
    eyeblinkr: "eyeBlinkRight",
    frownleft: "mouthFrown",
    frownright: "mouthFrown",
    happy: "mouthSmile",
    i: "mouthStretch",
    ih: "mouthStretch",
    jawopen: "jawOpen",
    moutha: "jawOpen",
    mouthaa: "jawOpen",
    mouthe: "mouthStretch",
    mouthfrown: "mouthFrown",
    mouthfrownl: "mouthFrown",
    mouthfrownleft: "mouthFrown",
    mouthfrownr: "mouthFrown",
    mouthfrownright: "mouthFrown",
    mouthfunnel: "mouthFunnel",
    mouthi: "mouthStretch",
    mouthopen: "jawOpen",
    mouthopenlower: "jawOpen",
    moutho: "mouthFunnel",
    mouthoh: "mouthFunnel",
    mouthpucker: "mouthPucker",
    mouthsmile: "mouthSmile",
    mouthsmilel: "mouthSmile",
    mouthsmileleft: "mouthSmile",
    mouthsmiler: "mouthSmile",
    mouthsmileright: "mouthSmile",
    mouthstretch: "mouthStretch",
    mouthstretchl: "mouthStretch",
    mouthstretchleft: "mouthStretch",
    mouthstretchr: "mouthStretch",
    mouthstretchright: "mouthStretch",
    mouthu: "mouthPucker",
    o: "mouthFunnel",
    oh: "mouthFunnel",
    ou: "mouthPucker",
    sad: "mouthFrown",
    smileleft: "mouthSmile",
    smileright: "mouthSmile",
    sorrow: "mouthFrown",
    u: "mouthPucker"
  });

  const vrmTrackingBindings = Object.freeze({
    aa: "jawOpen",
    angry: "browDown",
    blink: "eyeBlink",
    blinkLeft: "eyeBlinkLeft",
    blinkRight: "eyeBlinkRight",
    ee: "mouthStretch",
    happy: "mouthSmile",
    ih: "mouthStretch",
    joy: "mouthSmile",
    oh: "mouthOpen",
    ou: "mouthFunnel",
    relaxed: "mouthSmile",
    sad: "mouthFrown",
    sorrow: "mouthFrown",
    surprised: "browUp",
    a: "jawOpen",
    e: "mouthStretch",
    i: "mouthStretch",
    o: "mouthFunnel",
    u: "mouthPucker",
    fun: "mouthSmile"
  });
  const vrmTrackingByNormalizedName = Object.freeze(
    Object.fromEntries(Object.entries(vrmTrackingBindings).map(([name, key]) => [
      normalizeName(name),
      key
    ]))
  );

  function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function trackingKeyForMorphTarget(name) {
    return morphTargets[normalizeName(name)] || null;
  }

  function hasRecognizedMorphTarget(names) {
    return Array.isArray(names) && names.some(name => trackingKeyForMorphTarget(name) !== null);
  }

  function isRecognizedVrmExpression(name) {
    return Object.hasOwn(vrmTrackingByNormalizedName, normalizeName(name));
  }

  function getVrmExpressionNames() {
    return Object.keys(vrmTrackingBindings);
  }

  function trackedValue(scores, key) {
    const value = name => scores[name] || 0;
    switch (key) {
      case "browDown":
        return Math.max(value("browDownLeft"), value("browDownRight"));
      case "browUp":
        return Math.max(value("browInnerUp"), value("browOuterUpLeft"), value("browOuterUpRight"));
      case "eyeBlink":
        return Math.max(value("eyeBlinkLeft"), value("eyeBlinkRight"));
      case "mouthFrown":
        return Math.max(value("mouthFrownLeft"), value("mouthFrownRight"));
      case "mouthOpen":
        return value("jawOpen");
      case "mouthPucker":
        return value("mouthPucker");
      case "mouthSmile":
        return Math.max(value("mouthSmileLeft"), value("mouthSmileRight"));
      case "mouthStretch":
        return Math.max(value("mouthStretchLeft"), value("mouthStretchRight"));
      default:
        return value(key);
    }
  }

  function vrmExpressionValue(scores, expressionName) {
    const key = vrmTrackingByNormalizedName[normalizeName(expressionName)];
    if (!key) return 0;
    if (key === "mouthFunnel") {
      return Math.max(scores.mouthFunnel || 0, scores.mouthPucker || 0);
    }
    return trackedValue(scores, key);
  }

  return {
    hasRecognizedMorphTarget,
    isRecognizedVrmExpression,
    getVrmExpressionNames,
    trackingKeyForMorphTarget,
    trackedValue,
    vrmExpressionValue
  };
});
