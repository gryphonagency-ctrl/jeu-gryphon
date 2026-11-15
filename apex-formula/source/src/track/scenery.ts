import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import type { BuildCtx } from './util';
import { instanced, matrixAt, stdMat, Frame, fbm, GeoBuilder, yieldFrame, qualityIndex } from './util';
import { makeTreeMaterial, makeBuildingMaterial, makeLampMaterial } from './materials';
import type { TerrainInfo } from './terrain';
import { CIRCUIT_HINTS } from './themes';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** Random points around the circuit that are clear of the track corridor and pass `accept` (probability 0..1). */
const scatter = (ctx: BuildCtx, terrain: TerrainInfo, count: number, margin: number, accept: (x: number, z: number) => number): Float32Array => {
  const { rng } = ctx;
  const b = terrain.bounds;
  const out = new Float32Array(count * 3);
  let n = 0;
  let tries = 0;
  const cap = count * 40;
  while (n < count && tries++ < cap) {
    const x = b.min.x + rng.next() * (b.max.x - b.min.x);
    const z = b.min.z + rng.next() * (b.max.z - b.min.z);
    if (!terrain.isClear(x, z, margin)) continue;
    const a = accept(x, z);
    if (a <= 0 || rng.next() > a) continue;
    out[n * 3] = x;
    out[n * 3 + 1] = terrain.heightAt(x, z);
    out[n * 3 + 2] = z;
    n++;
  }
  return out.subarray(0, n * 3);
};

const inWater = (ctx: BuildCtx, x: number, z: number, pad = 12): boolean => {
  const hints = CIRCUIT_HINTS[ctx.def.id] ?? {};
  // a sea's rectangle is only the mesh extent; its real shoreline is the inland() function
  for (const w of hints.water ?? []) {
    if (w.kind === 'sea' && hints.inland) continue;
    if (x > w.x0 - pad && x < w.x1 + pad && z > w.z0 - pad && z < w.z1 + pad) return true;
  }
  if (hints.inland && hints.inland(x, z) < pad) return true;
  return false;
};

/* ─────────────────────────── trees ─────────────────────────── */

const buildTrees = (ctx: BuildCtx, map: THREE.Texture, kind: 'oak' | 'pine' | 'palm' | 'poplar', pts: Float32Array, hMin: number, hMax: number): void => {
  const n = pts.length / 3;
  if (n === 0) return;
  const { disposer: d, uniforms, rng } = ctx;
  // cross billboard: four unit quads around the trunk, pivot at the base, double-sided via duplicated winding
  const gb = new GeoBuilder();
  const quad = (ax: number, az: number): void => {
    const b = gb.vertexCount;
    gb.vertex(-0.5 * ax, 0, -0.5 * az, 0, 0, 1, 0, 0);
    gb.vertex(0.5 * ax, 0, 0.5 * az, 0, 0, 1, 1, 0);
    gb.vertex(0.5 * ax, 1, 0.5 * az, 0, 0, 1, 1, 1);
    gb.vertex(-0.5 * ax, 1, -0.5 * az, 0, 0, 1, 0, 1);
    gb.quad(b, b + 1, b + 2, b + 3);
  };
  quad(1, 0);
  quad(0, 1);
  quad(0.7071, 0.7071);
  quad(0.7071, -0.7071);
  const geo = d.geo(gb.build());
  const mat = makeTreeMaterial(d, map, uniforms);
  const aspect = kind === 'palm' ? 1.0 : kind === 'poplar' ? 0.32 : kind === 'pine' ? 0.55 : 1.05;
  const mats: THREE.Matrix4[] = [];
  for (let i = 0; i < n; i++) {
    const h = hMin + rng.next() * (hMax - hMin);
    mats.push(matrixAt(pts[i * 3], pts[i * 3 + 1] - 0.3, pts[i * 3 + 2], rng.next() * Math.PI * 2, h * aspect, h, h * aspect));
  }
  const mesh = instanced(geo, mat, mats, undefined, { castShadow: false, receiveShadow: false });
  mesh.name = `trees-${kind}`;
  mesh.frustumCulled = true;
  mesh.computeBoundingSphere();
  ctx.root.add(mesh);
  ctx.treeMeshes.push(mesh);
};

/* ─────────────────────────── floodlights / street lights ─────────────────────────── */

