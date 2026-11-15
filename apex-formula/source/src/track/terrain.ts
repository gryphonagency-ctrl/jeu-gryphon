import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import { makeWaterMaterial, makeWetAwareMaterial } from './materials';
import { CIRCUIT_HINTS } from './themes';
import { fbm, stdMat, type BuildCtx } from './util';

/** Fast nearest-centreline query (coarse brute force + fine refinement) usable for hundreds of thousands of points. */
export class TrackField {
  private readonly cx: Float32Array;
  private readonly cz: Float32Array;
  private readonly ci: Int32Array;
  private readonly fx: Float32Array;
  private readonly fz: Float32Array;
  private readonly fy: Float32Array;
  private readonly fine: number;
  private readonly farPts: { x: number; z: number; y: number }[] = [];
  readonly n: number;
  constructor(private readonly ctx: BuildCtx) {
    const S = ctx.track.samples;
    this.n = S.length;
    this.fine = Math.max(1, Math.round(10 / ctx.track.spacing));
    const m = Math.ceil(this.n / this.fine);
    this.cx = new Float32Array(m);
    this.cz = new Float32Array(m);
    this.ci = new Int32Array(m);
    for (let j = 0; j < m; j++) {
      const i = j * this.fine;
      this.cx[j] = S[i].position.x;
      this.cz[j] = S[i].position.z;
      this.ci[j] = i;
    }
    this.fx = new Float32Array(this.n);
    this.fz = new Float32Array(this.n);
    this.fy = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.fx[i] = S[i].position.x;
      this.fz[i] = S[i].position.z;
      this.fy[i] = S[i].position.y;
    }
    const farStep = Math.round(60 / ctx.track.spacing);
    for (let i = 0; i < this.n; i += farStep) this.farPts.push({ x: S[i].position.x, z: S[i].position.z, y: S[i].position.y });
  }

  /** Nearest sample index and squared distance. */
  nearest(x: number, z: number): { i: number; d2: number } {
    let best = 0;
    let bd = Infinity;
    const cx = this.cx;
    const cz = this.cz;
    for (let j = 0; j < cx.length; j++) {
      const dx = cx[j] - x;
      const dz = cz[j] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) {
        bd = d2;
        best = j;
      }
    }
    let bi = this.ci[best];
    let bd2 = bd;
    const from = this.ci[best] - this.fine;
    const to = this.ci[best] + this.fine;
    for (let i = from; i <= to; i++) {
      const k = ((i % this.n) + this.n) % this.n;
      const dx = this.fx[k] - x;
      const dz = this.fz[k] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd2) {
        bd2 = d2;
        bi = k;
      }
    }
    return { i: bi, d2: bd2 };
  }

  /** Inverse-distance weighted track height: smooth "valley floor" the circuit sits in. */
  farHeight(x: number, z: number): number {
    let sw = 0;
    let sy = 0;
    for (const p of this.farPts) {
      const dx = p.x - x;
      const dz = p.z - z;
      const w = 1 / (dx * dx + dz * dz + 2500);
      sw += w;
      sy += w * p.y;
    }
    return sy / sw;
  }
}

export interface TerrainInfo {
  field: TrackField;
  heightAt: (x: number, z: number) => number;
  /** Clearance test: true if (x,z) is at least `margin` metres outside the barriers. */
  isClear: (x: number, z: number, margin: number) => boolean;
  bounds: THREE.Box3;
}

