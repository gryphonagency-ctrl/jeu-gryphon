import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader } from "three";

const IMAGE_URL = "https://i.giphy.com/cCbM9ESE21PRbngTFj.webp";
const BASE_HEIGHT = 0.24;
const POSITION = [-0.72, 0.33, 0.08];
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const TEXTURE_REFRESH_INTERVAL = 1000 / 24;

export default class {

    #scene;
    #onStatus;
    #mesh;
    #texture;
    #scale = 1;
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
                side: DoubleSide,
                toneMapped: false
            })
        );
        this.#mesh.position.set(...POSITION);
        this.#mesh.scale.set(BASE_HEIGHT * imageAspect * this.#scale, BASE_HEIGHT * this.#scale, 1);
        this.#mesh.renderOrder = 2;
        this.#mesh.castShadow = false;
        this.#mesh.receiveShadow = false;
        this.#scene.addObject(this.#mesh);
        this.#onStatus("Personnage animé ajouté dans le bac.");
    }

    update(time) {
        if (this.#texture?.image && time - this.#lastTextureRefresh >= TEXTURE_REFRESH_INTERVAL) {
            this.#texture.needsUpdate = true;
            this.#lastTextureRefresh = time;
        }
    }

    setScale(scale) {
        if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
            throw new RangeError(`La taille du personnage doit être comprise entre ${MIN_SCALE} et ${MAX_SCALE}.`);
        }
        this.#scale = scale;
        if (this.#mesh) {
            const imageAspect = this.#texture.image.width / this.#texture.image.height || 1;
            this.#mesh.scale.set(BASE_HEIGHT * imageAspect * scale, BASE_HEIGHT * scale, 1);
        }
    }
}
