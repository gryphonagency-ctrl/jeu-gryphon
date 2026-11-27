import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  FaceLandmarker,
  FilesetResolver
} from "@mediapipe/tasks-vision";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

const canvas = document.getElementById("scene");
const video = document.getElementById("webcam");
const status = document.getElementById("status");
const cameraStatus = document.getElementById("camera-status");
const startButton = document.getElementById("start-camera");
const stopButton = document.getElementById("stop-camera");
const chooseButton = document.getElementById("choose-avatar");
const modelSelect = document.getElementById("avatar-model");
const backgroundButton = document.getElementById("toggle-background");
const fileInput = document.getElementById("avatar-file");
const overlayUrlInput = document.getElementById("overlay-url");
const copyUrlButton = document.getElementById("copy-url");
const relayStatus = document.getElementById("studio-relay-status");
const query = new URLSearchParams(location.search);
const overlayToken = query.get("token");
const isOverlayMode = overlayToken !== null;
const isStudioMode = !isOverlayMode || query.get("studio") === "1";
const isFaceAvatarControl = isOverlayMode && isStudioMode;

document.documentElement.classList.toggle("overlay-mode", isOverlayMode);
document.documentElement.classList.toggle("studio-mode", isStudioMode);
fileInput.disabled = isOverlayMode && !isStudioMode;

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
renderer.setClearColor(0x00ff00, isOverlayMode && !isStudioMode ? 0 : 1);

const scene = new THREE.Scene();
scene.background = isOverlayMode && !isStudioMode ? null : new THREE.Color(0x00ff00);
scene.add(new THREE.HemisphereLight(0xffffff, 0x38435b, 2.2));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(-2, 3, 4);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xc4d8ff, 1.1);
fillLight.position.set(3, 1, -2);
scene.add(fillLight);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 3;

const avatarRoot = new THREE.Group();
scene.add(avatarRoot);

const blendshapeNames = [
  "jawOpen",
  "mouthClose",
  "mouthFunnel",
  "mouthPucker",
  "mouthStretchLeft",
  "mouthStretchRight",
  "mouthSmileLeft",
  "mouthSmileRight",
  "mouthFrownLeft",
  "mouthFrownRight",
  "mouthUpperUpLeft",
  "mouthUpperUpRight",
  "mouthLowerDownLeft",
  "mouthLowerDownRight",
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "browDownLeft",
  "browDownRight",
  "browInnerUp",
  "browOuterUpLeft",
  "browOuterUpRight"
];

const scores = Object.fromEntries(blendshapeNames.map(name => [name, 0]));
const rotation = new THREE.Euler(0, 0, 0, "YXZ");
const targetRotation = new THREE.Euler(0, 0, 0, "YXZ");
const clock = new THREE.Clock();
const facialBoneAxis = new THREE.Vector3(1, 0, 0);
const facialBoneOffset = new THREE.Quaternion();
const armsDownDirection = new THREE.Vector3(0, -1, 0);
let landmarker;
let trackerMode = "IMAGE";
let trackerSwitching = false;
let avatarModel;
let avatarHead;
let avatarHeadBaseRotation;
let avatarVrm;
let avatarMorphBindings = [];
let avatarVrmExpressions = [];
let avatarFacialBones = [];
let avatarBodyBones = new Map();
let avatarBodyBaseQuaternions = new Map();
let avatarPortraitFrame;
let lastVideoTime = -1;
let cameraStream;
let objectUrl;
let transparentBackground = isOverlayMode && !isStudioMode;
let faceAvatarSocket;
let faceAvatarReconnectTimer;
let shouldReconnectFaceAvatarRelay = true;
let lastTrackingSentAt = 0;

function setStatus(message, kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
  status.classList.toggle("error", kind === "error");
  status.classList.toggle("good", kind === "good");
}

function setCameraStatus(message, kind = "info") {
  cameraStatus.textContent = message;
  cameraStatus.classList.toggle("error", kind === "error");
  cameraStatus.classList.toggle("good", kind === "good");
}

