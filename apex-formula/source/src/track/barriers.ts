import * as THREE from 'three';
import type { FlagType } from '../core/types';
import type { TrackSample } from '../core/track/TrackSpline';
import { makeFlagMaterial } from './materials';
import { CHUNK_LEN } from './surface';
import { GeoBuilder, makeScratchSample, matrixAt, stdMat, turnSide, type BuildCtx, instanced } from './util';

type BarrierKind = 0 | 1 | 2 | 3 | 4; // 0 none, 1 armco, 2 tyre, 3 tecpro, 4 concrete
const NONE: BarrierKind = 0;
const ARMCO: BarrierKind = 1;
const TYRE: BarrierKind = 2;
const TECPRO: BarrierKind = 3;
const CONCRETE: BarrierKind = 4;

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _col = new THREE.Color();

export interface MarshalFlags {
  mesh: THREE.InstancedMesh;
  /** Sector index per flag instance. */
  sectors: Int8Array;
}

const FLAG_COLORS: Record<FlagType, [string, number]> = {
  green: ['#19c24a', 0],
  yellow: ['#ffd400', 0],
  'double-yellow': ['#ffd400', 2],
  red: ['#ff2a1a', 0],
  blue: ['#2f7cff', 0],
  chequered: ['#ffffff', 1],
  'black-white': ['#ffffff', 2],
  sc: ['#ffd400', 2],
  vsc: ['#ffd400', 2],
};

export const flagStyle = (f: FlagType): [string, number] => FLAG_COLORS[f] ?? FLAG_COLORS.green;

/** Per-sample barrier kind on both sides, by theme and corner geometry. */
const classify = (ctx: BuildCtx): [Uint8Array, Uint8Array] => {
  const { track, theme } = ctx;
  const S = track.samples;
  const n = S.length;
  const out: [Uint8Array, Uint8Array] = [new Uint8Array(n), new Uint8Array(n)];
  // chicane detection (fast sign flips of curvature)
  const chicane = new Uint8Array(n);
  {
    const ext: { i: number; k: number }[] = [];
    for (let i = 0; i < n; i++) {
      const k = S[i].curvature;
      const kp = S[(i - 1 + n) % n].curvature;
      const kn = S[(i + 1) % n].curvature;
      if (Math.abs(k) > 1 / 70 && Math.abs(k) >= Math.abs(kp) && Math.abs(k) > Math.abs(kn)) ext.push({ i, k });
    }
    for (let a = 0; a < ext.length; a++) {
      const b = (a + 1) % ext.length;
      const ds = track.distanceForward(S[ext[a].i].s, S[ext[b].i].s);
      if (ds > 8 && ds < 75 && Math.sign(ext[a].k) !== Math.sign(ext[b].k)) {
        const from = ext[a].i - Math.round(45 / track.spacing);
        const to = ext[b].i + Math.round(45 / track.spacing);
        for (let i = from; i <= to; i++) chicane[((i % n) + n) % n] = 1;
      }
    }
  }
  // corner "outside" mask with a lead-in
  const lead = Math.round(70 / track.spacing);
  const tail = Math.round(40 / track.spacing);
  for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
    const side = sideIdx === 0 ? 1 : -1;
    const arr = out[sideIdx];
    for (let i = 0; i < n; i++) {
      let outside = false;
      for (let j = -tail; j <= lead && !outside; j += 2) {
        const k = S[(i + j + n) % n].curvature;
        if (Math.abs(k) > 1 / 260 && turnSide(k) === -side) outside = true;
      }
      let kind: BarrierKind;
      switch (theme) {
        case 'street':
          kind = CONCRETE;
          break;
        case 'desert':
          kind = outside ? (Math.abs(S[i].curvature) > 1 / 45 ? TYRE : ARMCO) : CONCRETE;
          break;
        case 'permanent':
          kind = chicane[i] && outside ? TECPRO : outside ? TYRE : ARMCO;
          break;
        case 'forest':
        case 'coastal':
        default:
          kind = outside ? TYRE : ARMCO;
          break;
      }
      arr[i] = kind;
    }
    // Remove runs shorter than 14 m by absorbing them into the previous run.
    const minRun = Math.round(14 / track.spacing);
    let start = 0;
    while (start < n) {
      let end = start;
      while (end < n && arr[end] === arr[start]) end++;
      if (end - start < minRun && start > 0) for (let i = start; i < end; i++) arr[i] = arr[start - 1];
      start = end;
    }
  }
  return out;
};

