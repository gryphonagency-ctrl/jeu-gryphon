import * as THREE from 'three';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Night-race floodlight rig: a few real shadow-casting SpotLights that ride along with the camera region so
 * the cars near the viewer get crisp multi-directional shadows, mimicking stadium light towers.
 */
export class Floodlights {
  readonly group = new THREE.Group();
  private readonly spots: THREE.SpotLight[] = [];
  private shadowCount = 2;
  private mapSize = 1024;
  private intensity = 0;
  private readonly color = new THREE.Color(1.0, 0.93, 0.82);

  constructor() {
    this.group.name = 'Floodlights';
    for (let i = 0; i < 3; i++) {
      const spot = new THREE.SpotLight(this.color, 0, 140, THREE.MathUtils.degToRad(48), 0.55, 1.6);
      spot.shadow.mapSize.set(this.mapSize, this.mapSize);
      spot.shadow.camera.near = 4;
      spot.shadow.camera.far = 140;
      spot.shadow.bias = -0.0004;
      spot.shadow.normalBias = 0.03;
      spot.visible = false;
      this.group.add(spot);
      this.group.add(spot.target);
      this.spots.push(spot);
    }
  }

  configure(shadowCount: number, mapSize: number): void {
    this.shadowCount = shadowCount;
    this.mapSize = mapSize;
    this.spots.forEach((s, i) => {
      s.castShadow = i < shadowCount;
      if (s.shadow.mapSize.x !== mapSize) {
        s.shadow.mapSize.set(mapSize, mapSize);
        s.shadow.map?.dispose();
        s.shadow.map = null;
      }
    });
  }

  /**
   * @param factor 0..1 rig strength (0 = day, hidden).
   * @param camera current camera; towers are placed ahead and to both sides of the view.
   */
  update(factor: number, camera: THREE.PerspectiveCamera): void {
    this.intensity = factor;
    const on = factor > 0.01;
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, 1);
    _fwd.normalize();
    _right.crossVectors(_fwd, _up).normalize();
    _focus.copy(camera.position).addScaledVector(_fwd, 22);
    _focus.y = camera.position.y - 1.5;
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      const active = on && i < Math.max(1, this.shadowCount + 1);
      s.visible = active;
      if (!active) continue;
      const side = i === 0 ? 1 : i === 1 ? -1 : 0;
      const ahead = i === 2 ? -18 : 30;
      s.position.copy(_focus).addScaledVector(_right, side * 26).addScaledVector(_fwd, ahead);
      s.position.y = _focus.y + 26;
      s.target.position.copy(_focus).addScaledVector(_fwd, i === 2 ? -6 : 4);
      // Candela-scale intensity: ~0.5 irradiance at the target distance per tower.
      s.intensity = 1100 * factor * (i === 2 ? 0.6 : 1);
    }
  }

  get active(): boolean {
    return this.intensity > 0.01;
  }

  dispose(): void {
    for (const s of this.spots) {
      s.shadow.map?.dispose();
      s.dispose();
    }
  }
}
