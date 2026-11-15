/**
 * Procedural geometry helpers for the car model: lofts through cross-sections, aerofoil sections,
 * bevelled plates, mirroring, UV remapping and cheap arm orientation for the suspension.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type V2 = [number, number];
export type V3 = [number, number, number];
export interface UVRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export const FULL_UV: UVRect = { u0: 0, v0: 0, u1: 1, v1: 1 };

/** Monotone cubic (Fritsch–Carlson) interpolant through (x, y) keys — no overshoot, C1 smooth. */
export const monotone = (keys: V2[]): ((x: number) => number) => {
  const k = [...keys].sort((a, b) => a[0] - b[0]);
  const n = k.length;
  const xs = k.map((p) => p[0]);
  const ys = k.map((p) => p[1]);
  if (n === 1) return () => ys[0];
  const h: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    m.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const d = new Array<number>(n).fill(0);
  d[0] = m[0];
  d[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) d[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      d[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * d[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * d[i + 1];
  };
};

const cr = (p0: number, p1: number, p2: number, p3: number, t: number, tension: number): number => {
  const m1 = tension * (p2 - p0);
  const m2 = tension * (p3 - p1);
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
};

/** Point on a closed Catmull-Rom loop at parameter t in [0,1) (uniform parameterisation by control point). */
export const catmullClosedAt = (pts: V2[], t: number, tension = 0.5): V2 => {
  const n = pts.length;
  const u = ((t % 1) + 1) % 1;
  const s = u * n;
  const i = Math.floor(s) % n;
  const f = s - Math.floor(s);
  const p0 = pts[(i - 1 + n) % n];
  const p1 = pts[i];
  const p2 = pts[(i + 1) % n];
  const p3 = pts[(i + 2) % n];
  return [cr(p0[0], p1[0], p2[0], p3[0], f, tension), cr(p0[1], p1[1], p2[1], p3[1], f, tension)];
};

export const catmullClosed = (pts: V2[], samples: number, tension = 0.5): V2[] => {
  const out: V2[] = [];
  for (let s = 0; s < samples; s++) out.push(catmullClosedAt(pts, s / samples, tension));
  return out;
};

/** Open Catmull-Rom through the points, `samples` points including both ends. */
export const catmullOpen = (pts: V2[], samples: number, tension = 0.5): V2[] => {
  const n = pts.length;
  const out: V2[] = [];
  for (let s = 0; s < samples; s++) {
    const t = (s / (samples - 1)) * (n - 1);
    const i = Math.min(Math.floor(t), n - 2);
    const f = t - i;
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, n - 1)];
    out.push([cr(p0[0], p1[0], p2[0], p3[0], f, tension), cr(p0[1], p1[1], p2[1], p3[1], f, tension)]);
  }
  return out;
};

export interface LoftOpts {
  uv?: UVRect;
  /** Profile is a closed loop (default true). */
  closed?: boolean;
  /** Custom 0..1 parameter per station (maps to u). Default: uniform by index. */
  stationT?: number[];
  /** Outward reference direction; when given, orientation is decided by it instead of the station centres. */
  orientRef?: V3;
  /** Skip the automatic outward-orientation pass. */
  noOrient?: boolean;
}

const flipWinding = (geo: THREE.BufferGeometry): void => {
  const index = geo.getIndex();
  if (index) {
    const a = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    index.needsUpdate = true;
  } else {
    for (const name of ['position', 'normal', 'uv']) {
      const attr = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (!attr) continue;
      const arr = attr.array as Float32Array;
      const sz = attr.itemSize;
      for (let i = 0; i < attr.count; i += 3) {
        for (let c = 0; c < sz; c++) {
          const ia = (i + 1) * sz + c;
          const ib = (i + 2) * sz + c;
          const t = arr[ia];
          arr[ia] = arr[ib];
          arr[ib] = t;
        }
      }
      attr.needsUpdate = true;
    }
  }
};

