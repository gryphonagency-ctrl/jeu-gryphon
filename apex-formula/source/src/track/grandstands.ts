import * as THREE from 'three';
import { TEAMS } from '../core/teams';
import { makeCrowdMaterial, makeFlagMaterial } from './materials';
import { Frame, GeoBuilder, makeScratchSample, matrixAt, orientedBox, shuffle, stdMat, turnSide, type BuildCtx, instanced } from './util';

const _p = new THREE.Vector3();
const _c = new THREE.Color();

interface StandSpec {
  s0: number;
  s1: number;
  side: number;
  tiers: number;
  roof: boolean;
}

const CLOTHES = ['#e8e4dc', '#22242a', '#5b6b8a', '#8a2f2f', '#d9c26a', '#3f6b4a', '#c9c9c9', '#7a4a8a', '#2f4f7f', '#e07b39', '#f2f2f2', '#333a44'];

const chooseStands = (ctx: BuildCtx): StandSpec[] => {
  const { track } = ctx;
  const pit = track.pitLane;
  const out: StandSpec[] = [];
  // main straight, opposite the pits
  out.push({ s0: track.wrapS(-150), s1: 240, side: -pit.side, tiers: 16, roof: true });
  // biggest corners (outside)
  const corners = track
    .cornersWithS()
    .map((c) => ({ ...c, k: track.sampleAt(c.s).curvature }))
    .filter((c) => Math.abs(c.k) > 1 / 120 && c.s > 500 && c.s < track.length - 500)
    .sort((a, b) => Math.abs(b.k) - Math.abs(a.k));
  const chosen: typeof corners = [];
  for (const c of corners) {
    if (chosen.length >= 4) break;
    if (chosen.some((o) => Math.abs(track.deltaS(o.s, c.s)) < 450)) continue;
    chosen.push(c);
  }
  for (const c of chosen) {
    const side = -turnSide(c.k);
    if (side === 0) continue;
    const len = 120;
    const s0 = track.wrapS(c.s - len * 0.55);
    const s1 = track.wrapS(c.s + len * 0.45);
    if (side === pit.side && (track.pitD(s0) >= 0 || track.pitD(s1) >= 0)) continue;
    out.push({ s0, s1, side, tiers: 12, roof: chosen.indexOf(c) < 2 });
  }
  return out;
};

export interface CrowdResult {
  crowd: THREE.InstancedMesh;
  flags: THREE.InstancedMesh;
}