/** Vertical wall strip along the track at a lateral offset: front face (track side), top, back. */
class WallBuilder {
  readonly gb: GeoBuilder;
  constructor(colors = false) {
    this.gb = new GeoBuilder({ colors });
  }
  /**
   * `pts` are consecutive base points (world) with `left` unit vectors; `side` tells which way the track is.
   * uvScale = metres per texture tile along the wall; vTop = v at the top of the front face.
   */
  run(pts: { p: THREE.Vector3; left: THREE.Vector3; s: number }[], side: number, h0: number, h1: number, thick: number, uvScale: number, vTop = 1, color?: THREE.Color, top = true, back = true): void {
    if (pts.length < 2) return;
    const gb = this.gb;
    const r = color ? color.r : 1;
    const g = color ? color.g : 1;
    const b = color ? color.b : 1;
    // front (faces the track: normal = -side * left)
    let prev = -1;
    for (let i = 0; i < pts.length; i++) {
      const { p, left, s } = pts[i];
      const nx = -side * left.x;
      const nz = -side * left.z;
      const row = gb.vertexCount;
      gb.vertex(p.x, p.y + h0, p.z, nx, 0, nz, s / uvScale, 0, r, g, b);
      gb.vertex(p.x, p.y + h1, p.z, nx, 0, nz, s / uvScale, vTop, r, g, b);
      if (prev >= 0) {
        if (side > 0) gb.quad(prev, row, row + 1, prev + 1);
        else gb.quad(prev, prev + 1, row + 1, row);
      }
      prev = row;
    }
    // top
    if (top) {
      prev = -1;
      for (let i = 0; i < pts.length; i++) {
        const { p, left, s } = pts[i];
        const row = gb.vertexCount;
        gb.vertex(p.x, p.y + h1, p.z, 0, 1, 0, s / uvScale, vTop, r * 0.9, g * 0.9, b * 0.9);
        _q.copy(p).addScaledVector(left, side * thick);
        gb.vertex(_q.x, _q.y + h1, _q.z, 0, 1, 0, s / uvScale, vTop + thick / uvScale, r * 0.9, g * 0.9, b * 0.9);
        if (prev >= 0) {
          if (side > 0) gb.quad(prev, row, row + 1, prev + 1);
          else gb.quad(prev, prev + 1, row + 1, row);
        }
        prev = row;
      }
    }
    if (!back) return;
    // back
    prev = -1;
    for (let i = 0; i < pts.length; i++) {
      const { p, left, s } = pts[i];
      const nx = side * left.x;
      const nz = side * left.z;
      _q.copy(p).addScaledVector(left, side * thick);
      const row = gb.vertexCount;
      gb.vertex(_q.x, _q.y + h0, _q.z, nx, 0, nz, s / uvScale, 0, r * 0.8, g * 0.8, b * 0.8);
      gb.vertex(_q.x, _q.y + h1, _q.z, nx, 0, nz, s / uvScale, vTop, r * 0.8, g * 0.8, b * 0.8);
      if (prev >= 0) {
        if (side > 0) gb.quad(prev, prev + 1, row + 1, row);
        else gb.quad(prev, row, row + 1, prev + 1);
      }
      prev = row;
    }
  }
}

interface Pt {
  p: THREE.Vector3;
  left: THREE.Vector3;
  s: number;
}