function setRelayStatus(message, kind = "info") {
  relayStatus.textContent = message;
  relayStatus.classList.toggle("error", kind === "error");
  relayStatus.classList.toggle("good", kind === "good");
}

function connectFaceAvatarRelay() {
  const socketUrl = new URL("/face-avatar-relay", location.href);
  socketUrl.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socketUrl.searchParams.set("token", overlayToken);
  socketUrl.searchParams.set("role", isFaceAvatarControl ? "control" : "overlay");
  faceAvatarSocket = new WebSocket(socketUrl);

  faceAvatarSocket.addEventListener("open", () => {
    if (isFaceAvatarControl) {
      setRelayStatus("Studio de suivi connecté. Active la webcam ici, puis laisse cette fenêtre ouverte.", "good");
    }
  });
  faceAvatarSocket.addEventListener("message", event => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error("Message de suivi facial invalide :", error);
      return;
    }
    if (message.type === "FACE_AVATAR_STATE" && !isFaceAvatarControl) {
      for (const name of blendshapeNames) {
        scores[name] = message.scores[name];
      }
      targetRotation.set(
        message.rotation.x,
        message.rotation.y,
        message.rotation.z
      );
    } else if (message.type === "FACE_AVATAR_STATUS" && isFaceAvatarControl) {
      setRelayStatus(
        message.overlayCount
          ? "Source TikTok LIVE Studio connectée · suivi actif dans cette fenêtre."
          : "Relais prêt. Ajoute aussi le lien copié comme source navigateur dans TikTok LIVE Studio.",
        message.overlayCount ? "good" : "info"
      );
    } else if (message.type === "FACE_AVATAR_ERROR" && isFaceAvatarControl) {
      setRelayStatus(message.message || "Le relais facial a refusé la commande.", "error");
    }
  });
  faceAvatarSocket.addEventListener("close", () => {
    if (!shouldReconnectFaceAvatarRelay) return;
    if (isFaceAvatarControl) setRelayStatus("Connexion au relais perdue · reconnexion…", "error");
    faceAvatarReconnectTimer = window.setTimeout(connectFaceAvatarRelay, 2500);
  });
  faceAvatarSocket.addEventListener("error", () => {
    if (isFaceAvatarControl) setRelayStatus("Connexion au relais facial impossible.", "error");
  });
}

