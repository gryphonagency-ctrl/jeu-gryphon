import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { DepthOfFieldPass, GradePass, MotionBlurPass, ScenePass } from './passes';
import type { QualityConfig } from './quality';
import { createLensDirtTexture } from './textures';

/**
 * HDR pipeline (HalfFloat):
 *   Scene → GTAO → Bloom → camera motion blur → DoF (cinematics) → grade (tonemap, look, flare, vignette, grain, sRGB) → SMAA/FXAA.
 * Anti-aliasing runs last on the display-referred image so its edge detection sees what the viewer sees.
 */
export class PostPipeline {
  readonly composer: EffectComposer;
  readonly scenePass: ScenePass;
  readonly gtao: GTAOPass;
  readonly bloom: UnrealBloomPass;
  readonly motionBlur: MotionBlurPass;
  readonly dof: DepthOfFieldPass;
  readonly grade: GradePass;
  readonly smaa: SMAAPass;
  readonly fxaa: FXAAPass;
  private readonly dirt: THREE.CanvasTexture;
  private width = 1920;
  private height = 1080;
  private pixelRatio = 1;
  private aoScale = 0.5;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    quality: QualityConfig,
  ) {
    const target = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    target.texture.name = 'Composer.rt1';
    this.composer = new EffectComposer(renderer, target);

    this.scenePass = new ScenePass(scene, camera, this.width, this.height);
    const depth = this.scenePass.depthTexture;

    // Constructed with its own G-buffer first (the pass expects that), then pointed at the scene depth so it
    // reconstructs normals from depth and skips its extra full-scene normal render.
    this.gtao = new GTAOPass(scene, camera, this.width, this.height);
    this.gtao.setGBuffer(depth, undefined);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.0, distanceFallOff: 1.0, scale: 1.1, samples: quality.aoSamples, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 2, rings: 2, samples: 12 });
    const internal = this.gtao as unknown as { normalRenderTarget: THREE.WebGLRenderTarget };
    internal.normalRenderTarget.setSize(4, 4);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.32, 0.45, 1.1);
    this.motionBlur = new MotionBlurPass(depth, quality.motionBlurTaps);
    this.dof = new DepthOfFieldPass(depth, 20);
    this.dirt = createLensDirtTexture();
    this.grade = new GradePass(depth, this.dirt);
    this.grade.material.toneMapped = false;
    this.smaa = new SMAAPass();
    this.fxaa = new FXAAPass();
    this.fxaa.material.depthTest = false;
    this.fxaa.material.depthWrite = false;

    const c = this.composer;
    c.addPass(this.scenePass);
    c.addPass(this.gtao);
    c.addPass(this.bloom);
    c.addPass(this.motionBlur);
    c.addPass(this.dof);
    c.addPass(this.grade);
    c.addPass(this.smaa);
    c.addPass(this.fxaa);
    this.applyQuality(quality);
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.scenePass.camera = camera;
    this.gtao.camera = camera;
  }

  applyQuality(q: QualityConfig): void {
    this.gtao.enabled = q.ao === 'gtao';
    this.aoScale = q.aoScale;
    this.gtao.updateGtaoMaterial({ samples: q.aoSamples });
    this.bloom.enabled = q.bloom;
    this.motionBlur.enabled = q.motionBlur;
    this.motionBlur.setTaps(q.motionBlurTaps);
    this.dof.enabled = false;
    this.grade.setFeatures({ ca: q.chromaticAberration, flare: q.lensFlare, dirt: q.lensDirt, grain: q.filmGrain });
    this.smaa.enabled = q.antialias === 'smaa';
    this.fxaa.enabled = q.antialias === 'fxaa';
    this.setSize(this.width, this.height, this.pixelRatio);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    this.gtao.setSize(Math.max(1, Math.floor(w * this.aoScale)), Math.max(1, Math.floor(h * this.aoScale)));
    (this.gtao as unknown as { normalRenderTarget: THREE.WebGLRenderTarget }).normalRenderTarget.setSize(4, 4);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
    this.scenePass.dispose();
    this.gtao.dispose();
    this.bloom.dispose();
    this.motionBlur.dispose();
    this.dof.dispose();
    this.grade.dispose();
    this.smaa.dispose();
    this.fxaa.dispose();
    this.dirt.dispose();
  }
}
