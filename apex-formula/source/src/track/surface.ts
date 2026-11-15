import * as THREE from 'three';
import { GRID_SIZE, TRACK } from '../core/constants';
import { clamp } from '../core/math';
import type { TrackSample } from '../core/track/TrackSpline';
import type { SurfaceType } from '../core/types';
import { makeAsphaltMaterial, makeWetAwareMaterial } from './materials';
import { GeoBuilder, fbm, makeScratchSample, matrixAt, smoothClosed, stdMat, turnSide, type BuildCtx, instanced } from './util';

export const CHUNK_LEN = 200;

const _p = new THREE.Vector3();
const _c = new THREE.Color();

/** Signed lateral of the rubbered-in racing line per spline sample (approximate out-in-out). */
export const computeRacingLine = (ctx: BuildCtx): Float32Array => {
  const S = ctx.track.samples;
  const n = S.length;
  const k = S.map((sm) => sm.curvature);
  const near = smoothClosed(k, 12);
  const wide = smoothClosed(k, 45);
  const out = new Array<number>(n);
  const look = Math.round(95 / ctx.track.spacing);
  for (let i = 0; i < n; i++) {
    const ahead = wide[(i + look) % n];
    const behind = wide[(i - look + n) % n];
    const v = clamp(130 * near[i] - 60 * (ahead + behind), -1, 1);
    out[i] = v * (S[i].width / 2 - 2.3);
  }
  return Float32Array.from(smoothClosed(out, 10));
};

interface Row {
  s: number;
  sample: TrackSample;
}

/** Iterate rows over [s0, s1] with adaptive spacing (denser in corners). */
const rows = (ctx: BuildCtx, s0: number, s1: number, base: number, cb: (r: Row, isLast: boolean) => void): void => {
  const sm = makeScratchSample();
  let s = s0;
  for (;;) {
    ctx.track.sample(s, sm);
    const last = s >= s1 - 1e-6;
    cb({ s, sample: sm }, last);
    if (last) break;
    const k = Math.abs(sm.curvature);
    const step = k > 1 / 60 ? base * 0.5 : k > 1 / 200 ? base * 0.75 : base;
    s = Math.min(s1, s + step);
  }
};

