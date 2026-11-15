import * as THREE from 'three';
import { TRACK } from '../core/constants';
import { TEAMS } from '../core/teams';
import { mergeTwo } from './barriers';
import { makeAsphaltMaterial, makeBuildingMaterial, makeFlagMaterial, makeLampMaterial } from './materials';
import { drawSign, fitText } from './textures';
import { Frame, GeoBuilder, makeScratchSample, matrixAt, orientedBox, stdMat, type BuildCtx, instanced } from './util';

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

export const buildPitComplex = async (ctx: BuildCtx): Promise<void> => {
  const { track, tex, disposer: d, palette, root, uniforms } = ctx;
  const pit = track.pitLane;
  const side = pit.side;
  const W = pit.width;
  const group = new THREE.Group();
  group.name = 'pit-complex';
  root.add(group);
  const sm = makeScratchSample();

  /* ── apron: paved area from the track edge to the barrier over the whole pit range ── */
  const apronMat = stdMat(d, { map: tex.runoffMap, roughness: 0.92, metalness: 0.02, color: new THREE.Color('#b3b1ac'), vertexColors: true });
  const laneMat = makeAsphaltMaterial(d, tex, uniforms, { pit: true });
  const apron = new GeoBuilder({ colors: true });
  const lane = new GeoBuilder({ colors: true, extra: 'aTrack' });
  let prevA = -1;
  let prevL = -1;
  let laneCount = 0;
  const LANE_N = 5;
  for (let dd = 0; dd <= pit.length; dd += 2) {
    const s = track.wrapS(pit.entryS + dd);
    track.sample(s, sm);
    const hw = sm.width / 2;
    const hasKerb = side > 0 ? sm.kerbL : sm.kerbR;
    const edge = hw + (hasKerb ? TRACK.kerbWidth : 0) + 0.02;
    const b = Math.max(edge + 2, side > 0 ? sm.barrierL : sm.barrierR) + 0.3;
    // apron
    const lats = [edge, edge + (b - edge) * 0.5, b];
    const rowA = apron.vertexCount;
    for (let i = 0; i < lats.length; i++) {
      _p.copy(sm.position).addScaledVector(sm.left, side * lats[i]);
      const v = 0.95 + 0.08 * Math.sin(dd * 0.31 + i);
      apron.vertex(_p.x, _p.y - 0.006, _p.z, 0, 1, 0, lats[i] / 5, dd / 5, v, v, v);
    }
    if (prevA >= 0) {
      if (side > 0) apron.stitch(prevA, rowA, lats.length);
      else for (let i = 0; i < lats.length - 1; i++) apron.quad(prevA + i, prevA + i + 1, rowA + i + 1, rowA + i);
    }
    prevA = rowA;
    // lane (clipped to the outside of the track asphalt)
    const pl = track.pitLaneLateralAtD(dd, sm.width) * side; // unsigned distance from centreline
    let near = pl - W / 2;
    const far = pl + W / 2;
    const clipped = near < hw + 0.05;
    if (clipped) near = hw + 0.05;
    if (far - near > 0.6) {
      const rowL = lane.vertexCount;
      for (let i = 0; i < LANE_N; i++) {
        const lat = near + ((far - near) * i) / (LANE_N - 1);
        _p.copy(sm.position).addScaledVector(sm.left, side * lat);
        const v = 0.96 + 0.06 * Math.sin(dd * 0.17 + i * 1.3);
        // aTrack: lateral relative to the lane centre; edge lines only where the lane is fully separate
        lane.vertex(_p.x, _p.y + 0.002, _p.z, 0, 1, 0, lat / 4, dd / 4, v, v, v, (lat - pl) * side, 999, clipped ? 999 : W / 2, dd);
      }
      if (prevL >= 0 && laneCount > 0) {
        if (side > 0) lane.stitch(prevL, rowL, LANE_N);
        else for (let i = 0; i < LANE_N - 1; i++) lane.quad(prevL + i, prevL + i + 1, rowL + i + 1, rowL + i);
      }
      prevL = rowL;
      laneCount++;
    } else {
      prevL = -1;
      laneCount = 0;
    }
  }
  const apronMesh = new THREE.Mesh(d.geo(apron.build()), apronMat);
  apronMesh.receiveShadow = true;
  apronMesh.name = 'pit-apron';
  group.add(apronMesh);
  const laneMesh = new THREE.Mesh(d.geo(lane.build()), laneMat);
  laneMesh.receiveShadow = true;
  laneMesh.name = 'pit-lane';
  group.add(laneMesh);
  await new Promise((r) => setTimeout(r, 0));

  /* ── paint: fast-lane divider, box markings, speed-limit line ── */
  const paint = new GeoBuilder({ colors: true });
  const white = new THREE.Color('#f0f0ee');
  const yellow = new THREE.Color('#f5c518');
  const paintQuad = (s: number, latC: number, len: number, wid: number, col: THREE.Color) => {
    track.sample(s, sm);
    const row = paint.vertexCount;
    const cs: [number, number][] = [
      [-len / 2, -wid / 2],
      [len / 2, -wid / 2],
      [len / 2, wid / 2],
      [-len / 2, wid / 2],
    ];
    for (const [ds, dl] of cs) {
      _p.copy(sm.position).addScaledVector(sm.tangent, ds).addScaledVector(sm.left, side * (latC + dl));
      paint.vertex(_p.x, _p.y + 0.012, _p.z, 0, 1, 0, 0, 0, col.r, col.g, col.b);
    }
    if (side > 0) paint.quad(row, row + 3, row + 2, row + 1);
    else paint.quad(row, row + 1, row + 2, row + 3);
  };
  const offAbs = Math.abs(pit.offset);
  for (let dd = pit.transition; dd < pit.length - pit.transition; dd += 4) paintQuad(track.wrapS(pit.entryS + dd), offAbs - 1.4, 2, 0.15, white);
  paintQuad(track.wrapS(pit.entryS + pit.limitStartD), offAbs, 0.3, W - 0.6, white);
  paintQuad(track.wrapS(pit.entryS + pit.limitEndD), offAbs, 0.3, W - 0.6, white);
  for (let i = 0; i < 10; i++) {
    const box = track.pitBox(i);
    const latC = Math.abs(box.lateral) + 1.6;
    paintQuad(box.s, latC, 6.4, 0.14, white);
    paintQuad(box.s, latC + 1.4, 0.14, 2.9, white);
    paintQuad(box.s, latC - 1.4, 0.14, 2.9, white);
    paintQuad(box.s + 3.2, latC, 0.14, 2.9, white);
    paintQuad(box.s - 3.2, latC, 0.14, 2.9, white);
    paintQuad(box.s + 1.9, latC, 0.16, 2.5, yellow);
  }
  const paintMat = stdMat(d, { vertexColors: true, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const paintMesh = new THREE.Mesh(d.geo(paint.build()), paintMat);
  paintMesh.name = 'pit-paint';
  group.add(paintMesh);

  /* ── pit wall (track side of the lane) + outer lane wall ── */
  const concreteMat = stdMat(d, { map: tex.concreteMap, normalMap: tex.concreteNormal, roughness: 0.9, metalness: 0, vertexColors: true });
  const fenceMat = stdMat(d, { map: tex.fenceMap, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
  const wallGb = new GeoBuilder({ colors: true });
  const fenceGb = new GeoBuilder();
  const wallFrom = pit.transition;
  const wallTo = pit.length - pit.transition;
  const frame = new Frame();
  const grey = new THREE.Color('#c9c7c0');
  const stripe = new THREE.Color(palette.barrierStripe);
  const boxes = TEAMS.map((t) => track.pitBox(t.pitBoxIndex));
  const bMin = Math.min(...boxes.map((b) => track.distanceForward(pit.entryS, b.s)));
  const bMax = Math.max(...boxes.map((b) => track.distanceForward(pit.entryS, b.s)));
  const bldFrom = bMin - 14;
  const bldTo = bMax + 14;
  for (let dd = wallFrom; dd < wallTo; dd += 6) {
    const d1 = Math.min(wallTo, dd + 6);
    const sMid = track.wrapS(pit.entryS + (dd + d1) / 2);
    track.sample(sMid, sm);
    frame.set(sm);
    const hw = sm.width / 2;
    const wallLat = side * (hw + TRACK.kerbWidth + 1.4);
    const half = (d1 - dd) / 2;
    orientedBox(wallGb, frame, -half, half, 0, 1.0, wallLat - side * 0.2, wallLat + side * 0.2, grey, 2);
    orientedBox(wallGb, frame, -half, half, 1.0, 1.12, wallLat - side * 0.2, wallLat + side * 0.2, stripe, 2, { bottom: false });
    // low fence on the pit wall
    frame.to(-half, 1.12, wallLat, _p);
    frame.to(half, 1.12, wallLat, _q);
    fenceQuad(fenceGb, _p, _q, 1.3, side, sm.left);
    // outer wall where there is no building
    const inBld = d1 > bldFrom && dd < bldTo;
    if (!inBld) {
      const outerLat = side * (offAbs + W / 2 + 0.6);
      orientedBox(wallGb, frame, -half, half, 0, 1.0, outerLat - side * 0.25, outerLat + side * 0.25, grey, 2);
      frame.to(-half, 1.0, outerLat, _p);
      frame.to(half, 1.0, outerLat, _q);
      fenceQuad(fenceGb, _p, _q, 2.6, -side, sm.left);
    }
  }
  const wallMesh = new THREE.Mesh(d.geo(wallGb.build()), concreteMat);
  wallMesh.castShadow = ctx.shadows;
  wallMesh.receiveShadow = true;
  wallMesh.name = 'pit-wall';
  group.add(wallMesh);
  ctx.shadowCasters.push(wallMesh);
  const fenceMesh = new THREE.Mesh(d.geo(fenceGb.build()), fenceMat);
  fenceMesh.name = 'pit-fence';
  group.add(fenceMesh);
  await new Promise((r) => setTimeout(r, 0));

  /* ── pit building ── */
  const midS = track.wrapS(pit.entryS + (bldFrom + bldTo) / 2);
  track.sample(midS, sm);
  frame.set(sm);
  const frontLat = offAbs + W / 2 + 1.0;
  const depth = 17;
  const halfLen = (bldTo - bldFrom) / 2;
  const bld = new GeoBuilder({ colors: true });
  const glassGb = new GeoBuilder({ colors: true });
  const teamGb = new GeoBuilder({ colors: true });
  const darkGb = new GeoBuilder({ colors: true });
  const lightGb = new GeoBuilder({ colors: true });
  const base = new THREE.Color(palette.buildingBase);
  const dark = new THREE.Color('#1a1c20');
  const cw = new THREE.Color('#ffffff');
  const L = (v: number) => side * v;
  const g0 = 0;
  const g1 = 5.4; // garage level
  const u1 = 10.2; // upper level
  // main slab behind the garage fronts (back part of the building)
  orientedBox(bld, frame, -halfLen, halfLen, g0, u1, L(frontLat + 1.2), L(frontLat + depth), base, 3, { front: true, back: true });
  // roof parapet
  orientedBox(bld, frame, -halfLen, halfLen, u1, u1 + 0.9, L(frontLat - 0.4), L(frontLat + depth), base, 3);
  // upper floor front: glass band with mullions and a balcony slab
  orientedBox(bld, frame, -halfLen, halfLen, g1, g1 + 0.5, L(frontLat - 1.6), L(frontLat + 1.4), base, 3);
  orientedBox(glassGb, frame, -halfLen, halfLen, g1 + 0.5, u1, L(frontLat - 0.1), L(frontLat + 1.2), new THREE.Color('#dfe9f0'), 4, { top: false });
  for (let k = -halfLen; k <= halfLen; k += 6) orientedBox(bld, frame, k - 0.12, k + 0.12, g1 + 0.5, u1, L(frontLat - 0.25), L(frontLat + 1.3), dark, 1);
  // balcony railing
  orientedBox(darkGb, frame, -halfLen, halfLen, g1 + 0.5, g1 + 1.6, L(frontLat - 1.65), L(frontLat - 1.55), dark, 1);
  // garages
  const garageMat = stdMat(d, { map: tex.garageAtlas.texture, roughness: 0.4, metalness: 0.1, emissive: new THREE.Color(0xffffff), emissiveMap: tex.garageAtlas.texture, emissiveIntensity: 0.6 });
  const garageSigns = new GeoBuilder();
  const crewMats: THREE.Matrix4[] = [];
  const crewCols: THREE.Color[] = [];
  const gantryMats: THREE.Matrix4[] = [];
  const gantryCols: THREE.Color[] = [];
  const roofFlags: THREE.Matrix4[] = [];
  const roofFlagCols: THREE.Color[] = [];
  const roofPoles: THREE.Matrix4[] = [];
  for (const team of TEAMS) {
    const box = track.pitBox(team.pitBoxIndex);
    const dBox = track.distanceForward(pit.entryS, box.s);
    const a = dBox - (bldFrom + bldTo) / 2; // along offset from the building centre
    _c.set(team.primaryColor);
    _c2.set(team.secondaryColor);
    // pillars between garages in team colour
    orientedBox(teamGb, frame, a - 4.25, a - 3.5, g0, g1, L(frontLat - 0.3), L(frontLat + 1.2), _c, 2);
    // door frame / lintel
    orientedBox(teamGb, frame, a - 3.5, a + 3.5, g1 - 0.9, g1, L(frontLat - 0.3), L(frontLat + 1.2), _c, 2);
    // interior: dark box with lit ceiling
    orientedBox(darkGb, frame, a - 3.5, a + 3.5, g0, g1 - 0.9, L(frontLat + 1.2), L(frontLat + 9), dark, 1, { front: false, back: false, sides: true, top: true });
    orientedBox(lightGb, frame, a - 3.0, a + 3.0, g1 - 1.0, g1 - 0.92, L(frontLat + 1.4), L(frontLat + 8.5), cw, 1);
    // light-box sign above the door
    const idx = tex.garageAtlas.add(`garage-${team.id}`, (c, w, h) => {
      c.fillStyle = team.primaryColor;
      c.fillRect(0, 0, w, h);
      c.fillStyle = team.secondaryColor;
      c.fillRect(0, h - 14, w, 14);
      fitText(c, team.shortName, 16, 10, w * 0.35, h - 34, { color: '#ffffff', weight: '900', italic: true });
      fitText(c, team.name.toUpperCase(), w * 0.4, 24, w * 0.56, h - 58, { color: '#ffffff', weight: '700', align: 'left' });
    });
    const cell = tex.garageAtlas.cell(idx);
    frame.to(a - 3.2, g1 - 0.85, L(frontLat - 0.32), _p);
    frame.to(a + 3.2, g1 - 0.85, L(frontLat - 0.32), _q);
    signQuad(garageSigns, _p, _q, 0.75, cell.u0, cell.v0, cell.u1, cell.v1, side, sm.left);
    // crew figures around the box (working lane side)
    const latC = Math.abs(box.lateral) + 1.6;
    const spots: [number, number][] = [
      [2.9, 0],
      [-2.9, 0],
      [1.6, 1.3],
      [1.6, -1.3],
      [-1.6, 1.3],
      [-1.6, -1.3],
      [0, 1.6],
      [4.2, 0.9],
    ];
    for (const [da, dl] of spots) {
      track.sample(box.s, sm);
      _p.copy(sm.position).addScaledVector(sm.tangent, da).addScaledVector(sm.left, side * (latC + dl));
      crewMats.push(matrixAt(_p.x, _p.y, _p.z, sm.heading + (dl > 0 ? Math.PI / 2 : -Math.PI / 2), 0.95, 0.95, 0.95));
      crewCols.push(_c.clone());
    }
    // pit wall gantry position (on the pit wall)
    track.sample(box.s, sm);
    const wallLat = side * (sm.width / 2 + TRACK.kerbWidth + 1.4);
    _p.copy(sm.position).addScaledVector(sm.left, wallLat);
    gantryMats.push(matrixAt(_p.x, _p.y, _p.z, sm.heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2)));
    gantryCols.push(_c.clone());
    // roof flags
    frame.set(track.sample(midS, sm));
    frame.to(a, u1 + 0.9, L(frontLat + 0.6), _p);
    roofPoles.push(matrixAt(_p.x, _p.y, _p.z, 0, 1, 1.6, 1));
    roofFlags.push(matrixAt(_p.x, _p.y + 4.6, _p.z, frame.yaw() + Math.PI / 2));
    roofFlagCols.push(_c.clone());
  }
  frame.set(track.sample(midS, sm));
  const addMesh = (gb: GeoBuilder, mat: THREE.Material, name: string, cast = true) => {
    if (gb.isEmpty()) return;
    const m = new THREE.Mesh(d.geo(gb.build()), mat);
    m.castShadow = cast && ctx.shadows;
    m.receiveShadow = true;
    m.name = name;
    group.add(m);
    if (cast) ctx.shadowCasters.push(m);
  };
  const bldMat = stdMat(d, { map: tex.concreteMap, roughness: 0.85, metalness: 0.02, vertexColors: true });
  const glassMat = stdMat(d, { map: tex.glassMap, roughness: 0.12, metalness: 0.6, vertexColors: true, envMapIntensity: 1.2 });
  const teamMat = stdMat(d, { vertexColors: true, roughness: 0.45, metalness: 0.1 });
  const darkMat = stdMat(d, { vertexColors: true, roughness: 0.8, metalness: 0.1 });
  const lightMat = makeLampMaterial(d, '#fff6e6', 1.4);
  addMesh(bld, bldMat, 'pit-building');
  addMesh(glassGb, glassMat, 'pit-building-glass', false);
  addMesh(teamGb, teamMat, 'pit-garage-fronts');
  addMesh(darkGb, darkMat, 'pit-garage-interiors', false);
  addMesh(lightGb, lightMat, 'pit-garage-lights', false);
  addMesh(garageSigns, garageMat, 'pit-garage-signs', false);
  ctx.night.push({ material: lightMat, dayIntensity: 0.8, nightIntensity: 2.2 });
  ctx.night.push({ material: garageMat, dayIntensity: 0.35, nightIntensity: 1.2 });

  // crews
  const body = d.geo(new THREE.CapsuleGeometry(0.2, 0.7, 3, 8));
  body.translate(0, 0.9, 0);
  const head = new THREE.SphereGeometry(0.13, 8, 6);
  head.translate(0, 1.5, 0);
  const figure = d.geo(mergeTwo(body, head));
  const crewMat = stdMat(d, { roughness: 0.75, metalness: 0.05, color: 0xffffff });
  const crews = instanced(figure, crewMat, crewMats, crewCols, { castShadow: false });
  crews.name = 'pit-crews';
  group.add(crews);

  // pit-wall gantries: platform + desk + roof (one merged geometry, team-coloured), monitors emissive
  const gGb = new GeoBuilder();
  const gf = new Frame();
  gf.origin.set(0, 0, 0);
  gf.fwd.set(0, 0, 1);
  gf.left.set(1, 0, 0);
  orientedBox(gGb, gf, -1.7, 1.7, 1.12, 1.3, -0.9, 0.9, undefined, 1); // platform
  orientedBox(gGb, gf, -1.5, 1.5, 1.3, 2.05, 0.35, 0.8, undefined, 1); // desk
  orientedBox(gGb, gf, -1.9, 1.9, 3.3, 3.42, -1.2, 1.0, undefined, 1); // roof
  orientedBox(gGb, gf, -1.8, -1.7, 1.3, 3.3, -1.0, -0.9, undefined, 1);
  orientedBox(gGb, gf, 1.7, 1.8, 1.3, 3.3, -1.0, -0.9, undefined, 1);
  orientedBox(gGb, gf, -1.8, -1.7, 1.3, 3.3, 0.8, 0.9, undefined, 1);
  orientedBox(gGb, gf, 1.7, 1.8, 1.3, 3.3, 0.8, 0.9, undefined, 1);
  const gantryGeo = d.geo(gGb.build());
  const gantryMat = stdMat(d, { roughness: 0.5, metalness: 0.3, color: 0xffffff });
  const gantries = instanced(gantryGeo, gantryMat, gantryMats, gantryCols, { castShadow: ctx.shadows });
  gantries.name = 'pit-wall-gantries';
  group.add(gantries);
  const monGb = new GeoBuilder();
  for (let k = -1; k <= 1; k++) orientedBox(monGb, gf, k * 0.95 - 0.4, k * 0.95 + 0.4, 2.1, 2.65, 0.6, 0.66, undefined, 1);
  const monGeo = d.geo(monGb.build());
  const monMat = makeLampMaterial(d, '#7fb6ff', 1.2);
  const monitors = instanced(monGeo, monMat, gantryMats, undefined, { castShadow: false });
  monitors.name = 'pit-monitors';
  group.add(monitors);
  ctx.night.push({ material: monMat, dayIntensity: 0.9, nightIntensity: 2.4 });

  // roof flags
  const flagMat = makeFlagMaterial(d, uniforms);
  const flagGeo = d.geo(new THREE.PlaneGeometry(2.4, 1.5, 8, 3));
  flagGeo.translate(1.2, 0.75, 0);
  const aFlag = new Float32Array(roofFlags.length * 4);
  for (let i = 0; i < roofFlags.length; i++) {
    aFlag[i * 4] = ctx.rng.next();
    aFlag[i * 4 + 2] = ctx.rng.next();
  }
  flagGeo.setAttribute('aFlag', new THREE.InstancedBufferAttribute(aFlag, 4));
  const flags = instanced(flagGeo, flagMat, roofFlags, roofFlagCols, { castShadow: false });
  flags.name = 'pit-roof-flags';
  group.add(flags);
  const poleGeo = d.geo(new THREE.CylinderGeometry(0.04, 0.05, 4.6, 6));
  poleGeo.translate(0, 2.3, 0);
  const poleMat = stdMat(d, { color: new THREE.Color('#e0e0e0'), roughness: 0.4, metalness: 0.6 });
  const poles = instanced(poleGeo, poleMat, roofPoles.map((m) => m), undefined, { castShadow: false });
  poles.name = 'pit-roof-poles';
  group.add(poles);
  await new Promise((r) => setTimeout(r, 0));

  /* ── speed-limit board & pit exit light ── */
  const signs = new GeoBuilder();
  const signMat = stdMat(d, { map: tex.boardAtlas.texture, roughness: 0.5, metalness: 0.05, transparent: true, alphaTest: 0.1 });
  const idx80 = tex.boardAtlas.add('pit-80', (c, w, h) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e10600';
    c.lineWidth = 16;
    c.beginPath();
    c.arc(w / 2, h / 2, h / 2 - 12, 0, Math.PI * 2);
    c.stroke();
    fitText(c, '80', w * 0.25, h * 0.22, w * 0.5, h * 0.56, { color: '#111', weight: '900' });
  });
  const cell80 = tex.boardAtlas.cell(idx80);
  {
    const s = track.wrapS(pit.entryS + pit.limitStartD);
    track.sample(s, sm);
    const wallLat = side * (sm.width / 2 + TRACK.kerbWidth + 1.4 + 0.5);
    _p.copy(sm.position).addScaledVector(sm.left, wallLat).addScaledVector(sm.tangent, 0.6);
    _q.copy(sm.position).addScaledVector(sm.left, wallLat).addScaledVector(sm.tangent, -0.6);
    _p.y += 2.2;
    _q.y += 2.2;
    signQuad(signs, _q, _p, 1.2, cell80.u0, cell80.v0, cell80.u1, cell80.v1, -side, sm.left);
    postAt(ctx, group, _p.x, _p.y - 2.2, _p.z, 2.3, 0.06);
  }
  const idxExit = tex.boardAtlas.add('pit-exit', (c, w, h) => drawSign(c, w, h, 'PIT EXIT', undefined, '#101418', '#ffffff', '#19c24a'));
  {
    const s = track.wrapS(pit.entryS + pit.length - pit.transition);
    track.sample(s, sm);
    const lat = side * (sm.width / 2 + TRACK.kerbWidth + 3.6);
    _p.copy(sm.position).addScaledVector(sm.left, lat).addScaledVector(sm.tangent, 0.9);
    _q.copy(sm.position).addScaledVector(sm.left, lat).addScaledVector(sm.tangent, -0.9);
    _p.y += 3.0;
    _q.y += 3.0;
    const ce = tex.boardAtlas.cell(idxExit);
    signQuad(signs, _q, _p, 1.2, ce.u0, ce.v0, ce.u1, ce.v1, -side, sm.left);
    postAt(ctx, group, _p.x, _p.y - 3.0, _p.z, 3.1, 0.07);
    // green lamps
    const lampGeo = d.geo(new THREE.SphereGeometry(0.16, 10, 8));
    const lampMat = makeLampMaterial(d, '#22e05a', 3);
    const lamps: THREE.Matrix4[] = [];
    for (let k = -1; k <= 1; k += 2) {
      _q.copy(sm.position).addScaledVector(sm.left, lat).addScaledVector(sm.tangent, k * 0.5);
      lamps.push(matrixAt(_q.x, _q.y + 4.5, _q.z));
    }
    const lm = instanced(lampGeo, lampMat, lamps, undefined, { castShadow: false });
    lm.name = 'pit-exit-lights';
    group.add(lm);
  }
  const signMesh = new THREE.Mesh(d.geo(signs.build()), signMat);
  signMesh.name = 'pit-signs';
  group.add(signMesh);

  /* ── paddock: media centre, hospitality, TV compound ── */
  buildPaddock(ctx, group, frame, halfLen, frontLat + depth + 6, side);
};

/** Vertical quad from a to b, `h` tall, facing toward -facingSide * left (i.e. toward the track when facingSide = pit side). */
const fenceQuad = (gb: GeoBuilder, a: THREE.Vector3, b: THREE.Vector3, h: number, facingSide: number, left: THREE.Vector3): void => {
  const row = gb.vertexCount;
  const nx = -facingSide * left.x;
  const nz = -facingSide * left.z;
  const len = a.distanceTo(b);
  gb.vertex(a.x, a.y, a.z, nx, 0, nz, 0, 0);
  gb.vertex(b.x, b.y, b.z, nx, 0, nz, len / 4, 0);
  gb.vertex(b.x, b.y + h, b.z, nx, 0, nz, len / 4, h / 4);
  gb.vertex(a.x, a.y + h, a.z, nx, 0, nz, 0, h / 4);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (-dz * nx + dx * nz > 0) gb.quad(row, row + 1, row + 2, row + 3);
  else gb.quad(row, row + 3, row + 2, row + 1);
};

/** Textured sign quad between a and b (bottom edge), h tall; faces -facingSide * left. */
export const signQuad = (gb: GeoBuilder, a: THREE.Vector3, b: THREE.Vector3, h: number, u0: number, v0: number, u1: number, v1: number, facingSide: number, left: THREE.Vector3): void => {
  const row = gb.vertexCount;
  const nx = -facingSide * left.x;
  const nz = -facingSide * left.z;
  gb.vertex(a.x, a.y, a.z, nx, 0, nz, u0, v0);
  gb.vertex(b.x, b.y, b.z, nx, 0, nz, u1, v0);
  gb.vertex(b.x, b.y + h, b.z, nx, 0, nz, u1, v1);
  gb.vertex(a.x, a.y + h, a.z, nx, 0, nz, u0, v1);
  // Winding (a, b, b+h) has normal (b-a) x up = (-dz, 0, dx); flip if that points away from the wanted normal.
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (-dz * nx + dx * nz > 0) gb.quad(row, row + 1, row + 2, row + 3);
  else gb.quad(row, row + 3, row + 2, row + 1);
};

const postAt = (ctx: BuildCtx, parent: THREE.Object3D, x: number, y: number, z: number, h: number, r: number): void => {
  const geo = ctx.disposer.geo(new THREE.CylinderGeometry(r, r * 1.1, h, 8));
  geo.translate(0, h / 2, 0);
  const m = new THREE.Mesh(geo, stdMat(ctx.disposer, { color: new THREE.Color('#9a9ea3'), roughness: 0.45, metalness: 0.7 }));
  m.position.set(x, y, z);
  m.castShadow = false;
  parent.add(m);
};

const buildPaddock = (ctx: BuildCtx, parent: THREE.Object3D, frame: Frame, halfLen: number, startLat: number, side: number): void => {
  const { disposer: d, tex, palette, uniforms, rng } = ctx;
  const L = (v: number) => side * v;
  const gb = new GeoBuilder({ colors: true });
  const glass = new GeoBuilder({ colors: true });
  const base = new THREE.Color(palette.buildingBase);
  const white = new THREE.Color('#f4f4f2');
  // media centre: long glass building
  orientedBox(gb, frame, -halfLen * 0.6, halfLen * 0.6, 0, 1.0, L(startLat), L(startLat + 20), base, 3);
  orientedBox(glass, frame, -halfLen * 0.6, halfLen * 0.6, 1.0, 12.5, L(startLat + 0.3), L(startLat + 19.7), new THREE.Color('#cfdde8'), 4);
  orientedBox(gb, frame, -halfLen * 0.6 - 0.5, halfLen * 0.6 + 0.5, 12.5, 13.4, L(startLat - 0.5), L(startLat + 20.5), base, 3);
  for (let k = -halfLen * 0.6; k <= halfLen * 0.6; k += 8) orientedBox(gb, frame, k - 0.15, k + 0.15, 1, 12.5, L(startLat - 0.1), L(startLat + 0.3), new THREE.Color('#2a2d33'), 1);
  // hospitality units: one per team along the paddock, team-coloured with a white roof
  const teamGb = new GeoBuilder({ colors: true });
  TEAMS.forEach((t, i) => {
    const a = -halfLen + 6 + i * ((2 * halfLen - 12) / 9);
    const col = new THREE.Color(t.primaryColor);
    orientedBox(teamGb, frame, a - 5.5, a + 5.5, 0, 5.6, L(startLat + 26), L(startLat + 34), col, 2);
    orientedBox(gb, frame, a - 5.8, a + 5.8, 5.6, 6.1, L(startLat + 25.6), L(startLat + 34.4), white, 2);
    orientedBox(glass, frame, a - 4.8, a + 4.8, 1.0, 4.6, L(startLat + 25.85), L(startLat + 26.05), new THREE.Color('#d8e6f0'), 2);
  });
  // TV compound: trucks and dishes beyond the hospitality row
  const truckGb = new GeoBuilder({ colors: true });
  const truckCol = new THREE.Color('#eeeeee');
  const stripe = new THREE.Color('#1c4fd6');
  for (let i = 0; i < 7; i++) {
    const a = -halfLen + 10 + i * 14 + rng.range(-2, 2);
    orientedBox(truckGb, frame, a - 6.5, a + 6.5, 0.9, 4.0, L(startLat + 40), L(startLat + 42.6), truckCol, 2);
    orientedBox(truckGb, frame, a - 6.5, a + 6.5, 2.2, 2.9, L(startLat + 39.9), L(startLat + 42.7), stripe, 2);
    orientedBox(truckGb, frame, a - 6.4, a + 6.4, 0.2, 0.9, L(startLat + 40.4), L(startLat + 42.2), new THREE.Color('#333'), 2);
  }
  const dishGeo = d.geo(new THREE.SphereGeometry(2.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  dishGeo.rotateX(-Math.PI / 2.6);
  dishGeo.translate(0, 3.2, 0);
  const dishMats: THREE.Matrix4[] = [];
  for (let i = 0; i < 4; i++) {
    frame.to(-halfLen + 12 + i * 9, 0, L(startLat + 47), _p);
    dishMats.push(matrixAt(_p.x, _p.y, _p.z, frame.yaw() + rng.range(-0.4, 0.4)));
  }
  const dishMat = stdMat(d, { color: new THREE.Color('#f2f2f2'), roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
  const dishes = instanced(dishGeo, dishMat, dishMats, undefined, { castShadow: false });
  dishes.name = 'tv-dishes';
  parent.add(dishes);

  const bldMat = stdMat(d, { map: tex.concreteMap, roughness: 0.85, metalness: 0.02, vertexColors: true });
  const glassMat = makeBuildingMaterial(d, uniforms, { vertexColors: true, roughness: 0.15, metalness: 0.55 }, [4, 3.6], 0.65);
  const teamMat = stdMat(d, { vertexColors: true, roughness: 0.5, metalness: 0.05 });
  const truckMat = stdMat(d, { vertexColors: true, roughness: 0.45, metalness: 0.2 });
  const add = (g: GeoBuilder, m: THREE.Material, name: string, cast = true) => {
    if (g.isEmpty()) return;
    const mesh = new THREE.Mesh(d.geo(g.build()), m);
    mesh.castShadow = cast && ctx.shadows;
    mesh.receiveShadow = true;
    mesh.name = name;
    parent.add(mesh);
    if (cast) ctx.shadowCasters.push(mesh);
    ctx.detailObjects.push(mesh);
  };
  add(gb, bldMat, 'paddock-buildings');
  add(glass, glassMat, 'paddock-glass', false);
  add(teamGb, teamMat, 'hospitality');
  add(truckGb, truckMat, 'tv-compound');
};
