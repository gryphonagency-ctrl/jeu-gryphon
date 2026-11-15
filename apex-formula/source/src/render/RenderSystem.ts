import * as THREE from 'three';
import type { QualityLevel } from '../core/constants';
import { clamp01, smoothstep } from '../core/math';
import type { EnvironmentState, IRenderSystem, RenderStats, TrackDefinition, World } from '../core/types';
import { createEnvironment } from '../core/world';
import { LightingState, THEMES, type ThemePalette } from './Atmosphere';
import { EnvironmentMaps, createStudioEnvironment } from './EnvMaps';
import { Floodlights } from './Floodlights';
import { PostPipeline } from './PostPipeline';
import { QUALITY, type QualityConfig } from './quality';
import { ShadowSystem } from './Shadows';
import { SkyDome } from './SkyDome';
import { Studio } from './Studio';
import { getSplitViewports } from './splitScreen';

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _sunUv = new THREE.Vector2();
const _color = new THREE.Color();
const _flareColor = new THREE.Color();

const MATERIAL_SCAN_INTERVAL = 0.5;

export class RenderSystem implements IRenderSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sessionGroup = new THREE.Group();

  private camera: THREE.PerspectiveCamera;
  private quality: QualityLevel = 'high';
  private q: QualityConfig = QUALITY.high;
  private readonly light = new LightingState();
  private theme: ThemePalette = THEMES.permanent;
  private fallbackEnv: EnvironmentState = createEnvironment(15.5);
  private readonly sky: SkyDome;
  private readonly envMaps: EnvironmentMaps;
  private readonly shadows: ShadowSystem;
  private readonly floods: Floodlights;
  private readonly hemi: THREE.HemisphereLight;
  private readonly fog: THREE.FogExp2;
  private readonly post: PostPipeline;
  private readonly studio: Studio;
  private studioEnv: THREE.WebGLRenderTarget | null = null;
  private menuMode = false;
  private width = 1;
  private height = 1;
  private lastDt = 1 / 60;
  private scanTimer = 0;
  private lastChildCount = -1;
  private scanBurst = 0;
  private lastRenderAt = 0;
  private smoothedFrameMs = 16.7;
  private readonly stats: RenderStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, quality: 'high' };
  private readonly disposeVisitor = (obj: THREE.Object3D): void => RenderSystem.disposeObject(obj);
  private splitCameras: readonly THREE.PerspectiveCamera[] | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false, depth: true });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping (ACES) and exposure live in the final grade pass so the whole pipeline stays linear HDR.
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    r.setClearColor(0x000000, 1);
    r.autoClear = true;

    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2500);
    this.camera.position.set(0, 1.2, 7);
    this.camera.lookAt(0, 0.5, 0);
    this.camera.updateMatrixWorld();

    this.sessionGroup.name = 'Session';
    this.scene.add(this.sessionGroup);

    this.sky = new SkyDome();
    this.scene.add(this.sky.mesh);
    this.envMaps = new EnvironmentMaps(r, this.sky);

    this.shadows = new ShadowSystem(this.camera, { cascades: this.q.cascades, mapSize: this.q.shadowMapSize, maxFar: this.q.shadowMaxFar, soft: this.q.softShadows });
    this.scene.add(this.shadows.group);

    this.floods = new Floodlights();
    this.floods.configure(this.q.floodlightShadows, this.q.floodlightShadowSize);
    this.scene.add(this.floods.group);

    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x30401c, 0.5);
    this.hemi.name = 'HemisphereFill';
    this.scene.add(this.hemi);

    this.fog = new THREE.FogExp2(0xb6c4d4, 0.0012);
    this.scene.fog = this.fog;
    this.scene.environmentIntensity = 1;

    this.studio = new Studio();
    this.scene.add(this.studio.group);

    this.post = new PostPipeline(r, this.scene, this.camera, this.q);

    this.light.setTheme(this.theme);
    this.light.update(this.fallbackEnv.timeOfDay, this.fallbackEnv.weather, 100);
    this.applyLighting();
    this.resize(Math.max(1, canvas.clientWidth || window.innerWidth), Math.max(1, canvas.clientHeight || window.innerHeight));
  }

  /* ───────────────────────────── configuration ───────────────────────────── */

  setEnvironment(def: TrackDefinition, env: EnvironmentState): void {
    this.theme = THEMES[def.environment.theme] ?? THEMES.permanent;
    this.fallbackEnv = env;
    this.light.setTheme(this.theme);
    this.light.update(env.timeOfDay, env.weather, 100);
    this.applyLighting();
    this.envMaps.markDirty();
    this.scanBurst = 120;
    this.lastChildCount = -1;
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    if (camera === this.camera) return;
    this.camera = camera;
    this.post.setCamera(camera);
    this.shadows.setCamera(camera);
  }

  setSplitCameras(cameras: readonly THREE.PerspectiveCamera[] | null): void {
    this.splitCameras = cameras && cameras.length > 1 ? cameras.slice(0, 4) : null;
  }

  setQuality(q: QualityLevel): void {
    this.quality = q;
    this.q = QUALITY[q];
    this.stats.quality = q;
    const cfg = this.q;
    this.shadows.configure({ cascades: cfg.cascades, mapSize: cfg.shadowMapSize, maxFar: cfg.shadowMaxFar, soft: cfg.softShadows });
    this.floods.configure(cfg.floodlightShadows, cfg.floodlightShadowSize);
    this.post.applyQuality(cfg);
    this.studio.setReflector(cfg.studioReflector, cfg.envMapSize >= 256 ? 1024 : 512);
    this.resize(this.width, this.height);
  }

  getQuality(): QualityLevel {
    return this.quality;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dprCap) * this.q.resolutionScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.post.setSize(this.width, this.height, dpr);
  }

  setMenuMode(enabled: boolean): void {
    if (enabled === this.menuMode) return;
    this.menuMode = enabled;
    this.studio.setVisible(enabled);
    this.sky.mesh.visible = !enabled;
    this.shadows.setEnabled(!enabled);
    this.hemi.visible = !enabled;
    this.scene.fog = enabled ? null : this.fog;
    if (enabled) {
      if (!this.studioEnv) this.studioEnv = createStudioEnvironment(this.renderer);
      this.scene.environment = this.studioEnv.texture;
      this.scene.environmentIntensity = 1;
      this.studio.setReflector(this.q.studioReflector, this.q.envMapSize >= 256 ? 1024 : 512);
      this.floods.update(0, this.camera);
    } else {
      this.envMaps.markDirty();
      this.scene.environment = null;
    }
  }

  /* ───────────────────────────── per frame ───────────────────────────── */

  update(world: World | null, camera: THREE.PerspectiveCamera, dt: number): void {
    if (camera !== this.camera) this.setCamera(camera);
    camera.updateMatrixWorld();
    this.lastDt = dt;
    const cinematic = this.menuMode || world?.mode === 'replay';
    const post = this.post;

    if (this.menuMode) {
      this.studio.update(camera, dt);
      post.grade.applyLook({
        exposure: 1.0,
        whiteBalance: _color.setRGB(1, 1, 1),
        saturation: 1.04,
        contrast: 1.08,
        lift: 0.012,
        vignette: 0.45,
        grain: 0.028,
        chromaticAberration: 0.008,
        splitTone: 0.35,
      });
      post.grade.setSun(null, 0, _flareColor.setRGB(1, 1, 1));
      post.motionBlur.enabled = false;
      post.dof.enabled = this.q.dof;
      const dofU = post.dof.uniforms;
      dofU.autoFocus.value = 0;
      dofU.focusDistance.value = camera.position.length();
      dofU.focusRange.value = 2.2;
      dofU.aperture.value = 1.1;
      dofU.maxCoc.value = 0.011;
      post.dof.updateCamera(camera);
      post.bloom.threshold = 1.25;
      post.bloom.strength = 0.28;
    } else {
      const env = world ? world.env : this.fallbackEnv;
      this.light.update(env.timeOfDay, env.weather, dt);
      this.applyLighting();
      this.sky.update(this.light, this.theme, env.weather, dt);
      this.floods.update(this.q.floodlightShadows > 0 || this.quality === 'low' ? this.light.flood : 0, camera);
      this.envMaps.update(this.light, env.timeOfDay, env.weather.fog, dt, this.scene);
      this.shadows.update();
      this.scanMaterials(dt);

      const L = this.light;
      post.grade.applyLook({
        exposure: L.exposure,
        whiteBalance: L.whiteBalance,
        saturation: L.saturation,
        contrast: L.contrast,
        lift: 0.018 + L.gloom * 0.012,
        vignette: 0.3 + L.night * 0.1,
        grain: 0.026 + L.night * 0.006,
        chromaticAberration: 0.011,
        splitTone: 0.55,
      });
      this.updateSunFlare(camera);
      post.bloom.threshold = 1.15 / Math.max(0.3, L.exposure);
      post.bloom.strength = 0.28 + L.night * 0.08 + L.wetness * 0.06;

      post.motionBlur.enabled = this.q.motionBlur;
      post.motionBlur.intensity = cinematic ? 0.7 : 1;
      post.motionBlur.updateCamera(camera, dt);

      post.dof.enabled = this.q.dof && cinematic;
      if (post.dof.enabled) {
        const dofU = post.dof.uniforms;
        dofU.autoFocus.value = 1;
        dofU.focusRange.value = 4;
        dofU.aperture.value = 0.9;
        dofU.maxCoc.value = 0.009;
        post.dof.updateCamera(camera);
      }
    }
  }

  private applyLighting(): void {
    const L = this.light;
    // Key light: the sun by day, the moon once the sun is gone (keeps night shadows alive under the floodlights).
    const useMoon = L.sunIntensity < 0.06;
    if (useMoon) {
      _dir.copy(L.moonDir).negate();
      this.shadows.setLight(_dir, L.moonIntensity, L.moonColor);
    } else {
      _dir.copy(L.sunDir).negate();
      this.shadows.setLight(_dir, L.sunIntensity, L.sunColor);
    }
    this.hemi.color.copy(L.hemiSky);
    this.hemi.groundColor.copy(L.hemiGround);
    this.hemi.intensity = L.hemiIntensity;
    this.fog.color.copy(L.fogColor);
    this.fog.density = L.fogDensity;
    if (!this.menuMode) this.scene.environmentIntensity = L.envIntensity;
  }

  private updateSunFlare(camera: THREE.PerspectiveCamera): void {
    const L = this.light;
    camera.getWorldDirection(_dir);
    const facing = _dir.dot(L.sunDir);
    const elDeg = THREE.MathUtils.radToDeg(L.sunElevation);
    let intensity = smoothstep(-1.5, 2.5, elDeg) * (1 - L.cloud * 0.92) * (1 - L.rain * 0.6);
    if (facing <= 0.05 || intensity <= 0.001) {
      this.post.grade.setSun(null, 0, L.sunColor);
      return;
    }
    _v.copy(L.sunDir).multiplyScalar(4000).add(camera.position).project(camera);
    _sunUv.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    const margin = 0.35;
    const inside = Math.min(_sunUv.x + margin, 1 + margin - _sunUv.x, _sunUv.y + margin, 1 + margin - _sunUv.y);
    intensity *= smoothstep(0, 0.3, inside) * clamp01(L.sunIntensity / 3.2);
    intensity *= 0.55 + 0.45 * smoothstep(0.55, 1.0, facing);
    _flareColor.copy(L.sunColor);
    this.post.grade.setSun(_sunUv, intensity, _flareColor);
  }

  private scanMaterials(dt: number): void {
    this.scanTimer -= dt;
    const count = this.sessionGroup.children.length;
    if (this.scanBurst > 0) this.scanBurst--;
    if (count !== this.lastChildCount || this.scanTimer <= 0 || this.scanBurst > 0) {
      this.lastChildCount = count;
      this.scanTimer = MATERIAL_SCAN_INTERVAL;
      this.shadows.setupMaterialsUnder(this.sessionGroup);
    }
  }

  render(): void {
    const now = performance.now();
    if (this.lastRenderAt > 0) {
      const interval = Math.min(250, now - this.lastRenderAt);
      this.smoothedFrameMs += (interval - this.smoothedFrameMs) * 0.08;
    }
    this.lastRenderAt = now;
    this.renderer.info.reset();
    if (this.splitCameras) this.renderSplit(this.splitCameras);
    else {
      this.post.render(this.lastDt);
      this.post.motionBlur.endFrame();
    }
    const info = this.renderer.info.render;
    this.stats.frameMs = this.smoothedFrameMs;
    this.stats.fps = this.smoothedFrameMs > 0 ? 1000 / this.smoothedFrameMs : 0;
    this.stats.drawCalls = info.calls;
    this.stats.triangles = info.triangles;
  }

  private renderSplit(cameras: readonly THREE.PerspectiveCamera[]): void {
    const renderer = this.renderer;
    const viewports = getSplitViewports(this.width, this.height, cameras.length);
    const previousToneMapping = renderer.toneMapping;
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.width, this.height);
    renderer.clear(true, true, true);
    renderer.setScissorTest(true);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    try {
      for (let i = 0; i < cameras.length; i++) {
        const viewport = viewports[i];
        const camera = cameras[i];
        camera.aspect = viewport.width / viewport.height;
        camera.updateProjectionMatrix();
        const x = viewport.x + 2;
        const y = this.height - viewport.y - viewport.height + 2;
        const width = Math.max(1, viewport.width - 4);
        const height = Math.max(1, viewport.height - 4);
        renderer.setViewport(x, y, width, height);
        renderer.setScissor(x, y, width, height);
        renderer.render(this.scene, camera);
      }
    } finally {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, this.width, this.height);
      renderer.toneMapping = previousToneMapping;
    }
  }

  getStats(): RenderStats {
    return this.stats;
  }

  /* ───────────────────────────── lifecycle ───────────────────────────── */

  clearSession(): void {
    const children = this.sessionGroup.children.slice();
    for (const child of children) {
      child.traverse(this.disposeVisitor);
      this.sessionGroup.remove(child);
    }
    this.shadows.clearRegistry();
    this.lastChildCount = -1;
    this.scanBurst = 0;
  }

  private static disposeObject(obj: THREE.Object3D): void {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    if (Array.isArray(mat)) for (const m of mat) RenderSystem.disposeMaterial(m);
    else RenderSystem.disposeMaterial(mat);
  }

  private static disposeMaterial(m: THREE.Material): void {
    const rec = m as unknown as Record<string, unknown>;
    for (const key in rec) {
      const v = rec[key];
      if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
    }
    const uniforms = (m as THREE.ShaderMaterial).uniforms;
    if (uniforms) {
      for (const key in uniforms) {
        const v = uniforms[key]?.value as { isTexture?: boolean; dispose?: () => void } | null;
        if (v && v.isTexture && v.dispose) v.dispose();
      }
    }
    m.dispose();
  }

  dispose(): void {
    this.clearSession();
    this.post.dispose();
    this.envMaps.dispose();
    this.studio.dispose();
    this.studioEnv?.dispose();
    this.studioEnv = null;
    this.shadows.dispose();
    this.floods.dispose();
    this.sky.dispose();
    this.hemi.dispose();
    this.scene.environment = null;
    this.renderer.dispose();
  }
}