function sendFaceAvatarTracking(active, force = false) {
  if (!isFaceAvatarControl || !faceAvatarSocket ||
      faceAvatarSocket.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  if (!force && now - lastTrackingSentAt < 30) return;
  faceAvatarSocket.send(JSON.stringify({
    type: "FACE_AVATAR_TRACKING",
    active,
    scores,
    rotation: { x: targetRotation.x, y: targetRotation.y, z: targetRotation.z }
  }));
  lastTrackingSentAt = now;
}

function updateSourceLink() {
  if (!overlayToken || !/^[a-f0-9]{64}$/.test(overlayToken)) {
    overlayUrlInput.value = "";
    copyUrlButton.disabled = true;
    setRelayStatus("Crée d’abord le lien indépendant depuis ton espace créateur.");
    return;
  }

  const sourceUrl = new URL(location.href);
  sourceUrl.searchParams.delete("studio");
  overlayUrlInput.value = sourceUrl.href;
  copyUrlButton.disabled = false;
  setRelayStatus("Lien prêt pour OBS ou TikTok LIVE Studio.", "good");
}

function disposeModel(model) {
  const textures = new Set();
  model.traverse(node => {
    if (node.geometry) node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}

function findAvatarHead(model, vrm) {
  const normalizedHead = vrm?.humanoid?.getNormalizedBoneNode?.("head");
  if (normalizedHead) return normalizedHead;
  let head = null;
  model.traverse(node => {
    const name = String(node.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!head && node.isBone && (name === "head" || name.endsWith("head"))) head = node;
  });
  return head;
}

function bodyBoneKey(action) {
  if (action.type === "hips") return "hips";
  if (action.type === "finger") {
    return `${action.side}:finger:${action.finger}:${action.joint}`;
  }
  return `${action.side}:${action.type}`;
}

function collectBodyBones(model) {
  const bones = new Map();
  model.traverse(node => {
    if (!node.isBone) return;
    const action = BodyAvatarRig.bodyBoneAction(node.name);
    if (action) bones.set(bodyBoneKey(action), node);
  });
  return bones;
}

function applyBoneDirection(key, childKey, targetDirection) {
  const bone = avatarBodyBones.get(key);
  const child = avatarBodyBones.get(childKey);
  const base = avatarBodyBaseQuaternions.get(key);
  if (!bone || !child || !base || !targetDirection || !bone.parent) return false;

  bone.parent.updateWorldMatrix(true, false);
  const parentRotation = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  const targetInParent = targetDirection.clone().applyQuaternion(parentRotation).normalize();
  const restDirection = child.position.clone().applyQuaternion(base).normalize();
  const correction = new THREE.Quaternion().setFromUnitVectors(restDirection, targetInParent);
  bone.quaternion.slerp(correction.multiply(base.clone()), 0.35);
  return true;
}

function applyArmsRestPose() {
  if (!avatarBodyBones.size) return;

  for (const side of ["left", "right"]) {
    const upperArmKey = `${side}:upperArm`;
    const forearmKey = `${side}:forearm`;
    applyBoneDirection(upperArmKey, forearmKey, armsDownDirection);
    avatarModel.updateMatrixWorld(true);
    applyBoneDirection(forearmKey, `${side}:hand`, armsDownDirection);
    avatarModel.updateMatrixWorld(true);
  }
}

function updateAvatarPortraitFrame() {
  if (!avatarPortraitFrame) return;
  const {
    root,
    planes,
    center,
    centerY,
    cutY,
    height,
    shoulderHalfWidth
  } = avatarPortraitFrame;
  const visibleHeight = 2 * camera.position.z *
    Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const scale = Math.min(
    visibleHeight * 0.72 / height,
    visibleHeight * camera.aspect * 0.82 / (shoulderHalfWidth * 2)
  );
  root.scale.setScalar(scale);
  root.position.set(
    -center.x * scale,
    -centerY * scale,
    -center.z * scale
  );
  planes[0].constant = -(cutY - centerY) * scale;
  planes[1].constant = shoulderHalfWidth * scale;
  planes[2].constant = shoulderHalfWidth * scale;
}

function resizeRenderer() {
  const width = Math.max(1, canvas.clientWidth || window.innerWidth);
  const height = Math.max(1, canvas.clientHeight || window.innerHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  updateAvatarPortraitFrame();
}

function cropToHeadAndShoulders(model, size, bounds, center, bodyBones, root) {
  const cutY = bounds.max.y - size.y * 0.2;
  const portraitHeight = bounds.max.y - cutY;
  const leftShoulder = bodyBones.get("left:upperArm");
  const rightShoulder = bodyBones.get("right:upperArm");
  const shoulderDistance = leftShoulder && rightShoulder
    ? Math.abs(
      rightShoulder.getWorldPosition(new THREE.Vector3()).x -
      leftShoulder.getWorldPosition(new THREE.Vector3()).x
    )
    : 0;
  const shoulderHalfWidth = Math.max(
    shoulderDistance ? shoulderDistance * 0.4 : 0,
    size.x * 0.15
  );
  const centerY = (cutY + bounds.max.y) / 2;
  const planes = [
    new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)
  ];

  model.traverse(node => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      material.clippingPlanes = planes;
      material.needsUpdate = true;
    }
  });

  return {
    root,
    planes,
    center,
    centerY,
    cutY,
    height: portraitHeight,
    shoulderHalfWidth
  };
}

function createFaceBindings(model, vrm) {
  const morphBindings = [];
  const facialBones = [];
  model.traverse(node => {
    if (node.isBone) {
      const action = FaceAvatarRig.facialBoneAction(node.name);
      if (action) {
        facialBones.push({
          bone: node,
          action,
          basePosition: node.position.clone(),
          baseQuaternion: node.quaternion.clone()
        });
      }
    }
    if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) {
      for (const [name, index] of Object.entries(node.morphTargetDictionary)) {
        const key = FaceAvatarRig.trackingKeyForMorphTarget(name);
        if (key) morphBindings.push({ mesh: node, index, key });
      }
    }
  });

  const expressionManager = vrm?.expressionManager;
  const expressions = expressionManager
    ? FaceAvatarRig.getVrmExpressionNames().filter(name => expressionManager.getExpression(name))
    : [];
  const hasFacialBoneRig = FaceAvatarRig.hasRecognizedFacialBones(
    facialBones.map(({ bone }) => bone.name)
  );
  if (!morphBindings.length && !expressions.length && !hasFacialBoneRig) {
    throw new Error(
      "Aucune expression faciale reconnue. Le modèle doit contenir des expressions VRM, des morph targets faciaux nommés ou une armature avec mâchoire et paupières/sourcils."
    );
  }
  return { morphBindings, expressions, facialBones };
}