/**
 * Loft a surface through stations. `stations[s][p]` is point p of station s; all stations share the point count.
 * u = station parameter, v = profile parameter, both mapped into `uv`. Normals are smoothed across the seam.
 */
export const loft = (stations: V3[][], opts: LoftOpts = {}): THREE.BufferGeometry => {
  const M = stations.length;
  const N = stations[0].length;
  const closed = opts.closed ?? true;
  const cols = closed ? N + 1 : N;
  const rect = opts.uv ?? FULL_UV;
  const pos = new Float32Array(M * cols * 3);
  const uv = new Float32Array(M * cols * 2);
  for (let s = 0; s < M; s++) {
    const st = opts.stationT ? opts.stationT[s] : s / (M - 1);
    const u = rect.u0 + st * (rect.u1 - rect.u0);
    for (let p = 0; p < cols; p++) {
      const pt = stations[s][p % N];
      const pf = closed ? p / N : p / (cols - 1);
      const i = s * cols + p;
      pos[i * 3] = pt[0];
      pos[i * 3 + 1] = pt[1];
      pos[i * 3 + 2] = pt[2];
      uv[i * 2] = u;
      uv[i * 2 + 1] = rect.v0 + pf * (rect.v1 - rect.v0);
    }
  }
  const idx: number[] = [];
  for (let s = 0; s < M - 1; s++) {
    for (let p = 0; p < cols - 1; p++) {
      const a = s * cols + p;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const finishNormals = () => {
    geo.computeVertexNormals();
    if (!closed) return;
    const n = geo.getAttribute('normal') as THREE.BufferAttribute;
    for (let s = 0; s < M; s++) {
      const a = s * cols;
      const b = a + N;
      let x = n.getX(a) + n.getX(b);
      let y = n.getY(a) + n.getY(b);
      let z = n.getZ(a) + n.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      x /= l;
      y /= l;
      z /= l;
      n.setXYZ(a, x, y, z);
      n.setXYZ(b, x, y, z);
    }
  };
  finishNormals();
  if (!opts.noOrient) {
    const n = geo.getAttribute('normal') as THREE.BufferAttribute;
    let dot = 0;
    if (opts.orientRef) {
      const r = opts.orientRef;
      for (let i = 0; i < n.count; i++) dot += n.getX(i) * r[0] + n.getY(i) * r[1] + n.getZ(i) * r[2];
    } else {
      for (let s = 0; s < M; s++) {
        let cx = 0;
        let cy = 0;
        let cz = 0;
        for (let p = 0; p < N; p++) {
          cx += stations[s][p][0];
          cy += stations[s][p][1];
          cz += stations[s][p][2];
        }
        cx /= N;
        cy /= N;
        cz /= N;
        for (let p = 0; p < cols; p++) {
          const i = s * cols + p;
          dot += n.getX(i) * (pos[i * 3] - cx) + n.getY(i) * (pos[i * 3 + 1] - cy) + n.getZ(i) * (pos[i * 3 + 2] - cz);
        }
      }
    }
    if (dot < 0) {
      flipWinding(geo);
      finishNormals();
    }
  }
  return geo;
};

/**
 * Closed aerofoil section in the (z, y) plane with the leading edge at the origin and the chord along -z.
 * Camber is inverted (downforce) and `alpha` raises the trailing edge. N points, N even.
 */
export const aerofoil = (N: number, chord: number, thick: number, camber: number, alpha: number, upperFirst: boolean): V2[] => {
  const half = N >> 1;
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  const surf = (x: number, upper: boolean): V2 => {
    const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
    const yc = -4 * camber * x * (1 - x);
    const y = (yc + (upper ? yt : -yt)) * chord;
    const z = -x * chord;
    return [z * ca + y * sa, -z * sa + y * ca];
  };
  const pts: V2[] = [];
  for (let i = 0; i <= half; i++) pts.push(surf(0.5 - 0.5 * Math.cos((Math.PI * i) / half), upperFirst));
  for (let i = half - 1; i >= 1; i--) pts.push(surf(0.5 - 0.5 * Math.cos((Math.PI * i) / half), !upperFirst));
  return pts;
};

export interface WingSpec {
  x0: number;
  x1: number;
  stations: number;
  N: number;
  thick: number;
  camber: number;
  upperFirst: boolean;
  uv: UVRect;
  chord: (x: number) => number;
  alpha: (x: number) => number;
  y: (x: number) => number;
  z: (x: number) => number;
}

/** Wing element lofted along X. */
export const wingLoft = (spec: WingSpec): THREE.BufferGeometry => {
  const st: V3[][] = [];
  for (let i = 0; i < spec.stations; i++) {
    const f = i / (spec.stations - 1);
    const x = spec.x0 + (spec.x1 - spec.x0) * f;
    const prof = aerofoil(spec.N, spec.chord(x), spec.thick, spec.camber, spec.alpha(x), spec.upperFirst);
    const y0 = spec.y(x);
    const z0 = spec.z(x);
    st.push(prof.map(([pz, py]) => [x, y0 + py, z0 + pz] as V3));
  }
  return loft(st, { uv: spec.uv, closed: true });
};

/** Polygon with rounded corners as a THREE.Shape. */
export const roundedShape = (pts: V2[], r: number): THREE.Shape => {
  const shape = new THREE.Shape();
  const n = pts.length;
  const corner = (i: number) => {
    const p = pts[i];
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, la * 0.5);
    const rb = Math.min(r, lb * 0.5);
    return {
      in: [p[0] + ((a[0] - p[0]) / la) * ra, p[1] + ((a[1] - p[1]) / la) * ra] as V2,
      out: [p[0] + ((b[0] - p[0]) / lb) * rb, p[1] + ((b[1] - p[1]) / lb) * rb] as V2,
      p,
    };
  };
  const c0 = corner(0);
  shape.moveTo(c0.out[0], c0.out[1]);
  for (let i = 1; i <= n; i++) {
    const c = corner(i % n);
    shape.lineTo(c.in[0], c.in[1]);
    shape.quadraticCurveTo(c.p[0], c.p[1], c.out[0], c.out[1]);
  }
  return shape;
};

export const roundedRect = (w: number, h: number, r: number): THREE.Shape =>
  roundedShape(
    [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ],
    r,
  );

/** Normalise the UV attribute's bounding box into `rect`. */
export const remapUV = (geo: THREE.BufferGeometry, rect: UVRect): THREE.BufferGeometry => {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  const su = u1 > u0 ? 1 / (u1 - u0) : 0;
  const sv = v1 > v0 ? 1 / (v1 - v0) : 0;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, rect.u0 + (uv.getX(i) - u0) * su * (rect.u1 - rect.u0), rect.v0 + (uv.getY(i) - v0) * sv * (rect.v1 - rect.v0));
  }
  uv.needsUpdate = true;
  return geo;
};