export const buildTerrain = async (ctx: BuildCtx): Promise<TerrainInfo> => {
  const { track, tex, disposer: d, palette, root, uniforms, theme, def } = ctx;
  const hints = CIRCUIT_HINTS[def.id] ?? {};
  const field = new TrackField(ctx);
  const S = track.samples;
  const pit = track.pitLane;

  const tunnel = hints.tunnel ? { from: track.cpS[hints.tunnel.fromCp] + 6, to: track.cpS[hints.tunnel.toCp] - 6 } : null;
  const heights = S.map((s) => s.position.y).sort((a, b) => a - b);
  const farY = heights[Math.floor(heights.length / 2)] - 1.2;
  // height the terrain fades to at its edge and that the far ground takes beyond it (sea stays sea, coast hills keep rising)
  const farTarget = (x: number, z: number): number => {
    if (!hints.inland) return farY;
    const inl = hints.inland(x, z);
    if (inl < 0) return hints.seabed ?? -12;
    let h = farY;
    if (hints.inlandRise) h += hints.inlandRise * clamp(inl, 0, 1400) * smoothstep(0, 200, inl);
    return h;
  };
  const bounds = track.bounds.clone();
  const margin = 430;
  bounds.min.x -= margin;
  bounds.min.z -= margin;
  bounds.max.x += margin;
  bounds.max.z += margin;
  const spanX = bounds.max.x - bounds.min.x;
  const spanZ = bounds.max.z - bounds.min.z;
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cz = (bounds.min.z + bounds.max.z) / 2;
  // lakes sit ~1.2 m below the local valley floor so the shore never floats above the ground
  const lakes = (hints.water ?? [])
    .filter((w) => w.kind === 'lake')
    .map((w) => {
      const pts = [
        [w.x0, w.z0],
        [w.x1, w.z0],
        [w.x0, w.z1],
        [w.x1, w.z1],
        [(w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2],
      ];
      const level = Math.min(...pts.map(([x, z]) => field.farHeight(x, z))) - 1.2;
      return { ...w, level };
    });
  const waterRegions = [...(hints.water ?? []).filter((w) => w.kind !== 'lake'), ...lakes];

  const barrierAt = (i: number, side: number): number => {
    const sm = S[i];
    let b = side > 0 ? sm.barrierL : sm.barrierR;
    if (side === pit.side && track.pitD(sm.s) >= 0) b = Math.max(b, 95); // paddock is flat
    return b;
  };

  const heightAt = (x: number, z: number): number => {
    const { i, d2 } = field.nearest(x, z);
    const sm = S[i];
    const dx = x - sm.position.x;
    const dz = z - sm.position.z;
    const side = dx * sm.left.x + dz * sm.left.z > 0 ? 1 : -1;
    const dist = Math.sqrt(d2);
    const b = barrierAt(i, side);
    const trackY = sm.position.y;
    if (dist < b + 1.5) {
      if (tunnel && sm.s > tunnel.from && sm.s < tunnel.to) {
        // hill over the tunnel
        return trackY + 10 * smoothstep(3, 14, dist);
      }
      return trackY - 0.08;
    }
    const far = field.farHeight(x, z);
    let h = trackY + (far - trackY) * smoothstep(b + 6, b + 110, dist);
    const undul = (fbm(x / palette.terrainScale, z / palette.terrainScale, 3) - 0.5) * 2 * palette.terrainAmp;
    h += undul * smoothstep(b + 22, b + 140, dist);
    if (theme === 'desert') h += Math.abs(fbm(x / 140 + 3, z / 140, 2) - 0.5) * 6 * smoothstep(b + 40, b + 160, dist);
    if (hints.hills) {
      for (const hill of hints.hills) {
        const hd = Math.hypot(x - hill.x, z - hill.z);
        if (hd < hill.r) {
          const shape = (1 - smoothstep(0, hill.r, hd)) * hill.h;
          const near = tunnel && sm.s > tunnel.from - 40 && sm.s < tunnel.to + 40 ? 1 : smoothstep(b + 8, b + 60, dist);
          h += shape * near;
        }
      }
    }
    if (tunnel && sm.s > tunnel.from - 30 && sm.s < tunnel.to + 30) {
      const along = Math.min(sm.s - (tunnel.from - 30), tunnel.to + 30 - sm.s);
      const cover = smoothstep(0, 30, along) * (10 * smoothstep(3, 14, dist));
      h = Math.max(h, trackY + cover);
    }
    if (hints.inland) {
      const inl = hints.inland(x, z);
      if (hints.inlandRise) h += hints.inlandRise * clamp(inl, 0, 1400) * smoothstep(b + 30, b + 140, dist) * smoothstep(0, 200, inl);
      if (inl < 25) {
        const seabed = hints.seabed ?? -12;
        const t = smoothstep(25, -30, inl);
        h = h + (seabed - h) * t;
        if (inl < 25 && dist < b + 30) h = Math.max(h, trackY - 0.08 - smoothstep(25, 0, inl) * 0.2);
      }
    }
    for (const lk of lakes) {
      const inside = Math.min(x - lk.x0, lk.x1 - x, z - lk.z0, lk.z1 - z);
      if (inside > -30) h = Math.min(h, lk.level + 1.5 - 5 * smoothstep(-30, 20, inside));
    }
    // fade to the far plane at the grid edge
    const edge = Math.max(Math.abs(x - cx) / (spanX / 2), Math.abs(z - cz) / (spanZ / 2));
    h += (farTarget(x, z) - h) * smoothstep(0.78, 1, edge);
    return h;
  };

  const isClear = (x: number, z: number, m: number): boolean => {
    const { i, d2 } = field.nearest(x, z);
    const sm = S[i];
    const dx = x - sm.position.x;
    const dz = z - sm.position.z;
    const side = dx * sm.left.x + dz * sm.left.z > 0 ? 1 : -1;
    const b = barrierAt(i, side);
    return d2 > (b + m) * (b + m);
  };

  /* ── grid mesh in tiles ── */
  const cell = clamp(Math.max(spanX, spanZ) / 330, 5, 14);
  const nx = Math.ceil(spanX / cell);
  const nz = Math.ceil(spanZ / cell);
  const tiles = 6;
  const groundMat = makeWetAwareMaterial(
    d,
    uniforms,
    { map: tex.groundMap, normalMap: theme === 'desert' ? tex.gravelNormal : tex.grassNormal, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.95, metalness: 0, vertexColors: true },
    'ground',
    0.75,
    0.85,
  );
  const group = new THREE.Group();
  group.name = 'terrain';
  root.add(group);
  const hCache = new Float32Array((nx + 1) * (nz + 1));
  // compute heights row by row with yields
  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) hCache[iz * (nx + 1) + ix] = heightAt(bounds.min.x + ix * cell, bounds.min.z + iz * cell);
    if (iz % 12 === 11) {
      ctx.progress(iz / nz, 'Shaping terrain');
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const colorAt = (x: number, z: number, h: number, ix: number, iz: number): [number, number, number] => {
    const n = fbm(x / 60, z / 60, 3);
    let v = 0.85 + n * 0.3;
    // slope shading: steeper → rockier / darker
    const hx = hCache[iz * (nx + 1) + Math.min(nx, ix + 1)] - h;
    const hz = hCache[Math.min(nz, iz + 1) * (nx + 1) + ix] - h;
    const slope = Math.hypot(hx, hz) / cell;
    let r = v;
    let g = v;
    let b = v;
    if (theme === 'desert') {
      r = v * 1.03;
      g = v;
      b = v * 0.92;
    } else if (theme === 'coastal') {
      const dry = fbm(x / 200, z / 200, 2);
      r = v * (0.95 + dry * 0.2);
      g = v;
      b = v * (0.85 + dry * 0.1);
    } else if (theme === 'street') {
      r = g = b = 0.9 + n * 0.15;
    }
    if (slope > 0.35) {
      const t = smoothstep(0.35, 0.9, slope);
      r = r * (1 - t) + 0.62 * t;
      g = g * (1 - t) + 0.58 * t;
      b = b * (1 - t) + 0.52 * t;
    }
    return [r, g, b];
  };
  const tileNx = Math.ceil(nx / tiles);
  const tileNz = Math.ceil(nz / tiles);
  for (let tz = 0; tz < tiles; tz++) {
    for (let tx = 0; tx < tiles; tx++) {
      const x0 = tx * tileNx;
      const z0 = tz * tileNz;
      const x1 = Math.min(nx, x0 + tileNx);
      const z1 = Math.min(nz, z0 + tileNz);
      const w = x1 - x0 + 1;
      const hgt = z1 - z0 + 1;
      if (w < 2 || hgt < 2) continue;
      const pos = new Float32Array(w * hgt * 3);
      const col = new Float32Array(w * hgt * 3);
      const uv = new Float32Array(w * hgt * 2);
      const nrm = new Float32Array(w * hgt * 3);
      let k = 0;
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const x = bounds.min.x + ix * cell;
          const z = bounds.min.z + iz * cell;
          const h = hCache[iz * (nx + 1) + ix];
          pos[k * 3] = x;
          pos[k * 3 + 1] = h;
          pos[k * 3 + 2] = z;
          const [r, g, b] = colorAt(x, z, h, ix, iz);
          col[k * 3] = r;
          col[k * 3 + 1] = g;
          col[k * 3 + 2] = b;
          uv[k * 2] = x / 14;
          uv[k * 2 + 1] = z / 14;
          // normal from central differences
          const hl = hCache[iz * (nx + 1) + Math.max(0, ix - 1)];
          const hr = hCache[iz * (nx + 1) + Math.min(nx, ix + 1)];
          const hd = hCache[Math.max(0, iz - 1) * (nx + 1) + ix];
          const hu = hCache[Math.min(nz, iz + 1) * (nx + 1) + ix];
          const nxv = (hl - hr) / (2 * cell);
          const nzv = (hd - hu) / (2 * cell);
          const inv = 1 / Math.hypot(nxv, 1, nzv);
          nrm[k * 3] = nxv * inv;
          nrm[k * 3 + 1] = inv;
          nrm[k * 3 + 2] = nzv * inv;
          k++;
        }
      }
      const idx: number[] = [];
      for (let iz = 0; iz < hgt - 1; iz++) {
        for (let ix = 0; ix < w - 1; ix++) {
          const a = iz * w + ix;
          const b = a + 1;
          const c = a + w;
          const dd = c + 1;
          idx.push(a, c, b, b, c, dd);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(d.geo(g), groundMat);
      mesh.receiveShadow = true;
      mesh.name = `terrain-${tx}-${tz}`;
      group.add(mesh);
    }
    await new Promise((r) => setTimeout(r, 0));
  }

  // far plane: a ring outside the terrain grid (a hole where the tiles are, so it never covers low ground)
  const outer = 20000;
  const hx = spanX / 2 - cell * 1.5;
  const hz = spanZ / 2 - cell * 1.5;
  const farMat = stdMat(d, { color: new THREE.Color(palette.groundFar), roughness: 1, metalness: 0 });
  // near far-ground: a coarse displaced grid (sea stays below water level, coastal hills keep rising) with the tile area cut out
  const R = 4200;
  const N = 84;
  const nearGeo = new THREE.PlaneGeometry(R * 2, R * 2, N, N);
  nearGeo.rotateX(-Math.PI / 2);
  const np = nearGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < np.count; i++) np.setY(i, farTarget(np.getX(i) + cx, np.getZ(i) + cz) - 0.05);
  const srcIdx = nearGeo.getIndex()!;
  const kept: number[] = [];
  const inHole = (i: number): boolean => Math.abs(np.getX(i)) < hx && Math.abs(np.getZ(i)) < hz;
  for (let t = 0; t < srcIdx.count; t += 3) {
    const a = srcIdx.getX(t);
    const b = srcIdx.getX(t + 1);
    const c = srcIdx.getX(t + 2);
    if (inHole(a) && inHole(b) && inHole(c)) continue;
    kept.push(a, b, c);
  }
  nearGeo.setIndex(kept);
  nearGeo.computeVertexNormals();
  const nearFar = new THREE.Mesh(d.geo(nearGeo), farMat);
  nearFar.position.set(cx, 0, cz);
  nearFar.receiveShadow = false;
  nearFar.name = 'far-ground';
  group.add(nearFar);
  // flat horizon ring beyond that
  const shape = new THREE.Shape([new THREE.Vector2(-outer, -outer), new THREE.Vector2(outer, -outer), new THREE.Vector2(outer, outer), new THREE.Vector2(-outer, outer)]);
  shape.holes.push(new THREE.Path([new THREE.Vector2(-R, -R), new THREE.Vector2(-R, R), new THREE.Vector2(R, R), new THREE.Vector2(R, -R)]));
  const farGeo = d.geo(new THREE.ShapeGeometry(shape));
  farGeo.rotateX(-Math.PI / 2);
  const far = new THREE.Mesh(farGeo, farMat);
  far.position.set(cx, farY - 0.05, cz);
  far.receiveShadow = false;
  far.name = 'far-plane';
  group.add(far);

  // water
  for (const w of waterRegions) {
    const wx = Math.min(8000, w.x1 - w.x0);
    const wz = Math.min(8000, w.z1 - w.z0);
    const geo = d.geo(new THREE.PlaneGeometry(wx, wz, 1, 1));
    geo.rotateX(-Math.PI / 2);
    // world-space UVs so the normal map tiles in metres
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, (posAttr.getX(i) + wx / 2) / 18, (posAttr.getZ(i) + wz / 2) / 18);
    const mat = makeWaterMaterial(d, tex, uniforms, palette.water);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((w.x0 + w.x1) / 2, w.level, (w.z0 + w.z1) / 2);
    mesh.receiveShadow = true;
    mesh.name = `water-${w.kind}`;
    group.add(mesh);
  }

  return { field, heightAt, isClear, bounds };
};
