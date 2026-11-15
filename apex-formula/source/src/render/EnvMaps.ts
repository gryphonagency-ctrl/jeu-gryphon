import * as THREE from 'three';
import type { LightingState } from './Atmosphere';
import type { SkyDome } from './SkyDome';

/**
 * Builds `scene.environment` (PMREM) from the procedural sky, re-generated only when the lighting changes noticeably.
 * At night a ring of bright emitters stands in for the stadium light towers so bodywork picks up their highlights.
 */
export class EnvironmentMaps {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly skyScene = new THREE.Scene();
  private readonly towers: THREE.Mesh[] = [];
  private readonly towerMaterial: THREE.MeshBasicMaterial;
  private readonly towerGeometry: THREE.PlaneGeometry;
  private skyTarget: THREE.WebGLRenderTarget | null = null;
  private lastTime = -100;
  private lastCloud = -1;
  private lastWet = -1;
  private lastFog = -1;
  private lastFlood = -1;
  private cooldown = 0;
  private dirty = true;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly sky: SkyDome,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.skyScene.add(sky.envMesh);
    this.towerGeometry = new THREE.PlaneGeometry(5, 2.2);
    this.towerMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.94, 0.84), toneMapped: false, side: THREE.DoubleSide });
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(this.towerGeometry, this.towerMaterial);
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const r = 40;
      m.position.set(Math.cos(a) * r, 18 + (i % 2) * 4, Math.sin(a) * r);
      m.lookAt(0, 0, 0);
      m.visible = false;
      this.skyScene.add(m);
      this.towers.push(m);
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Regenerate if the lighting moved enough. Returns the current environment texture (may be unchanged). */
  update(light: LightingState, timeOfDay: number, fog: number, dt: number, scene: THREE.Scene): void {
    this.cooldown -= dt;
    const changed =
      this.dirty ||
      Math.abs(timeOfDay - this.lastTime) > 0.12 ||
      Math.abs(light.cloud - this.lastCloud) > 0.06 ||
      Math.abs(light.wetness - this.lastWet) > 0.12 ||
      Math.abs(fog - this.lastFog) > 0.1 ||
      Math.abs(light.flood - this.lastFlood) > 0.15;
    if (!changed || (this.cooldown > 0 && !this.dirty)) return;
    this.dirty = false;
    this.cooldown = 1.5;
    this.lastTime = timeOfDay;
    this.lastCloud = light.cloud;
    this.lastWet = light.wetness;
    this.lastFog = fog;
    this.lastFlood = light.flood;

    const flood = light.flood;
    const towersOn = flood > 0.05;
    for (const t of this.towers) t.visible = towersOn;
    this.towerMaterial.color.setRGB(1.0, 0.94, 0.84).multiplyScalar(1.5 + 4.5 * flood);

    this.sky.setEnvCapture(true);
    const old = this.skyTarget;
    this.skyTarget = this.pmrem.fromScene(this.skyScene, 0, 0.5, 500);
    this.sky.setEnvCapture(false);
    scene.environment = this.skyTarget.texture;
    old?.dispose();
  }

  dispose(): void {
    this.skyTarget?.dispose();
    this.skyTarget = null;
    this.towerGeometry.dispose();
    this.towerMaterial.dispose();
    this.pmrem.dispose();
  }
}

/** Static studio environment (soft boxes on black) for the menu showroom reflections. */
export function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        void main() {
          float h = normalize( vPos ).y;
          vec3 top = vec3( 0.05, 0.055, 0.07 );
          vec3 horizon = vec3( 0.16, 0.165, 0.19 );
          vec3 floor = vec3( 0.02, 0.02, 0.024 );
          vec3 c = h > 0.0 ? mix( horizon, top, pow( h, 0.6 ) ) : mix( horizon, floor, pow( -h, 0.4 ) );
          gl_FragColor = vec4( c, 1.0 );
        }`,
    }),
  );
  scene.add(dome);
  const panel = (w: number, h: number, x: number, y: number, z: number, r: number, g: number, b: number, look: THREE.Vector3) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(look);
    scene.add(m);
    return m;
  };
  const origin = new THREE.Vector3(0, 0.6, 0);
  panel(9, 4, 6, 6, 4, 14, 13.5, 12.6, origin);
  panel(7, 3, -7, 5, -6, 8, 9, 11, origin);
  panel(14, 1.2, 0, 7.5, -3, 5, 5, 5.5, origin);
  panel(4, 6, -8, 2.5, 5, 3.2, 3.4, 4, origin);
  panel(20, 20, 0, 12, 0, 0.35, 0.36, 0.4, origin);
  const target = pmrem.fromScene(scene, 0.02, 0.5, 200);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
  pmrem.dispose();
  return target;
}
