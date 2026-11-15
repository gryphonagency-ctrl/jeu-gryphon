import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

const fsVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

function quadMaterial(uniforms: Record<string, THREE.IUniform>, fragmentShader: string, defines: Record<string, number | string> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    defines,
    vertexShader: fsVertex,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
}

/* ───────────────────────────── Scene pass ───────────────────────────── */

/**
 * Renders the scene into an owned HDR target with a depth texture, then blits colour into the composer's read buffer.
 * Keeping depth in a dedicated texture lets every later pass read scene depth without framebuffer feedback loops.
 */
export class ScenePass extends Pass {
  camera: THREE.Camera;
  readonly target: THREE.WebGLRenderTarget;
  readonly depthTexture: THREE.DepthTexture;
  private readonly copyMaterial: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor(
    readonly scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
  ) {
    super();
    this.camera = camera;
    this.needsSwap = false;
    this.depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
    this.target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthTexture: this.depthTexture,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.name = 'ScenePass.hdr';
    this.copyMaterial = quadMaterial(
      { tDiffuse: { value: this.target.texture } },
      /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() { gl_FragColor = texture2D( tDiffuse, vUv ); }
      `,
    );
    this.quad = new FullScreenQuad(this.copyMaterial);
  }

  override render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  override dispose(): void {
    this.target.dispose();
    this.copyMaterial.dispose();
    this.quad.dispose();
  }
}

/* ───────────────────────────── Camera motion blur ───────────────────────────── */

const motionBlurFrag = /* glsl */ `
#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform mat4 projInverse;
uniform mat4 cameraWorld;
uniform mat4 prevViewProj;
uniform float strength;
uniform float maxBlur;
uniform float nearFade0;
uniform float nearFade1;
uniform float cameraNear;
uniform float cameraFar;
uniform vec2 texelSize;
varying vec2 vUv;

void main() {
  float depth = texture2D( tDepth, vUv ).x;
  vec4 clip = vec4( vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
  vec4 view = projInverse * clip;
  view /= view.w;
  vec4 world = cameraWorld * view;
  vec4 prev = prevViewProj * world;
  vec2 prevUv = ( prev.xy / prev.w ) * 0.5 + 0.5;
  vec2 vel = vUv - prevUv;
  float viewZ = -view.z;
  float fade = depth >= 1.0 ? 1.0 : smoothstep( nearFade0, nearFade1, viewZ );
  vel *= strength * fade;
  float len = length( vel );
  if ( len > maxBlur ) vel *= maxBlur / len;
  if ( len < texelSize.x * 0.75 ) {
    gl_FragColor = texture2D( tDiffuse, vUv );
    return;
  }
  vec4 acc = vec4( 0.0 );
  float wsum = 0.0;
  for ( int i = 0; i < TAPS; i ++ ) {
    float t = ( float( i ) + 0.5 ) / float( TAPS ) - 0.5;
    vec2 uv = clamp( vUv + vel * t, texelSize, 1.0 - texelSize );
    float dn = texture2D( tDepth, uv ).x;
    float zn = -perspectiveDepthToViewZ( dn, cameraNear, cameraFar );
    // Do not smear crisp near objects (the followed car, the cockpit) into the background.
    float w = dn >= 1.0 ? 1.0 : max( 0.04, smoothstep( nearFade0, nearFade1, zn ) );
    acc += texture2D( tDiffuse, uv ) * w;
    wsum += w;
  }
  gl_FragColor = acc / wsum;
}
`;

export class MotionBlurPass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly currViewProj = new THREE.Matrix4();
  private readonly lastCameraPos = new THREE.Vector3();
  private readonly lastCameraDir = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private hasPrev = false;
  /** Global strength multiplier (0 disables the blur for this frame). */
  intensity = 1;

  constructor(depthTexture: THREE.DepthTexture, taps: number) {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      tDepth: { value: depthTexture },
      projInverse: { value: new THREE.Matrix4() },
      cameraWorld: { value: new THREE.Matrix4() },
      prevViewProj: { value: this.prevViewProj },
      strength: { value: 0.55 },
      maxBlur: { value: 0.022 },
      nearFade0: { value: 7 },
      nearFade1: { value: 15 },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      texelSize: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    };
    this.material = quadMaterial(this.uniforms, motionBlurFrag, { TAPS: taps });
    this.quad = new FullScreenQuad(this.material);
  }

  setTaps(taps: number): void {
    if (this.material.defines.TAPS !== taps) {
      this.material.defines.TAPS = taps;
      this.material.needsUpdate = true;
    }
  }

  /** Call once per frame with the camera in its final pose for this frame (matrices must be up to date). */
  updateCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    this.currViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    (this.uniforms.projInverse.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (this.uniforms.cameraWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
    this.uniforms.cameraNear.value = camera.near;
    this.uniforms.cameraFar.value = camera.far;
    camera.getWorldDirection(this.dir);
    // A cut (teleport / camera switch) must not produce a one-frame smear.
    const jump = camera.position.distanceToSquared(this.lastCameraPos) > 12 * 12 || this.dir.dot(this.lastCameraDir) < 0.6;
    const speed = dt > 0 ? camera.position.distanceTo(this.lastCameraPos) / dt : 0;
    const speedFactor = THREE.MathUtils.clamp(speed / 45, 0.35, 1);
    this.uniforms.strength.value = this.hasPrev && !jump ? 0.6 * speedFactor * this.intensity : 0;
    this.lastCameraPos.copy(camera.position);
    this.lastCameraDir.copy(this.dir);
    this.hasPrev = true;
  }

  /** Store this frame's view-projection as "previous" for the next frame. Call after render. */
  endFrame(): void {
    this.prevViewProj.copy(this.currViewProj);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.texelSize.value as THREE.Vector2).set(1 / width, 1 / height);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

/* ───────────────────────────── Depth of field (cinematics) ───────────────────────────── */

const dofFrag = /* glsl */ `
#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform float focusDistance;
uniform float focusRange;
uniform float aperture;
uniform float maxCoc;
uniform float autoFocus;
uniform vec2 texelSize;
varying vec2 vUv;

float linearDepth( vec2 uv ) {
  float d = texture2D( tDepth, uv ).x;
  return d >= 1.0 ? cameraFar : -perspectiveDepthToViewZ( d, cameraNear, cameraFar );
}
float cocAt( float z, float focus ) {
  float d = max( abs( z - focus ) - focusRange, 0.0 );
  return clamp( d / max( z, 0.5 ) * aperture, 0.0, 1.0 );
}

void main() {
  float focus = focusDistance;
  if ( autoFocus > 0.5 ) {
    focus = linearDepth( vec2( 0.5, 0.5 ) ) * 0.4;
    focus += linearDepth( vec2( 0.46, 0.5 ) ) * 0.15;
    focus += linearDepth( vec2( 0.54, 0.5 ) ) * 0.15;
    focus += linearDepth( vec2( 0.5, 0.46 ) ) * 0.15;
    focus += linearDepth( vec2( 0.5, 0.54 ) ) * 0.15;
    focus = clamp( focus, 1.5, 120.0 );
  }
  float z = linearDepth( vUv );
  float coc = cocAt( z, focus );
  vec4 centre = texture2D( tDiffuse, vUv );
  if ( coc < 0.02 ) {
    gl_FragColor = centre;
    return;
  }
  float radius = coc * maxCoc;
  vec2 aspect = vec2( texelSize.x / texelSize.y, 1.0 );
  vec4 acc = centre;
  float wsum = 1.0;
  const float GOLDEN = 2.39996323;
  for ( int i = 1; i <= TAPS; i ++ ) {
    float fi = float( i );
    float r = sqrt( fi / float( TAPS ) ) * radius;
    float a = fi * GOLDEN;
    vec2 off = vec2( cos( a ), sin( a ) ) * r * aspect;
    vec2 uv = clamp( vUv + off, texelSize, 1.0 - texelSize );
    vec4 s = texture2D( tDiffuse, uv );
    float zs = linearDepth( uv );
    // Sharp foreground must not bleed over blurred background (and vice versa): weight taps by their own CoC.
    float cs = cocAt( zs, focus );
    float w = clamp( cs / max( coc, 1e-3 ), 0.25, 1.0 );
    // Brighter taps dominate to keep bokeh highlights sparkly.
    w *= 1.0 + min( dot( s.rgb, vec3( 0.333 ) ), 4.0 ) * 0.35;
    acc += s * w;
    wsum += w;
  }
  gl_FragColor = acc / wsum;
}
`;

export class DepthOfFieldPass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(depthTexture: THREE.DepthTexture, taps = 20) {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      tDepth: { value: depthTexture },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      focusDistance: { value: 7 },
      focusRange: { value: 1.5 },
      aperture: { value: 1.6 },
      maxCoc: { value: 0.014 },
      autoFocus: { value: 0 },
      texelSize: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
    };
    this.material = quadMaterial(this.uniforms, dofFrag, { TAPS: taps });
    this.quad = new FullScreenQuad(this.material);
  }

  updateCamera(camera: THREE.PerspectiveCamera): void {
    this.uniforms.cameraNear.value = camera.near;
    this.uniforms.cameraFar.value = camera.far;
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.texelSize.value as THREE.Vector2).set(1 / width, 1 / height);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

/* ───────────────────────────── Final grade: tone map, look, flare, vignette, grain ───────────────────────────── */

const gradeFrag = /* glsl */ `
#include <common>
#include <tonemapping_pars_fragment>
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D tDirt;
uniform vec2 resolution;
uniform float time;
uniform vec3 whiteBalance;
uniform float saturation;
uniform float contrast;
uniform float lift;
uniform float vignette;
uniform float grainAmount;
uniform float caAmount;
uniform vec2 sunUv;
uniform float sunFlare;
uniform vec3 flareColor;
uniform float dirtAmount;
uniform float splitTone;
varying vec2 vUv;

float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

float sunVisibility() {
  vec2 px = vec2( resolution.y / resolution.x, 1.0 ) * 0.007;
  float vis = step( 0.99999, texture2D( tDepth, sunUv ).x ) * 2.0;
  for ( int i = 0; i < 8; i ++ ) {
    float a = float( i ) * 0.785398;
    vis += step( 0.99999, texture2D( tDepth, sunUv + vec2( cos( a ), sin( a ) ) * px ).x );
  }
  return vis * 0.1;
}

void main() {
  vec2 uv = vUv;
  vec2 centred = uv - 0.5;
  float r2 = dot( centred, centred );
  vec3 col;
  #if CA == 1
    vec2 caOff = centred * r2 * caAmount;
    col.r = texture2D( tDiffuse, uv + caOff ).r;
    col.g = texture2D( tDiffuse, uv ).g;
    col.b = texture2D( tDiffuse, uv - caOff ).b;
  #else
    col = texture2D( tDiffuse, uv ).rgb;
  #endif

  #if FLARE == 1
  if ( sunFlare > 0.001 ) {
    float vis = sunVisibility() * sunFlare;
    if ( vis > 0.001 ) {
      vec2 aspect = vec2( resolution.x / resolution.y, 1.0 );
      vec2 d = ( uv - sunUv ) * aspect;
      float dist = length( d );
      float streak = exp( -abs( d.y ) * 110.0 ) * exp( -abs( d.x ) * 2.4 ) * 0.42;
      float glow = 0.05 / ( dist * 14.0 + 0.12 );
      vec2 toCentre = ( vec2( 0.5 ) - sunUv ) * aspect;
      vec3 ghosts = vec3( 0.0 );
      for ( int i = 0; i < 5; i ++ ) {
        float fi = float( i );
        float f = 0.5 + fi * 0.42;
        vec2 gp = sunUv * aspect + toCentre * f;
        float gd = length( uv * aspect - gp );
        float size = 0.03 + 0.028 * fi;
        float disc = pow( max( 0.0, 1.0 - gd / size ), 1.6 );
        float ring = smoothstep( size * 0.55, size * 0.85, gd ) * ( 1.0 - smoothstep( size * 0.85, size, gd ) );
        vec3 tint = mix( vec3( 0.45, 0.72, 1.0 ), vec3( 1.0, 0.62, 0.38 ), fract( fi * 0.37 + 0.2 ) );
        ghosts += tint * ( disc * 0.045 + ring * 0.06 ) * ( 1.0 - fi * 0.12 );
      }
      vec3 flare = flareColor * ( streak * vec3( 0.75, 0.88, 1.25 ) + glow ) + ghosts;
      col += flare * vis;
      #if DIRT == 1
        float dirt = texture2D( tDirt, uv ).r;
        col += dirt * dirtAmount * vis * flareColor * ( 0.6 / ( dist * 2.5 + 0.55 ) );
      #endif
    }
  }
  #endif

  col *= whiteBalance;
  #if TONEMAP == 1
    col = AgXToneMapping( col );
  #else
    col = ACESFilmicToneMapping( col );
  #endif

  float luma = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
  col = mix( vec3( luma ), col, saturation );
  col = max( ( col - 0.42 ) * contrast + 0.42, 0.0 );
  col = col * ( 1.0 - lift ) + lift * vec3( 0.42, 0.47, 0.58 );
  float t = smoothstep( 0.05, 0.85, luma );
  vec3 tone = mix( vec3( 0.965, 1.005, 1.045 ), vec3( 1.035, 1.0, 0.955 ), t );
  col *= mix( vec3( 1.0 ), tone, splitTone );

  float vig = 1.0 - vignette * smoothstep( 0.12, 1.15, r2 * 2.4 );
  col *= vig;

  #if GRAIN == 1
    float g = hash12( gl_FragCoord.xy + vec2( fract( time * 7.13 ) * 913.0, fract( time * 3.71 ) * 517.0 ) ) - 0.5;
    col += g * grainAmount * ( 1.0 - luma * 0.75 );
  #endif

  gl_FragColor = sRGBTransferOETF( vec4( clamp( col, 0.0, 1.0 ), 1.0 ) );
}
`;

export interface GradeLook {
  exposure: number;
  whiteBalance: THREE.Color;
  saturation: number;
  contrast: number;
  lift: number;
  vignette: number;
  grain: number;
  chromaticAberration: number;
  splitTone: number;
}

export class GradePass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(depthTexture: THREE.DepthTexture, dirt: THREE.Texture) {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      tDepth: { value: depthTexture },
      tDirt: { value: dirt },
      resolution: { value: new THREE.Vector2(1920, 1080) },
      time: { value: 0 },
      toneMappingExposure: { value: 1 },
      whiteBalance: { value: new THREE.Color(1, 1, 1) },
      saturation: { value: 1.08 },
      contrast: { value: 1.06 },
      lift: { value: 0.02 },
      vignette: { value: 0.32 },
      grainAmount: { value: 0.035 },
      caAmount: { value: 0.012 },
      sunUv: { value: new THREE.Vector2(0.5, 0.5) },
      sunFlare: { value: 0 },
      flareColor: { value: new THREE.Color(1, 0.95, 0.85) },
      dirtAmount: { value: 0.35 },
      splitTone: { value: 0.6 },
    };
    this.material = quadMaterial(this.uniforms, gradeFrag, { CA: 1, FLARE: 1, DIRT: 1, GRAIN: 1, TONEMAP: 0 });
    this.quad = new FullScreenQuad(this.material);
  }

  setFeatures(f: { ca: boolean; flare: boolean; dirt: boolean; grain: boolean }): void {
    const d = this.material.defines;
    const next = { CA: f.ca ? 1 : 0, FLARE: f.flare ? 1 : 0, DIRT: f.dirt ? 1 : 0, GRAIN: f.grain ? 1 : 0 };
    if (d.CA !== next.CA || d.FLARE !== next.FLARE || d.DIRT !== next.DIRT || d.GRAIN !== next.GRAIN) {
      Object.assign(d, next);
      this.material.needsUpdate = true;
    }
  }

  applyLook(look: GradeLook): void {
    const u = this.uniforms;
    u.toneMappingExposure.value = look.exposure;
    (u.whiteBalance.value as THREE.Color).copy(look.whiteBalance);
    u.saturation.value = look.saturation;
    u.contrast.value = look.contrast;
    u.lift.value = look.lift;
    u.vignette.value = look.vignette;
    u.grainAmount.value = look.grain;
    u.caAmount.value = look.chromaticAberration;
    u.splitTone.value = look.splitTone;
  }

  setSun(uv: THREE.Vector2 | null, intensity: number, color: THREE.Color): void {
    if (uv) (this.uniforms.sunUv.value as THREE.Vector2).copy(uv);
    this.uniforms.sunFlare.value = uv ? intensity : 0;
    (this.uniforms.flareColor.value as THREE.Color).copy(color);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.time.value += deltaTime;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.resolution.value as THREE.Vector2).set(width, height);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}
