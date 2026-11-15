/**
 * Racing-line assist ribbon: 1 m wide strip along `world.racingLine`, green (accelerate) → yellow (lift) → red (braking),
 * with an animated chevron flow indicating direction. Built once per assist-setting change.
 */
import * as THREE from 'three';
import type { TrackSpline } from '../core/track/TrackSpline';
import type { RacingLineAssist, RacingLinePoint } from '../core/types';

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vUv = uv;
  vColor = aColor;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float ux = abs(vUv.x - 0.5);
  float edge = 1.0 - smoothstep(0.36, 0.5, ux);
  float phase = (vUv.y - ux * 1.5) / 2.2 - uTime * 1.6;
  float chev = fract(phase);
  float mark = smoothstep(0.30, 0.42, chev) * (1.0 - smoothstep(0.50, 0.62, chev));
  float a = vAlpha * edge * (0.42 + 0.5 * mark) * uOpacity;
  if (a < 0.003) discard;
  vec3 col = vColor * (0.85 + 0.9 * mark);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const WIDTH = 1.0;
const LIFT = 0.015;

const GREEN = new THREE.Color(0x22ff55);
const YELLOW = new THREE.Color(0xffd21f);
const RED = new THREE.Color(0xff2a22);

export class RacingLineRibbon {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry | null = null;
  private builtFor: RacingLineAssist = 'off';
  private builtLine: RacingLinePoint[] | null = null;
  private targetOpacity = 1;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.name = 'vfx-racing-line';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  /** Rebuilds only when the assist mode or the line reference changed. */
  sync(track: TrackSpline, line: RacingLinePoint[] | null, mode: RacingLineAssist): void {
    if (mode === this.builtFor && line === this.builtLine) return;
    this.builtFor = mode;
    this.builtLine = line;
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    if (mode === 'off' || !line || line.length < 3) {
      this.mesh.visible = false;
      return;
    }
    this.geometry = this.build(track, line, mode);
    this.mesh.geometry = this.geometry;
  }

  private build(track: TrackSpline, line: RacingLinePoint[], mode: RacingLineAssist): THREE.BufferGeometry {
    const n = line.length;
    const positions = new Float32Array(n * 2 * 3);
    const colors = new Float32Array(n * 2 * 3);
    const alphas = new Float32Array(n * 2);
    const uvs = new Float32Array(n * 2 * 2);
    const index = new Uint32Array(n * 6);

    // Classification: 0 = accelerate, 1 = lift, 2 = brake.
    const cls = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = line[i];
      const next = line[(i + 1) % n];
      const next2 = line[(i + 3) % n];
      if (p.braking) cls[i] = 2;
      else if (next.speed < p.speed - 0.25 || next2.speed < p.speed - 0.8) cls[i] = 1;
      else cls[i] = 0;
    }
    // Smooth the class field so colour transitions blend over a few points.
    const smoothCls = new Float32Array(n);
    const win = 2;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let j = -win; j <= win; j++) acc += cls[(i + j + n) % n];
      smoothCls[i] = acc / (2 * win + 1);
    }

    // Corner-only mask with soft ends.
    const alpha = new Float32Array(n).fill(1);
    if (mode === 'corners') {
      const mask = new Float32Array(n);
      const sample = track.sample(0);
      for (let i = 0; i < n; i++) {
        track.sample(line[i].s, sample);
        mask[i] = cls[i] > 0.5 || Math.abs(sample.curvature) > 0.0055 ? 1 : 0;
      }
      // Dilate by ~25 m then blur for a fade at each end.
      const spacing = Math.max(0.5, track.length / n);
      const dil = Math.ceil(25 / spacing);
      const dilated = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let v = 0;
        for (let j = -dil; j <= dil && v === 0; j++) v = mask[(i + j + n) % n];
        dilated[i] = v;
      }
      const blur = Math.ceil(18 / spacing);
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let j = -blur; j <= blur; j++) acc += dilated[(i + j + n) % n];
        alpha[i] = Math.min(1, (acc / (2 * blur + 1)) * 1.15);
      }
    }

    const sm = track.sample(0);
    const c = new THREE.Color();
    const pos = new THREE.Vector3();
    let dist = 0;
    let prevX = 0;
    let prevZ = 0;
    for (let i = 0; i < n; i++) {
      const p = line[i];
      track.sample(p.s, sm);
      pos.copy(sm.position).addScaledVector(sm.left, p.lateral).addScaledVector(sm.normal, LIFT);
      if (i > 0) dist += Math.hypot(pos.x - prevX, pos.z - prevZ);
      prevX = pos.x;
      prevZ = pos.z;
      const v = smoothCls[i];
      if (v <= 1) c.copy(GREEN).lerp(YELLOW, v);
      else c.copy(YELLOW).lerp(RED, v - 1);
      const lx = sm.left.x * WIDTH * 0.5;
      const lz = sm.left.z * WIDTH * 0.5;
      const o = i * 6;
      positions[o] = pos.x + lx;
      positions[o + 1] = pos.y;
      positions[o + 2] = pos.z + lz;
      positions[o + 3] = pos.x - lx;
      positions[o + 4] = pos.y;
      positions[o + 5] = pos.z - lz;
      colors[o] = c.r;
      colors[o + 1] = c.g;
      colors[o + 2] = c.b;
      colors[o + 3] = c.r;
      colors[o + 4] = c.g;
      colors[o + 5] = c.b;
      alphas[i * 2] = alpha[i];
      alphas[i * 2 + 1] = alpha[i];
      uvs[i * 4] = 0;
      uvs[i * 4 + 1] = dist;
      uvs[i * 4 + 2] = 1;
      uvs[i * 4 + 3] = dist;
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = ((i + 1) % n) * 2;
      const o = i * 6;
      index[o] = a;
      index[o + 1] = a + 1;
      index[o + 2] = b + 1;
      index[o + 3] = a;
      index[o + 4] = b + 1;
      index[o + 5] = b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }

  /** Smoothly hide (replay / TV cameras) or show. */
  setVisible(visible: boolean): void {
    this.targetOpacity = visible ? 1 : 0;
  }

  update(time: number, dt: number): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    const cur = u.uOpacity.value as number;
    const next = cur + (this.targetOpacity - cur) * Math.min(1, dt * 6);
    u.uOpacity.value = next;
    this.mesh.visible = this.builtFor !== 'off' && !!this.geometry && next > 0.01;
  }

  dispose(): void {
    this.geometry?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
