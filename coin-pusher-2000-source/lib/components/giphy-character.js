import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader } from "three";

const IMAGE_URL = "https://i.giphy.com/cCbM9ESE21PRbngTFj.webp";
const BASE_HEIGHT = 0.24;
const PLATE_MIN_X = -0.72;
const PLATE_MAX_X = 0.72;
const PLATE_MIN_Z = -0.25;
const PLATE_MAX_Z = 0.95;
const PLATE_SURFACE_Y = 0.17;
const DEFAULT_HORIZONTAL_PERCENT = 15;
const DEFAULT_DEPTH_PERCENT = 30;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const TEXTURE_REFRESH_INTERVAL = 1000 / 24;

export default class {

    #scene;
    #onStatus;
    #mesh;
    #texture;
    #scale = 1;
    #horizontalPercent = DEFAULT_HORIZONTAL_PERCENT;
    #depthPercent = DEFAULT_DEPTH_PERCENT;
    #lastTextureRefresh = 0;

    constructor({ scene, onStatus }) {
        this.#scene = scene;
        this.#onStatus = onStatus;
    }

    async initialize() {
        this.#onStatus("Chargement du personnage animé dans le bac…");
        try {
            const loader = new TextureLoader().setCrossOrigin("anonymous");
            this.#texture = await loader.loadAsync(IMAGE_URL);
        } catch (error) {
            console.error("Impossible de charger le personnage Giphy :", error);
            this.#onStatus("Personnage indisponible : vérifie la connexion à Giphy.");
            return;
        }
        this.#texture.colorSpace = SRGBColorSpace;
        const imageAspect = this.#texture.image.width / this.#texture.image.height || 1;
        this.#mesh = new Mesh(
            new PlaneGeometry(1, 1),
            new MeshBasicMaterial({
                map: this.#texture,
                transparent: true,
                alphaTest: 0.01,
                depthWrite: false,
                depthTest: false,
                side: DoubleSide,
                toneMapped: false
            })
        );
        this.#mesh.renderOrder = 10;
        this.#mesh.castShadow = false;
        this.#mesh.receiveShadow = false;
        this.#scene.addObject(this.#mesh);
        this.#updatePlacement();
        this.#onStatus("Personnage animé ajouté dans le bac.");
    }

    update(time) {
        if (this.#texture?.image && time - this.#lastTextureRefresh >= TEXTURE_REFRESH_INTERVAL) {
            this.#texture.needsUpdate = true;
            this.#lastTextureRefresh = time;
        }
    }

    setPosition({ horizontalPercent, depthPercent }) {
        if (
            !Number.isFinite(horizontalPercent) ||
            horizontalPercent < 0 ||
            horizontalPercent > 100 ||
            !Number.isFinite(depthPercent) ||
            depthPercent < 0 ||
            depthPercent > 100
        ) {
            throw new RangeError("La position du personnage doit rester entre 0 % et 100 % sur le plateau.");
        }
        this.#horizontalPercent = horizontalPercent;
        this.#depthPercent = depthPercent;
        this.#updatePlacement();
    }

    setScale(scale) {
        if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
            throw new RangeError(`La taille du personnage doit être comprise entre ${MIN_SCALE} et ${MAX_SCALE}.`);
        }
        this.#scale = scale;
        this.#updatePlacement();
    }

    #updatePlacement() {
        if (!this.#mesh) {
            return;
        }
        const imageAspect = this.#texture.image.width / this.#texture.image.height || 1;
        const height = BASE_HEIGHT * this.#scale;
        const halfWidth = height * imageAspect / 2;
        const minX = PLATE_MIN_X + halfWidth;
        const maxX = PLATE_MAX_X - halfWidth;
        const x = minX + (maxX - minX) * this.#horizontalPercent / 100;
        const z = PLATE_MIN_Z + (PLATE_MAX_Z - PLATE_MIN_Z) * this.#depthPercent / 100;
        this.#mesh.position.set(x, PLATE_SURFACE_Y + height / 2 + 0.015, z);
        this.#mesh.scale.set(height * imageAspect, height, 1);
    }
}
