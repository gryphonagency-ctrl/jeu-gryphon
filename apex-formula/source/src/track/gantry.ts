import * as THREE from 'three';
import { TRACK } from '../core/constants';
import { makeAtlasBoardMaterial, makeLampMaterial } from './materials';
import { drawSign } from './textures';
import { Frame, GeoBuilder, makeScratchSample, matrixAt, orientedBox, stdMat, turnSide, type BuildCtx, instanced } from './util';
import { AD_BRANDS } from './themes';

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

export interface StartLights {
  set(count: number): void;
}

/** Start/finish gantry with the 5-column light panel and the title banner. */
export const buildGantry = (ctx: BuildCtx): StartLights => {
  const { track, tex, disposer: d, root } = ctx;
  const sm = makeScratchSample();
  track.sample(0, sm);
  const frame = new Frame(sm);
  const side = track.pitLane.side;
  const hw = sm.width / 2;
  const pitCol = side * (hw + TRACK.kerbWidth + 1.4);
  const otherB = side > 0 ? sm.barrierR : sm.barrierL;
  const otherCol = -side * Math.max(hw + 2.2, otherB - 0.6);
  const group = new THREE.Group();
  group.name = 'gantry';
  root.add(group);

  const steel = new GeoBuilder({ colors: true });
  const grey = new THREE.Color('#d8dadd');
  const dark = new THREE.Color('#23262b');
  const H = 9.4;
  // columns (lattice look: a core box + corner tubes)
  for (const lat of [pitCol, otherCol]) {
    const base = lat === pitCol ? 1.1 : 0;
    orientedBox(steel, frame, -0.55, 0.55, base, H, lat - 0.55, lat + 0.55, dark, 1);
    for (const [da, dl] of [
      [-0.62, -0.62],
      [0.62, -0.62],
      [0.62, 0.62],
      [-0.62, 0.62],
    ])
      orientedBox(steel, frame, da - 0.09, da + 0.09, base, H + 0.2, lat + dl - 0.09, lat + dl + 0.09, grey, 1);
  }
  // beam across
  const lo = Math.min(pitCol, otherCol) - 0.7;
  const hi = Math.max(pitCol, otherCol) + 0.7;
  orientedBox(steel, frame, -0.7, 0.7, H - 1.4, H + 0.2, lo, hi, dark, 1);
  for (const [da, dy] of [
    [-0.75, H - 1.45],
    [0.75, H - 1.45],
    [-0.75, H + 0.1],
    [0.75, H + 0.1],
  ])
    orientedBox(steel, frame, da - 0.08, da + 0.08, dy - 0.08, dy + 0.08, lo, hi, grey, 1);
  // diagonal-ish braces (short boxes)
  for (let l = lo + 1.5; l < hi - 1.5; l += 3) orientedBox(steel, frame, -0.05, 0.05, H - 1.35, H + 0.05, l - 0.05, l + 0.05, grey, 1);
  const steelMat = stdMat(d, { map: tex.metalMap, roughness: 0.45, metalness: 0.75, vertexColors: true });
  const steelMesh = new THREE.Mesh(d.geo(steel.build()), steelMat);
  steelMesh.castShadow = ctx.shadows;
  steelMesh.receiveShadow = true;
  steelMesh.name = 'gantry-steel';
  group.add(steelMesh);
  ctx.shadowCasters.push(steelMesh);

  // banner (both faces)
  const banner = new GeoBuilder();
  const bannerMat = stdMat(d, { map: tex.banner, emissive: new THREE.Color(0xffffff), emissiveMap: tex.banner, emissiveIntensity: 0.25, roughness: 0.6, metalness: 0 });
  ctx.night.push({ material: bannerMat, dayIntensity: 0.15, nightIntensity: 1.1 });
  for (const face of [1, -1]) {
    const row = banner.vertexCount;
    const nx = frame.fwd.x * face;
    const nz = frame.fwd.z * face;
    // text starts on the viewer's left: seen from the grid (face -1) that is +left (hi)
    const l0 = face > 0 ? lo + 0.4 : hi - 0.4;
    const l1 = face > 0 ? hi - 0.4 : lo + 0.4;
    frame.to(face * 0.72, H - 3.7, l0, _p);
    banner.vertex(_p.x, _p.y, _p.z, nx, 0, nz, 0, 0);
    frame.to(face * 0.72, H - 3.7, l1, _p);
    banner.vertex(_p.x, _p.y, _p.z, nx, 0, nz, 1, 0);
    frame.to(face * 0.72, H - 1.5, l1, _p);
    banner.vertex(_p.x, _p.y, _p.z, nx, 0, nz, 1, 1);
    frame.to(face * 0.72, H - 1.5, l0, _p);
    banner.vertex(_p.x, _p.y, _p.z, nx, 0, nz, 0, 1);
    // winding: (v1-v0) x up must equal the normal direction
    const dx = frame.left.x * (l1 - l0);
    const dz = frame.left.z * (l1 - l0);
    if (-dz * nx + dx * nz > 0) banner.quad(row, row + 1, row + 2, row + 3);
    else banner.quad(row, row + 3, row + 2, row + 1);
  }
  const bannerMesh = new THREE.Mesh(d.geo(banner.build()), bannerMat);
  bannerMesh.name = 'gantry-banner';
  group.add(bannerMesh);

  // light panel hanging over the track centre, facing the grid (-fwd)
  const panel = new GeoBuilder({ colors: true });
  orientedBox(panel, frame, -0.35, 0.35, H - 6.2, H - 3.8, -1.7, 1.7, dark, 1);
  orientedBox(panel, frame, -0.12, 0.12, H - 3.8, H - 1.5, -0.12, 0.12, grey, 1);
  const panelMesh = new THREE.Mesh(d.geo(panel.build()), steelMat);
  panelMesh.castShadow = ctx.shadows;
  panelMesh.name = 'light-panel';
  group.add(panelMesh);
  const lampGeo = d.geo(new THREE.SphereGeometry(0.17, 12, 10));
  const offMat = stdMat(d, { color: new THREE.Color('#3a0808'), roughness: 0.3, metalness: 0.1 });
  const onMat = makeLampMaterial(d, '#ff2020', 6);
  const lamps: THREE.Mesh[][] = [];
  for (let col = 0; col < 5; col++) {
    const column: THREE.Mesh[] = [];
    for (let row = 0; row < 2; row++) {
      const lat = (col - 2) * 0.62;
      const y = H - 4.5 - row * 0.6;
      frame.to(-0.38, y, lat, _p);
      const m = new THREE.Mesh(lampGeo, offMat);
      m.position.copy(_p);
      m.name = `start-light-${col}-${row}`;
      group.add(m);
      column.push(m);
    }
    lamps.push(column);
  }
  let lit = -1;
  return {
    set(count: number) {
      if (count === lit) return;
      lit = count;
      for (let c = 0; c < 5; c++) for (const m of lamps[c]) m.material = c < count ? onMat : offMat;
    },
  };
};