const buildFloodlights = (ctx: BuildCtx, terrain: TerrainInfo, spacing: number): void => {
  const { track, disposer: d, theme } = ctx;
  const pit = track.pitLane;
  const positions: { x: number; y: number; z: number; yaw: number }[] = [];
  let side = 1;
  for (let s = spacing * 0.5; s < track.length; s += spacing) {
    side = -side;
    const sm = track.sampleAt(s);
    const inPit = side === pit.side && track.pitD(s) >= 0;
    const lat = (side > 0 ? sm.barrierL : sm.barrierR) + (inPit ? 96 : 10);
    const x = sm.position.x + sm.left.x * lat * side;
    const z = sm.position.z + sm.left.z * lat * side;
    if (inWater(ctx, x, z, 4)) continue;
    const yaw = Math.atan2(-sm.left.x * side, -sm.left.z * side);
    positions.push({ x, y: terrain.heightAt(x, z), z, yaw });
  }
  const poleGeo = d.geo(new THREE.CylinderGeometry(0.35, 0.6, 32, 8, 1, false));
  poleGeo.translate(0, 16, 0);
  const poleMat = stdMat(d, { color: 0xb8bcc0, roughness: 0.6, metalness: 0.6 });
  const headGeo = d.geo(new THREE.BoxGeometry(4.2, 1.8, 0.7));
  headGeo.translate(0, 32.4, 0.9);
  const headMat = stdMat(d, { color: 0x30343a, roughness: 0.5, metalness: 0.7 });
  const lampGeo = d.geo(new THREE.PlaneGeometry(3.9, 1.5));
  lampGeo.translate(0, 32.4, 1.27);
  const lampMat = makeLampMaterial(d, '#fff4d6', 0);
  const mats = positions.map((p) => matrixAt(p.x, p.y, p.z, p.yaw));
  const poles = instanced(poleGeo, poleMat, mats, undefined, { castShadow: true });
  const heads = instanced(headGeo, headMat, mats, undefined, { castShadow: true });
  const lamps = instanced(lampGeo, lampMat, mats, undefined, { receiveShadow: false });
  ctx.night.push({ material: lampMat, dayIntensity: 0, nightIntensity: 3.2 });
  poles.name = 'flood-poles';
  ctx.root.add(poles, heads, lamps);
  ctx.shadowCasters.push(poles, heads);

  if (theme === 'street') {
    // street lamps every 30 m on both sides
    const lm: THREE.Matrix4[] = [];
    for (let s = 6; s < track.length; s += 30) {
      const sm = track.sampleAt(s);
      for (const sd of [1, -1]) {
        if (sd === pit.side && track.pitD(s) >= 0) continue;
        const lat = (sd > 0 ? sm.barrierL : sm.barrierR) + 1.4;
        const x = sm.position.x + sm.left.x * lat * sd;
        const z = sm.position.z + sm.left.z * lat * sd;
        if (inWater(ctx, x, z, 2)) continue;
        lm.push(matrixAt(x, sm.position.y, z, Math.atan2(-sm.left.x * sd, -sm.left.z * sd)));
      }
    }
    const lpGeo = d.geo(new THREE.CylinderGeometry(0.08, 0.14, 8, 6));
    lpGeo.translate(0, 4, 0);
    const armGeo = d.geo(new THREE.BoxGeometry(0.12, 0.12, 2.2));
    armGeo.translate(0, 7.9, 1.0);
    const glowGeo = d.geo(new THREE.BoxGeometry(0.5, 0.18, 1.0));
    glowGeo.translate(0, 7.75, 1.7);
    const glowMat = makeLampMaterial(d, '#ffd9a0', 0);
    const lampPoles = instanced(lpGeo, poleMat, lm);
    const arms = instanced(armGeo, poleMat, lm);
    const glows = instanced(glowGeo, glowMat, lm, undefined, { receiveShadow: false });
    ctx.night.push({ material: glowMat, dayIntensity: 0, nightIntensity: 2.6 });
    lampPoles.name = 'street-lamps';
    ctx.root.add(lampPoles, arms, glows);
    ctx.detailObjects.push(arms);
  }
};

/* ─────────────────────────── buildings ─────────────────────────── */

interface BuildingSpec {
  x: number;
  z: number;
  y: number;
  w: number;
  dpt: number;
  h: number;
  yaw: number;
  color: THREE.Color;
  roof?: 'flat' | 'terracotta';
}

const buildBuildings = (ctx: BuildCtx, specs: BuildingSpec[], name: string, litRatio: number): void => {
  const n = specs.length;
  if (n === 0) return;
  const { disposer: d, uniforms, tex } = ctx;
  const geo = d.geo(new THREE.BoxGeometry(1, 1, 1));
  geo.translate(0, 0.5, 0);
  const mat = makeBuildingMaterial(d, uniforms, { map: tex.concreteMap, color: 0xffffff }, [3.4, 3.6], litRatio);
  const mats: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const roofs: BuildingSpec[] = [];
  for (const b of specs) {
    _p.set(b.x, b.y, b.z);
    _q.setFromAxisAngle(Y_AXIS, b.yaw);
    _s.set(b.w, b.h, b.dpt);
    mats.push(new THREE.Matrix4().compose(_p, _q, _s));
    cols.push(b.color);
    if (b.roof === 'terracotta') roofs.push(b);
  }
  const mesh = instanced(geo, mat, mats, cols, { castShadow: true });
  mesh.name = name;
  mesh.frustumCulled = true;
  mesh.computeBoundingSphere();
  ctx.root.add(mesh);
  ctx.shadowCasters.push(mesh);
  if (roofs.length) {
    const rg = d.geo(new THREE.ConeGeometry(0.7071, 1, 4, 1));
    rg.rotateY(Math.PI / 4);
    rg.translate(0, 0.5, 0);
    const rm = stdMat(d, { color: 0x9a4a30, roughness: 0.85 });
    const rmats = roofs.map((b) => {
      _p.set(b.x, b.y + b.h, b.z);
      _q.setFromAxisAngle(Y_AXIS, b.yaw);
      _s.set(b.w * 1.08, Math.min(b.w, b.dpt) * 0.42, b.dpt * 1.08);
      return new THREE.Matrix4().compose(_p, _q, _s);
    });
    const rmesh = instanced(rg, rm, rmats, undefined, { castShadow: true });
    rmesh.name = `${name}-roofs`;
    ctx.root.add(rmesh);
  }
};