const samplePath = (ctx: BuildCtx, sFrom: number, sTo: number, latFn: (sm: TrackSample) => number, step: number): Pt[] => {
  const pts: Pt[] = [];
  const sm = makeScratchSample();
  const len = ctx.track.distanceForward(sFrom, sTo);
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 0; i <= n; i++) {
    const s = ctx.track.wrapS(sFrom + (len * i) / n);
    ctx.track.sample(s, sm);
    const lat = latFn(sm);
    pts.push({ p: sm.position.clone().addScaledVector(sm.left, lat), left: sm.left.clone(), s: sFrom + (len * i) / n });
  }
  return pts;
};

export const buildBarriers = async (ctx: BuildCtx): Promise<MarshalFlags> => {
  const { track, tex, disposer: d, palette, root, theme } = ctx;
  const kinds = classify(ctx);
  const L = track.length;
  const nChunks = Math.max(1, Math.round(L / CHUNK_LEN));
  const chunkLen = L / nChunks;
  const pit = track.pitLane;
  const pitSide = pit.side;

  const tyreMat = stdMat(d, { map: tex.tyreMap, normalMap: tex.tyreNormal, normalScale: new THREE.Vector2(1, 1), roughness: 0.85, metalness: 0, vertexColors: true });
  const armcoMat = stdMat(d, { map: tex.armcoMap, normalMap: tex.armcoNormal, normalScale: new THREE.Vector2(1, 1), roughness: 0.45, metalness: 0.75, vertexColors: true });
  const tecproMat = stdMat(d, { map: tex.tecproMap, roughness: 0.6, metalness: 0, vertexColors: true });
  const concreteMat = stdMat(d, { map: tex.concreteMap, normalMap: tex.concreteNormal, roughness: 0.9, metalness: 0, vertexColors: true });
  const fenceMat = stdMat(d, { map: tex.fenceMap, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6, color: 0xffffff, depthWrite: true });
  const postMat = stdMat(d, { color: new THREE.Color('#8a8f95'), roughness: 0.5, metalness: 0.7 });
  const beltCol = new THREE.Color('#2a2a2c');
  const stripeCol = new THREE.Color(palette.barrierStripe);

  const group = new THREE.Group();
  group.name = 'barriers';
  root.add(group);

  const postGeo = d.geo(new THREE.BoxGeometry(0.1, 0.9, 0.12));
  postGeo.translate(0, 0.45, 0);
  const fencePostGeo = d.geo(new THREE.CylinderGeometry(0.05, 0.06, 1, 6));
  fencePostGeo.translate(0, 0.5, 0);
  const armcoPosts: THREE.Matrix4[] = [];
  const fencePosts: THREE.Matrix4[] = [];
  const inPitBuildingZone = (side: number, s: number): boolean => {
    if (side !== pitSide) return false;
    const dd = track.pitD(s);
    return dd >= pit.transition * 0.9 && dd <= pit.length - pit.transition * 0.9;
  };
  const fenceWanted = (side: number, i: number): boolean => {
    if (theme === 'street' || theme === 'coastal' || theme === 'desert' || theme === 'permanent') return true;
    // forest: fence on corner outsides and the main straight only
    const k = kinds[side > 0 ? 0 : 1][i];
    const s = track.samples[i].s;
    return k === TYRE || k === TECPRO || s < 400 || s > L - 500;
  };

  for (let c = 0; c < nChunks; c++) {
    const s0 = c * chunkLen;
    const s1 = (c + 1) * chunkLen;
    const chunk = new THREE.Group();
    chunk.name = `barriers-${c}`;
    const walls: Record<number, WallBuilder> = { 1: new WallBuilder(true), 2: new WallBuilder(true), 3: new WallBuilder(true), 4: new WallBuilder(true) };
    const fence = new WallBuilder(false);

    for (const side of [1, -1] as const) {
      const arr = kinds[side > 0 ? 0 : 1];
      const i0 = Math.round(s0 / track.spacing);
      const i1 = Math.min(track.samples.length, Math.round(s1 / track.spacing));
      let i = i0;
      while (i < i1) {
        const kind = arr[i] as BarrierKind;
        let j = i;
        while (j < i1 && arr[j] === kind && inPitBuildingZone(side, track.samples[j].s) === inPitBuildingZone(side, track.samples[i].s)) j++;
        const sa = track.samples[i].s;
        const sb = j < track.samples.length ? track.samples[j].s : s1;
        if (!inPitBuildingZone(side, sa) && kind !== NONE && sb - sa > 0.5) {
          const latFn = (sm: TrackSample) => side * ((side > 0 ? sm.barrierL : sm.barrierR) - 0.05);
          const step = 3;
          const pts = samplePath(ctx, sa, sb, latFn, step);
          switch (kind) {
            case TYRE: {
              _col.set(0xffffff);
              walls[TYRE].run(pts, side, 0, 1.1, 0.75, 0.66, 1, _col, false);
              // conveyor belt strip along the top front edge
              const belt = pts.map((pt) => ({ p: pt.p.clone().addScaledVector(pt.left, -side * 0.02), left: pt.left, s: pt.s }));
              walls[TYRE].run(belt, side, 1.1, 1.22, 0.79, 4, 0.02, beltCol, true);
              break;
            }
            case ARMCO: {
              _col.set(0xffffff);
              const rail = pts.map((pt) => ({ p: pt.p.clone().addScaledVector(pt.left, side * 0.06), left: pt.left, s: pt.s }));
              walls[ARMCO].run(rail, side, 0.45, 0.78, 0.09, 4, 1, _col, true);
              for (let k = 0; k < pts.length; k += 1) {
                const pt = pts[k];
                _p.copy(pt.p).addScaledVector(pt.left, side * 0.14);
                armcoPosts.push(matrixAt(_p.x, _p.y, _p.z, Math.atan2(pt.left.z, pt.left.x)));
              }
              break;
            }
            case TECPRO: {
              _col.set(0xffffff);
              walls[TECPRO].run(pts, side, 0, 1.0, 0.9, 2.4, 1, _col, true);
              break;
            }
            case CONCRETE:
            default: {
              _col.set(0xffffff);
              walls[CONCRETE].run(pts, side, 0, 0.86, 0.5, 2, 0.86, _col, false);
              walls[CONCRETE].run(pts, side, 0.86, 1.0, 0.5, 2, 0.14, stripeCol, true);
              break;
            }
          }
          // debris fence
          if (fenceWanted(side, i)) {
            const back = kind === CONCRETE ? 0.25 : kind === TYRE ? 0.9 : 0.5;
            const base = kind === CONCRETE ? 1.0 : 0;
            const fh = theme === 'street' ? 3.4 : 3.2;
            const fpts = pts.map((pt) => ({ p: pt.p.clone().addScaledVector(pt.left, side * back), left: pt.left, s: pt.s }));
            fence.run(fpts, side, base, base + fh, 0.02, 4, fh / 4, undefined, false, false);
            for (let k = 0; k < fpts.length; k += 1) {
              const pt = fpts[k];
              fencePosts.push(matrixAt(pt.p.x, pt.p.y + base, pt.p.z, 0, 1, fh + 0.1, 1));
            }
          }
        }
        i = Math.max(j, i + 1);
      }
    }
    const add = (wb: WallBuilder, mat: THREE.Material, name: string, cast: boolean) => {
      if (wb.gb.isEmpty()) return;
      const m = new THREE.Mesh(d.geo(wb.gb.build()), mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      m.name = name;
      chunk.add(m);
      if (cast) ctx.shadowCasters.push(m);
    };
    add(walls[TYRE], tyreMat, 'tyre-wall', ctx.shadows);
    add(walls[ARMCO], armcoMat, 'armco', false);
    add(walls[TECPRO], tecproMat, 'tecpro', ctx.shadows);
    add(walls[CONCRETE], concreteMat, 'concrete', ctx.shadows);
    add(fence, fenceMat, 'fence', false);
    group.add(chunk);
    if (c % 4 === 3) {
      ctx.progress(c / nChunks, 'Building barriers');
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (armcoPosts.length) {
    const m = instanced(postGeo, postMat, armcoPosts, undefined, { castShadow: false });
    m.name = 'armco-posts';
    group.add(m);
  }
  if (fencePosts.length) {
    const m = instanced(fencePostGeo, postMat, fencePosts, undefined, { castShadow: false });
    m.name = 'fence-posts';
    group.add(m);
  }

  return buildMarshalPosts(ctx, group);
};

/** Marshal huts every ~300 m with a flag whose colour follows the sector flag. */
const buildMarshalPosts = (ctx: BuildCtx, parent: THREE.Object3D): MarshalFlags => {
  const { track, disposer: d, palette, uniforms } = ctx;
  const L = track.length;
  const count = Math.max(4, Math.round(L / 300));
  const hutMat = stdMat(d, { color: new THREE.Color(palette.concrete), roughness: 0.8, metalness: 0, vertexColors: true });
  const marshalMat = stdMat(d, { color: new THREE.Color('#ff7a00'), roughness: 0.8, metalness: 0 });
  const poleMat = stdMat(d, { color: new THREE.Color('#dddddd'), roughness: 0.4, metalness: 0.6 });
  const flagMat = makeFlagMaterial(d, uniforms);

  const hut = new GeoBuilder({ colors: true });
  const orange = new THREE.Color('#ff7a00');
  const white = new THREE.Color('#f2f2f0');
  const dark = new THREE.Color('#333');
  const marshals: THREE.Matrix4[] = [];
  const poles: THREE.Matrix4[] = [];
  const flags: THREE.Matrix4[] = [];
  const sectors: number[] = [];
  const sm = makeScratchSample();
  const pit = track.pitLane;
  for (let i = 0; i < count; i++) {
    const s = track.wrapS(150 + (i * L) / count);
    const side = i % 2 === 0 ? 1 : -1;
    if (side === pit.side && track.pitD(s) >= 0) continue;
    track.sample(s, sm);
    const b = side > 0 ? sm.barrierL : sm.barrierR;
    const yaw = sm.heading;
    // hut base
    _p.copy(sm.position).addScaledVector(sm.left, side * (b + 2.6));
    const fwd = sm.tangent;
    const lft = sm.left;
    const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, col: THREE.Color) => {
      // cx along track, cz lateral (outward positive), cy up — build 8 corners in world space
      const cornersLocal: [number, number, number][] = [
        [-sx / 2, 0, -sz / 2],
        [sx / 2, 0, -sz / 2],
        [sx / 2, 0, sz / 2],
        [-sx / 2, 0, sz / 2],
      ];
      const w = (lx: number, ly: number, lz: number, out: THREE.Vector3) => out.copy(_p).addScaledVector(fwd, cx + lx).addScaledVector(lft, side * (cz + lz)).setY(_p.y + cy + ly);
      // sides
      for (let k = 0; k < 4; k++) {
        const c0 = cornersLocal[k];
        const c1 = cornersLocal[(k + 1) % 4];
        w(c0[0], 0, c0[2], _a);
        w(c1[0], 0, c1[2], _b);
        w(c1[0], sy, c1[2], _c);
        w(c0[0], sy, c0[2], _d);
        if (side > 0) hut.face(_a, _b, _c, _d, [0, 0, 1, 1], col);
        else hut.face(_b, _a, _d, _c, [0, 0, 1, 1], col);
      }
      // top
      w(cornersLocal[0][0], sy, cornersLocal[0][2], _a);
      w(cornersLocal[1][0], sy, cornersLocal[1][2], _b);
      w(cornersLocal[2][0], sy, cornersLocal[2][2], _c);
      w(cornersLocal[3][0], sy, cornersLocal[3][2], _d);
      if (side > 0) hut.face(_a, _b, _c, _d, [0, 0, 1, 1], col);
      else hut.face(_a, _d, _c, _b, [0, 0, 1, 1], col);
    };
    box(0, 0, 0, 2.6, 0.9, 2.4, white);
    box(0, 0.9, 0, 2.6, 0.35, 2.4, orange);
    box(0, 1.25, 0, 2.6, 0.9, 2.4, white);
    box(0, 2.15, 0, 2.9, 0.12, 2.7, dark);
    // marshal standing beside the hut, pole in front
    _q.copy(_p).addScaledVector(fwd, 2.1).addScaledVector(lft, side * -0.6);
    marshals.push(matrixAt(_q.x, _q.y, _q.z, yaw));
    _q.copy(_p).addScaledVector(fwd, -1.9).addScaledVector(lft, side * -1.0);
    poles.push(matrixAt(_q.x, _q.y, _q.z, 0));
    flags.push(matrixAt(_q.x, _q.y + 3.0, _q.z, yaw + Math.PI / 2 - side * 0.3));
    sectors.push(sm.sector);
  }
  if (!hut.isEmpty()) {
    const m = new THREE.Mesh(d.geo(hut.build()), hutMat);
    m.castShadow = ctx.shadows;
    m.receiveShadow = true;
    m.name = 'marshal-huts';
    parent.add(m);
  }
  // marshal figure: body capsule + head
  const body = d.geo(new THREE.CapsuleGeometry(0.22, 0.75, 3, 8));
  body.translate(0, 0.95, 0);
  const head = new THREE.SphereGeometry(0.13, 8, 6);
  head.translate(0, 1.58, 0);
  const figure = d.geo(mergeTwo(body, head));
  if (marshals.length) {
    const m = instanced(figure, marshalMat, marshals, undefined, { castShadow: false });
    m.name = 'marshals';
    parent.add(m);
    const poleGeo = d.geo(new THREE.CylinderGeometry(0.025, 0.03, 3.8, 6));
    poleGeo.translate(0, 1.9, 0);
    const pm = instanced(poleGeo, poleMat, poles, undefined, { castShadow: false });
    pm.name = 'flag-poles';
    parent.add(pm);
  }
  // flags: quad 0.9 x 0.6 with the pole edge at x = 0
  const flagGeo = d.geo(new THREE.PlaneGeometry(0.9, 0.6, 6, 2));
  flagGeo.translate(0.45, 0.3, 0);
  const aFlag = new Float32Array(Math.max(1, flags.length) * 4);
  for (let i = 0; i < flags.length; i++) {
    aFlag[i * 4] = Math.random();
    aFlag[i * 4 + 1] = 0;
    aFlag[i * 4 + 2] = Math.random() * 1.5;
  }
  flagGeo.setAttribute('aFlag', new THREE.InstancedBufferAttribute(aFlag, 4));
  const colors = flags.map(() => new THREE.Color(FLAG_COLORS.green[0]));
  const fm = instanced(flagGeo, flagMat, flags, colors, { castShadow: false });
  fm.name = 'marshal-flags';
  parent.add(fm);
  return { mesh: fm, sectors: Int8Array.from(sectors) };
};

const mergeTwo = (a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry => {
  const ai = a.toNonIndexed();
  const bi = b.toNonIndexed();
  const pos = new Float32Array(ai.attributes.position.array.length + bi.attributes.position.array.length);
  pos.set(ai.attributes.position.array as Float32Array, 0);
  pos.set(bi.attributes.position.array as Float32Array, ai.attributes.position.array.length);
  const nor = new Float32Array(pos.length);
  nor.set(ai.attributes.normal.array as Float32Array, 0);
  nor.set(bi.attributes.normal.array as Float32Array, ai.attributes.normal.array.length);
  const uv = new Float32Array((pos.length / 3) * 2);
  uv.set(ai.attributes.uv.array as Float32Array, 0);
  uv.set(bi.attributes.uv.array as Float32Array, ai.attributes.uv.array.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  ai.dispose();
  bi.dispose();
  a.dispose();
  b.dispose();
  return g;
};

export { mergeTwo };
