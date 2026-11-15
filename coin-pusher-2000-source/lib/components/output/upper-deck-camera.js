import { PerspectiveCamera } from "three";
import { UPPER_DECK_LAYER } from "./upper-deck-layer.js";

const FIELD_OF_VIEW = 27;
const CAMERA_POSITION = [0, 1.15, 0];
const DECK_CENTER = [0, 0.24, 0];
const NEAR_PLANE = 0.01;
const FAR_PLANE = 5;

export default function createUpperDeckCamera(aspectRatio) {
    const camera = new PerspectiveCamera(FIELD_OF_VIEW, aspectRatio, NEAR_PLANE, FAR_PLANE);
    camera.position.set(...CAMERA_POSITION);
    camera.up.set(0, 0, -1);
    camera.layers.set(UPPER_DECK_LAYER);
    camera.lookAt(...DECK_CENTER);
    return camera;
}