/* ─────────────────────────── helicopter ─────────────────────────── */

const buildHelicopter = (ctx: BuildCtx, terrain: TerrainInfo): void => {
  const { disposer: d } = ctx;
  const g = new THREE.Group();
  g.name = 'helicopter';
  const body = stdMat(d, { color: 0x1a2a44, roughness: 0.4, metalness: 0.4 });
  const glass = stdMat(d, { color: 0x88aacc, roughness: 0.1, metalness: 0.6 });
  const dark = stdMat(d, { color: 0x111111, roughness: 0.6, metalness: 0.3 });
  const hull = new THREE.Mesh(d.geo(new THREE.SphereGeometry(1.3, 12, 8)), body);
  hull.scale.set(1.2, 1, 2.4);
  g.add(hull);
  const cab = new THREE.Mesh(d.geo(new THREE.SphereGeometry(1.0, 12, 8)), glass);
  cab.position.set(0, 0.3, 2.2);
  cab.scale.set(1.1, 0.8, 1.2);
  g.add(cab);
  const tail = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(0.22, 0.5, 6, 8)), body);
  tail.rotation.x = -Math.PI / 2;
  tail.position.set(0, 0.35, -5.5);
  g.add(tail);
  const fin = new THREE.Mesh(d.geo(new THREE.BoxGeometry(0.1, 1.8, 1.0)), body);
  fin.position.set(0, 1.2, -8.2);
  g.add(fin);
  const skidGeo = d.geo(new THREE.BoxGeometry(0.12, 0.12, 3.6));
  for (const sx of [-0.9, 0.9]) {
    const sk = new THREE.Mesh(skidGeo, dark);
    sk.position.set(sx, -1.55, 0.4);
    g.add(sk);
  }
  const mast = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(0.15, 0.15, 0.9, 6)), dark);
  mast.position.set(0, 1.6, 0);
  g.add(mast);
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.05, 0);
  const bladeGeo = d.geo(new THREE.BoxGeometry(0.35, 0.06, 11));
  for (let i = 0; i < 2; i++) {
    const bl = new THREE.Mesh(bladeGeo, dark);
    bl.rotation.y = (i * Math.PI) / 2;
    rotor.add(bl);
  }
  g.add(rotor);
  const tailRotor = new THREE.Mesh(d.geo(new THREE.BoxGeometry(0.05, 1.8, 0.2)), dark);
  tailRotor.position.set(0.3, 1.2, -8.2);
  g.add(tailRotor);
  ctx.root.add(g);
  ctx.detailObjects.push(g);
  const b = terrain.bounds;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const rad = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.28;
  let top = -Infinity;
  for (const s of ctx.track.samples) top = Math.max(top, s.position.y);
  const baseY = top + 120;
  let phase = ctx.rng.next() * Math.PI * 2;
  ctx.animators.push({
    update(time, dt) {
      phase += dt * 0.055;
      g.position.set(cx + Math.cos(phase) * rad, baseY + Math.sin(time * 0.3) * 6, cz + Math.sin(phase) * rad);
      g.rotation.set(0, Math.atan2(-Math.sin(phase), Math.cos(phase)) + Math.PI, 0);
      g.rotateZ(0.22);
      g.rotateX(-0.08);
      rotor.rotation.y += dt * 38;
      tailRotor.rotation.x += dt * 60;
    },
  });
};

/* ─────────────────────────── Ferris wheel ─────────────────────────── */