export const buildSurface = async (ctx: BuildCtx, lineLat: Float32Array): Promise<void> => {
  const { track, tex, uniforms, disposer: d, palette, root } = ctx;
  const L = track.length;
  const nChunks = Math.max(1, Math.round(L / CHUNK_LEN));
  const chunkLen = L / nChunks;

  const asphaltMat = makeAsphaltMaterial(d, tex, uniforms);
  const kerbMat = stdMat(d, { vertexColors: true, roughness: 0.62, metalness: 0.02, color: 0xffffff });
  const grassMat = makeWetAwareMaterial(d, uniforms, { map: tex.grassMap, normalMap: tex.grassNormal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.95, metalness: 0, vertexColors: true }, 'grass', 0.72, 0.85);
  const gravelMat = makeWetAwareMaterial(d, uniforms, { map: tex.gravelMap, normalMap: tex.gravelNormal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 1, metalness: 0, vertexColors: true }, 'gravel', 0.6, 0.8);
  const runoffMat = makeWetAwareMaterial(d, uniforms, { map: tex.runoffMap, normalMap: tex.asphaltNormal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.9, metalness: 0.02, vertexColors: true }, 'runoff', 0.5, 0.3);
  const matFor = (t: SurfaceType): THREE.MeshStandardMaterial => (t === 'gravel' ? gravelMat : t === 'runoff' ? runoffMat : grassMat);
  const decalMat = stdMat(d, { color: 0xffffff, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, transparent: true, depthWrite: false });
  const checkerMat = stdMat(d, { map: tex.checker, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  tex.checker.wrapS = THREE.RepeatWrapping;
  const gridMat = stdMat(d, { map: tex.gridAtlas.texture, roughness: 0.6, metalness: 0, transparent: true, alphaTest: 0.2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false });
  const drsMat = stdMat(d, { map: tex.boardAtlas.texture, roughness: 0.6, metalness: 0, transparent: true, alphaTest: 0.2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false });

  const kerbA = new THREE.Color(palette.kerbA);
  const kerbB = new THREE.Color(palette.kerbB);
  const pit = track.pitLane;
  const pitSide = pit.side;
  const lineAt = (s: number): number => {
    const kf = track.wrapS(s) / track.spacing;
    const i0 = Math.floor(kf) % lineLat.length;
    const i1 = (i0 + 1) % lineLat.length;
    const u = kf - Math.floor(kf);
    return lineLat[i0] + (lineLat[i1] - lineLat[i0]) * u;
  };
  const inPitRange = (s: number): number => track.pitD(s); // -1 outside

  const surfaceGroup = new THREE.Group();
  surfaceGroup.name = 'surface';
  root.add(surfaceGroup);

  const LAT_N = 9;
  for (let c = 0; c < nChunks; c++) {
    const s0 = c * chunkLen;
    const s1 = (c + 1) * chunkLen;
    const chunk = new THREE.Group();
    chunk.name = `chunk-${c}`;

    /* ── asphalt ── */
    const asph = new GeoBuilder({ colors: true, extra: 'aTrack' });
    let prevRow = -1;
    rows(ctx, s0, s1, 2.0, (r) => {
      const sm = r.sample;
      const hw = sm.width / 2;
      const line = lineAt(r.s);
      const row = asph.vertexCount;
      for (let i = 0; i < LAT_N; i++) {
        const lat = -hw + (2 * hw * i) / (LAT_N - 1);
        _p.copy(sm.position).addScaledVector(sm.left, lat);
        const v = 0.94 + 0.12 * fbm(r.s * 0.02, lat * 0.15, 2);
        asph.vertex(_p.x, _p.y, _p.z, sm.normal.x, sm.normal.y, sm.normal.z, lat / 4 + 0.5, r.s / 4, v, v, v * 1.01, lat, line, hw, r.s);
      }
      if (prevRow >= 0) asph.stitch(prevRow, row, LAT_N);
      prevRow = row;
    });
    const asphMesh = new THREE.Mesh(d.geo(asph.build()), asphaltMat);
    asphMesh.receiveShadow = true;
    asphMesh.name = 'asphalt';
    chunk.add(asphMesh);

    /* ── kerbs (per side, 0.9 m alternating blocks with a stepped profile) ── */
    const kerb = new GeoBuilder({ colors: true });
    const kw = track.kerbWidth;
    const profileLat = [0, 0.12, kw * 0.5, kw - 0.12, kw];
    const profileH = [0.004, 0.034, 0.038, 0.034, 0.014];
    for (const side of [1, -1] as const) {
      const sm = makeScratchSample();
      const blockLen = 0.9;
      let bs = Math.floor(s0 / blockLen) * blockLen;
      let blockIndex = Math.round(bs / blockLen);
      while (bs < s1) {
        const be = Math.min(s1, bs + blockLen);
        const mid = (Math.max(bs, s0) + be) / 2;
        track.sample(mid, sm);
        const has = side > 0 ? sm.kerbL : sm.kerbR;
        if (has) {
          const col = blockIndex % 2 === 0 ? kerbA : kerbB;
          const lift = blockIndex % 2 === 0 ? 0.006 : 0;
          const nRows = Math.abs(sm.curvature) > 1 / 80 ? 3 : 2;
          let prev = -1;
          for (let ri = 0; ri < nRows; ri++) {
            const s = Math.max(bs, s0) + ((be - Math.max(bs, s0)) * ri) / (nRows - 1);
            track.sample(s, sm);
            const hw = sm.width / 2;
            const row = kerb.vertexCount;
            for (let i = 0; i < profileLat.length; i++) {
              const lat = side * (hw + profileLat[i]);
              _p.copy(sm.position).addScaledVector(sm.left, lat);
              const h = profileH[i] + lift;
              // Approximate normals from the profile slope.
              const slope = i === 1 ? -0.5 : i === 3 ? 0.5 : 0;
              const nx = sm.left.x * slope * side;
              const nz = sm.left.z * slope * side;
              const shade = 0.92 + 0.08 * Math.sin(blockIndex * 12.9898);
              kerb.vertex(_p.x, _p.y + h, _p.z, nx, 1, nz, profileLat[i] / kw, s, col.r * shade, col.g * shade, col.b * shade);
            }
            if (prev >= 0) {
              if (side > 0) kerb.stitch(prev, row, profileLat.length);
              else for (let i = 0; i < profileLat.length - 1; i++) kerb.quad(prev + i, prev + i + 1, row + i + 1, row + i);
            }
            prev = row;
          }
        }
        bs = be;
        blockIndex++;
      }
    }
    if (!kerb.isEmpty()) {
      const km = new THREE.Mesh(d.geo(kerb.build()), kerbMat);
      km.receiveShadow = true;
      km.castShadow = false;
      km.name = 'kerbs';
      chunk.add(km);
    }

    /* ── run-off per side, grouped by surface type ── */
    for (const side of [1, -1] as const) {
      let cur: SurfaceType | null = null;
      let gb: GeoBuilder | null = null;
      let prev = -1;
      const flush = () => {
        if (gb && !gb.isEmpty() && cur) {
          const m = new THREE.Mesh(d.geo(gb.build()), matFor(cur));
          m.receiveShadow = true;
          m.name = `runoff-${cur}`;
          chunk.add(m);
        }
        gb = null;
        prev = -1;
      };
      rows(ctx, s0, s1, 4.0, (r, isLast) => {
        const sm = r.sample;
        const type = side > 0 ? sm.runoffL : sm.runoffR;
        const pd = inPitRange(r.s);
        const skip = side === pitSide && pd >= 0; // pit apron covers this
        if (skip) {
          flush();
          cur = null;
          return;
        }
        if (type !== cur) {
          // close the previous strip on this row, then start a new one sharing the row
          if (gb) addRunoffRow(gb, sm, side, r.s, cur!, palette, prev, (row) => (prev = row));
          flush();
          cur = type;
          gb = new GeoBuilder({ colors: true });
          prev = -1;
        }
        if (gb) addRunoffRow(gb, sm, side, r.s, type, palette, prev, (row) => (prev = row));
        if (isLast) flush();
      });
    }

    /* ── decals in this chunk ── */
    const decals = new GeoBuilder({ colors: true });
    const sm = makeScratchSample();
    // Sector marks (white bars at both edges)
    for (const ss of track.sectorS) {
      if (ss >= s0 && ss < s1) {
        track.sample(ss, sm);
        for (const side of [1, -1]) paintBar(decals, sm, side * (sm.width / 2 - 0.5), 0.7, 1.2, 0.012);
      }
    }
    // DRS detection lines
    for (const z of track.drsZones) {
      if (z.detectionS >= s0 && z.detectionS < s1) {
        track.sample(z.detectionS, sm);
        paintBar(decals, sm, 0, sm.width - 0.8, 0.15, 0.012);
      }
    }
    // Pit entry / exit lines (solid white line along the track edge on the pit side over the transitions)
    {
      const pl = track.pitLane;
      const ranges: [number, number][] = [
        [pl.entryS, pl.entryS + pl.transition],
        [pl.exitS - pl.transition, pl.exitS],
      ];
      for (const [ra, rb] of ranges) {
        const len = track.distanceForward(ra, rb);
        for (let dd = 0; dd < len; dd += 2) {
          const s = track.wrapS(ra + dd);
          if (s < s0 || s >= s1) continue;
          track.sample(s, sm);
          paintBar(decals, sm, pitSide * (sm.width / 2 - 0.3), 0.2, 2.0, 0.012);
        }
      }
    }
    if (!decals.isEmpty()) {
      const dm = new THREE.Mesh(d.geo(decals.build()), decalMat);
      dm.name = 'decals';
      chunk.add(dm);
    }

    for (const special of buildChunkSpecials(ctx, s0, s1, checkerMat, gridMat, drsMat)) chunk.add(special);
    surfaceGroup.add(chunk);

    if (c % 3 === 2) {
      ctx.progress(c / nChunks, 'Laying asphalt');
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  buildSausageKerbs(ctx, surfaceGroup);
};

const addRunoffRow = (gb: GeoBuilder, sm: TrackSample, side: number, s: number, type: SurfaceType, palette: { grass: string }, prev: number, setPrev: (row: number) => void): void => {
  const hw = sm.width / 2;
  const hasKerb = side > 0 ? sm.kerbL : sm.kerbR;
  const edge = hw + (hasKerb ? TRACK.kerbWidth : 0);
  const b = Math.max(edge + 0.5, side > 0 ? sm.barrierL : sm.barrierR);
  const span = b - edge;
  const lats = [edge, edge + Math.min(1.0, span * 0.3), edge + span * 0.45, b];
  const row = gb.vertexCount;
  const exitSide = turnSide(sm.curvature) === -side; // this side is the outside of the corner
  const astro = type === 'grass' && hasKerb && exitSide;
  for (let i = 0; i < lats.length; i++) {
    const lat = side * lats[i];
    _p.copy(sm.position).addScaledVector(sm.left, lat);
    const dist = lats[i] - edge;
    const bump = type === 'gravel' ? 0 : dist > 4 ? (fbm(s * 0.05, lat * 0.08, 2) - 0.5) * 0.06 * Math.min(1, (dist - 4) / 6) : 0;
    let r = 1;
    let g = 1;
    let bl = 1;
    if (type === 'grass') {
      const v = 0.85 + 0.3 * fbm(s * 0.013, lat * 0.05, 3);
      r = v;
      g = v;
      bl = v;
      if (astro && i === 1) {
        r = 0.55;
        g = 1.25;
        bl = 0.45;
      }
    } else if (type === 'gravel') {
      const v = 0.9 + 0.2 * fbm(s * 0.02, lat * 0.1, 2);
      r = v;
      g = v;
      bl = v;
    } else {
      const v = 0.92 + 0.16 * fbm(s * 0.01, lat * 0.05, 2);
      r = v;
      g = v;
      bl = v;
    }
    gb.vertex(_p.x, _p.y + bump - 0.002, _p.z, 0, 1, 0, (lat * side) / 6, s / 6, r, g, bl);
  }
  if (prev >= 0) {
    if (side > 0) gb.stitch(prev, row, lats.length);
    else for (let i = 0; i < lats.length - 1; i++) gb.quad(prev + i, prev + i + 1, row + i + 1, row + i);
  }
  setPrev(row);
};

/** A painted rectangle (length along the track, width across) centred at lateral `lat`. */
const paintBar = (gb: GeoBuilder, sm: TrackSample, lat: number, width: number, length: number, lift: number): void => {
  const hl = length / 2;
  const hwid = width / 2;
  const row = gb.vertexCount;
  const corners: [number, number][] = [
    [-hl, -hwid],
    [hl, -hwid],
    [hl, hwid],
    [-hl, hwid],
  ];
  for (const [ds, dl] of corners) {
    _p.copy(sm.position).addScaledVector(sm.tangent, ds).addScaledVector(sm.left, lat + dl);
    gb.vertex(_p.x, _p.y + lift, _p.z, 0, 1, 0, 0, 0, 0.9, 0.9, 0.88);
  }
  gb.quad(row, row + 1, row + 2, row + 3);
};

/** S/F chequered strip, grid boxes and DRS text decals that fall inside [s0, s1). */
const buildChunkSpecials = (ctx: BuildCtx, s0: number, s1: number, checkerMat: THREE.Material, gridMat: THREE.Material, drsMat: THREE.Material): THREE.Object3D[] => {
  const { track, tex, disposer: d } = ctx;
  const out: THREE.Object3D[] = [];
  const sm = makeScratchSample();
  const contains = (s: number) => {
    s = track.wrapS(s);
    return s >= s0 && s < s1;
  };

  if (contains(0)) {
    const gb = new GeoBuilder();
    for (let side = 0; side < 2; side++) {
      // two rows of squares 0.6 m
      const sA = -0.6 + side * 0.6;
      const sB = sA + 0.6;
      track.sample(track.wrapS(sA), sm);
      const hw = sm.width / 2;
      const row = gb.vertexCount;
      const n = Math.max(2, Math.round(sm.width / 0.6));
      for (let i = 0; i <= n; i++) {
        const lat = -hw + (2 * hw * i) / n;
        _p.copy(sm.position).addScaledVector(sm.left, lat);
        gb.vertex(_p.x, _p.y + 0.012, _p.z, 0, 1, 0, i / 8, side * 0.5);
      }
      track.sample(track.wrapS(sB), sm);
      for (let i = 0; i <= n; i++) {
        const lat = -hw + (2 * hw * i) / n;
        _p.copy(sm.position).addScaledVector(sm.left, lat);
        gb.vertex(_p.x, _p.y + 0.012, _p.z, 0, 1, 0, i / 8, side * 0.5 + 0.5);
      }
      gb.stitch(row, row + n + 1, n + 1);
    }
    const m = new THREE.Mesh(d.geo(gb.build()), checkerMat);
    m.name = 'start-finish';
    out.push(m);
  }

  // Grid boxes
  const grid = new GeoBuilder();
  for (let i = 0; i < GRID_SIZE; i++) {
    const slot = track.gridSlot(i);
    if (!contains(slot.s)) continue;
    const cell = tex.gridAtlas.cell(i);
    track.sample(slot.s, sm);
    const lat = slot.lateral;
    const row = grid.vertexCount;
    // quad from 2.2 m behind to 3.0 m ahead of the car origin, 2.6 m wide
    const pts: [number, number, number, number][] = [
      [-2.2, -1.3, cell.u1, cell.v0],
      [-2.2, 1.3, cell.u0, cell.v0],
      [3.0, 1.3, cell.u0, cell.v1],
      [3.0, -1.3, cell.u1, cell.v1],
    ];
    for (const [ds, dl, u, v] of pts) {
      _p.copy(sm.position).addScaledVector(sm.tangent, ds).addScaledVector(sm.left, lat + dl);
      grid.vertex(_p.x, _p.y + 0.014, _p.z, 0, 1, 0, u, v);
    }
    grid.quad(row, row + 3, row + 2, row + 1);
  }
  if (!grid.isEmpty()) {
    const m = new THREE.Mesh(d.geo(grid.build()), gridMat);
    m.name = 'grid-boxes';
    out.push(m);
  }

  // DRS zone start text on the asphalt + zone number
  const drs = new GeoBuilder();
  for (const z of track.drsZones) {
    if (!contains(z.startS)) continue;
    const idx = tex.boardAtlas.add('paint-drs', (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#f2f2f0';
      c.font = `900 ${h * 0.7}px "Helvetica Neue", Arial, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('DRS', w / 2, h / 2);
    });
    const cell = tex.boardAtlas.cell(idx);
    track.sample(z.startS, sm);
    for (const side of [1, -1]) {
      const lat = side * (sm.width / 2 - 2.2);
      const row = drs.vertexCount;
      const pts: [number, number, number, number][] = [
        [0, -1.6, cell.u1, cell.v0],
        [0, 1.6, cell.u0, cell.v0],
        [5, 1.6, cell.u0, cell.v1],
        [5, -1.6, cell.u1, cell.v1],
      ];
      for (const [ds, dl, u, v] of pts) {
        _p.copy(sm.position).addScaledVector(sm.tangent, ds).addScaledVector(sm.left, lat + dl);
        drs.vertex(_p.x, _p.y + 0.014, _p.z, 0, 1, 0, u, v);
      }
      drs.quad(row, row + 3, row + 2, row + 1);
    }
  }
  if (!drs.isEmpty()) {
    const m = new THREE.Mesh(d.geo(drs.build()), drsMat);
    m.name = 'drs-paint';
    out.push(m);
  }
  return out;
};

/** Yellow "sausage" kerbs behind the exit kerb of chicanes (fast direction changes). */
const buildSausageKerbs = (ctx: BuildCtx, parent: THREE.Object3D): void => {
  if (ctx.theme === 'street') return;
  const { track, disposer: d } = ctx;
  const S = track.samples;
  const n = S.length;
  // local curvature extrema
  const ext: { i: number; k: number }[] = [];
  for (let i = 0; i < n; i++) {
    const k = S[i].curvature;
    const kp = S[(i - 1 + n) % n].curvature;
    const kn = S[(i + 1) % n].curvature;
    if (Math.abs(k) > 1 / 70 && Math.abs(k) >= Math.abs(kp) && Math.abs(k) > Math.abs(kn)) ext.push({ i, k });
  }
  const sites: { s: number; side: number }[] = [];
  for (let a = 0; a < ext.length; a++) {
    const b = (a + 1) % ext.length;
    const ds = track.distanceForward(S[ext[a].i].s, S[ext[b].i].s);
    if (ds > 8 && ds < 75 && Math.sign(ext[a].k) !== Math.sign(ext[b].k)) {
      sites.push({ s: S[ext[b].i].s + 14, side: -Math.sign(ext[b].k) });
    }
  }
  if (sites.length === 0) return;
  const geo = d.geo(new THREE.BoxGeometry(1.1, 0.09, 0.42));
  geo.translate(0, 0.045, 0);
  const mat = stdMat(d, { color: new THREE.Color('#e8c11c'), roughness: 0.55, metalness: 0 });
  const mats: THREE.Matrix4[] = [];
  const sm = makeScratchSample();
  for (const site of sites) {
    for (let j = 0; j < 7; j++) {
      const s = site.s + j * 1.3;
      track.sample(s, sm);
      const hw = sm.width / 2;
      const hasKerb = site.side > 0 ? sm.kerbL : sm.kerbR;
      const lat = site.side * (hw + (hasKerb ? TRACK.kerbWidth : 0) + 0.32);
      _p.copy(sm.position).addScaledVector(sm.left, lat);
      mats.push(matrixAt(_p.x, _p.y, _p.z, sm.heading));
    }
  }
  _c.set(0xffffff);
  const mesh = instanced(geo, mat, mats, undefined, { castShadow: ctx.shadows });
  mesh.name = 'sausage-kerbs';
  parent.add(mesh);
};