/**
 * Bevelled plate in the ZY plane, outer (+x) face at xCentre + thickness/2. Cap UVs run u = -z, v = y so text reads
 * correctly on the +x face. `bend(z, y)` offsets x per vertex for flared endplates.
 */
export const plateZY = (
  outline: V2[],
  thickness: number,
  xCentre: number,
  uv: UVRect,
  radius = 0.01,
  bevel = 0.003,
  bend?: (z: number, y: number) => number,
): THREE.BufferGeometry => {
  const shape = roundedShape(
    outline.map(([z, y]) => [-z, y] as V2),
    radius,
  );
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.rotateY(Math.PI / 2);
  geo.translate(xCentre - thickness / 2, 0, 0);
  if (bend) {
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + bend(p.getZ(i), p.getY(i)));
    geo.computeVertexNormals();
  }
  return remapUV(geo, uv);
};

/** Bevelled plate in the XZ plane with its underside at yBottom. */
export const plateXZ = (outline: V2[], thickness: number, yBottom: number, uv: UVRect, radius = 0.01, bevel = 0.003): THREE.BufferGeometry => {
  const shape = roundedShape(
    outline.map(([x, z]) => [x, -z] as V2),
    radius,
  );
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, yBottom + bevel, 0);
  return remapUV(geo, uv);
};