const buildFerrisWheel = (ctx: BuildCtx, x: number, y: number, z: number, yaw: number): void => {
  const { disposer: d } = ctx;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  g.name = 'ferris-wheel';
  const R = 15;
  const steel = stdMat(d, { color: 0xe8e8ee, roughness: 0.4, metalness: 0.7 });
  const legGeo = d.geo(new THREE.CylinderGeometry(0.35, 0.5, R * 1.28, 8));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, steel);
      leg.position.set(sx * 5, R * 0.6, sz * 1.6);
      leg.rotation.z = -sx * 0.36;
      leg.rotation.x = sz * 0.12;
      leg.castShadow = true;
      g.add(leg);
    }
  }
  const wheel = new THREE.Group();
  wheel.position.y = R + 1.5;
  const rimGeo = d.geo(new THREE.TorusGeometry(R, 0.22, 8, 48));
  for (const sz of [-1, 1]) {
    const rim = new THREE.Mesh(rimGeo, steel);
    rim.position.z = sz * 1.2;
    wheel.add(rim);
  }
  const spokeGeo = d.geo(new THREE.CylinderGeometry(0.07, 0.07, R * 2, 5));
  const n = 16;
  for (let i = 0; i < n / 2; i++) {
    for (const sz of [-1, 1]) {
      const sp = new THREE.Mesh(spokeGeo, steel);
      sp.rotation.z = (i / (n / 2)) * Math.PI;
      sp.position.z = sz * 1.2;
      wheel.add(sp);
    }
  }
  const gondGeo = d.geo(new THREE.SphereGeometry(1.0, 10, 8));
  const gondCols = [0xff4d4d, 0x4da6ff, 0xffd24d, 0x4dff88].map((c) => new THREE.Color(c));
  const gondMats: THREE.Matrix4[] = [];
  const gondColList: THREE.Color[] = [];
  for (let i = 0; i < n; i++) {
    gondMats.push(new THREE.Matrix4());
    gondColList.push(gondCols[i % 4]);
  }
  const gondolas = instanced(gondGeo, stdMat(d, { color: 0xffffff, roughness: 0.4, metalness: 0.1 }), gondMats, gondColList);
  g.add(gondolas);
  const lampMat = makeLampMaterial(d, '#ffe6a0', 0);
  const lampGeo = d.geo(new THREE.SphereGeometry(0.28, 6, 5));
  const lampMats: THREE.Matrix4[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    lampMats.push(matrixAt(Math.cos(a) * R, Math.sin(a) * R, 0));
  }
  const lamps = instanced(lampGeo, lampMat, lampMats, undefined, { receiveShadow: false });
  wheel.add(lamps);
  ctx.night.push({ material: lampMat, dayIntensity: 0.1, nightIntensity: 2.5 });
  g.add(wheel);
  ctx.root.add(g);
  ctx.detailObjects.push(g);
  ctx.animators.push({
    update(_time, dt) {
      wheel.rotation.z += dt * 0.08;
      // gondolas hang: counter-rotate them so they stay upright
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        _p.set(Math.cos(a) * R, Math.sin(a) * R - 1.2, 0);
        _q.setFromAxisAngle(Z_AXIS, -wheel.rotation.z);
        _s.set(1, 1, 1);
        gondolas.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      gondolas.instanceMatrix.needsUpdate = true;
    },
  });
};

/* ─────────────────────────── boats ─────────────────────────── */

interface BoatSpec {
  x: number;
  z: number;
  yaw: number;
  scale: number;
}

const buildBoats = (ctx: BuildCtx, pts: BoatSpec[], level: number): void => {
  const n = pts.length;
  if (!n) return;
  const { disposer: d } = ctx;
  const hullGeo = d.geo(new THREE.CylinderGeometry(1.4, 0.9, 10, 7, 1));
  hullGeo.rotateX(Math.PI / 2);
  hullGeo.scale(1, 0.55, 1);
  hullGeo.translate(0, 0.35, 0);
  const white = stdMat(d, { color: 0xf4f4f0, roughness: 0.35, metalness: 0.05 });
  const cabGeo = d.geo(new THREE.BoxGeometry(1.8, 1.2, 3.4));
  cabGeo.translate(0, 1.5, -0.6);
  const cabMat = stdMat(d, { color: 0x2b3a55, roughness: 0.2, metalness: 0.4 });
  const mastGeo = d.geo(new THREE.CylinderGeometry(0.06, 0.09, 11, 5));
  mastGeo.translate(0, 6.5, 0.8);
  const mastMat = stdMat(d, { color: 0xdddddd, roughness: 0.4, metalness: 0.6 });
  const mats = pts.map((b) => matrixAt(b.x, level, b.z, b.yaw, b.scale, b.scale, b.scale));
  const mastMats = pts.map((b, i) => matrixAt(b.x, level, b.z, b.yaw, b.scale, b.scale * (0.7 + (i % 3) * 0.2), b.scale));
  const hulls = instanced(hullGeo, white, mats, undefined, { castShadow: true, receiveShadow: false });
  const cabs = instanced(cabGeo, cabMat, mats, undefined, { receiveShadow: false });
  const masts = instanced(mastGeo, mastMat, mastMats, undefined, { receiveShadow: false });
  hulls.name = 'boats';
  ctx.root.add(hulls, cabs, masts);
  ctx.detailObjects.push(hulls, cabs, masts);
  ctx.animators.push({
    update(time) {
      for (let i = 0; i < n; i++) {
        const b = pts[i];
        const bob = Math.sin(time * 0.9 + i * 1.7) * 0.12;
        hulls.setMatrixAt(i, matrixAt(b.x, level + bob, b.z, b.yaw, b.scale, b.scale, b.scale, _m));
        cabs.setMatrixAt(i, _m);
        masts.setMatrixAt(i, matrixAt(b.x, level + bob, b.z, b.yaw, b.scale, b.scale * (0.7 + (i % 3) * 0.2), b.scale, _m));
      }
      hulls.instanceMatrix.needsUpdate = true;
      cabs.instanceMatrix.needsUpdate = true;
      masts.instanceMatrix.needsUpdate = true;
    },
  });
};

/* ─────────────────────────── rock mesas ─────────────────────────── */

