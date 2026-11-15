import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualityLevel } from '../core/constants';
import { Rng } from '../core/math';
import type { TrackSample, TrackSpline } from '../core/track/TrackSpline';
import type { TrackDefinition, TrackTheme } from '../core/types';
import type { ThemePalette } from './themes';
import type { TextureLib } from './textures';
import type { SharedUniforms } from './materials';

export const yieldFrame = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export const makeScratchSample = (): TrackSample => ({
  s: 0,
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  left: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  width: 0,
  curvature: 0,
  grade: 0,
  heading: 0,
  kerbL: false,
  kerbR: false,
  runoffL: 'grass',
  runoffR: 'grass',
  barrierL: 0,
  barrierR: 0,
  sector: 0,
  cpIndex: 0,
});

/** 0 = full day, 1 = full night. */
export const nightFactor = (timeOfDay: number): number => {
  const t = ((timeOfDay % 24) + 24) % 24;
  if (t >= 7 && t <= 17.5) return 0;
  if (t > 17.5 && t < 20.5) return (t - 17.5) / 3;
  if (t >= 20.5 || t < 5) return 1;
  return 1 - (t - 5) / 2;
};

/** Cheap deterministic 2D value noise (0..1). */
const hash2 = (x: number, y: number): number => {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
};
export const valueNoise = (x: number, y: number): number => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
export const fbm = (x: number, y: number, octaves = 4): number => {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x, y) * amp;
    norm += amp;
    x = x * 2.03 + 17.3;
    y = y * 1.97 + 9.1;
    amp *= 0.5;
  }
  return sum / norm;
};

export interface BuildCtx {
  def: TrackDefinition;
  track: TrackSpline;
  theme: TrackTheme;
  palette: ThemePalette;
  quality: QualityLevel;
  rng: Rng;
  root: THREE.Group;
  tex: TextureLib;
  uniforms: SharedUniforms;
  disposer: Disposer;
  shadows: boolean;
  /** Materials & meshes that need per-frame or quality attention. */
  night: NightItem[];
  crowdMeshes: THREE.InstancedMesh[];
  treeMeshes: THREE.InstancedMesh[];
  detailObjects: THREE.Object3D[];
  shadowCasters: THREE.Object3D[];
  animators: Animator[];
  progress: (p: number, label: string) => void;
}

export interface Animator {
  update(time: number, dt: number, night: number): void;
}

export interface NightItem {
  material: THREE.MeshStandardMaterial;
  dayIntensity: number;
  nightIntensity: number;
}

/** Tracks GPU resources for one build so dispose() can free everything. */
export class Disposer {
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private textures = new Set<THREE.Texture>();

  geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.add(g);
    return g;
  }
  mat<T extends THREE.Material>(m: T): T {
    this.materials.add(m);
    return m;
  }
  tex<T extends THREE.Texture>(t: T): T {
    this.textures.add(t);
    return t;
  }
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
  }
}

/**
 * Accumulates triangles into flat arrays and produces an indexed BufferGeometry.
 * Supports optional vertex colours and one extra vec4 attribute (used by the asphalt shader).
 */
