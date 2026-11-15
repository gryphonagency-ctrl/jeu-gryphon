/**
 * Reusable instanced billboard particle system: ONE draw call per system, CPU simulation into preallocated
 * typed-array instance attributes (dense swap-remove so instanceCount == alive and the upload range is minimal).
 */
import * as THREE from 'three';

export type BlendMode = 'additive' | 'alpha';

export interface ParticleSystemOptions {
  name: string;
  capacity: number;
  texture: THREE.Texture;
  blend: BlendMode;
  /** m/s² downward. */
  gravity?: number;
  /** Linear drag (1/s). */
  drag?: number;
  /** m/s² upward (smoke). */
  buoyancy?: number;
  /** 0..1 coupling to the wind velocity. */
  wind?: number;
  /** Restitution on ground contact; negative = no ground collision. */
  bounce?: number;
  /** Fraction of horizontal velocity kept on each bounce. */
  friction?: number;
  /** Billboard length added per m/s of view-space velocity (0 = round, rotating sprite). */
  stretch?: number;
  /** Speed (m/s) beyond which the stretch stops growing. */
  stretchMax?: number;
  /** Size multiplier at birth / death. */
  sizeOverLife?: [number, number];
  /** Fraction of life spent fading in / fading out. */
  fade?: [number, number];
  /** 0..1 how much the fake sphere lighting affects the sprite. */
  lit?: number;
  /** Fade sprites that get closer to the camera than this (m). */
  softNear?: number;
  /** Horizontal wobble amplitude (m/s²) for confetti/leaves. */
  flutter?: number;
  /** Lay quads flat on the ground instead of camera facing. */
  ground?: boolean;
  /** Attributes are written directly by the owner each frame (no ageing/simulation). */
  manual?: boolean;
  renderOrder?: number;
  depthTest?: boolean;
}

/** Shared spawn scratch: emitters fill this then call `system.spawn()`. Never allocated per frame. */
export const SP = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  life: 1,
  size: 1,
  r: 1,
  g: 1,
  b: 1,
  a: 1,
  rot: 0,
  rotSpeed: 0,
  /** Ground plane under the particle: y = gC + gX·x + gZ·z. */
  gC: -1e9,
  gX: 0,
  gZ: 0,
};

/** Per-frame simulation environment shared by all systems. */
export const SIM_ENV = {
  windX: 0,
  windZ: 0,
  time: 0,
};

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aData;   // t (0..1), size, rotation, seed
attribute vec4 aColor;
uniform float uStretch;
uniform float uStretchMax;
uniform vec2 uSizeOverLife;
uniform vec2 uFade;
uniform float uSoftNear;
uniform float uGround;
varying vec2 vUv;
varying vec4 vColor;
varying float vSeed;