export const buildGrandstands = async (ctx: BuildCtx): Promise<CrowdResult> => {
  const { track, disposer: d, palette, root, uniforms, tex, rng, theme } = ctx;
  const group = new THREE.Group();
  group.name = 'grandstands';
  root.add(group);
  const specs = chooseStands(ctx);
  const seatCols = palette.seat.map((c) => new THREE.Color(c));
  const concrete = new THREE.Color(palette.concrete);
  const roofCol = new THREE.Color(palette.roof);
  const steel = new THREE.Color('#9aa0a6');
  const structMat = stdMat(d, { map: tex.concreteMap, roughness: 0.85, metalness: 0.02, vertexColors: true });
  const roofMat = stdMat(d, { roughness: 0.5, metalness: 0.35, vertexColors: true });
  const sm = makeScratchSample();

  const crowdMats: THREE.Matrix4[] = [];
  const crowdCols: THREE.Color[] = [];
  const crowdAttr: number[] = [];
  const flagMats: THREE.Matrix4[] = [];
  const flagCols: THREE.Color[] = [];
  const teamCols = TEAMS.map((t) => new THREE.Color(t.primaryColor));
  const teamCols2 = TEAMS.map((t) => new THREE.Color(t.secondaryColor));
  const densityBase = theme === 'street' ? 0.9 : 0.86;

  for (const spec of specs) {
    const gb = new GeoBuilder({ colors: true });
    const roofGb = new GeoBuilder({ colors: true });
    const len = track.distanceForward(spec.s0, spec.s1);
    const riser = 0.82;
    const tread = 0.86;
    const baseH = 1.6;
    const T = spec.tiers;
    const profile: [number, number][] = [];
    for (let r = 0; r < T; r++) {
      profile.push([r * tread, baseH + r * riser]);
      profile.push([(r + 1) * tread - 0.02, baseH + r * riser]);
      profile.push([(r + 1) * tread, baseH + (r + 1) * riser]);
    }
    const topLat = T * tread;
    const topH = baseH + T * riser;
    let prev = -1;
    const stepS = 3;
    const nS = Math.ceil(len / stepS);
    const rowSamples: { s: number; base: number; frame: Frame }[] = [];
    for (let i = 0; i <= nS; i++) {
      const s = track.wrapS(spec.s0 + (len * i) / nS);
      track.sample(s, sm);
      const b = spec.side > 0 ? sm.barrierL : sm.barrierR;
      const base = b + 5.5;
      rowSamples.push({ s, base, frame: new Frame(sm) });
      const row = gb.vertexCount;
      for (let k = 0; k < profile.length; k++) {
        const [dl, h] = profile[k];
        const tier = Math.floor(k / 3);
        const col = k % 3 === 2 ? concrete : seatCols[Math.floor(tier / 3) % seatCols.length];
        _p.copy(sm.position).addScaledVector(sm.left, spec.side * (base + dl));
        const riserFace = k % 3 === 2;
        const nx = riserFace ? -spec.side * sm.left.x : 0;
        const nz = riserFace ? -spec.side * sm.left.z : 0;
        gb.vertex(_p.x, _p.y + h, _p.z, nx, riserFace ? 0 : 1, nz, dl / 2, s / 2, col.r, col.g, col.b);
      }
      if (prev >= 0) {
        if (spec.side > 0) gb.stitch(prev, row, profile.length);
        else for (let k = 0; k < profile.length - 1; k++) gb.quad(prev + k, prev + k + 1, row + k + 1, row + k);
      }
      prev = row;
    }
    // walls: front, back and ends, plus roof structure, built from local frames every 12 m
    for (let i = 0; i < rowSamples.length - 1; i += 4) {
      const a = rowSamples[i];
      const bEnd = rowSamples[Math.min(rowSamples.length - 1, i + 4)];
      const segLen = track.distanceForward(a.s, bEnd.s);
      const fr = a.frame;
      const L = (v: number) => spec.side * v;
      orientedBox(gb, fr, 0, segLen, 0, baseH, L(a.base - 0.4), L(a.base + 0.1), concrete, 3); // front wall
      orientedBox(gb, fr, 0, segLen, 0, topH, L(a.base + topLat), L(a.base + topLat + 1.2), concrete, 3); // back wall
      // vomitory / access stair every other segment
      if (spec.roof) {
        const columnA = segLen * 0.5;
        orientedBox(roofGb, fr, columnA - 0.35, columnA + 0.35, topH, topH + 6.5, L(a.base + topLat + 0.3), L(a.base + topLat + 1.0), steel, 1);
        // sloping roof slab: approximate with two flat plates
        orientedBox(roofGb, fr, 0, segLen, topH + 6.0, topH + 6.35, L(a.base + topLat * 0.15), L(a.base + topLat + 1.4), roofCol, 3);
        orientedBox(roofGb, fr, 0, segLen, topH + 5.5, topH + 6.0, L(a.base + topLat * 0.15), L(a.base + topLat * 0.15 + 0.4), roofCol, 3); // fascia
        // rear roof beam
        orientedBox(roofGb, fr, 0, segLen, topH + 6.35, topH + 6.9, L(a.base + topLat + 0.2), L(a.base + topLat + 1.4), steel, 1);
      }
    }
    // end walls
    for (const end of [rowSamples[0], rowSamples[rowSamples.length - 1]]) {
      const fr = end.frame;
      const L = (v: number) => spec.side * v;
      const a0 = end === rowSamples[0] ? -0.6 : 0;
      orientedBox(gb, fr, a0, a0 + 0.6, 0, topH, L(end.base - 0.4), L(end.base + topLat + 1.2), concrete, 3);
    }
    const standMesh = new THREE.Mesh(d.geo(gb.build()), structMat);
    standMesh.castShadow = ctx.shadows;
    standMesh.receiveShadow = true;
    standMesh.name = 'grandstand';
    group.add(standMesh);
    ctx.shadowCasters.push(standMesh);
    if (!roofGb.isEmpty()) {
      const roofMesh = new THREE.Mesh(d.geo(roofGb.build()), roofMat);
      roofMesh.castShadow = ctx.shadows;
      roofMesh.receiveShadow = true;
      roofMesh.name = 'grandstand-roof';
      group.add(roofMesh);
      ctx.shadowCasters.push(roofMesh);
    }

    // crowd on every tread
    const density = densityBase;
    for (let r = 0; r < T; r++) {
      const lat = r * tread + 0.42;
      const h = baseH + r * riser;
      for (let ds = 0.3; ds < len - 0.3; ds += 0.56) {
        if (rng.next() > density) continue;
        const s = track.wrapS(spec.s0 + ds + rng.range(-0.12, 0.12));
        track.sample(s, sm);
        const b = spec.side > 0 ? sm.barrierL : sm.barrierR;
        _p.copy(sm.position).addScaledVector(sm.left, spec.side * (b + 5.5 + lat + rng.range(-0.1, 0.1)));
        const scale = rng.range(0.9, 1.1);
        crowdMats.push(matrixAt(_p.x, _p.y + h, _p.z, 0));
        const roll = rng.next();
        if (roll < 0.3) {
          const ti = Math.floor(rng.next() * TEAMS.length);
          _c.copy(rng.next() < 0.7 ? teamCols[ti] : teamCols2[ti]);
        } else if (roll < 0.42) _c.set('#f4f4f2');
        else _c.set(CLOTHES[Math.floor(rng.next() * CLOTHES.length)]);
        crowdCols.push(_c.clone());
        crowdAttr.push(rng.next(), Math.floor(rng.next() * 8), scale, 0);
        if (rng.next() < 0.07) {
          const ti = Math.floor(rng.next() * TEAMS.length);
          flagMats.push(matrixAt(_p.x, _p.y + h + 1.75 * scale, _p.z, sm.heading + rng.range(-0.6, 0.6)));
          flagCols.push(teamCols[ti].clone());
        }
      }
    }
    ctx.progress(0.5, 'Filling grandstands');
    await new Promise((r) => setTimeout(r, 0));
  }

  // shuffle so that a count prefix is a uniform subset
  const order = shuffle(crowdMats.map((_, i) => i), rng);
  const orderedMats = order.map((i) => crowdMats[i]);
  const orderedCols = order.map((i) => crowdCols[i]);
  const attr = new Float32Array(Math.max(1, order.length) * 4);
  order.forEach((i, j) => {
    attr[j * 4] = crowdAttr[i * 4];
    attr[j * 4 + 1] = crowdAttr[i * 4 + 1];
    attr[j * 4 + 2] = crowdAttr[i * 4 + 2];
    attr[j * 4 + 3] = crowdAttr[i * 4 + 3];
  });
  const quad = d.geo(new THREE.PlaneGeometry(0.62, 1.75));
  quad.translate(0, 0.875, 0);
  quad.setAttribute('aCrowd', new THREE.InstancedBufferAttribute(attr, 4));
  const crowdMat = makeCrowdMaterial(d, tex, uniforms);
  const crowd = instanced(quad, crowdMat, orderedMats, orderedCols, { castShadow: false, receiveShadow: false });
  crowd.name = 'crowd';
  crowd.userData.total = orderedMats.length;
  group.add(crowd);
  ctx.crowdMeshes.push(crowd);

  const flagGeo = d.geo(new THREE.PlaneGeometry(0.7, 0.45, 6, 2));
  flagGeo.translate(0.35, 0.225, 0);
  const aFlag = new Float32Array(Math.max(1, flagMats.length) * 4);
  for (let i = 0; i < flagMats.length; i++) {
    aFlag[i * 4] = rng.next();
    aFlag[i * 4 + 2] = rng.range(0, 2);
  }
  flagGeo.setAttribute('aFlag', new THREE.InstancedBufferAttribute(aFlag, 4));
  const flagMat = makeFlagMaterial(d, uniforms);
  const flags = instanced(flagGeo, flagMat, flagMats, flagCols, { castShadow: false, receiveShadow: false });
  flags.name = 'crowd-flags';
  flags.userData.total = flagMats.length;
  group.add(flags);
  ctx.crowdMeshes.push(flags);
  return { crowd, flags };
};

