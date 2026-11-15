import { CSS3DRenderer, CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { DoubleSide, Euler, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, WebGLRenderTarget } from "three";
import createUpperDeckCamera from "./upper-deck-camera.js";

const MODEL_PATH = "./assets/screen.glb";
const INDEX_VIEW_PATH = "./views/index.html?v=screen-video-clean";

const DISPLAY_MATERIAL_NAME = "display";
const SCREEN_WIDTH = 0.442;
const SCREEN_HEIGHT = 0.319;
const SCREEN_PIXEL_WIDTH = 442;
const SCREEN_PIXEL_HEIGHT = 319;
const Z_AXIS = new Vector3(0, 0, 1);

export default class {

    #scene;
    #window;
    #css3DRenderer;
    #css3DObject;
    #screenReady;
    #screenVideoUrl = null;
    #upperDeckCamera;
    #upperDeckRenderTarget;
    #upperDeckDisplay;
    #upperDeckRenderFailed = false;
    #cameraPosition = new Vector3();
    #screenNormal = new Vector3();
    #screenVisible;

    constructor({ scene }) {
        this.#scene = scene;
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
    }

    async initialize() {
        const { screenPosition, screenRotation, model } = await initializeModel({ scene: this.#scene });
        const leftScreenModel = model.clone(true);
        leftScreenModel.scale.x = -1;
        this.#scene.addObject(leftScreenModel);

        this.#upperDeckRenderTarget = new WebGLRenderTarget(SCREEN_PIXEL_WIDTH, SCREEN_PIXEL_HEIGHT);
        this.#upperDeckCamera = createUpperDeckCamera(SCREEN_PIXEL_WIDTH / SCREEN_PIXEL_HEIGHT);
        const mirroredScreenPosition = screenPosition.clone();
        mirroredScreenPosition.x *= -1;
        const mirroredScreenRotation = new Euler(
            screenRotation.x,
            -screenRotation.y,
            -screenRotation.z,
            screenRotation.order
        );
        this.#screenNormal.copy(Z_AXIS).applyEuler(mirroredScreenRotation);
        this.#upperDeckDisplay = new Mesh(
            new PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT),
            new MeshBasicMaterial({
                map: this.#upperDeckRenderTarget.texture,
                side: DoubleSide,
                depthTest: false,
                depthWrite: false
            })
        );
        this.#upperDeckDisplay.position.copy(mirroredScreenPosition)
            .addScaledVector(this.#screenNormal, 0.002);
        this.#upperDeckDisplay.rotation.copy(mirroredScreenRotation);
        this.#upperDeckDisplay.renderOrder = 10;
        this.#scene.addObject(this.#upperDeckDisplay);

        this.#css3DObject = new CSS3DObject(this.#window);
        this.#css3DObject.position.copy(screenPosition);
        this.#css3DObject.rotation.copy(screenRotation);
        this.#css3DObject.scale.set(0.001, 0.001, 0.001);
        this.#scene.css3DScene.add(this.#css3DObject);
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

    refresh() {
        if (!this.#upperDeckRenderFailed) {
            this.#upperDeckDisplay.visible = false;
            try {
                this.#scene.renderToTarget(this.#upperDeckCamera, this.#upperDeckRenderTarget);
            } catch (error) {
                this.#upperDeckRenderFailed = true;
                console.error("La vue miroir du plateau a été désactivée après une erreur de rendu.", error);
            } finally {
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