export class GeoBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] | null;
  extra: number[] | null;
  indices: number[] = [];
  private readonly extraName: string;

  constructor(opts: { colors?: boolean; extra?: string } = {}) {
    this.colors = opts.colors ? [] : null;
    this.extra = opts.extra ? [] : null;
    this.extraName = opts.extra ?? '';
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, r = 1, g = 1, b = 1, e0 = 0, e1 = 0, e2 = 0, e3 = 0): number {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    if (this.colors) this.colors.push(r, g, b);
    if (this.extra) this.extra.push(e0, e1, e2, e3);
    return this.vertexCount - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  /** Connect two rows of equal vertex count (row A first index, row B first index). */
  stitch(rowA: number, rowB: number, count: number): void {
    for (let i = 0; i < count - 1; i++) {
      const a = rowA + i;
      const b = rowB + i;
      this.indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  /** Axis-aligned-ish quad from 4 world points (counter-clockwise seen from the normal side). */
  face(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, uv: [number, number, number, number] = [0, 0, 1, 1], color?: THREE.Color): void {
    _e1.subVectors(p1, p0);
    _e2.subVectors(p3, p0);
    _n.crossVectors(_e1, _e2).normalize();
    const r = color ? color.r : 1;
    const g = color ? color.g : 1;
    const b = color ? color.b : 1;
    const i0 = this.vertex(p0.x, p0.y, p0.z, _n.x, _n.y, _n.z, uv[0], uv[1], r, g, b);
    this.vertex(p1.x, p1.y, p1.z, _n.x, _n.y, _n.z, uv[2], uv[1], r, g, b);
    this.vertex(p2.x, p2.y, p2.z, _n.x, _n.y, _n.z, uv[2], uv[3], r, g, b);
    this.vertex(p3.x, p3.y, p3.z, _n.x, _n.y, _n.z, uv[0], uv[3], r, g, b);
    this.quad(i0, i0 + 1, i0 + 2, i0 + 3);
  }

  /** Box between min & max corners, optional per-face uv scale (metres per tile). */
  box(min: THREE.Vector3, max: THREE.Vector3, uvScale = 1, color?: THREE.Color, faces: { top?: boolean; bottom?: boolean } = {}): void {
    const { x: x0, y: y0, z: z0 } = min;
    const { x: x1, y: y1, z: z1 } = max;
    const sx = (x1 - x0) / uvScale;
    const sy = (y1 - y0) / uvScale;
    const sz = (z1 - z0) / uvScale;
    // +z
    this.face(_p[0].set(x0, y0, z1), _p[1].set(x1, y0, z1), _p[2].set(x1, y1, z1), _p[3].set(x0, y1, z1), [0, 0, sx, sy], color);
    // -z
    this.face(_p[0].set(x1, y0, z0), _p[1].set(x0, y0, z0), _p[2].set(x0, y1, z0), _p[3].set(x1, y1, z0), [0, 0, sx, sy], color);
    // +x
    this.face(_p[0].set(x1, y0, z1), _p[1].set(x1, y0, z0), _p[2].set(x1, y1, z0), _p[3].set(x1, y1, z1), [0, 0, sz, sy], color);
    // -x
    this.face(_p[0].set(x0, y0, z0), _p[1].set(x0, y0, z1), _p[2].set(x0, y1, z1), _p[3].set(x0, y1, z0), [0, 0, sz, sy], color);
    if (faces.top !== false) this.face(_p[0].set(x0, y1, z1), _p[1].set(x1, y1, z1), _p[2].set(x1, y1, z0), _p[3].set(x0, y1, z0), [0, 0, sx, sz], color);
    if (faces.bottom) this.face(_p[0].set(x0, y0, z0), _p[1].set(x1, y0, z0), _p[2].set(x1, y0, z1), _p[3].set(x0, y0, z1), [0, 0, sx, sz], color);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (this.extra) g.setAttribute(this.extraName, new THREE.Float32BufferAttribute(this.extra, 4));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  isEmpty(): boolean {
    return this.indices.length === 0;
  }
}

const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

/** Local frame along the track: along = tangent (XZ), lat = left, up = +Y. */
export class Frame {
  readonly origin = new THREE.Vector3();
  readonly fwd = new THREE.Vector3();
  readonly left = new THREE.Vector3();
  constructor(sm?: TrackSample) {
    if (sm) this.set(sm);
  }
  set(sm: TrackSample): this {
    this.origin.copy(sm.position);
    this.fwd.set(sm.tangent.x, 0, sm.tangent.z).normalize();
    this.left.copy(sm.left);
    return this;
  }
  to(along: number, up: number, lat: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.origin).addScaledVector(this.fwd, along).addScaledVector(this.left, lat).setY(this.origin.y + up);
  }
  yaw(): number {
    return Math.atan2(this.fwd.x, this.fwd.z);
  }
}

const _bc = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
/** Box in a local track frame: along [a0,a1], up [y0,y1], lateral [l0,l1]. Outward-facing faces. */
export const orientedBox = (gb: GeoBuilder, f: Frame, a0: number, a1: number, y0: number, y1: number, l0: number, l1: number, color?: THREE.Color, uvScale = 1, faces: { top?: boolean; bottom?: boolean; front?: boolean; back?: boolean; sides?: boolean } = {}): void => {
  if (l0 > l1) {
    const t = l0;
    l0 = l1;
    l1 = t;
  }
  if (a0 > a1) {
    const t = a0;
    a0 = a1;
    a1 = t;
  }
  // corners: index bit0 = along, bit1 = up, bit2 = lat
  for (let i = 0; i < 8; i++) f.to(i & 1 ? a1 : a0, i & 2 ? y1 : y0, i & 4 ? l1 : l0, _bc[i]);
  const la = (a1 - a0) / uvScale;
  const lu = (y1 - y0) / uvScale;
  const ll = (l1 - l0) / uvScale;
  // +lat face (left side) normal = +left : corners with bit2 set: 4,5,6,7 → (a0,y0)=4,(a1,y0)=5,(a1,y1)=7,(a0,y1)=6 ; winding so normal = fwd x up? need (p1-p0)x(p3-p0) = +left: p1-p0 = fwd, p3-p0 = up → fwd x up = -left. So reverse.
  if (faces.sides !== false) {
    gb.face(_bc[5], _bc[4], _bc[6], _bc[7], [0, 0, la, lu], color); // +left
    gb.face(_bc[0], _bc[1], _bc[3], _bc[2], [0, 0, la, lu], color); // -left
  }
  if (faces.front !== false) gb.face(_bc[1], _bc[5], _bc[7], _bc[3], [0, 0, ll, lu], color); // +along
  if (faces.back !== false) gb.face(_bc[4], _bc[0], _bc[2], _bc[6], [0, 0, ll, lu], color); // -along
  if (faces.top !== false) gb.face(_bc[2], _bc[3], _bc[7], _bc[6], [0, 0, la, ll], color); // +up
  if (faces.bottom) gb.face(_bc[4], _bc[5], _bc[1], _bc[0], [0, 0, la, ll], color);
};

export const mergeGeos = (geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
  const valid = geos.filter((g) => g.getAttribute('position') && g.getAttribute('position').count > 0);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  const merged = mergeGeometries(valid, false);
  for (const g of valid) g.dispose();
  return merged;
};

/** Build an InstancedMesh from a list of matrices (and optional colours). */
export const instanced = (
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  matrices: THREE.Matrix4[],
  colors?: THREE.Color[],
  opts: { castShadow?: boolean; receiveShadow?: boolean } = {},
): THREE.InstancedMesh => {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  if (colors) for (let i = 0; i < matrices.length; i++) mesh.setColorAt(i, colors[i]);
  mesh.count = matrices.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = !!opts.castShadow;
  mesh.receiveShadow = opts.receiveShadow !== false;
  mesh.frustumCulled = false;
  return mesh;
};

export const matrixAt = (x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1, out = new THREE.Matrix4()): THREE.Matrix4 => {
  _q.setFromAxisAngle(_up, yaw);
  _sc.set(sx, sy, sz);
  _pos.set(x, y, z);
  return out.compose(_pos, _q, _sc);
};
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _sc = new THREE.Vector3();
const _pos = new THREE.Vector3();

export const stdMat = (d: Disposer, params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => d.mat(new THREE.MeshStandardMaterial(params));

export const qualityIndex = (q: QualityLevel): number => ({ low: 0, medium: 1, high: 2, ultra: 3 })[q];

export const shuffle = <T>(arr: T[], rng: Rng): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
};

/** Signed side of a corner at s: +1 the track turns left (inside = left), -1 right, 0 straight. */
export const turnSide = (curv: number, threshold = 1 / 600): number => (curv > threshold ? 1 : curv < -threshold ? -1 : 0);

/** Moving-average smoothing over a closed array. */
export const smoothClosed = (arr: number[], win: number): number[] => {
  const n = arr.length;
  const out = new Array<number>(n);
  let acc = 0;
  for (let j = -win; j <= win; j++) acc += arr[((j % n) + n) % n];
  for (let i = 0; i < n; i++) {
    out[i] = acc / (2 * win + 1);
    acc -= arr[(((i - win) % n) + n) % n];
    acc += arr[(i + win + 1) % n];
  }
  return out;
};
