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

  const facialBoneActions = Object.freeze({
    jaw: Object.freeze({ type: "jaw" }),
    jawbone: Object.freeze({ type: "jaw" }),
    mandible: Object.freeze({ type: "jaw" }),
    centerbrow: Object.freeze({ type: "centerBrow" }),
    llipcorner: Object.freeze({ type: "lipCorner", side: "left" }),
    leftlipcorner: Object.freeze({ type: "lipCorner", side: "left" }),
    rlipcorner: Object.freeze({ type: "lipCorner", side: "right" }),
    rightlipcorner: Object.freeze({ type: "lipCorner", side: "right" })
  });

  function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function facialBoneAction(name) {
    const normalized = normalizeName(name);
    if (facialBoneActions[normalized]) return facialBoneActions[normalized];

    const eyelid = normalized.match(/^(tl|tr|bl|br)eyelid/);
    if (eyelid) {
      return {
        type: eyelid[1].startsWith("t") ? "upperEyelid" : "lowerEyelid",
        side: eyelid[1].endsWith("l") ? "left" : "right"
      };
    }

    const lip = normalized.match(/^(tl|tr|bl|br)lip/);
    if (lip) {
      return {
        type: lip[1].startsWith("t") ? "upperLip" : "lowerLip",
        side: lip[1].endsWith("l") ? "left" : "right"
      };
    }

    const brow = normalized.match(/^(left|right)brow/);
    if (brow) return { type: "brow", side: brow[1] };
    return null;
  }

  function hasRecognizedFacialBones(names) {
    if (!Array.isArray(names)) return false;
    const types = new Set(names.map(name => facialBoneAction(name)?.type).filter(Boolean));
    const hasMouth = types.has("jaw") || types.has("upperLip") ||
      types.has("lowerLip") || types.has("lipCorner");
    const hasEyes = types.has("upperEyelid") || types.has("lowerEyelid");
    return hasMouth && (hasEyes || types.has("brow") || types.has("centerBrow"));
  }

  function facialBoneValue(scores, action) {
    const value = name => scores[name] || 0;
    switch (action?.type) {
      case "jaw":
        return value("jawOpen");
      case "upperEyelid":
      case "lowerEyelid":
        return value(action.side === "left" ? "eyeBlinkLeft" : "eyeBlinkRight");
      case "brow":
        return Math.max(value("browInnerUp"), value(`browOuterUp${action.side === "left" ? "Left" : "Right"}`)) -
          value(action.side === "left" ? "browDownLeft" : "browDownRight");
      case "centerBrow":
        return value("browInnerUp") - Math.max(value("browDownLeft"), value("browDownRight"));
      case "upperLip":
        return value(`mouthUpperUp${action.side === "left" ? "Left" : "Right"}`);
      case "lowerLip":
        return value(`mouthLowerDown${action.side === "left" ? "Left" : "Right"}`);
      case "lipCorner":
        return value(action.side === "left" ? "mouthSmileLeft" : "mouthSmileRight") -
          value(action.side === "left" ? "mouthFrownLeft" : "mouthFrownRight");
      default:
        return 0;
    }
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
    facialBoneAction,
    hasRecognizedFacialBones,
    facialBoneValue,
    trackedValue,
    vrmExpressionValue
  };
});