/** Braking boards, DRS boards, corner boards, km boards, ad boards on the barriers, mega-boards. */
export const buildBoards = (ctx: BuildCtx): void => {
  const { track, tex, disposer: d, root, uniforms, rng, theme } = ctx;
  const S = track.samples;
  const sm = makeScratchSample();
  const group = new THREE.Group();
  group.name = 'boards';
  root.add(group);
  const pit = track.pitLane;

  const boardGeo = d.geo(new THREE.PlaneGeometry(1, 1));
  boardGeo.translate(0, 0.5, 0);
  const cells: number[] = [];
  const mats: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const push = (s: number, lat: number, cellIdx: number, w: number, h: number, baseY: number, facing: 'back' | 'front' | 'in' = 'back') => {
    track.sample(s, sm);
    _p.copy(sm.position).addScaledVector(sm.left, lat);
    // PlaneGeometry faces +Z; yaw so +Z faces backwards along the track (toward approaching cars)
    let yaw = sm.heading + Math.PI;
    if (facing === 'front') yaw = sm.heading;
    if (facing === 'in') yaw = sm.heading + (lat > 0 ? -Math.PI / 2 : Math.PI / 2);
    mats.push(matrixAt(_p.x, _p.y + baseY, _p.z, yaw, w, h, 1));
    const c = tex.boardAtlas.cell(cellIdx);
    cells.push(c.u0, c.v0, c.u1, c.v1);
    posts.push(matrixAt(_p.x, _p.y, _p.z, yaw, w * 0.7, baseY + h * 0.2, 1));
  };
  const cellFor = (key: string, big: string, small?: string, band = '#e10600', bg = '#101418', fg = '#ffffff') => tex.boardAtlas.add(key, (c, w, h) => drawSign(c, w, h, big, small, bg, fg, band));
  const c150 = cellFor('150', '150');
  const c100 = cellFor('100', '100');
  const c50 = cellFor('50', '50');
  const cDrs = cellFor('drs', 'DRS', 'ZONE', '#19c24a');
  const cDet = cellFor('det', 'DRS', 'DETECTION', '#ffd400');

  const curvAt = (s: number) => Math.abs(track.sampleAt(s).curvature);
  const isPitSideRange = (s: number, lat: number) => Math.sign(lat) === pit.side && track.pitD(s) >= 0;
  const insideLat = (s: number, side: number, extra = 0.9): number => {
    track.sample(s, sm);
    const hw = sm.width / 2;
    const k = side > 0 ? sm.kerbL : sm.kerbR;
    return side * (hw + (k ? TRACK.kerbWidth : 0) + extra);
  };
  const barrierLat = (s: number, side: number, inset = 1.0): number => {
    track.sample(s, sm);
    const b = side > 0 ? sm.barrierL : sm.barrierR;
    const hw = sm.width / 2;
    return side * Math.max(hw + TRACK.kerbWidth + 0.8, b - inset);
  };

  // corner boards + braking boards
  const corners = track.cornersWithS();
  for (const c of corners) {
    const k = track.sampleAt(c.s).curvature;
    const dir = turnSide(k, 1 / 400);
    if (dir === 0) continue;
    const cc = cellFor(`corner-${c.number}`, `T${c.number}`, c.name.toUpperCase(), '#2f7cff');
    push(track.wrapS(c.s - 30), insideLat(c.s - 30, dir, 1.2), cc, 1.4, 1.0, 1.1, 'back');
    if (Math.abs(k) < 1 / 150) continue;
    // walk back to the corner entry
    let sE = c.s;
    for (let i = 0; i < 400; i++) {
      if (curvAt(sE - 2) < 1 / 500) break;
      sE -= 2;
    }
    const outside = -dir;
    const list: [number, number][] = [
      [50, c50],
      [100, c100],
      [150, c150],
    ];
    for (const [dist, cell] of list) {
      const s = track.wrapS(sE - dist);
      if (curvAt(s) > 1 / 300) continue;
      const lat = barrierLat(s, outside, theme === 'street' ? 0.7 : 1.1);
      if (isPitSideRange(s, lat)) continue;
      push(s, lat, cell, 1.3, 1.5, 1.0, 'back');
    }
  }
  // DRS boards at zone starts (both sides) and detection markers
  for (const z of track.drsZones) {
    for (const side of [1, -1]) {
      const lat = barrierLat(z.startS, side, 1.0);
      if (isPitSideRange(z.startS, lat)) continue;
      push(z.startS, lat, cDrs, 1.3, 1.5, 1.0, 'back');
    }
    const side = -pit.side;
    push(z.detectionS, barrierLat(z.detectionS, side, 1.0), cDet, 1.3, 1.1, 1.0, 'back');
  }
  // km boards
  for (let km = 1; km * 1000 < track.length - 200; km++) {
    const s = km * 1000;
    const side = -pit.side;
    const cell = cellFor(`km${km}`, `${km} km`, undefined, '#ffffff', '#f2f2f0', '#111111');
    push(s, barrierLat(s, side, 1.0), cell, 1.0, 0.8, 1.2, 'back');
  }
  const boardMat = makeAtlasBoardMaterial(d, tex.boardAtlas.texture, uniforms, 0.5);
  boardMat.side = THREE.DoubleSide;
  const boardGeoI = boardGeo.clone();
  d.geo(boardGeoI);
  boardGeoI.setAttribute('aCell', new THREE.InstancedBufferAttribute(Float32Array.from(cells), 4));
  const boards = instanced(boardGeoI, boardMat, mats, undefined, { castShadow: false });
  boards.name = 'sign-boards';
  group.add(boards);
  // posts: two legs
  const legs = new GeoBuilder();
  const lf = new Frame();
  lf.fwd.set(0, 0, 1);
  lf.left.set(1, 0, 0);
  orientedBox(legs, lf, -0.03, 0.03, 0, 1, -0.53, -0.47, undefined, 1);
  orientedBox(legs, lf, -0.03, 0.03, 0, 1, 0.47, 0.53, undefined, 1);
  const legGeo = d.geo(legs.build());
  const legMat = stdMat(d, { color: new THREE.Color('#8f9398'), roughness: 0.5, metalness: 0.7 });
  const legMesh = instanced(legGeo, legMat, posts, undefined, { castShadow: false });
  legMesh.name = 'sign-posts';
  group.add(legMesh);

  /* ── ad boards on barriers ── */
  const adCells: number[] = [];
  const adMats: THREE.Matrix4[] = [];
  const frameMats: THREE.Matrix4[] = [];
  const adGeo = d.geo(new THREE.PlaneGeometry(1, 1));
  adGeo.translate(0, 0.5, 0);
  const n = S.length;
  const step = Math.round(8 / track.spacing);
  let brand = 0;
  let run = 0;
  for (const side of [1, -1] as const) {
    for (let i = 0; i < n; i += step) {
      const s = S[i].s;
      const k = S[i].curvature;
      const outside = turnSide(k, 1 / 300) === -side;
      const straight = Math.abs(k) < 1 / 500;
      if (!(outside || straight)) {
        run = 0;
        continue;
      }
      if (side === pit.side && track.pitD(s) >= 0) continue;
      track.sample(s, sm);
      const b = side > 0 ? sm.barrierL : sm.barrierR;
      const hw = sm.width / 2;
      if (b < hw + TRACK.kerbWidth + 2.2 && theme !== 'street') continue;
      if ((run++ % 3) === 0) brand = (brand + 1) % AD_BRANDS.length;
      // Only every other 8 m slot on straights so the boards do not form a continuous wall
      if (straight && !outside && i % (step * 2) !== 0) continue;
      const lat = side * (b + 0.35);
      _p.copy(sm.position).addScaledVector(sm.left, lat);
      const yaw = sm.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      const h = theme === 'street' ? 1.0 : 1.05;
      const baseY = theme === 'street' ? 1.05 : sm.curvature !== 0 && outside ? 1.25 : 0.85;
      adMats.push(matrixAt(_p.x, _p.y + baseY, _p.z, yaw, 7.2, h, 1));
      frameMats.push(matrixAt(_p.x, _p.y + baseY - 0.05, _p.z, yaw, 7.35, h + 0.1, 1));
      const c = tex.adAtlas.cell(brand);
      adCells.push(c.u0, c.v0, c.u1, c.v1);
    }
  }
  // mega-boards behind the main straight (non-pit side), tall on posts
  const mega = [-120, 60, 190];
  for (const s of mega) {
    track.sample(track.wrapS(s), sm);
    const side = -pit.side;
    const b = side > 0 ? sm.barrierL : sm.barrierR;
    _p.copy(sm.position).addScaledVector(sm.left, side * (b + 24));
    const yaw = sm.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    adMats.push(matrixAt(_p.x, _p.y + 12, _p.z, yaw, 30, 5, 1));
    frameMats.push(matrixAt(_p.x, _p.y + 11.8, _p.z, yaw, 30.6, 5.4, 1));
    const c = tex.adAtlas.cell(Math.floor(rng.next() * AD_BRANDS.length));
    adCells.push(c.u0, c.v0, c.u1, c.v1);
    // posts for the mega-board
    const pg = d.geo(new THREE.CylinderGeometry(0.25, 0.3, 12, 8));
    pg.translate(0, 6, 0);
    const pm = new THREE.Mesh(pg, legMat);
    pm.position.copy(_p);
    pm.castShadow = ctx.shadows;
    group.add(pm);
  }
  if (adMats.length) {
    const adGeoI = adGeo.clone();
    d.geo(adGeoI);
    adGeoI.setAttribute('aCell', new THREE.InstancedBufferAttribute(Float32Array.from(adCells), 4));
    const adMat = makeAtlasBoardMaterial(d, tex.adAtlas.texture, uniforms, 0.6);
    const ads = instanced(adGeoI, adMat, adMats, undefined, { castShadow: false });
    ads.name = 'ad-boards';
    group.add(ads);
    const frameGeo = d.geo(new THREE.BoxGeometry(1, 1, 0.08));
    frameGeo.translate(0, 0.5, -0.05);
    const frameMat = stdMat(d, { color: new THREE.Color('#1c1e22'), roughness: 0.6, metalness: 0.3 });
    const frames = instanced(frameGeo, frameMat, frameMats, undefined, { castShadow: ctx.shadows });
    frames.name = 'ad-frames';
    group.add(frames);
  }
};