const buildMesas = (ctx: BuildCtx, terrain: TerrainInfo, count: number, minDist: number): void => {
  const { disposer: d, tex, rng } = ctx;
  const mat = stdMat(d, { map: tex.rockMap, normalMap: tex.rockNormal, roughness: 0.95, metalness: 0, color: 0xc8a37a });
  const b = terrain.bounds;
  let placed = 0;
  let tries = 0;
  while (placed < count && tries++ < 400) {
    const x = b.min.x + rng.next() * (b.max.x - b.min.x);
    const z = b.min.z + rng.next() * (b.max.z - b.min.z);
    if (!terrain.isClear(x, z, minDist) || inWater(ctx, x, z, 60)) continue;
    const r = 50 + rng.next() * 90;
    const h = 22 + rng.next() * 30;
    const geo = new THREE.CylinderGeometry(r * (0.55 + rng.next() * 0.25), r, h, 14, 3, false);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const n = fbm(px / 25 + x, pz / 25 + z, 3) - 0.5;
      if (Math.hypot(px, pz) > 1) {
        const k = 1 + n * 0.35;
        pos.setXYZ(i, px * k, py + n * 3, pz * k);
      }
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(d.geo(geo), mat);
    mesh.position.set(x, terrain.heightAt(x, z) + h / 2 - 4, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'mesa';
    ctx.root.add(mesh);
    ctx.shadowCasters.push(mesh);
    placed++;
  }
};

/* ─────────────────────────── landmarks ─────────────────────────── */

const castAll = (ctx: BuildCtx, g: THREE.Object3D): void => {
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  ctx.shadowCasters.push(g);
};

const buildCastle = (ctx: BuildCtx, x: number, y: number, z: number): void => {
  const { disposer: d, tex } = ctx;
  const stone = stdMat(d, { map: tex.concreteMap, color: 0x9d968a, roughness: 0.9 });
  const roof = stdMat(d, { color: 0x4a3a3a, roughness: 0.8 });
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.name = 'castle';
  const keep = new THREE.Mesh(d.geo(new THREE.BoxGeometry(26, 30, 22)), stone);
  keep.position.y = 15;
  g.add(keep);
  const keepRoof = new THREE.Mesh(d.geo(new THREE.ConeGeometry(18, 12, 4)), roof);
  keepRoof.rotation.y = Math.PI / 4;
  keepRoof.position.y = 36;
  g.add(keepRoof);
  const towerGeo = d.geo(new THREE.CylinderGeometry(4.5, 5, 36, 10));
  const coneGeo = d.geo(new THREE.ConeGeometry(5.6, 9, 10));
  const wallGeo = d.geo(new THREE.BoxGeometry(1, 12, 1));
  const corners = [
    [-28, -24],
    [28, -24],
    [28, 24],
    [-28, 24],
  ];
  for (let i = 0; i < 4; i++) {
    const [tx, tz] = corners[i];
    const t = new THREE.Mesh(towerGeo, stone);
    t.position.set(tx, 18, tz);
    g.add(t);
    const c = new THREE.Mesh(coneGeo, roof);
    c.position.set(tx, 40.5, tz);
    g.add(c);
    const [nx, nz] = corners[(i + 1) % 4];
    const w = new THREE.Mesh(wallGeo, stone);
    w.position.set((tx + nx) / 2, 6, (tz + nz) / 2);
    w.scale.set(Math.max(2, Math.abs(nx - tx)), 1, Math.max(2, Math.abs(nz - tz)));
    g.add(w);
  }
  castAll(ctx, g);
  ctx.root.add(g);
};

const buildLighthouse = (ctx: BuildCtx, x: number, y: number, z: number): void => {
  const { disposer: d } = ctx;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.name = 'lighthouse';
  const white = stdMat(d, { color: 0xf6f6f2, roughness: 0.6 });
  const red = stdMat(d, { color: 0xc0392b, roughness: 0.6 });
  const tower = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(2.4, 3.4, 22, 12)), white);
  tower.position.y = 11;
  g.add(tower);
  const band = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(2.9, 3.0, 3, 12)), red);
  band.position.y = 12;
  g.add(band);
  const lampMat = makeLampMaterial(d, '#fff2c0', 0.2);
  const lamp = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(1.8, 1.8, 2.4, 12)), lampMat);
  lamp.position.y = 23.2;
  g.add(lamp);
  const cap = new THREE.Mesh(d.geo(new THREE.ConeGeometry(2.6, 2.2, 12)), red);
  cap.position.y = 25.5;
  g.add(cap);
  const base = new THREE.Mesh(d.geo(new THREE.BoxGeometry(12, 4, 9)), white);
  base.position.set(6, 2, 0);
  g.add(base);
  castAll(ctx, g);
  ctx.night.push({ material: lampMat, dayIntensity: 0.2, nightIntensity: 4 });
  ctx.root.add(g);
};