void main() {
  float t = aData.x;
  float size = aData.y * mix(uSizeOverLife.x, uSizeOverLife.y, t);
  float fadeIn = uFade.x > 0.0 ? smoothstep(0.0, uFade.x, t) : 1.0;
  float fadeOut = uFade.y > 0.0 ? 1.0 - smoothstep(1.0 - uFade.y, 1.0, t) : 1.0;
  vec2 corner = position.xy;
  float c = cos(aData.z);
  float s = sin(aData.z);
  vec4 mv;
  if (uGround > 0.5) {
    vec3 wp = aPos + vec3(c * corner.x - s * corner.y, 0.0, s * corner.x + c * corner.y) * size;
    mv = modelViewMatrix * vec4(wp, 1.0);
  } else {
    mv = modelViewMatrix * vec4(aPos, 1.0);
    vec2 axisX;
    vec2 axisY;
    float len = size;
    if (uStretch > 0.0) {
      vec3 vv = (modelViewMatrix * vec4(aVel, 0.0)).xyz;
      float sp = length(vv.xy);
      vec2 dir = sp > 1e-3 ? vv.xy / sp : vec2(0.0, 1.0);
      axisY = dir;
      axisX = vec2(dir.y, -dir.x);
      len = size + uStretch * min(sp, uStretchMax);
    } else {
      axisX = vec2(c, s);
      axisY = vec2(-s, c);
    }
    mv.xy += axisX * (corner.x * size) + axisY * (corner.y * len);
  }
  gl_Position = projectionMatrix * mv;
  float near = uSoftNear > 0.0 ? smoothstep(0.0, uSoftNear, -mv.z) : 1.0;
  vUv = uv;
  vColor = vec4(aColor.rgb, aColor.a * fadeIn * fadeOut * near);
  vSeed = aData.w;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uLit;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
varying vec2 vUv;
varying vec4 vColor;
varying float vSeed;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  float alpha = tex.a * vColor.a;
  if (alpha < 0.004) discard;
  vec3 col = vColor.rgb * tex.rgb;
  if (uLit > 0.0) {
    vec2 c = vUv * 2.0 - 1.0;
    float r2 = min(1.0, dot(c, c));
    vec3 n = normalize(vec3(c * 0.85, sqrt(1.0 - r2 * 0.7)));
    float ndl = dot(n, uSunDir);
    float wrap = max(0.0, ndl) * 0.7 + max(0.0, ndl * 0.5 + 0.5) * 0.3;
    // Thicker centre of the puff is darker (self shadowing), rims stay bright.
    float thick = 1.0 - 0.08 * (1.0 - r2) * tex.a;
    vec3 light = (uAmbient + uSunColor * wrap) * thick;
    col = mix(col, col * light, uLit);
  }
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const CPU_STRIDE = 8; // age, life, rotSpeed, gC, gX, gZ, grounded, flutterPhase

export class ParticleSystem {
  readonly name: string;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geometry: THREE.InstancedBufferGeometry;
  private capacity: number;
  private alive = 0;
  private cursor = 0;

  private pos!: Float32Array;
  private vel!: Float32Array;
  private data!: Float32Array;
  private color!: Float32Array;
  private cpu!: Float32Array;
  private aPos!: THREE.InstancedBufferAttribute;
  private aVel!: THREE.InstancedBufferAttribute;
  private aData!: THREE.InstancedBufferAttribute;
  private aColor!: THREE.InstancedBufferAttribute;
  private readonly ranges = [
    { start: 0, count: 0 },
    { start: 0, count: 0 },
    { start: 0, count: 0 },
    { start: 0, count: 0 },
  ];

  private readonly gravity: number;
  private readonly drag: number;
  private readonly buoyancy: number;
  private readonly wind: number;
  private readonly bounce: number;
  private readonly friction: number;
  private readonly flutter: number;
  private readonly manual: boolean;

  constructor(opts: ParticleSystemOptions) {
    this.name = opts.name;
    this.capacity = Math.max(4, opts.capacity | 0);
    this.gravity = opts.gravity ?? 0;
    this.drag = opts.drag ?? 0;
    this.buoyancy = opts.buoyancy ?? 0;
    this.wind = opts.wind ?? 0;
    this.bounce = opts.bounce ?? -1;
    this.friction = opts.friction ?? 0.6;
    this.flutter = opts.flutter ?? 0;
    this.manual = !!opts.manual;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMap: { value: opts.texture },
        uStretch: { value: opts.stretch ?? 0 },
        uStretchMax: { value: opts.stretchMax ?? 60 },
        uSizeOverLife: { value: new THREE.Vector2(opts.sizeOverLife?.[0] ?? 1, opts.sizeOverLife?.[1] ?? 1) },
        uFade: { value: new THREE.Vector2(opts.fade?.[0] ?? 0.1, opts.fade?.[1] ?? 0.4) },
        uSoftNear: { value: opts.softNear ?? 0 },
        uGround: { value: opts.ground ? 1 : 0 },
        uLit: { value: opts.lit ?? 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Vector3(1, 1, 1) },
        uAmbient: { value: new THREE.Vector3(0.4, 0.4, 0.4) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: opts.depthTest ?? true,
      blending: opts.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

    this.geometry = this.buildGeometry(this.capacity);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = `vfx-${opts.name}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 10;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  get count(): number {
    return this.alive;
  }

  get max(): number {
    return this.capacity;
  }

  private buildGeometry(capacity: number): THREE.InstancedBufferGeometry {
    const g = new THREE.InstancedBufferGeometry();
    const quad = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
    const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    g.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);

    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.data = new Float32Array(capacity * 4);
    this.color = new Float32Array(capacity * 4);
    this.cpu = new Float32Array(capacity * CPU_STRIDE);
    this.bufs.pos = this.pos;
    this.bufs.vel = this.vel;
    this.bufs.data = this.data;
    this.bufs.color = this.color;
    this.bufs.capacity = capacity;

    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos);
    g.setAttribute('aVel', this.aVel);
    g.setAttribute('aData', this.aData);
    g.setAttribute('aColor', this.aColor);
    g.instanceCount = 0;
    // Huge bounding sphere so three never culls the system (frustumCulled=false already, but keep raycasts sane).
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }

  /** Live re-allocation for quality changes. Keeps as many alive particles as fit. */
  setCapacity(capacity: number): void {
    capacity = Math.max(4, capacity | 0);
    if (capacity === this.capacity) return;
    const oldPos = this.pos;
    const oldVel = this.vel;
    const oldData = this.data;
    const oldColor = this.color;
    const oldCpu = this.cpu;
    const keep = Math.min(this.alive, capacity);
    const old = this.geometry;
    this.capacity = capacity;
    this.geometry = this.buildGeometry(capacity);
    this.pos.set(oldPos.subarray(0, keep * 3));
    this.vel.set(oldVel.subarray(0, keep * 3));
    this.data.set(oldData.subarray(0, keep * 4));
    this.color.set(oldColor.subarray(0, keep * 4));
    this.cpu.set(oldCpu.subarray(0, keep * CPU_STRIDE));
    this.alive = keep;
    this.cursor = keep % capacity;
    this.mesh.geometry = this.geometry;
    old.dispose();
    this.markAll();
  }

  clear(): void {
    this.alive = 0;
    this.cursor = 0;
    this.geometry.instanceCount = 0;
  }

  /** Spawn from `SP`. When full, the round-robin slot is recycled. */
  spawn(): void {
    let i: number;
    if (this.alive < this.capacity) {
      i = this.alive++;
    } else {
      i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
    }
    this.write(i);
  }

  private write(i: number): void {
    const p = SP;
    const i3 = i * 3;
    const i4 = i * 4;
    const ic = i * CPU_STRIDE;
    const pos = this.pos;
    const vel = this.vel;
    const data = this.data;
    const color = this.color;
    const cpu = this.cpu;
    pos[i3] = p.x;
    pos[i3 + 1] = p.y;
    pos[i3 + 2] = p.z;
    vel[i3] = p.vx;
    vel[i3 + 1] = p.vy;
    vel[i3 + 2] = p.vz;
    data[i4] = 0;
    data[i4 + 1] = p.size;
    data[i4 + 2] = p.rot;
    data[i4 + 3] = Math.random();
    color[i4] = p.r;
    color[i4 + 1] = p.g;
    color[i4 + 2] = p.b;
    color[i4 + 3] = p.a;
    cpu[ic] = 0;
    cpu[ic + 1] = Math.max(0.016, p.life);
    cpu[ic + 2] = p.rotSpeed;
    cpu[ic + 3] = p.gC;
    cpu[ic + 4] = p.gX;
    cpu[ic + 5] = p.gZ;
    cpu[ic + 6] = 0;
    cpu[ic + 7] = Math.random() * 6.2831;
  }

  /** Manual mode: write particle `i` directly (position, size, colour). Call setCount() afterwards. */
  set(i: number, x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number, rot = 0): void {
    if (i >= this.capacity) return;
    const i3 = i * 3;
    const i4 = i * 4;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.data[i4] = 0;
    this.data[i4 + 1] = size;
    this.data[i4 + 2] = rot;
    this.color[i4] = r;
    this.color[i4 + 1] = g;
    this.color[i4 + 2] = b;
    this.color[i4 + 3] = a;
  }

  /** Manual mode: set how many of the directly written particles are drawn. */
  setCount(n: number): void {
    this.alive = Math.min(this.capacity, Math.max(0, n | 0));
  }

  setLighting(sunDirView: THREE.Vector3, sunColor: THREE.Vector3, ambient: THREE.Vector3): void {
    const u = this.material.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(sunDirView);
    (u.uSunColor.value as THREE.Vector3).copy(sunColor);
    (u.uAmbient.value as THREE.Vector3).copy(ambient);
  }

  private kill(i: number): void {
    const last = this.alive - 1;
    if (i !== last) {
      const pos = this.pos;
      const vel = this.vel;
      const data = this.data;
      const color = this.color;
      const cpu = this.cpu;
      const a3 = i * 3;
      const b3 = last * 3;
      pos[a3] = pos[b3];
      pos[a3 + 1] = pos[b3 + 1];
      pos[a3 + 2] = pos[b3 + 2];
      vel[a3] = vel[b3];
      vel[a3 + 1] = vel[b3 + 1];
      vel[a3 + 2] = vel[b3 + 2];
      const a4 = i * 4;
      const b4 = last * 4;
      data[a4] = data[b4];
      data[a4 + 1] = data[b4 + 1];
      data[a4 + 2] = data[b4 + 2];
      data[a4 + 3] = data[b4 + 3];
      color[a4] = color[b4];
      color[a4 + 1] = color[b4 + 1];
      color[a4 + 2] = color[b4 + 2];
      color[a4 + 3] = color[b4 + 3];
      const ac = i * CPU_STRIDE;
      const bc = last * CPU_STRIDE;
      for (let k = 0; k < CPU_STRIDE; k++) cpu[ac + k] = cpu[bc + k];
    }
    this.alive = last;
    if (this.cursor >= this.alive) this.cursor = 0;
  }

  /** Advance the simulation by dt and upload the used range. */
  update(dt: number): void {
    if (!this.manual && dt > 0 && this.alive > 0) this.simulate(dt);
    this.upload();
  }

  private simulate(dt: number): void {
    const pos = this.pos;
    const vel = this.vel;
    const data = this.data;
    const cpu = this.cpu;
    const g = this.gravity - this.buoyancy;
    const dragK = Math.max(0, 1 - this.drag * dt);
    const windK = this.wind * dt;
    const windX = SIM_ENV.windX;
    const windZ = SIM_ENV.windZ;
    const bounce = this.bounce;
    const friction = this.friction;
    const flutter = this.flutter;
    const time = SIM_ENV.time;
    let i = 0;
    while (i < this.alive) {
      const ic = i * CPU_STRIDE;
      const age = cpu[ic] + dt;
      const life = cpu[ic + 1];
      if (age >= life) {
        this.kill(i);
        continue;
      }
      cpu[ic] = age;
      const i3 = i * 3;
      const i4 = i * 4;
      data[i4] = age / life;
      data[i4 + 2] += cpu[ic + 2] * dt;

      let vx = vel[i3];
      let vy = vel[i3 + 1];
      let vz = vel[i3 + 2];
      if (cpu[ic + 6] > 0.5) {
        // Resting on the ground (confetti / debris): only friction.
        vx *= dragK;
        vz *= dragK;
        vy = 0;
      } else {
        vy -= g * dt;
        vx *= dragK;
        vy *= dragK;
        vz *= dragK;
        if (windK > 0) {
          vx += (windX - vx) * windK;
          vz += (windZ - vz) * windK;
        }
        if (flutter > 0) {
          const ph = cpu[ic + 7];
          vx += Math.sin(time * 5.3 + ph) * flutter * dt;
          vz += Math.cos(time * 4.1 + ph * 1.7) * flutter * dt;
          vy += Math.sin(time * 7.0 + ph * 2.3) * flutter * 0.5 * dt;
        }
      }
      let x = pos[i3] + vx * dt;
      let y = pos[i3 + 1] + vy * dt;
      let z = pos[i3 + 2] + vz * dt;
      if (bounce >= 0) {
        const gc = cpu[ic + 3];
        if (gc > -1e8) {
          const gy = gc + cpu[ic + 4] * x + cpu[ic + 5] * z;
          const lift = data[i4 + 1] * 0.25;
          if (y < gy + lift) {
            y = gy + lift;
            if (vy < 0) {
              if (-vy < 0.8 || bounce < 0.05) {
                vy = 0;
                cpu[ic + 6] = 1;
                cpu[ic + 2] = 0;
                vx *= friction;
                vz *= friction;
              } else {
                vy = -vy * bounce;
                vx *= friction;
                vz *= friction;
                cpu[ic + 2] *= 0.6;
              }
            }
          }
        }
      }
      pos[i3] = x;
      pos[i3 + 1] = y;
      pos[i3 + 2] = z;
      vel[i3] = vx;
      vel[i3 + 1] = vy;
      vel[i3 + 2] = vz;
      i++;
    }
  }

  private markAll(): void {
    this.upload(true);
  }

  private upload(all = false): void {
    const n = all ? this.capacity : this.alive;
    this.geometry.instanceCount = this.alive;
    if (n === 0) return;
    this.mark(this.aPos, this.ranges[0], n * 3);
    this.mark(this.aVel, this.ranges[1], n * 3);
    this.mark(this.aData, this.ranges[2], n * 4);
    this.mark(this.aColor, this.ranges[3], n * 4);
  }

  private mark(attr: THREE.InstancedBufferAttribute, range: { start: number; count: number }, count: number): void {
    range.start = 0;
    range.count = count;
    attr.updateRanges.length = 0;
    attr.updateRanges.push(range);
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }

  /** Direct typed-array access for subclasses with custom simulation (rain). Object is stable; arrays change on setCapacity. */
  protected readonly bufs: { pos: Float32Array; vel: Float32Array; data: Float32Array; color: Float32Array; capacity: number } = {
    pos: new Float32Array(0),
    vel: new Float32Array(0),
    data: new Float32Array(0),
    color: new Float32Array(0),
    capacity: 0,
  };

  protected setAliveRaw(n: number): void {
    this.alive = Math.min(this.capacity, Math.max(0, n | 0));
  }

  protected uploadRaw(): void {
    this.upload();
  }
}