/** Two pedestrian bridges over straights with ad banners, plus TV camera towers at the biggest corners. */
export const buildBridgesAndTowers = (ctx: BuildCtx): void => {
  const { track, tex, disposer: d, root, uniforms, rng } = ctx;
  const sm = makeScratchSample();
  const group = new THREE.Group();
  group.name = 'bridges';
  root.add(group);
  const L = track.length;
  const pit = track.pitLane;
  const steelMat = stdMat(d, { map: tex.metalMap, roughness: 0.45, metalness: 0.75, vertexColors: true });
  const trussMat = stdMat(d, { map: tex.fenceMap, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
  const adMat = makeAtlasBoardMaterial(d, tex.adAtlas.texture, uniforms, 0.6);
  const grey = new THREE.Color('#cfd3d8');
  const dark = new THREE.Color('#2a2d33');
  const adCells: number[] = [];
  const adMats: THREE.Matrix4[] = [];
  const adGeo = d.geo(new THREE.PlaneGeometry(1, 1));
  adGeo.translate(0, 0.5, 0);
  const candidates = [0.38, 0.72].map((f) => track.wrapS(f * L));
  for (let sRaw of candidates) {
    // find a straight spot not in the pit range
    let ok = false;
    for (let t = 0; t < 60 && !ok; t++) {
      const k = Math.abs(track.sampleAt(sRaw).curvature);
      ok = k < 1 / 600 && track.pitD(sRaw) < 0;
      if (!ok) sRaw = track.wrapS(sRaw + 25);
    }
    if (!ok) continue;
    track.sample(sRaw, sm);
    const frame = new Frame(sm);
    const bL = sm.barrierL + 3;
    const bR = -(sm.barrierR + 3);
    const H = 6.2;
    const gb = new GeoBuilder({ colors: true });
    // deck
    orientedBox(gb, frame, -1.6, 1.6, H, H + 0.3, bR - 2.5, bL + 2.5, dark, 1);
    // side trusses (solid rails + lattice)
    for (const a of [-1.65, 1.65]) {
      orientedBox(gb, frame, a - 0.08, a + 0.08, H + 0.3, H + 0.42, bR - 2.5, bL + 2.5, grey, 1);
      orientedBox(gb, frame, a - 0.08, a + 0.08, H + 2.4, H + 2.55, bR - 2.5, bL + 2.5, grey, 1);
    }
    // towers with stairs
    for (const lat of [bL + 2.5, bR - 2.5]) {
      const dirl = Math.sign(lat);
      orientedBox(gb, frame, -1.8, 1.8, 0, H + 2.6, lat, lat + dirl * 3.6, grey, 2);
      orientedBox(gb, frame, -1.9, 1.9, H + 2.6, H + 2.9, lat - dirl * 0.2, lat + dirl * 3.8, dark, 1);
    }
    const mesh = new THREE.Mesh(d.geo(gb.build()), steelMat);
    mesh.castShadow = ctx.shadows;
    mesh.receiveShadow = true;
    mesh.name = 'bridge';
    group.add(mesh);
    ctx.shadowCasters.push(mesh);
    // lattice panels
    const lat = new GeoBuilder();
    for (const a of [-1.65, 1.65]) {
      frame.to(a, H + 0.42, bR - 2.5, _p);
      frame.to(a, H + 0.42, bL + 2.5, _q);
      const row = lat.vertexCount;
      const nx = frame.fwd.x * Math.sign(a);
      const nz = frame.fwd.z * Math.sign(a);
      const len = _p.distanceTo(_q);
      lat.vertex(_p.x, _p.y, _p.z, nx, 0, nz, 0, 0);
      lat.vertex(_q.x, _q.y, _q.z, nx, 0, nz, len / 4, 0);
      lat.vertex(_q.x, _q.y + 2, _q.z, nx, 0, nz, len / 4, 0.5);
      lat.vertex(_p.x, _p.y + 2, _p.z, nx, 0, nz, 0, 0.5);
      lat.quad(row, row + 1, row + 2, row + 3);
    }
    const latMesh = new THREE.Mesh(d.geo(lat.build()), trussMat);
    latMesh.name = 'bridge-lattice';
    group.add(latMesh);
    // ad banners on both faces of the bridge
    for (const face of [1, -1]) {
      frame.to(face * 1.75, H + 0.5, 0, _p);
      const yaw = frame.yaw() + (face > 0 ? 0 : Math.PI);
      adMats.push(matrixAt(_p.x, _p.y, _p.z, yaw, Math.min(30, bL - bR - 2), 1.8, 1));
      const c = tex.adAtlas.cell(Math.floor(rng.next() * AD_BRANDS.length));
      adCells.push(c.u0, c.v0, c.u1, c.v1);
    }
  }
  // TV camera towers at the 6 sharpest corners (outside)
  const corners = track.cornersWithS().map((c) => ({ ...c, k: track.sampleAt(c.s).curvature })).sort((a, b) => Math.abs(b.k) - Math.abs(a.k)).slice(0, 6);
  const towerGb = new GeoBuilder({ colors: true });
  const tf = new Frame();
  tf.fwd.set(0, 0, 1);
  tf.left.set(1, 0, 0);
  for (const [a, l] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ])
    orientedBox(towerGb, tf, a - 0.08, a + 0.08, 0, 7.2, l - 0.08, l + 0.08, grey, 1);
  for (let y = 1.8; y < 7; y += 1.8) {
    orientedBox(towerGb, tf, -1.05, 1.05, y, y + 0.1, -1.05, -0.95, grey, 1);
    orientedBox(towerGb, tf, -1.05, 1.05, y, y + 0.1, 0.95, 1.05, grey, 1);
    orientedBox(towerGb, tf, -1.05, -0.95, y, y + 0.1, -1.05, 1.05, grey, 1);
    orientedBox(towerGb, tf, 0.95, 1.05, y, y + 0.1, -1.05, 1.05, grey, 1);
  }
  orientedBox(towerGb, tf, -1.3, 1.3, 7.2, 7.4, -1.3, 1.3, dark, 1);
  orientedBox(towerGb, tf, -1.3, 1.3, 7.4, 8.4, -1.3, -1.25, grey, 1);
  orientedBox(towerGb, tf, -1.3, 1.3, 7.4, 8.4, 1.25, 1.3, grey, 1);
  orientedBox(towerGb, tf, -0.3, 0.3, 8.6, 9.1, -0.9, 0.3, dark, 1); // camera
  orientedBox(towerGb, tf, -0.5, 0.5, 8.4, 8.6, -0.5, 0.5, grey, 1);
  const towerGeo = d.geo(towerGb.build());
  const towerMats: THREE.Matrix4[] = [];
  for (const c of corners) {
    const dir = turnSide(c.k, 1 / 400);
    if (dir === 0) continue;
    const side = -dir;
    const s = track.wrapS(c.s + 25);
    if (side === pit.side && track.pitD(s) >= 0) continue;
    track.sample(s, sm);
    const b = side > 0 ? sm.barrierL : sm.barrierR;
    _p.copy(sm.position).addScaledVector(sm.left, side * (b + 7));
    towerMats.push(matrixAt(_p.x, _p.y, _p.z, sm.heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2)));
  }
  if (towerMats.length) {
    const towers = instanced(towerGeo, steelMat, towerMats, undefined, { castShadow: ctx.shadows });
    towers.name = 'tv-towers';
    group.add(towers);
    ctx.detailObjects.push(towers);
  }
  if (adMats.length) {
    const g = adGeo.clone();
    d.geo(g);
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(Float32Array.from(adCells), 4));
    const ads = instanced(g, adMat, adMats, undefined, { castShadow: false });
    ads.name = 'bridge-ads';
    group.add(ads);
  }
};