function applyFaceExpressions() {
  for (const { mesh, index, key } of avatarMorphBindings) {
    const current = mesh.morphTargetInfluences[index] || 0;
    const target = FaceAvatarRig.trackedValue(scores, key);
    mesh.morphTargetInfluences[index] = THREE.MathUtils.lerp(current, target, 0.48);
  }
  for (const name of avatarVrmExpressions) {
    const target = FaceAvatarRig.vrmExpressionValue(scores, name);
    avatarVrm.expressionManager.setValue(name, target);
  }
}

function applyFacialBoneExpressions() {
  for (const { bone, action, basePosition, baseQuaternion } of avatarFacialBones) {
    const value = FaceAvatarRig.facialBoneValue(scores, action);
    bone.position.copy(basePosition);
    bone.quaternion.copy(baseQuaternion);
    switch (action.type) {
      case "jaw":
        facialBoneOffset.setFromAxisAngle(facialBoneAxis, 0.24 - 0.85 * value);
        bone.quaternion.multiply(facialBoneOffset);
        break;
      case "upperEyelid":
        bone.position.y -= 0.03 * value;
        facialBoneOffset.setFromAxisAngle(facialBoneAxis, -0.55 * value);
        bone.quaternion.multiply(facialBoneOffset);
        break;
      case "lowerEyelid":
        bone.position.y += 0.022 * value;
        facialBoneOffset.setFromAxisAngle(facialBoneAxis, 0.38 * value);
        bone.quaternion.multiply(facialBoneOffset);
        break;
      case "brow":
      case "centerBrow":
        bone.position.y += 0.008 * value;
        break;
      case "upperLip":
        bone.position.y += 0.004 * value;
        break;
      case "lowerLip":
        bone.position.y -= 0.004 * value;
        break;
      case "lipCorner":
        bone.position.y += 0.006 * value;
        bone.position.x += (action.side === "left" ? -1 : 1) *
          (0.005 * Math.max(
            scores[action.side === "left" ? "mouthStretchLeft" : "mouthStretchRight"],
            0
          ) - 0.006 * Math.max(scores.mouthPucker || 0, scores.mouthFunnel || 0));
        break;
    }
  }
}

async function setTrackerMode(mode) {
  if (trackerMode === mode) return;

  trackerSwitching = true;
  try {
    await landmarker.setOptions({ runningMode: mode });
    trackerMode = mode;
  } finally {
    trackerSwitching = false;
  }
}

