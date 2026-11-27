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
const startButton = document.getElementById("start-camera");
const chooseButton = document.getElementById("choose-avatar");
const loadLuffyButton = document.getElementById("load-luffy");
const backgroundButton = document.getElementById("toggle-background");
const controlsToggle = document.getElementById("toggle-controls");
const fileInput = document.getElementById("avatar-file");
const query = new URLSearchParams(location.search);
const overlayToken = query.get("token");
const isOverlayMode = overlayToken !== null;
const isStudioMode = !isOverlayMode || query.get("studio") === "1";

document.documentElement.classList.toggle("overlay-mode", isOverlayMode);
document.documentElement.classList.toggle("studio-mode", isStudioMode);
controlsToggle.hidden = !isStudioMode;
if (isOverlayMode && !isStudioMode) {
  chooseButton.hidden = true;
  loadLuffyButton.hidden = true;
  backgroundButton.hidden = true;
  fileInput.disabled = true;
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
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

function setStatus(message, kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
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
  if (!landmarker) throw new Error("Le suivi facial n’est pas encore prêt.");

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
    startButton.disabled = false;
  } catch (error) {
    if (loadedModel && loadedModel !== avatarModel) disposeModel(loadedModel);
    throw error;
  } finally {
    if (resumeVideo) await setTrackerMode("VIDEO");
  }
}

async function initializeTracker() {
  setStatus("Chargement du suivi facial…");
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
  loadLuffyButton.disabled = false;

  if (isOverlayMode) {
    const response = await fetch(
      `/api/face-avatar-overlay-model?token=${encodeURIComponent(overlayToken)}`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      throw new Error("Lien d’avatar invalide, révoqué ou désactivé.");
    }
    objectUrl = URL.createObjectURL(await response.blob());
    await loadAvatar(objectUrl, "modèle du compte");
    if (isStudioMode) {
      setStatus("Modèle du compte chargé. Configure les options dans ce panneau.");
    } else {
      try {
        await startCamera();
      } catch (error) {
        startButton.disabled = false;
        setStatus(`Caméra non démarrée : ${error.message}`, "error");
      }
    }
    return;
  }

  startButton.disabled = true;
  setStatus("Choisis un GLB ou VRM avec expressions, morph targets ou armature faciale.", "warning");
}

async function startCamera() {
  if (!landmarker) throw new Error("Le suivi facial n’est pas encore prêt.");
  if (!avatarModel) throw new Error("Choisis d’abord un modèle 3D GLB ou VRM.");
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("La caméra exige un site sécurisé (localhost ou HTTPS).");
  }

  startButton.disabled = true;
  setStatus("Demande d’accès à la caméra…");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  });
  cameraStream = stream;
  try {
    video.srcObject = stream;
    await video.play();
    await setTrackerMode("VIDEO");
    setStatus("Suivi actif · visage.");
    if (isOverlayMode && !isStudioMode) document.body.classList.add("overlay-live");
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    cameraStream = undefined;
    video.srcObject = null;
    throw error;
  }
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
  applyFaceExpressions();
}

function animate() {
  updateFaceTracking();
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
  document.documentElement.classList.toggle("transparent", transparentBackground);
}

chooseButton.addEventListener("click", () => fileInput.click());
loadLuffyButton.addEventListener("click", async () => {
  loadLuffyButton.disabled = true;
  try {
    await loadAvatar("./assets/luffy.vrm", "Luffy");
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
  } catch (error) {
    setStatus(`Modèle 3D impossible à charger : ${error.message}`, "error");
  } finally {
    loadLuffyButton.disabled = false;
  }
});
fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  if (!/\.(glb|vrm)$/i.test(file.name)) {
    setStatus("Choisis un fichier .glb ou .vrm.", "error");
    fileInput.value = "";
    return;
  }
  const nextObjectUrl = URL.createObjectURL(file);
  try {
    await loadAvatar(nextObjectUrl, file.name);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = nextObjectUrl;
  } catch (error) {
    URL.revokeObjectURL(nextObjectUrl);
    setStatus(`Modèle 3D impossible à charger : ${error.message}`, "error");
  } finally {
    fileInput.value = "";
  }
});

startButton.addEventListener("click", async () => {
  try {
    await startCamera();
  } catch (error) {
    startButton.disabled = false;
    setStatus(`Caméra non démarrée : ${error.message}`, "error");
  }
});

backgroundButton.addEventListener("click", updateBackground);
controlsToggle.addEventListener("click", () => {
  const open = document.documentElement.classList.toggle("studio-controls-open");
  controlsToggle.setAttribute("aria-expanded", String(open));
  controlsToggle.textContent = open ? "Fermer" : "Options";
});
window.addEventListener("resize", resizeRenderer);

window.addEventListener("beforeunload", () => {
  cameraStream?.getTracks().forEach(track => track.stop());
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