const buildFarm = (ctx: BuildCtx, x: number, y: number, z: number, yaw: number): void => {
  const { disposer: d, tex } = ctx;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  g.name = 'farm';
  const barnMat = stdMat(d, { color: 0x8c3b2e, roughness: 0.8, map: tex.concreteMap });
  const roofMat = stdMat(d, { color: 0x3b3b40, roughness: 0.7, metalness: 0.3 });
  const houseMat = stdMat(d, { color: 0xe6dcc8, roughness: 0.85, map: tex.concreteMap });
  const barn = new THREE.Mesh(d.geo(new THREE.BoxGeometry(24, 7, 12)), barnMat);
  barn.position.y = 3.5;
  g.add(barn);
  const barnRoof = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(8.6, 8.6, 25, 3, 1)), roofMat);
  barnRoof.rotation.z = Math.PI / 2;
  barnRoof.rotation.x = Math.PI / 2;
  barnRoof.scale.set(0.55, 1, 1);
  barnRoof.position.y = 8.5;
  g.add(barnRoof);
  const house = new THREE.Mesh(d.geo(new THREE.BoxGeometry(12, 6, 9)), houseMat);
  house.position.set(24, 3, 4);
  g.add(house);
  const hr = new THREE.Mesh(d.geo(new THREE.ConeGeometry(8.2, 4, 4)), stdMat(d, { color: 0x7a3a2a, roughness: 0.8 }));
  hr.rotation.y = Math.PI / 4;
  hr.position.set(24, 8, 4);
  hr.scale.set(1, 1, 0.75);
  g.add(hr);
  const silo = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(2.6, 2.6, 14, 12)), stdMat(d, { color: 0xc9ccd0, roughness: 0.4, metalness: 0.7 }));
  silo.position.set(-18, 7, -4);
  g.add(silo);
  const siloTop = new THREE.Mesh(d.geo(new THREE.ConeGeometry(2.8, 2.5, 12)), roofMat);
  siloTop.position.set(-18, 15.2, -4);
  g.add(siloTop);
  castAll(ctx, g);
  ctx.root.add(g);
};

/** Glass hotel tower (desert): three stacked/offset slabs using the window material. */
const buildTower = (ctx: BuildCtx, x: number, y: number, z: number, w: number, h: number, yaw: number): void => {
  const { disposer: d, uniforms, tex } = ctx;
  const mat = makeBuildingMaterial(d, uniforms, { map: tex.glassMap, color: 0xffffff, roughness: 0.3, metalness: 0.4 }, [2.6, 3.2], 0.7);
  const geo = d.geo(new THREE.BoxGeometry(1, 1, 1));
  geo.translate(0, 0.5, 0);
  _q.setFromAxisAngle(Y_AXIS, yaw);
  const mats = [
    new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(w, h, w * 0.6)),
    new THREE.Matrix4().compose(_p.set(x + Math.cos(yaw) * w * 0.9, y, z - Math.sin(yaw) * w * 0.9), _q, _s.set(w * 0.8, h * 0.62, w * 0.5)),
    new THREE.Matrix4().compose(_p.set(x - Math.cos(yaw) * w * 0.8, y, z + Math.sin(yaw) * w * 0.8), _q, _s.set(w * 1.3, h * 0.25, w * 1.3)),
  ];
  const cols = [new THREE.Color(0x5a7f9a), new THREE.Color(0x6f8ea6), new THREE.Color(0xcbb896)];
  const mesh = instanced(geo, mat, mats, cols, { castShadow: true });
  mesh.name = 'hotel';
  ctx.root.add(mesh);
  ctx.shadowCasters.push(mesh);
  const spire = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(0.3, 1.2, h * 0.18, 8)), stdMat(d, { color: 0xdde2e8, metalness: 0.8, roughness: 0.3 }));
  spire.position.set(x, y + h + h * 0.09, z);
  ctx.root.add(spire);
};

/* ─────────────────────────── main ─────────────────────────── */