async function loadAvatar(source, label) {
  if (!landmarker && !isOverlayMode) throw new Error("Le suivi facial n’est pas encore prêt.");

  const resumeVideo = Boolean(cameraStream && trackerMode === "VIDEO");
  let loadedModel;

  try {
    await setTrackerMode("IMAGE");
    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(source);
    const vrm = gltf.userData.vrm || null;
    if (vrm?.meta?.metaVersion === "0") VRMUtils.rotateVRM0(vrm);
    loadedModel = vrm?.scene || gltf.scene;
    if (!loadedModel) throw new Error("Le fichier ne contient pas de scène 3D.");

    const faceBindings = createFaceBindings(loadedModel, vrm);
    const bodyBones = collectBodyBones(loadedModel);
    const bodyBaseQuaternions = new Map(
      [...bodyBones].map(([key, bone]) => [key, bone.quaternion.clone()])
    );
    loadedModel.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(loadedModel);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
      throw new Error("Le modèle 3D ne contient aucune géométrie visible.");
    }

    const nextAvatarRoot = new THREE.Group();
    nextAvatarRoot.add(loadedModel);
    const portraitFrame = cropToHeadAndShoulders(
      loadedModel,
      size,
      bounds,
      center,
      bodyBones,
      nextAvatarRoot
    );
    const nextHead = findAvatarHead(loadedModel, vrm);

    if (avatarModel) {
      disposeModel(avatarModel);
    }
    avatarRoot.clear();
    avatarRoot.add(nextAvatarRoot);
    avatarPortraitFrame = portraitFrame;
    updateAvatarPortraitFrame();
    avatarModel = loadedModel;
    avatarHead = nextHead;
    avatarHeadBaseRotation = avatarHead?.rotation.clone() || null;
    avatarVrm = vrm;
    avatarMorphBindings = faceBindings.morphBindings;
    avatarVrmExpressions = faceBindings.expressions;
    avatarFacialBones = faceBindings.facialBones;
    avatarBodyBones = bodyBones;
    avatarBodyBaseQuaternions = bodyBaseQuaternions;
    avatarRoot.rotation.set(0, 0, 0);
    setStatus(`Modèle 3D chargé : ${label}`);
    startButton.disabled = Boolean(cameraStream);
    stopButton.disabled = !cameraStream;
  } catch (error) {
    if (loadedModel && loadedModel !== avatarModel) disposeModel(loadedModel);
    throw error;
  } finally {
    if (resumeVideo) await setTrackerMode("VIDEO");
  }
}

async function loadAccountModel() {
  const modelPath = overlayToken
    ? `/api/face-avatar-overlay-model?token=${encodeURIComponent(overlayToken)}`
    : "/api/face-avatar-overlay-model";
  const response = await fetch(modelPath, {
    credentials: "same-origin",
    cache: "no-store"
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Connecte-toi à ton compte créateur autorisé pour charger son modèle.");
    }
    if (response.status === 404) {
      throw new Error("Aucun modèle n’est enregistré pour ce lien ou ce compte.");
    }
    throw new Error(`Impossible de charger le modèle du compte (${response.status}).`);
  }

  const nextObjectUrl = URL.createObjectURL(await response.blob());
  try {
    await loadAvatar(nextObjectUrl, "Modèle du compte");
  } catch (error) {
    URL.revokeObjectURL(nextObjectUrl);
    throw error;
  }

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = nextObjectUrl;
  modelSelect.value = "account";
}

async function uploadAccountModel(model, modelFormat) {
  const response = await fetch("/api/face-avatar-overlay-model", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Avatar-Format": modelFormat
    },
    body: model
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || "Impossible d’enregistrer ce modèle pour le compte.");
  }
}

async function initializeTracker() {
  setStatus("Chargement du suivi facial…");
  if (!isOverlayMode || isStudioMode) {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
    );
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU"
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "IMAGE",
      numFaces: 1
    });
  }
  modelSelect.disabled = false;
  chooseButton.disabled = false;
  updateSourceLink();

  if (isOverlayMode) {
    await loadAccountModel();
    connectFaceAvatarRelay();
    if (isStudioMode) {
      setStatus("Modèle chargé. Active le suivi webcam dans cette fenêtre et laisse-la ouverte pendant le live.");
      setCameraStatus("La webcam est utilisée par le studio de suivi, pas par la source TikTok.");
    } else {
      setStatus("Overlay prêt. Ouvre le studio de suivi dans ton navigateur et active la webcam.");
      setCameraStatus("En attente des mouvements transmis par le studio de suivi.");
    }
    return;
  }

  startButton.disabled = true;
  setStatus("Choisis Luffy ou charge un modèle GLB ou VRM avec expressions faciales.", "warning");
}

