import { Vector3 } from "three";

const DROP_AREA_WIDTH = 0.55;
const DROP_AREA_DEPTH = 0.2;

export function getPrizeDropPosition(center, size, random = Math.random) {
    const position = center.clone();
    position.x += (random() - 0.5) * Math.max(0, DROP_AREA_WIDTH - size.width);
    position.z += (random() - 0.5) * Math.max(0, DROP_AREA_DEPTH - size.height);
    return position;
}
