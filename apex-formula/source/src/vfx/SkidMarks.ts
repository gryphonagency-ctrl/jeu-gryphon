/**
 * Persistent skid-mark decals: one BufferGeometry (one draw call) holding a ring of independent quads per wheel slot.
 * Dry rubber marks are distance-spaced and permanent until the ring wraps (oldest few fade progressively);
 * wet tyre tracks are time-spaced and fade out over ~2 s via a birth-time attribute.
 */
import * as THREE from 'three';

const FADE_TAIL = 5;

const VERT = /* glsl */ `
attribute vec4 aData; // alpha, tint (0 rubber, 1 wet track), birth, fadeTime
varying vec2 vUv;
varying vec4 vData;
void main() {
  vUv = uv;
  vData = aData;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
varying vec2 vUv;
varying vec4 vData;
void main() {
  float fade = vData.w > 0.0 ? 1.0 - clamp((uTime - vData.z) / vData.w, 0.0, 1.0) : 1.0;
  float edge = 1.0 - smoothstep(0.28, 0.5, abs(vUv.x - 0.5));
  vec3 n = texture2D(uNoise, vec2(vUv.x * 2.0, vUv.y * 0.04)).rgb;
  float streak = 0.65 + 0.35 * n.b;
  float grain = 0.75 + 0.25 * texture2D(uNoise, vec2(vUv.y * 0.6, vUv.x * 0.5)).r;
  float a = vData.x * fade * edge * streak * grain;
  vec3 rubber = vec3(0.018, 0.018, 0.02);
  vec3 wet = vec3(0.5, 0.53, 0.58);
  vec3 col = mix(rubber, wet, vData.y);
  a *= mix(1.0, 0.4, vData.y);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Range {
  start: number;
  count: number;
}

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly position: THREE.BufferAttribute;
  private readonly data: THREE.BufferAttribute;
  private readonly uvAttr: THREE.BufferAttribute;
  private readonly pos: Float32Array;
  private readonly dat: Float32Array;
  private readonly uv: Float32Array;

  private readonly slots: number;
  private readonly drySegs: number;
  private readonly wetSegs: number;
  private readonly wetBase: number;

  private readonly head: Int32Array;
  private readonly wetHead: Int32Array;
  private readonly hasPrev: Uint8Array;
  private readonly prev: Float32Array;
  private readonly prevAlpha: Float32Array;
  private readonly dist: Float32Array;
  private readonly wetHasPrev: Uint8Array;
  private readonly wetPrev: Float32Array;
  private readonly wetTimer: Float32Array;
  private readonly baseAlpha: Float32Array;

  private readonly poolPos: Range[] = [];
  private readonly poolDat: Range[] = [];
  private readonly poolUv: Range[] = [];
  private usedPos = 0;
  private usedDat = 0;
  private usedUv = 0;
  private fullUpload = true;

  constructor(slots: number, drySegs: number, wetSegs: number, noise: THREE.Texture) {
    this.slots = slots;
    this.drySegs = drySegs;
    this.wetSegs = wetSegs;
    this.wetBase = slots * drySegs;
    const quads = slots * (drySegs + wetSegs);
    const verts = quads * 4;
    this.pos = new Float32Array(verts * 3);
    this.dat = new Float32Array(verts * 4);
    this.uv = new Float32Array(verts * 2);
    const index = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      const o = q * 6;
      index[o] = v;
      index[o + 1] = v + 1;
      index[o + 2] = v + 2;
      index[o + 3] = v;
      index[o + 4] = v + 2;
      index[o + 5] = v + 3;
    }
    for (let v = 0; v < verts; v += 4) {
      this.uv[v * 2] = 0;
      this.uv[(v + 1) * 2] = 1;
      this.uv[(v + 2) * 2] = 1;
      this.uv[(v + 3) * 2] = 0;
    }
    this.geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.data = new THREE.BufferAttribute(this.dat, 4).setUsage(THREE.DynamicDrawUsage);
    this.uvAttr = new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('aData', this.data);
    this.geometry.setAttribute('uv', this.uvAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uNoise: { value: noise }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'vfx-skidmarks';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;

    this.head = new Int32Array(slots);
    this.wetHead = new Int32Array(slots);
    this.hasPrev = new Uint8Array(slots);
    this.prev = new Float32Array(slots * 6);
    this.prevAlpha = new Float32Array(slots);
    this.dist = new Float32Array(slots);
    this.wetHasPrev = new Uint8Array(slots);
    this.wetPrev = new Float32Array(slots * 6);
    this.wetTimer = new Float32Array(slots);
    this.baseAlpha = new Float32Array(slots * drySegs);
    const poolSize = 1024;
    for (let i = 0; i < poolSize; i++) {
      this.poolPos.push({ start: 0, count: 0 });
      this.poolDat.push({ start: 0, count: 0 });
      this.poolUv.push({ start: 0, count: 0 });
    }
  }

  clear(): void {
    this.dat.fill(0);
    this.head.fill(0);
    this.wetHead.fill(0);
    this.hasPrev.fill(0);
    this.wetHasPrev.fill(0);
    this.dist.fill(0);
    this.wetTimer.fill(0);
    this.baseAlpha.fill(0);
    this.fullUpload = true;
  }

  private rangePos(start: number, count: number): void {
    if (this.usedPos >= this.poolPos.length) {
      this.fullUpload = true;
      return;
    }
    const r = this.poolPos[this.usedPos++];
    r.start = start;
    r.count = count;
    this.position.updateRanges.push(r);
  }

  private rangeDat(start: number, count: number): void {
    if (this.usedDat >= this.poolDat.length) {
      this.fullUpload = true;
      return;
    }
    const r = this.poolDat[this.usedDat++];
    r.start = start;
    r.count = count;
    this.data.updateRanges.push(r);
  }

  private rangeUv(start: number, count: number): void {
    if (this.usedUv >= this.poolUv.length) {
      this.fullUpload = true;
      return;
    }
    const r = this.poolUv[this.usedUv++];
    r.start = start;
    r.count = count;
    this.uvAttr.updateRanges.push(r);
  }

  private writeQuad(
    q: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
    alphaPrev: number,
    alphaCur: number,
    tint: number,
    birth: number,
    fadeTime: number,
    vPrev: number,
    vCur: number,
  ): void {
    const v0 = q * 4;
    const p = this.pos;
    let o = v0 * 3;
    p[o++] = ax;
    p[o++] = ay;
    p[o++] = az;
    p[o++] = bx;
    p[o++] = by;
    p[o++] = bz;
    p[o++] = cx;
    p[o++] = cy;
    p[o++] = cz;
    p[o++] = dx;
    p[o++] = dy;
    p[o] = dz;
    const d = this.dat;
    o = v0 * 4;
    for (let k = 0; k < 4; k++) {
      d[o++] = k < 2 ? alphaPrev : alphaCur;
      d[o++] = tint;
      d[o++] = birth;
      d[o++] = fadeTime;
    }
    const u = this.uv;
    o = v0 * 2;
    u[o + 1] = vPrev;
    u[o + 3] = vPrev;
    u[o + 5] = vCur;
    u[o + 7] = vCur;
    this.rangePos(v0 * 3, 12);
    this.rangeDat(v0 * 4, 16);
    this.rangeUv(v0 * 2, 8);
  }

  private setQuadAlpha(q: number, alpha: number): void {
    const o = q * 16;
    const d = this.dat;
    d[o] = alpha;
    d[o + 4] = alpha;
    d[o + 8] = alpha;
    d[o + 12] = alpha;
    this.rangeDat(o, 16);
  }

  /** Continue (or start) a dry rubber strip for `slot` at the contact patch edge points L/R. Call `endDry` when sliding stops. */
  layDry(slot: number, lx: number, ly: number, lz: number, rx: number, ry: number, rz: number, alpha: number, speed: number): void {
    if (slot < 0 || slot >= this.slots) return;
    const p6 = slot * 6;
    const prev = this.prev;
    if (!this.hasPrev[slot]) {
      prev[p6] = lx;
      prev[p6 + 1] = ly;
      prev[p6 + 2] = lz;
      prev[p6 + 3] = rx;
      prev[p6 + 4] = ry;
      prev[p6 + 5] = rz;
      this.prevAlpha[slot] = 0;
      this.hasPrev[slot] = 1;
      return;
    }
    const mx = (lx + rx) * 0.5 - (prev[p6] + prev[p6 + 3]) * 0.5;
    const mz = (lz + rz) * 0.5 - (prev[p6 + 2] + prev[p6 + 5]) * 0.5;
    const seg = Math.sqrt(mx * mx + mz * mz);
    const spacing = Math.max(0.35, speed * 0.028);
    if (seg < spacing) return;
    if (seg > 12) {
      // Teleport / reset: restart the strip.
      this.hasPrev[slot] = 0;
      this.layDry(slot, lx, ly, lz, rx, ry, rz, alpha, speed);
      return;
    }
    const h = this.head[slot];
    const q = slot * this.drySegs + h;
    const vPrev = this.dist[slot];
    const vCur = vPrev + seg;
    this.dist[slot] = vCur;
    this.writeQuad(q, prev[p6], prev[p6 + 1], prev[p6 + 2], prev[p6 + 3], prev[p6 + 4], prev[p6 + 5], rx, ry, rz, lx, ly, lz, this.prevAlpha[slot], alpha, 0, 0, 0, vPrev, vCur);
    this.baseAlpha[q] = alpha;
    // Progressive fade of the oldest quads just ahead of the head.
    for (let j = 1; j <= FADE_TAIL; j++) {
      const idx = (h + j) % this.drySegs;
      const qq = slot * this.drySegs + idx;
      const base = this.baseAlpha[qq];
      if (base > 0) this.setQuadAlpha(qq, (base * (j - 1)) / FADE_TAIL);
    }
    this.head[slot] = (h + 1) % this.drySegs;
    prev[p6] = lx;
    prev[p6 + 1] = ly;
    prev[p6 + 2] = lz;
    prev[p6 + 3] = rx;
    prev[p6 + 4] = ry;
    prev[p6 + 5] = rz;
    this.prevAlpha[slot] = alpha;
  }

  endDry(slot: number): void {
    if (slot >= 0 && slot < this.slots) this.hasPrev[slot] = 0;
  }

  /** Wet tyre track: time-spaced quads that fade over `fadeTime`. */
  layWet(slot: number, lx: number, ly: number, lz: number, rx: number, ry: number, rz: number, alpha: number, time: number, dt: number, fadeTime = 2): void {
    if (slot < 0 || slot >= this.slots) return;
    const p6 = slot * 6;
    const prev = this.wetPrev;
    if (!this.wetHasPrev[slot]) {
      prev[p6] = lx;
      prev[p6 + 1] = ly;
      prev[p6 + 2] = lz;
      prev[p6 + 3] = rx;
      prev[p6 + 4] = ry;
      prev[p6 + 5] = rz;
      this.wetHasPrev[slot] = 1;
      this.wetTimer[slot] = 0;
      return;
    }
    this.wetTimer[slot] += dt;
    if (this.wetTimer[slot] < 0.05) return;
    this.wetTimer[slot] = 0;
    const mx = (lx + rx) * 0.5 - (prev[p6] + prev[p6 + 3]) * 0.5;
    const mz = (lz + rz) * 0.5 - (prev[p6 + 2] + prev[p6 + 5]) * 0.5;
    const seg2 = mx * mx + mz * mz;
    if (seg2 > 144) {
      this.wetHasPrev[slot] = 0;
      return;
    }
    if (seg2 < 0.0025) return;
    const h = this.wetHead[slot];
    const q = this.wetBase + slot * this.wetSegs + h;
    this.writeQuad(q, prev[p6], prev[p6 + 1], prev[p6 + 2], prev[p6 + 3], prev[p6 + 4], prev[p6 + 5], rx, ry, rz, lx, ly, lz, alpha, alpha, 1, time, fadeTime, 0, Math.sqrt(seg2));
    this.wetHead[slot] = (h + 1) % this.wetSegs;
    prev[p6] = lx;
    prev[p6 + 1] = ly;
    prev[p6 + 2] = lz;
    prev[p6 + 3] = rx;
    prev[p6 + 4] = ry;
    prev[p6 + 5] = rz;
  }

  endWet(slot: number): void {
    if (slot >= 0 && slot < this.slots) this.wetHasPrev[slot] = 0;
  }

  /** Flush pending attribute ranges. Call once per frame after all lay* calls. */
  commit(time: number): void {
    this.material.uniforms.uTime.value = time;
    if (this.fullUpload) {
      this.position.updateRanges.length = 0;
      this.data.updateRanges.length = 0;
      this.uvAttr.updateRanges.length = 0;
      this.position.needsUpdate = true;
      this.data.needsUpdate = true;
      this.uvAttr.needsUpdate = true;
      this.fullUpload = false;
    } else {
      if (this.usedPos > 0) this.position.needsUpdate = true;
      if (this.usedDat > 0) this.data.needsUpdate = true;
      if (this.usedUv > 0) this.uvAttr.needsUpdate = true;
    }
    this.usedPos = 0;
    this.usedDat = 0;
    this.usedUv = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