async function startCamera() {
  if (!landmarker) throw new Error("Le suivi facial n’est pas encore prêt.");
  if (!avatarModel) throw new Error("Choisis d’abord un modèle 3D GLB ou VRM.");
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("La caméra exige un site sécurisé (localhost ou HTTPS).");
  }

  startButton.disabled = true;
  stopButton.disabled = true;
  setCameraStatus("Demande d’accès à la caméra…");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  });
  cameraStream = stream;
  try {
    video.srcObject = stream;
    video.hidden = !isStudioMode;
    await video.play();
    await setTrackerMode("VIDEO");
    setCameraStatus("Suivi actif · visage.", "good");
    stopButton.disabled = false;
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    cameraStream = undefined;
    video.srcObject = null;
    video.hidden = true;
    startButton.disabled = !avatarModel;
    throw error;
  }
}

async function stopCamera() {
  const stream = cameraStream;
  if (!stream) return;

  cameraStream = undefined;
  stream.getTracks().forEach(track => track.stop());
  video.srcObject = null;
  video.hidden = true;
  lastVideoTime = -1;
  stopButton.disabled = true;
  await setTrackerMode("IMAGE");
  for (const name of blendshapeNames) scores[name] = 0;
  targetRotation.set(0, 0, 0);
  rotation.set(0, 0, 0);
  sendFaceAvatarTracking(false, true);
  startButton.disabled = !avatarModel;
  setCameraStatus("Caméra arrêtée.");
}

function updateFaceTracking() {
  if (
    !landmarker ||
    !avatarModel ||
    trackerMode !== "VIDEO" ||
    trackerSwitching ||
    video.readyState < 2 ||
    video.currentTime === lastVideoTime
  ) return;

  lastVideoTime = video.currentTime;
  const result = landmarker.detectForVideo(video, performance.now());
  const categories = new Map(
    (result.faceBlendshapes?.[0]?.categories || []).map(category => [
      category.categoryName,
      category.score
    ])
  );
  for (const name of blendshapeNames) {
    scores[name] = THREE.MathUtils.lerp(scores[name], categories.get(name) || 0, 0.42);
  }
  const pose = result.facialTransformationMatrixes?.[0];
  if (pose?.data) {
    const matrix = new THREE.Matrix4().fromArray(pose.data);
    const euler = new THREE.Euler().setFromRotationMatrix(matrix, "YXZ");
    targetRotation.set(-euler.x, -euler.y, -euler.z);
  } else {
    targetRotation.set(0, 0, 0);
  }
  rotation.x = THREE.MathUtils.lerp(rotation.x, targetRotation.x, 0.35);
  rotation.y = THREE.MathUtils.lerp(rotation.y, targetRotation.y, 0.35);
  rotation.z = THREE.MathUtils.lerp(rotation.z, targetRotation.z, 0.35);
  if (avatarHead && avatarHeadBaseRotation) {
    avatarHead.rotation.set(
      avatarHeadBaseRotation.x + rotation.x,
      avatarHeadBaseRotation.y + rotation.y,
      avatarHeadBaseRotation.z + rotation.z,
      "YXZ"
    );
  } else {
    avatarRoot.rotation.copy(rotation);
  }
  sendFaceAvatarTracking(Boolean(result.faceBlendshapes?.length));
  applyFaceExpressions();
}

