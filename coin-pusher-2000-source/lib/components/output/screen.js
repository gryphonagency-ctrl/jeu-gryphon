import { CSS3DRenderer, CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { Box3, DoubleSide, Euler, Mesh, MeshBasicMaterial, Plane, PlaneGeometry, Quaternion, Raycaster, Vector2, Vector3, WebGLRenderTarget } from "three";
import createUpperDeckCamera from "./upper-deck-camera.js";
import { getUpperDeckRenderInterval } from "./upper-deck-render-interval.js";

const MODEL_PATH = "./assets/screen.glb";
const INDEX_VIEW_PATH = "./views/index.html?v=screen-logo-removed";

const DISPLAY_MATERIAL_NAME = "display";
const SCREEN_WIDTH = 0.442;
const SCREEN_HEIGHT = 0.319;
const SCREEN_PIXEL_WIDTH = 442;
const SCREEN_PIXEL_HEIGHT = 319;
const SCREEN_LAYOUT_STORAGE_KEY = "coin-pusher-2000-screen-layout-v1";
const SCREEN_DRAG_PLANE_HEIGHT = 0.53;
const SCREEN_POSITION_LIMITS = {
    x: { min: -1.2, max: 1.2 },
    z: { min: -0.5, max: 1.2 }
};
const Z_AXIS = new Vector3(0, 0, 1);
const UP_AXIS = new Vector3(0, 1, 0);
const DEFAULT_SCREEN_LAYOUT = {
    left: { x: 0.0865727811579241, z: 0.1271680125996637, rotation: 0 },
    right: { x: -0.11448161323309503, z: 0.0930351955778674, rotation: -0.241717529296875 }
};

export default class {

    #scene;
    #backgroundTexture;
    #screenLayout;
    #screensLocked;
    #screenLayoutButton;
    #screenRotationButton;
    #rotationMode = false;
    #canvas;
    #raycaster = new Raycaster();
    #pointerPosition = new Vector2();
    #dragPlane = new Plane(new Vector3(0, 1, 0), -SCREEN_DRAG_PLANE_HEIGHT);
    #dragPosition = new Vector3();
    #screenDrag = null;
    #suppressNextClick = false;
    #window;
    #css3DRenderer;
    #css3DObject;
    #screenReady;
    #screenVideoUrl = null;
    #upperDeckCamera;
    #upperDeckRenderTarget;
    #upperDeckDisplay;
    #upperDeckRenderFailed = false;
    #upperDeckRenderFrame = 0;
    #leftScreenModel;
    #rightScreenModel;
    #leftDisplayPosition;
    #rightDisplayPosition;
    #rightDisplayWorldPosition = new Vector3();
    #rightScreenPivot = new Vector3();
    #rightDisplayQuaternion = new Quaternion();
    #yawQuaternion = new Quaternion();
    #rotationScratch = new Vector3();
    #leftScreenNormal = new Vector3();
    #cameraPosition = new Vector3();
    #screenNormal = new Vector3();
    #screenVisible;

    constructor({ scene, backgroundTexture }) {
        this.#scene = scene;
        this.#backgroundTexture = backgroundTexture;
        const savedLayout = readScreenLayout();
        this.#screenLayout = savedLayout.layout;
        this.#screensLocked = savedLayout.locked;
        this.#screenLayoutButton = document.getElementById("screen-layout-lock");
        this.#screenRotationButton = document.getElementById("screen-rotation-mode");
        this.#window = document.createElement("iframe");
        this.#window.style.width = `${SCREEN_WIDTH * 1000}px`;
        this.#window.style.height = `${SCREEN_HEIGHT * 1000}px`;
        this.#window.style.border = "none";
        this.#css3DRenderer = new CSS3DRenderer();
        this.#css3DRenderer.setSize(window.innerWidth, window.innerHeight);
        this.#css3DRenderer.domElement.style.position = "absolute";
        this.#css3DRenderer.domElement.style.top = 0;
        this.#css3DRenderer.domElement.style.zIndex = "7";
        this.#css3DRenderer.domElement.style.pointerEvents = "none";
        scene.containerElement.appendChild(this.#css3DRenderer.domElement);
        this.#screenLayoutButton.addEventListener("click", () => {
            this.#screensLocked = !this.#screensLocked;
            if (this.#screensLocked) {
                this.#rotationMode = false;
            }
            this.#updateScreenLayoutButton();
            this.#saveScreenLayout();
        });
        this.#screenRotationButton.addEventListener("click", () => {
            if (this.#screensLocked) {
                return;
            }
            this.#rotationMode = !this.#rotationMode;
            this.#updateScreenLayoutButton();
        });
        this.#updateScreenLayoutButton();
    }

    async initialize() {
        const { screenPosition, screenRotation, model } = await initializeModel({ scene: this.#scene });
        const leftScreenModel = model.clone(true);
        leftScreenModel.scale.x = -1;
        this.#leftScreenModel = leftScreenModel;
        this.#rightScreenModel = model;
        this.#scene.addObject(leftScreenModel);
        this.#leftDisplayPosition = screenPosition.clone();
        this.#leftDisplayPosition.x *= -1;
        this.#rightDisplayPosition = screenPosition.clone();
        model.updateMatrixWorld(true);
        const modelBounds = new Box3().setFromObject(model);
        this.#rightScreenPivot.set(
            (modelBounds.min.x + modelBounds.max.x) / 2,
            modelBounds.min.y,
            (modelBounds.min.z + modelBounds.max.z) / 2
        );
        this.#rightDisplayQuaternion.setFromEuler(screenRotation);

        this.#upperDeckRenderTarget = new WebGLRenderTarget(SCREEN_PIXEL_WIDTH, SCREEN_PIXEL_HEIGHT);
        this.#upperDeckCamera = createUpperDeckCamera(SCREEN_PIXEL_WIDTH / SCREEN_PIXEL_HEIGHT);
        const mirroredScreenRotation = new Euler(
            screenRotation.x,
            -screenRotation.y,
            -screenRotation.z,
            screenRotation.order
        );
        this.#leftScreenNormal.copy(Z_AXIS).applyEuler(mirroredScreenRotation);
        this.#upperDeckDisplay = new Mesh(
            new PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT),
            new MeshBasicMaterial({
                map: this.#upperDeckRenderTarget.texture,
                side: DoubleSide,
                depthTest: false,
                depthWrite: false
            })
        );
        this.#upperDeckDisplay.rotation.copy(mirroredScreenRotation);
        this.#applyScreenLayout();
        this.#upperDeckDisplay.renderOrder = 10;
        this.#scene.addObject(this.#upperDeckDisplay);

        this.#css3DObject = new CSS3DObject(this.#window);
        this.#css3DObject.position.copy(this.#rightDisplayPosition);
        this.#css3DObject.rotation.copy(screenRotation);
        this.#css3DObject.scale.set(0.001, 0.001, 0.001);
        this.#scene.css3DScene.add(this.#css3DObject);
        this.#applyScreenLayout();
        this.#setupScreenMovement();
        addEventListener("message", event => {
            if (
                event.source !== this.#window.contentWindow ||
                event.origin !== location.origin ||
                event.data?.type !== "screenReady"
            ) {
                return;
            }
            this.#screenReady = true;
            if (this.#screenVideoUrl) {
                this.#postMessage({ type: "setScreenVideo", url: this.#screenVideoUrl });
            }
        });
        this.#window.src = INDEX_VIEW_PATH;
    }

    update() {
        this.#cameraPosition.copy(this.#scene.camera.position);
        this.#screenNormal.copy(Z_AXIS)
            .applyQuaternion(this.#css3DObject.quaternion);
        this.#screenVisible = this.#cameraPosition
            .sub(this.#css3DObject.position)
            .normalize()
            .dot(this.#screenNormal) > 0;
    }

    refresh(activePrizeObjects = 0) {
        this.#upperDeckRenderFrame++;
        const renderInterval = getUpperDeckRenderInterval(activePrizeObjects);
        if (
            !this.#upperDeckRenderFailed &&
            this.#upperDeckRenderFrame % renderInterval === 0
        ) {
            this.#upperDeckDisplay.visible = false;
            const sceneBackground = this.#scene.background;
            if (this.#backgroundTexture) {
                this.#scene.background = this.#backgroundTexture;
            }
            try {
                this.#scene.renderToTarget(this.#upperDeckCamera, this.#upperDeckRenderTarget);
            } catch (error) {
                this.#upperDeckRenderFailed = true;
                console.error("La vue miroir du plateau a été désactivée après une erreur de rendu.", error);
            } finally {
                this.#scene.background = sceneBackground;
                this.#upperDeckDisplay.visible = !this.#upperDeckRenderFailed;
            }
        }
        this.#css3DObject.visible = this.#screenVisible;
        this.#css3DRenderer.render(this.#scene.css3DScene, this.#scene.camera);
    }

    resize(width, height) {
        if (this.#css3DRenderer) {
            this.#css3DRenderer.setSize(width, height);
        }
    }

    showDemoMode() {
        this.#postMessage({
            type: "showDemoMode"
        });
    }

    showRunStart(data) {
        this.#postMessage({
            type: "showRunStart",
            ...data
        });
    }

    showRunComplete(data) {
        this.#postMessage({
            type: "showRunComplete",
            ...data
        });
    }

    setVideo(url) {
        this.#screenVideoUrl = url;
        this.#postMessage({
            type: "setScreenVideo",
            url
        });
    }

    #postMessage(data) {
        if (this.#screenReady) {
            this.#window.contentWindow.postMessage(data, location.origin);
        }
    }

    #setupScreenMovement() {
        this.#canvas = this.#scene.containerElement.querySelector("canvas");
        if (!this.#canvas) {
            throw new Error("Unable to find the game canvas for screen positioning.");
        }
        this.#canvas.addEventListener("pointerdown", this.#handlePointerDown);
        window.addEventListener("pointermove", this.#handlePointerMove, true);
        window.addEventListener("pointerup", this.#handlePointerUp, true);
        window.addEventListener("pointercancel", this.#handlePointerCancel, true);
        window.addEventListener("click", this.#handleClickCapture, true);
        this.#updateScreenLayoutButton();
    }

    #handlePointerDown = event => {
        if (this.#screensLocked || (event.button !== undefined && event.button !== 0)) {
            return;
        }
        const screen = this.#screenUnderPointer(event);
        if (!screen || (this.#rotationMode && screen !== "right")) {
            return;
        }
        const rotate = screen === "right" && (this.#rotationMode || event.shiftKey);
        const pointerPosition = rotate ? null : this.#pointOnDragPlane(event);
        if (!rotate && !pointerPosition) {
            return;
        }
        const position = this.#screenLayout[screen];
        this.#screenDrag = {
            screen,
            mode: rotate ? "rotate" : "move",
            pointerId: event.pointerId,
            pointerStart: pointerPosition?.clone(),
            pointerStartX: event.clientX,
            screenStartX: position.x,
            screenStartZ: position.z,
            screenStartRotation: position.rotation
        };
        this.#suppressNextClick = true;
        this.#canvas.style.cursor = "grabbing";
        if (event.pointerId !== undefined && typeof this.#canvas.setPointerCapture === "function") {
            this.#canvas.setPointerCapture(event.pointerId);
        }
        event.preventDefault();
        event.stopPropagation();
    };

    #handlePointerMove = event => {
        if (!this.#screenDrag) {
            if (this.#screensLocked) {
                this.#canvas.style.cursor = "";
            } else {
                const screen = this.#screenUnderPointer(event);
                this.#canvas.style.cursor = screen
                    ? this.#rotationMode && screen === "right" ? "ew-resize" : "grab"
                    : "";
            }
            return;
        }
        if (event.pointerId !== this.#screenDrag.pointerId) {
            return;
        }
        const layout = this.#screenLayout[this.#screenDrag.screen];
        if (this.#screenDrag.mode === "rotate") {
            if (!this.#canvas.clientWidth) {
                return;
            }
            layout.rotation = normalizeScreenRotation(
                this.#screenDrag.screenStartRotation +
                (event.clientX - this.#screenDrag.pointerStartX) / this.#canvas.clientWidth * Math.PI * 2
            );
        } else {
            const pointerPosition = this.#pointOnDragPlane(event);
            if (!pointerPosition) {
                return;
            }
            layout.x = clampScreenPosition(
                this.#screenDrag.screenStartX + pointerPosition.x - this.#screenDrag.pointerStart.x,
                "x"
            );
            layout.z = clampScreenPosition(
                this.#screenDrag.screenStartZ + pointerPosition.z - this.#screenDrag.pointerStart.z,
                "z"
            );
        }
        this.#applyScreenLayout();
        this.#canvas.style.cursor = "grabbing";
        event.preventDefault();
        event.stopPropagation();
    };

    #handlePointerUp = event => {
        this.#finishScreenDrag(event, false);
    };

    #handlePointerCancel = event => {
        this.#finishScreenDrag(event, true);
    };

    #finishScreenDrag(event, cancelled) {
        if (!this.#screenDrag || event.pointerId !== this.#screenDrag.pointerId) {
            return;
        }
        this.#screenDrag = null;
        if (
            typeof this.#canvas.hasPointerCapture === "function" &&
            this.#canvas.hasPointerCapture(event.pointerId) &&
            typeof this.#canvas.releasePointerCapture === "function"
        ) {
            this.#canvas.releasePointerCapture(event.pointerId);
        }
        this.#canvas.style.cursor = "";
        if (cancelled) {
            this.#suppressNextClick = false;
        } else {
            this.#saveScreenLayout();
        }
        event.preventDefault();
        event.stopPropagation();
    }

    #handleClickCapture = event => {
        if (!this.#suppressNextClick) {
            return;
        }
        this.#suppressNextClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    #screenUnderPointer(event) {
        if (!this.#setPointerRay(event)) {
            return null;
        }
        const intersections = this.#raycaster.intersectObjects(
            [this.#leftScreenModel, this.#rightScreenModel],
            true
        );
        const hit = intersections[0]?.object;
        if (!hit) {
            return null;
        }
        return isDescendant(this.#leftScreenModel, hit) ? "left" : "right";
    }

    #pointOnDragPlane(event) {
        if (!this.#setPointerRay(event)) {
            return null;
        }
        return this.#raycaster.ray.intersectPlane(this.#dragPlane, this.#dragPosition);
    }

    #setPointerRay(event) {
        const bounds = this.#canvas.getBoundingClientRect();
        if (!bounds.width || !bounds.height) {
            return false;
        }
        this.#pointerPosition.set(
            ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
            -((event.clientY - bounds.top) / bounds.height) * 2 + 1
        );
        this.#raycaster.setFromCamera(this.#pointerPosition, this.#scene.camera);
        return true;
    }

    #saveScreenLayout() {
        try {
            globalThis.localStorage?.setItem(
                SCREEN_LAYOUT_STORAGE_KEY,
                JSON.stringify({
                    left: { x: this.#screenLayout.left.x, z: this.#screenLayout.left.z },
                    right: {
                        x: this.#screenLayout.right.x,
                        z: this.#screenLayout.right.z,
                        rotation: this.#screenLayout.right.rotation
                    },
                    locked: this.#screensLocked
                })
            );
        } catch (error) {
            console.error("Unable to save the screen positions:", error);
            this.#screenLayoutButton.title = "Les positions bougent, mais ne peuvent pas être sauvegardées.";
        }
    }

    #updateScreenLayoutButton() {
        this.#screenLayoutButton.textContent = this.#screensLocked
            ? "🔓 Déplacer les écrans"
            : "🔒 Verrouiller les écrans";
        this.#screenLayoutButton.setAttribute("aria-pressed", String(this.#screensLocked));
        this.#screenLayoutButton.dataset.locked = String(this.#screensLocked);
        this.#screenLayoutButton.title = this.#screensLocked
            ? "Autoriser le déplacement des deux écrans"
            : "Fais glisser les écrans pour les déplacer. Maj+glisser l’écran droit pour le pivoter.";
        this.#screenRotationButton.disabled = this.#screensLocked;
        this.#screenRotationButton.setAttribute("aria-pressed", String(this.#rotationMode));
        this.#screenRotationButton.textContent = this.#rotationMode
            ? "✓ Rotation active"
            : "↻ Pivoter l’écran droit";
        this.#screenRotationButton.title = this.#screensLocked
            ? "Déverrouille les écrans pour ajuster la rotation"
            : "Active ce mode puis fais glisser l’écran droit horizontalement; Maj+glisser fonctionne aussi";
        if (this.#canvas) {
            this.#canvas.style.cursor = "";
        }
    }

    #applyScreenLayout() {
        const { left, right } = this.#screenLayout;
        if (this.#leftScreenModel) {
            this.#leftScreenModel.position.set(left.x, 0, left.z);
            const yaw = this.#yawQuaternion.setFromAxisAngle(UP_AXIS, right.rotation);
            this.#rightScreenModel.rotation.set(0, right.rotation, 0);
            this.#rotationScratch.copy(this.#rightScreenPivot).applyQuaternion(yaw);
            this.#rightScreenModel.position.set(
                right.x + this.#rightScreenPivot.x - this.#rotationScratch.x,
                0,
                right.z + this.#rightScreenPivot.z - this.#rotationScratch.z
            );
        }
        if (this.#upperDeckDisplay) {
            this.#upperDeckDisplay.position.copy(this.#leftDisplayPosition)
                .add(new Vector3(left.x, 0, left.z))
                .addScaledVector(this.#leftScreenNormal, 0.002);
        }
        if (this.#css3DObject) {
            const yaw = this.#yawQuaternion.setFromAxisAngle(UP_AXIS, right.rotation);
            this.#rightDisplayWorldPosition.copy(this.#rightDisplayPosition)
                .sub(this.#rightScreenPivot)
                .applyQuaternion(yaw)
                .add(this.#rightScreenPivot)
                .add(new Vector3(right.x, 0, right.z));
            this.#css3DObject.position.copy(this.#rightDisplayWorldPosition);
            this.#css3DObject.quaternion.copy(this.#rightDisplayQuaternion).premultiply(yaw);
        }
    }
}

async function initializeModel({ scene }) {
    const model = await scene.loadModel(MODEL_PATH);
    const mesh = model.scene;
    let screenPosition, screenRotation;
    mesh.traverse(child => {
        const name = child.name;
        if (name === DISPLAY_MATERIAL_NAME) {
            screenPosition = child.position;
            screenRotation = child.rotation;
        }
    });
    scene.addObject(mesh);
    return {
        model: mesh,
        screenPosition,
        screenRotation
    };
}

function readScreenLayout() {
    try {
        const saved = JSON.parse(globalThis.localStorage?.getItem(SCREEN_LAYOUT_STORAGE_KEY) || "null");
        const savedLayout = saved?.layout || saved;
        const layout = {};
        for (const side of ["left", "right"]) {
            const position = savedLayout?.[side] || {};
            layout[side] = {
                ...DEFAULT_SCREEN_LAYOUT[side],
                x: clampScreenPosition(position.x ?? DEFAULT_SCREEN_LAYOUT[side].x, "x"),
                z: clampScreenPosition(position.z ?? DEFAULT_SCREEN_LAYOUT[side].z, "z")
            };
        }
        layout.right.rotation = normalizeScreenRotation(
            savedLayout?.right?.rotation ?? DEFAULT_SCREEN_LAYOUT.right.rotation
        );
        return {
            layout,
            locked: typeof saved?.locked === "boolean" ? saved.locked : false
        };
    } catch (error) {
        console.error("Unable to load the saved screen positions:", error);
        return {
            layout: createDefaultScreenLayout(),
            locked: false
        };
    }
}

function createDefaultScreenLayout() {
    return {
        left: { ...DEFAULT_SCREEN_LAYOUT.left },
        right: { ...DEFAULT_SCREEN_LAYOUT.right }
    };
}

function clampScreenPosition(value, axis) {
    const limits = SCREEN_POSITION_LIMITS[axis];
    const position = Number(value);
    if (!Number.isFinite(position)) {
        throw new TypeError(`Invalid ${axis} position for a screen.`);
    }
    return Math.max(limits.min, Math.min(limits.max, position));
}

function normalizeScreenRotation(value) {
    const rotation = Number(value);
    if (!Number.isFinite(rotation)) {
        throw new TypeError("Invalid rotation for the right screen.");
    }
    return Math.atan2(Math.sin(rotation), Math.cos(rotation));
}

function isDescendant(parent, child) {
    let node = child;
    while (node) {
        if (node === parent) {
            return true;
        }
        node = node.parent;
    }
    return false;
}