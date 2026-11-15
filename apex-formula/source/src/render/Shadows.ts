import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';

type CompileHook = THREE.Material['onBeforeCompile'];
type KeyHook = THREE.Material['customProgramCacheKey'];

interface HookRecord {
  onBeforeCompile: CompileHook;
  hadOwnKey: boolean;
  customProgramCacheKey: KeyHook;
}

const LIT_MATERIAL_KEYS = ['isMeshStandardMaterial', 'isMeshPhysicalMaterial', 'isMeshLambertMaterial', 'isMeshPhongMaterial', 'isMeshToonMaterial'] as const;

function isLitMaterial(m: THREE.Material): boolean {
  const rec = m as unknown as Record<string, unknown>;
  for (const k of LIT_MATERIAL_KEYS) if (rec[k] === true) return true;
  return false;
}

/**
 * Materials that have not (yet) been set up for CSM would otherwise be lit by every cascade light at once
 * (N× too bright). Patch the non-CSM directional loop so such materials only use cascade 0: correct brightness
 * and near shadows until the incremental setup reaches them.
 */
function patchFallbackDirectionalLoop(): void {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const marker = '!defined( USE_CSM ) && !defined( CSM_CASCADES )';
  const at = chunk.indexOf(marker);
  if (at < 0) return;
  const loop = 'for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {';
  const loopAt = chunk.indexOf(loop, at);
  if (loopAt < 0) return;
  THREE.ShaderChunk.lights_fragment_begin = chunk.slice(0, loopAt) + 'for ( int i = 0; i < 1; i ++ ) {' + chunk.slice(loopAt + loop.length);
}

export interface ShadowConfig {
  cascades: number;
  mapSize: number;
  maxFar: number;
  /** Wider PCF kernel (softer penumbra). */
  soft: boolean;
}

/** Cascaded shadow maps that follow the camera, plus incremental CSM setup of every lit material under a root. */
export class ShadowSystem {
  csm: CSM;
  readonly group = new THREE.Group();
  private camera: THREE.PerspectiveCamera;
  private readonly registry = new Set<THREE.Material>();
  private processed = new WeakSet<THREE.Material>();
  private readonly hooks = new Map<THREE.Material, HookRecord>();
  private config: ShadowConfig;
  private lastFov = 0;
  private lastAspect = 0;
  private lastNear = 0;
  private lastFar = 0;
  private readonly setupVisitor = (obj: THREE.Object3D): void => this.visit(obj);

  constructor(camera: THREE.PerspectiveCamera, config: ShadowConfig) {
    this.camera = camera;
    this.config = config;
    this.group.name = 'ShadowRig';
    this.csm = this.createCsm();
  }

  private createCsm(): CSM {
    const csm = new CSM({
      camera: this.camera,
      parent: this.group,
      cascades: this.config.cascades,
      maxFar: this.config.maxFar,
      mode: 'practical',
      shadowMapSize: this.config.mapSize,
      shadowBias: -0.00012,
      lightDirection: new THREE.Vector3(0.4, -0.8, 0.3).normalize(),
      lightIntensity: 3,
      lightNear: 1,
      lightFar: 1200,
      lightMargin: 220,
    });
    csm.fade = true;
    for (const light of csm.lights) {
      light.shadow.normalBias = 0.02;
      light.shadow.radius = this.config.soft ? 2.5 : 1;
      light.shadow.camera.near = 1;
      light.shadow.camera.far = 1200;
    }
    patchFallbackDirectionalLoop();
    this.rememberCamera();
    return csm;
  }

  private rememberCamera(): void {
    this.lastFov = this.camera.fov;
    this.lastAspect = this.camera.aspect;
    this.lastNear = this.camera.near;
    this.lastFar = this.camera.far;
  }

  get lights(): THREE.DirectionalLight[] {
    return this.csm.lights;
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    if (camera === this.camera) return;
    this.camera = camera;
    this.csm.camera = camera;
    this.csm.updateFrustums();
    this.rememberCamera();
  }