/** Mirror across X (keeps normals valid). Optionally flips u inside a UV rect so decals stay readable. */
export const mirrorX = (src: THREE.BufferGeometry, flipU?: UVRect): THREE.BufferGeometry => {
  const geo = src.clone();
  geo.scale(-1, 1, 1);
  flipWinding(geo);
  if (flipU) {
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, flipU.u0 + flipU.u1 - uv.getX(i));
    uv.needsUpdate = true;
  }
  return geo;
};

/** Triangle fan filling a planar polygon (e.g. an intake cap). Faces along `faceDir`. */
export const fanCap = (poly: V3[], faceDir: V3): THREE.BufferGeometry => {
  const n = poly.length;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of poly) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const pos = new Float32Array((n + 1) * 3);
  const uv = new Float32Array((n + 1) * 2);
  pos[0] = cx / n;
  pos[1] = cy / n;
  pos[2] = cz / n;
  uv[0] = 0.5;
  uv[1] = 0.5;
  for (let i = 0; i < n; i++) {
    pos[(i + 1) * 3] = poly[i][0];
    pos[(i + 1) * 3 + 1] = poly[i][1];
    pos[(i + 1) * 3 + 2] = poly[i][2];
    uv[(i + 1) * 2] = 0.5 + 0.5 * Math.cos((i / n) * Math.PI * 2);
    uv[(i + 1) * 2 + 1] = 0.5 + 0.5 * Math.sin((i / n) * Math.PI * 2);
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(0, i + 1, ((i + 1) % n) + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  if (nrm.getX(0) * faceDir[0] + nrm.getY(0) * faceDir[1] + nrm.getZ(0) * faceDir[2] < 0) {
    flipWinding(geo);
    geo.computeVertexNormals();
  }
  return geo;
};

/** Merge parts into one non-indexed geometry (disposes the inputs). */
export const mergeParts = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const nonIndexed = parts.map((g) => {
    if (!g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    return g.getIndex() ? g.toNonIndexed() : g;
  });
  const merged = mergeGeometries(nonIndexed, false);
  for (const g of parts) g.dispose();
  for (const g of nonIndexed) if (!parts.includes(g)) g.dispose();
  if (!merged) throw new Error('mergeParts failed');
  return merged;
};

/** Apply a Matrix4 built from position/rotation/scale to a geometry (bakes a placement). */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
export const placed = (geo: THREE.BufferGeometry, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): THREE.BufferGeometry => {
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  _m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), _q, new THREE.Vector3(scale[0], scale[1], scale[2]));
  geo.applyMatrix4(_m);
  return geo;
};

const _dir = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);

/** Pose a unit Y-cylinder so it spans a→b with cross-section radii rx/rz. Allocation free. */
export const orientArm = (obj: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, rx: number, rz: number): void => {
  _dir.subVectors(b, a);
  const len = _dir.length() || 1e-4;
  _dir.multiplyScalar(1 / len);
  obj.position.addVectors(a, b).multiplyScalar(0.5);
  obj.quaternion.setFromUnitVectors(_Y, _dir);
  obj.scale.set(rx, len, rz);
};

/** Bake a unit cylinder between two points into a static geometry. */
export const bakedArm = (cyl: THREE.BufferGeometry, a: V3, b: V3, rx: number, rz: number): THREE.BufferGeometry => {
  const g = cyl.clone();
  const tmp = new THREE.Object3D();
  orientArm(tmp, new THREE.Vector3(...a), new THREE.Vector3(...b), rx, rz);
  tmp.updateMatrix();
  g.applyMatrix4(tmp.matrix);
  return g;
};

export const triCount = (obj: THREE.Object3D): number => {
  let n = 0;
  obj.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const idx = g.getIndex();
    n += idx ? idx.count / 3 : g.getAttribute('position').count / 3;
  });
  return Math.round(n);
};