function animate() {
  updateFaceTracking();
  if (isOverlayMode && !isStudioMode) {
    rotation.x = THREE.MathUtils.lerp(rotation.x, targetRotation.x, 0.35);
    rotation.y = THREE.MathUtils.lerp(rotation.y, targetRotation.y, 0.35);
    rotation.z = THREE.MathUtils.lerp(rotation.z, targetRotation.z, 0.35);
    if (avatarHead && avatarHeadBaseRotation) {
      avatarHead.rotation.set(
        avatarHeadBaseRotation.x + rotation.x,
        avatarHeadBaseRotation.y + rotation.y,
        avatarHeadBaseRotation.z + rotation.z,
        "YXZ"
      );
    } else {
      avatarRoot.rotation.copy(rotation);
    }
  }
  avatarVrm?.update(clock.getDelta());
  applyArmsRestPose();
  applyFacialBoneExpressions();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function updateBackground() {
  transparentBackground = !transparentBackground;
  scene.background = transparentBackground ? null : new THREE.Color(0x00ff00);
  renderer.setClearColor(0x00ff00, transparentBackground ? 0 : 1);
  backgroundButton.textContent = transparentBackground ? "Fond vert" : "Fond transparent";
  backgroundButton.setAttribute("aria-pressed", String(transparentBackground));
}

chooseButton.addEventListener("click", () => fileInput.click());
modelSelect.addEventListener("change", async () => {
  modelSelect.disabled = true;
  chooseButton.disabled = true;
  try {
    if (modelSelect.value === "account") {
      await loadAccountModel();
    } else if (modelSelect.value === "luffy") {
      const response = await fetch("./assets/luffy.vrm", {
        credentials: "same-origin",
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Impossible de charger Luffy.");
      const luffyModel = await response.blob();
      const luffyUrl = URL.createObjectURL(luffyModel);
      try {
        await loadAvatar(luffyUrl, "Luffy");
      } finally {
        URL.revokeObjectURL(luffyUrl);
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = undefined;
      try {
        await uploadAccountModel(luffyModel, "vrm");
        setStatus("Luffy est enregistré pour le lien et chargé dans l’aperçu.", "good");
      } catch (error) {
        setStatus(`Luffy est chargé dans l’aperçu, mais pas enregistré pour le lien : ${error.message}`, "error");
      }
    }
  } catch (error) {
    setStatus(`Modèle 3D impossible à charger : ${error.message}`, "error");
  } finally {
    modelSelect.disabled = false;
    chooseButton.disabled = false;
  }
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const modelFormat = file.name.toLowerCase().endsWith(".vrm")
    ? "vrm"
    : file.name.toLowerCase().endsWith(".glb")
      ? "glb"
      : "";
  if (!modelFormat) {
    setStatus("Choisis un fichier .glb ou .vrm.", "error");
    fileInput.value = "";
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    setStatus("Le modèle 3D ne doit pas dépasser 25 Mo.", "error");
    fileInput.value = "";
    return;
  }

  modelSelect.disabled = true;
  chooseButton.disabled = true;
  setStatus("Validation et envoi du modèle 3D…");
  try {
    await uploadAccountModel(file, modelFormat);
    await loadAccountModel();
    setStatus(`Modèle ${file.name} enregistré pour le compte et chargé.`);
  } catch (error) {
    setStatus(error.message || "Impossible d’ajouter ce modèle 3D.", "error");
  } finally {
    modelSelect.disabled = false;
    chooseButton.disabled = false;
    fileInput.value = "";
  }
});

startButton.addEventListener("click", async () => {
  try {
    await startCamera();
  } catch (error) {
    startButton.disabled = !avatarModel;
    setCameraStatus(`Caméra non démarrée : ${error.message}`, "error");
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  try {
    await stopCamera();
  } catch (error) {
    startButton.disabled = !avatarModel;
    setCameraStatus(`Impossible d’arrêter le suivi : ${error.message}`, "error");
  }
});

copyUrlButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(overlayUrlInput.value);
    setRelayStatus("Lien copié.", "good");
  } catch {
    overlayUrlInput.select();
    setRelayStatus("Copie le lien sélectionné avec Ctrl+C.", "error");
  }
});

backgroundButton.addEventListener("click", updateBackground);
window.addEventListener("resize", resizeRenderer);
resizeRenderer();

window.addEventListener("beforeunload", () => {
  shouldReconnectFaceAvatarRelay = false;
  window.clearTimeout(faceAvatarReconnectTimer);
  sendFaceAvatarTracking(false, true);
  faceAvatarSocket?.close();
  cameraStream?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});

resizeRenderer();
renderer.render(scene, camera);
animate();
initializeTracker().catch(error => {
  console.error(error);
  startButton.disabled = true;
  setStatus(`Erreur d’initialisation : ${error.message}`, "error");
});