  /** Rebuild cascades (quality change). Re-applies CSM to every registered material. */
  configure(config: ShadowConfig): void {
    if (config.cascades === this.config.cascades && config.mapSize === this.config.mapSize && config.maxFar === this.config.maxFar) {
      this.config = config;
      for (const light of this.csm.lights) light.shadow.radius = config.soft ? 2.5 : 1;
      return;
    }
    this.config = config;
    this.teardownCsm();
    this.csm = this.createCsm();
    this.processed = new WeakSet();
    for (const m of this.registry) {
      this.processed.add(m);
      this.applyTo(m);
    }
  }

  private teardownCsm(): void {
    this.csm.dispose();
    this.csm.remove();
    for (const [m, rec] of this.hooks) {
      if (rec.onBeforeCompile === THREE.Material.prototype.onBeforeCompile) delete (m as Partial<THREE.Material>).onBeforeCompile;
      else m.onBeforeCompile = rec.onBeforeCompile;
      if (rec.hadOwnKey) m.customProgramCacheKey = rec.customProgramCacheKey;
      else delete (m as Partial<THREE.Material>).customProgramCacheKey;
      m.needsUpdate = true;
    }
    this.hooks.clear();
  }

  setLight(direction: THREE.Vector3, intensity: number, color: THREE.Color): void {
    this.csm.lightDirection.copy(direction);
    for (const light of this.csm.lights) {
      light.intensity = intensity;
      light.color.copy(color);
    }
  }

  setEnabled(enabled: boolean): void {
    for (const light of this.csm.lights) light.visible = enabled;
  }

  /** Per frame: follow the camera. */
  update(): void {
    const cam = this.camera;
    if (cam.fov !== this.lastFov || cam.aspect !== this.lastAspect || cam.near !== this.lastNear || cam.far !== this.lastFar) {
      this.csm.updateFrustums();
      this.rememberCamera();
    }
    this.csm.update();
  }

  /** Walk `root` and set up any lit material not processed yet. */
  setupMaterialsUnder(root: THREE.Object3D): void {
    root.traverse(this.setupVisitor);
  }

  private visit(obj: THREE.Object3D): void {
    const mesh = obj as THREE.Mesh;
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    if (Array.isArray(mat)) {
      for (let i = 0; i < mat.length; i++) this.register(mat[i]);
    } else this.register(mat);
  }

  private register(m: THREE.Material): void {
    if (this.processed.has(m) || !isLitMaterial(m)) return;
    this.processed.add(m);
    this.registry.add(m);
    this.applyTo(m);
  }

  private applyTo(m: THREE.Material): void {
    const prevHook = m.onBeforeCompile;
    const hadOwnKey = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey');
    const prevKey = m.customProgramCacheKey;
    this.csm.setupMaterial(m);
    const csmHook = m.onBeforeCompile;
    const hasCustomHook = prevHook !== THREE.Material.prototype.onBeforeCompile;
    if (hasCustomHook) {
      m.onBeforeCompile = (shader, renderer) => {
        prevHook.call(m, shader, renderer);
        csmHook.call(m, shader, renderer);
      };
    }
    const keyIsDefault = prevKey === THREE.Material.prototype.customProgramCacheKey;
    const baseKey: () => string = keyIsDefault ? () => prevHook.toString() : () => prevKey.call(m);
    const cascades = this.config.cascades;
    m.customProgramCacheKey = () => `${baseKey()}|csm${cascades}`;
    this.hooks.set(m, { onBeforeCompile: prevHook, hadOwnKey, customProgramCacheKey: prevKey });
    m.needsUpdate = true;
  }

  /** Forget every registered material (session cleared). Materials are disposed by the caller. */
  clearRegistry(): void {
    this.registry.clear();
    this.hooks.clear();
    this.processed = new WeakSet();
    this.csm.shaders.clear();
  }

  dispose(): void {
    this.teardownCsm();
    this.registry.clear();
  }
}