export const buildScenery = async (ctx: BuildCtx, terrain: TerrainInfo): Promise<void> => {
  const { theme, rng, track, palette, def, quality, tex, disposer: d } = ctx;
  const hints = CIRCUIT_HINTS[def.id] ?? {};
  const qi = qualityIndex(quality);
  const density = [0.35, 0.65, 1, 1.25][qi];
  const notWater = (x: number, z: number): number => (inWater(ctx, x, z) ? 0 : 1);
  const S = track.samples;
  const pit = track.pitLane;

  // frame on the pit straight, used to place landmark structures behind the paddock
  const pitFrame = new Frame(track.sampleAt(track.wrapS(track.length - 200)));
  const behindPaddock = (lat: number, along: number, out = new THREE.Vector3()): THREE.Vector3 => pitFrame.to(along, 0, lat * pit.side, out);

  ctx.progress(0, 'Planting scenery');

  if (theme === 'permanent' || theme === 'forest') {
    const kind = palette.treeKind;
    const clusters = (x: number, z: number): number => {
      const n = fbm(x / 260 + 7, z / 260, 3);
      const base = theme === 'forest' ? smoothstep(0.32, 0.6, n) * 1.2 : smoothstep(0.5, 0.75, n);
      return notWater(x, z) * clamp(base, 0, 1);
    };
    const count = Math.round((theme === 'forest' ? 16000 : 9000) * density);
    buildTrees(ctx, tex.treeMap, kind, scatter(ctx, terrain, count, 16, clusters), theme === 'forest' ? 13 : 9, theme === 'forest' ? 21 : 15);
    // near-field trees along the corridor keep the view busy from track level
    const near = scatter(ctx, terrain, Math.round(1600 * density), 20, (x, z) => {
      const { d2 } = terrain.field.nearest(x, z);
      return notWater(x, z) * (d2 < 100 * 100 ? 0.9 : 0);
    });
    buildTrees(ctx, tex.treeMap, kind, near, 8, 13);
    await yieldFrame();
    ctx.progress(0.4, 'Planting scenery');
    let farms = 0;
    for (let tries = 0; tries < 300 && farms < 3; tries++) {
      const b = terrain.bounds;
      const x = b.min.x + rng.next() * (b.max.x - b.min.x);
      const z = b.min.z + rng.next() * (b.max.z - b.min.z);
      if (!terrain.isClear(x, z, 130) || inWater(ctx, x, z, 40)) continue;
      if (fbm(x / 260 + 7, z / 260, 3) > 0.5) continue;
      buildFarm(ctx, x, terrain.heightAt(x, z), z, rng.next() * Math.PI * 2);
      farms++;
    }
    if (hints.castle) buildCastle(ctx, hints.castle.x, terrain.heightAt(hints.castle.x, hints.castle.z) - 1, hints.castle.z);
    buildFloodlights(ctx, terrain, 320);
  } else if (theme === 'street') {
    const specs: BuildingSpec[] = [];
    const g = hints.cityGrid ?? { x0: -1200, z0: -1200, x1: 1200, z1: 1200 };
    const pastel = [0xf2d6b3, 0xe9c19b, 0xd9a066, 0xf5e6cc, 0xe0b8a8, 0xc98a6a, 0xf0e0d0, 0xd8c8b8, 0xb85c4a, 0xf7f1e3];
    const towers = [0x7a8ea0, 0x8c9aa8, 0x9fb2c2, 0x5f6f80];
    const hill = hints.hills?.[0];
    const block = 58;
    for (let gx = g.x0; gx < g.x1; gx += block) {
      for (let gz = g.z0; gz < g.z1; gz += block) {
        const cx = gx + block / 2;
        const cz = gz + block / 2;
        if (inWater(ctx, cx, cz, 26)) continue;
        if (hill && Math.hypot(cx - hill.x, cz - hill.z) < hill.r * 0.75) continue;
        const dist = Math.sqrt(terrain.field.nearest(cx, cz).d2);
        const far = smoothstep(1500, 500, dist); // 1 near the circuit, 0 far away
        const n = rng.next() < 0.55 + far * 0.4 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const w = 16 + rng.next() * 22;
          const dpt = 16 + rng.next() * 22;
          const x = cx + (rng.next() - 0.5) * (block - w - 6);
          const z = cz + (rng.next() - 0.5) * (block - dpt - 6);
          const half = Math.hypot(w, dpt) / 2;
          if (!terrain.isClear(x, z, half + 3) || inWater(ctx, x, z, half + 2)) continue;
          const tall = dist > 120 && rng.next() < 0.1 + far * 0.2;
          const h = tall ? 45 + rng.next() * 60 : 12 + rng.next() * 18;
          _c.setHex(tall ? towers[Math.floor(rng.next() * towers.length)] : pastel[Math.floor(rng.next() * pastel.length)]);
          specs.push({ x, z, y: terrain.heightAt(x, z) - 0.6, w, dpt, h, yaw: (rng.next() - 0.5) * 0.1, color: _c.clone(), roof: tall || rng.next() < 0.3 ? 'flat' : 'terracotta' });
        }
      }
    }
    buildBuildings(ctx, specs, 'city', 0.6);
    await yieldFrame();
    ctx.progress(0.35, 'Planting scenery');
    if (hill) {
      buildCastle(ctx, hill.x, terrain.heightAt(hill.x, hill.z) - 1, hill.z);
      const hillTrees = scatter(ctx, terrain, Math.round(320 * density), 14, (x, z) => (Math.hypot(x - hill.x, z - hill.z) < hill.r * 0.9 ? 1 : 0));
      buildTrees(ctx, tex.treeMap, 'oak', hillTrees, 8, 13);
    }
    const water = hints.water?.[0];
    if (water) {
      const palms = scatter(ctx, terrain, Math.round(300 * density), 11, (x, z) => {
        if (inWater(ctx, x, z, 3)) return 0;
        const dq = water.x0 - x;
        return dq > 0 && dq < 40 ? 1 : 0.06;
      });
      buildTrees(ctx, tex.palmMap, 'palm', palms, 7, 11);
      const boats: BoatSpec[] = [];
      for (let i = 0; i < 26; i++) boats.push({ x: water.x0 + 30 + rng.next() * 330, z: -620 + rng.next() * 760, yaw: rng.next() * Math.PI * 2, scale: 0.9 + rng.next() * 1.4 });
      buildBoats(ctx, boats, water.level);
      const bw = new THREE.Mesh(d.geo(new THREE.BoxGeometry(14, 3, 520)), stdMat(d, { color: 0xb9b3a8, roughness: 0.9, map: tex.concreteMap }));
      bw.position.set(water.x0 + 420, water.level + 0.6, -300);
      bw.name = 'breakwater';
      castAll(ctx, bw);
      ctx.root.add(bw);
      // Ferris wheel on the quay, harbour end of the straight
      const fs = track.sampleAt(track.wrapS(track.length - 640));
      const fx = fs.position.x + fs.left.x * -pit.side * 26;
      const fz = fs.position.z + fs.left.z * -pit.side * 26;
      buildFerrisWheel(ctx, fx, terrain.heightAt(fx, fz), fz, Math.atan2(fs.tangent.x, fs.tangent.z));
    }
    buildFloodlights(ctx, terrain, 240);
  } else if (theme === 'desert') {
    buildMesas(ctx, terrain, 7, 380);
    await yieldFrame();
    ctx.progress(0.3, 'Planting scenery');
    const lake = (hints.water ?? []).find((w) => w.kind === 'lake');
    const palms = scatter(ctx, terrain, Math.round(560 * density), 12, (x, z) => {
      if (inWater(ctx, x, z, 4)) return 0;
      if (lake) {
        const inside = Math.min(x - lake.x0, lake.x1 - x, z - lake.z0, lake.z1 - z);
        if (inside > -60) return 1;
      }
      return terrain.field.nearest(x, z).d2 < 140 * 140 ? 0.35 : 0.02;
    });
    buildTrees(ctx, tex.palmMap, 'palm', palms, 7, 12);
    const hp = behindPaddock(150, -120);
    buildTower(ctx, hp.x, terrain.heightAt(hp.x, hp.z) - 0.5, hp.z, 30, 118, pitFrame.yaw() + 0.35);
    const specs: BuildingSpec[] = [];
    const sand = [0xe8d8b8, 0xdcc9a3, 0xf0e4cc, 0xcdb48c];
    for (let i = 0; i < 90; i++) {
      const p = behindPaddock(120 + rng.next() * 260, -700 + rng.next() * 900);
      if (!terrain.isClear(p.x, p.z, 20) || Math.hypot(p.x - hp.x, p.z - hp.z) < 70) continue;
      specs.push({ x: p.x, z: p.z, y: terrain.heightAt(p.x, p.z) - 0.5, w: 10 + rng.next() * 16, dpt: 10 + rng.next() * 16, h: 5 + rng.next() * 9, yaw: pitFrame.yaw() + (rng.next() - 0.5) * 0.2, color: new THREE.Color(sand[i % 4]), roof: 'flat' });
    }
    buildBuildings(ctx, specs, 'souq', 0.5);
    buildFloodlights(ctx, terrain, 150);
  } else if (theme === 'coastal') {
    const pines = scatter(ctx, terrain, Math.round(6000 * density), 14, (x, z) => {
      if (inWater(ctx, x, z, 6)) return 0;
      const n = fbm(x / 220 + 3, z / 220, 3);
      return clamp(smoothstep(0.35, 0.65, n) + 0.15, 0, 1);
    });
    buildTrees(ctx, tex.treeMap, 'pine', pines, 9, 15);
    await yieldFrame();
    ctx.progress(0.35, 'Planting scenery');
    const specs: BuildingSpec[] = [];
    const villaPts = scatter(ctx, terrain, Math.round(260 * density), 22, (x, z) => {
      if (inWater(ctx, x, z, 30)) return 0;
      const inl = hints.inland ? hints.inland(x, z) : 100;
      return inl > 60 && inl < 900 ? 0.9 : 0.1;
    });
    const cream = [0xf4ead6, 0xe9d5b5, 0xf7e2c8, 0xdcc3a2, 0xf0d9c9];
    for (let i = 0; i < villaPts.length / 3; i++) {
      specs.push({ x: villaPts[i * 3], y: villaPts[i * 3 + 1] - 0.8, z: villaPts[i * 3 + 2], w: 9 + rng.next() * 8, dpt: 8 + rng.next() * 8, h: 4 + rng.next() * 4, yaw: rng.next() * Math.PI, color: new THREE.Color(cream[i % cream.length]), roof: 'terracotta' });
    }
    buildBuildings(ctx, specs, 'villas', 0.45);
    // lighthouse on the outside of the tightest corner (the cliff hairpin)
    let hairpin = S[0];
    for (const s of S) if (Math.abs(s.curvature) > Math.abs(hairpin.curvature)) hairpin = s;
    const outside = hairpin.curvature > 0 ? -1 : 1;
    const lx = hairpin.position.x + hairpin.left.x * (hairpin.barrierL + 38) * outside;
    const lz = hairpin.position.z + hairpin.left.z * (hairpin.barrierL + 38) * outside;
    if (!inWater(ctx, lx, lz, 2)) buildLighthouse(ctx, lx, terrain.heightAt(lx, lz), lz);
    const sea = hints.water?.[0];
    if (sea) {
      const boats: BoatSpec[] = [];
      for (let i = 0; i < 16; i++) {
        const x = sea.x1 - 40 - rng.next() * 240;
        const z = -250 + rng.next() * 700;
        if (!inWater(ctx, x, z, -20)) continue;
        boats.push({ x, z, yaw: rng.next() * Math.PI * 2, scale: 0.8 + rng.next() * 1.0 });
      }
      buildBoats(ctx, boats, sea.level);
    }
    buildFloodlights(ctx, terrain, 300);
  }

  buildHelicopter(ctx, terrain);
  ctx.progress(1, 'Planting scenery');
};
