import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CORE_CIRCUITS } from '../core/circuits';
import type { QualityLevel } from '../core/constants';
import { TrackSpline } from '../core/track/TrackSpline';
import type { FlagType, TrackDefinition, World } from '../core/types';
import { CIRCUITS } from './circuits';
import { TrackBuilder } from './TrackBuilder';
import { nightFactor } from './util';

const ALL: TrackDefinition[] = [...CORE_CIRCUITS, ...CIRCUITS];
const QUALITIES: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const FLAGS: FlagType[] = ['green', 'yellow', 'double-yellow', 'blue', 'red', 'chequered'];

const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const plot = document.getElementById('plot') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const statsEl = document.getElementById('stats') as HTMLDivElement;
const load = document.getElementById('load') as HTMLDivElement;
const loadLabel = document.getElementById('label') as HTMLDivElement;
const loadBar = load.querySelector('#bar > div') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 30000);
camera.position.set(-60, 30, -120);
const controls = new OrbitControls(camera, glCanvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.01;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;

const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x53442c, 0.45);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
const sunTarget = new THREE.Object3D();
scene.add(sun, sunTarget);
sun.target = sunTarget;

const state = {
  index: 0,
  topDown: false,
  timeOfDay: 14,
  wet: 0,
  lights: 0,
  flag: 0,
  quality: 2,
  overlay: true,
  fly: false,
  building: false,
};

const world = {
  env: { timeOfDay: 14, weather: { wetness: 0 } },
  race: { phase: 'racing', lightsOn: 0, sectorFlags: ['green', 'green', 'green'] as [FlagType, FlagType, FlagType] },
} as unknown as World;

const builder = new TrackBuilder();
let track: TrackSpline | null = null;
let def: TrackDefinition | null = null;

/* ─────────────────────────── validation ─────────────────────────── */

const segIntersect = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean => {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
};

interface Report {
  length: number;
  minRadius: number;
  minRadiusS: number;
  maxGrade: number;
  pitLen: number;
  gridOk: boolean;
  gridCurv: number;
  intersections: number;
  minClearance: number;
  sfStraight: number;
}

const analyse = (t: TrackSpline): Report => {
  const S = t.samples;
  let maxCurv = 0;
  let minRadiusS = 0;
  let maxGrade = 0;
  for (const s of S) {
    if (Math.abs(s.curvature) > maxCurv) {
      maxCurv = Math.abs(s.curvature);
      minRadiusS = s.s;
    }
    maxGrade = Math.max(maxGrade, Math.abs(s.grade));
  }
  // polyline self-intersection (edges of the asphalt, both sides) at 6 m steps
  const step = Math.max(1, Math.round(6 / t.spacing));
  const pts: [number, number][][] = [[], []];
  for (let i = 0; i < S.length; i += step) {
    const s = S[i];
    const hw = s.width / 2 + 1.2;
    pts[0].push([s.position.x + s.left.x * hw, s.position.z + s.left.z * hw]);
    pts[1].push([s.position.x - s.left.x * hw, s.position.z - s.left.z * hw]);
  }
  let intersections = 0;
  for (const poly of pts) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const c = poly[j];
        const d = poly[(j + 1) % n];
        if (segIntersect(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])) intersections++;
      }
    }
  }
  // corridor clearance: centreline points far apart in s but close in space
  let minClearance = Infinity;
  const cs = Math.max(1, Math.round(10 / t.spacing));
  for (let i = 0; i < S.length; i += cs) {
    for (let j = i + cs; j < S.length; j += cs) {
      const ds = Math.min(S[j].s - S[i].s, t.length - (S[j].s - S[i].s));
      if (ds < 150) continue;
      const d = Math.hypot(S[i].position.x - S[j].position.x, S[i].position.z - S[j].position.z);
      const need = (S[i].barrierL + S[i].barrierR + S[j].barrierL + S[j].barrierR) / 2;
      minClearance = Math.min(minClearance, d - need);
    }
  }
  const g19 = t.gridSlot(19);
  const gs = t.sampleAt(g19.s);
  // straight length before S/F
  let sf = 0;
  for (let s = 0; s < 1500; s += 5) {
    if (Math.abs(t.sampleAt(t.wrapS(-s)).curvature) > 1 / 900) break;
    sf = s;
  }
  return {
    length: t.length,
    minRadius: 1 / Math.max(1e-6, maxCurv),
    minRadiusS,
    maxGrade,
    pitLen: t.pitLane.length,
    gridOk: Math.abs(gs.curvature) < 1 / 1500,
    gridCurv: gs.curvature,
    intersections,
    minClearance,
    sfStraight: sf,
  };
};

/* ─────────────────────────── 2D plot ─────────────────────────── */

const drawPlot = (t: TrackSpline, d: TrackDefinition): void => {
  const ctx = plot.getContext('2d')!;
  const W = plot.width;
  const H = plot.height;
  ctx.clearRect(0, 0, W, H);
  const b = t.bounds;
  const pad = 70;
  const sx = (W - pad * 2) / (b.max.x - b.min.x);
  const sz = (H - pad * 2) / (b.max.z - b.min.z);
  const k = Math.min(sx, sz);
  const ox = W / 2 - ((b.min.x + b.max.x) / 2) * k;
  const oz = H / 2 - ((b.min.z + b.max.z) / 2) * k;
  const X = (x: number) => ox + x * k;
  const Z = (z: number) => oz + z * k;
  const S = t.samples;
  const stroke = (side: number, lat: (s: (typeof S)[number]) => number, color: string, width: number, filter?: (s: (typeof S)[number]) => boolean) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= S.length; i++) {
      const s = S[i % S.length];
      if (filter && !filter(s)) {
        pen = false;
        continue;
      }
      const l = lat(s) * side;
      const x = X(s.position.x + s.left.x * l);
      const z = Z(s.position.z + s.left.z * l);
      if (!pen) {
        ctx.moveTo(x, z);
        pen = true;
      } else ctx.lineTo(x, z);
    }
    ctx.stroke();
  };
  // barriers
  stroke(1, (s) => s.barrierL, '#6b7684', 2);
  stroke(-1, (s) => s.barrierR, '#6b7684', 2);
  // run-off fill hints
  stroke(1, (s) => s.width / 2 + 1.5, '#354b2e', 1);
  stroke(-1, (s) => s.width / 2 + 1.5, '#354b2e', 1);
  // asphalt edges
  stroke(1, (s) => s.width / 2, '#c9d1d9', 1.5);
  stroke(-1, (s) => s.width / 2, '#c9d1d9', 1.5);
  // kerbs
  stroke(1, (s) => s.width / 2 + 0.6, '#ff4040', 4, (s) => s.kerbL);
  stroke(-1, (s) => s.width / 2 + 0.6, '#ff4040', 4, (s) => s.kerbR);
  // DRS zones
  ctx.strokeStyle = '#3ddc84';
  ctx.lineWidth = 5;
  for (const z of t.drsZones) {
    ctx.beginPath();
    const len = t.distanceForward(z.startS, z.endS);
    for (let s = 0; s <= len; s += 5) {
      const sm = t.sampleAt(t.wrapS(z.startS + s));
      if (s === 0) ctx.moveTo(X(sm.position.x), Z(sm.position.z));
      else ctx.lineTo(X(sm.position.x), Z(sm.position.z));
    }
    ctx.stroke();
    const det = t.sampleAt(z.detectionS);
    ctx.fillStyle = '#3ddc84';
    ctx.beginPath();
    ctx.arc(X(det.position.x), Z(det.position.z), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // pit lane
  ctx.strokeStyle = '#4da3ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const pl = t.pitLane;
  const pitLen = t.distanceForward(pl.entryS, pl.exitS);
  for (let s = 0; s <= pitLen; s += 4) {
    const ps = t.pitLaneSample(t.wrapS(pl.entryS + s));
    if (s === 0) ctx.moveTo(X(ps.position.x), Z(ps.position.z));
    else ctx.lineTo(X(ps.position.x), Z(ps.position.z));
  }
  ctx.stroke();
  // pit boxes
  ctx.fillStyle = '#ff5cf0';
  for (let i = 0; i < 10; i++) {
    const pb = t.pitBox(i);
    ctx.fillRect(X(pb.position.x) - 3, Z(pb.position.z) - 3, 6, 6);
  }
  // grid
  ctx.fillStyle = '#ffd400';
  for (let i = 0; i < 20; i++) {
    const g = t.gridSlot(i);
    ctx.fillRect(X(g.position.x) - 2.5, Z(g.position.z) - 2.5, 5, 5);
  }
  // S/F
  const sf = S[0];
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(X(sf.position.x + sf.left.x * sf.width * 0.6), Z(sf.position.z + sf.left.z * sf.width * 0.6));
  ctx.lineTo(X(sf.position.x - sf.left.x * sf.width * 0.6), Z(sf.position.z - sf.left.z * sf.width * 0.6));
  ctx.stroke();
  // sectors
  ctx.strokeStyle = '#ffa640';
  for (const ss of t.sectorS) {
    const sm = t.sampleAt(ss);
    ctx.beginPath();
    ctx.moveTo(X(sm.position.x + sm.left.x * sm.width * 0.7), Z(sm.position.z + sm.left.z * sm.width * 0.7));
    ctx.lineTo(X(sm.position.x - sm.left.x * sm.width * 0.7), Z(sm.position.z - sm.left.z * sm.width * 0.7));
    ctx.stroke();
  }
  // corners
  ctx.fillStyle = '#ffffff';
  ctx.font = '22px ui-monospace, monospace';
  for (const c of t.cornersWithS()) {
    const sm = t.sampleAt(c.s);
    const out = sm.curvature > 0 ? -1 : 1;
    ctx.fillText(`T${c.number} ${c.name}`, X(sm.position.x + sm.left.x * out * 30), Z(sm.position.z + sm.left.z * out * 30));
  }
  ctx.fillStyle = '#9fb0c0';
  ctx.font = '24px ui-monospace, monospace';
  ctx.fillText(`${d.name} — ${(t.length / 1000).toFixed(3)} km`, 20, H - 24);
};

/* ─────────────────────────── build ─────────────────────────── */

const fmt = (v: boolean, txt: string): string => `<span class="${v ? 'ok' : 'bad'}">${txt}</span>`;

const buildCircuit = async (i: number): Promise<void> => {
  if (state.building) return;
  state.building = true;
  state.index = i;
  def = ALL[i];
  track = new TrackSpline(def);
  const t0 = performance.now();
  load.style.display = 'block';
  drawPlot(track, def);
  const r = analyse(track);
  statsEl.innerHTML = [
    `${def.id}  length ${(r.length / 1000).toFixed(3)} km  ref ${def.referenceLapTime}s → avg ${((r.length / def.referenceLapTime) * 3.6).toFixed(0)} km/h`,
    fmt(r.minRadius >= 14, `min radius ${r.minRadius.toFixed(1)} m @ s=${r.minRadiusS.toFixed(0)}`),
    fmt(r.maxGrade <= 0.12, `max grade ${(r.maxGrade * 100).toFixed(1)} %`),
    fmt(r.pitLen >= 400 && r.pitLen <= 900, `pit lane ${r.pitLen.toFixed(0)} m`),
    fmt(r.gridOk, `grid slot 19 on straight (curv ${r.gridCurv.toExponential(1)})  S/F straight ${r.sfStraight} m`),
    fmt(r.intersections === 0, `self-intersections ${r.intersections}`),
    fmt(r.minClearance > 0, `min corridor clearance ${r.minClearance.toFixed(1)} m`),
    `DRS zones ${track.drsZones.length}  corners ${def.corners.length}  sectors @ ${track.sectorS.map((s) => s.toFixed(0)).join(', ')}`,
  ].join('\n');
  state.timeOfDay = def.environment.timeOfDay;
  try {
    await builder.build(def, track, scene, (p, label) => {
      loadBar.style.width = `${(p * 100).toFixed(1)}%`;
      loadLabel.textContent = `${label} ${(p * 100).toFixed(0)}%`;
    });
  } catch (err) {
    console.error(err);
    loadLabel.textContent = `BUILD FAILED: ${(err as Error).message}`;
    state.building = false;
    return;
  }
  builder.setQuality(QUALITIES[state.quality]);
  load.style.display = 'none';
  console.info(`[track-dev] built ${def.id} in ${((performance.now() - t0) / 1000).toFixed(2)} s`, renderer.info.memory, renderer.info.programs?.length);
  // camera: behind the grid looking down the straight
  const sm = track.sampleAt(track.wrapS(-120));
  camera.position.copy(sm.position).addScaledVector(sm.tangent, -40).addScaledVector(sm.left, 18).add(new THREE.Vector3(0, 14, 0));
  controls.target.copy(track.sampleAt(120).position).add(new THREE.Vector3(0, 2, 0));
  state.building = false;
  updateHud();
};

/* ─────────────────────────── controls ─────────────────────────── */

const updateHud = (): void => {
  hud.innerHTML = [
    `<b>APEX FORMULA — track dev</b>`,
    `[1-${ALL.length}] circuit: ${ALL.map((c, i) => (i === state.index ? `<b>${c.id}</b>` : c.id)).join(' · ')}`,
    `[T] top-down ${state.topDown ? 'ON' : 'off'}   [O] overlay ${state.overlay ? 'ON' : 'off'}   [Q] quality ${QUALITIES[state.quality]}`,
    `[N] time ${state.timeOfDay.toFixed(1)}h (night ${nightFactor(state.timeOfDay).toFixed(2)})   [W] wet ${state.wet.toFixed(1)}`,
    `[L] start lights ${state.lights}   [F] sector flag ${FLAGS[state.flag]}   [G] wander camera`,
    `drag: orbit · wheel: zoom · right-drag: pan`,
  ].join('\n');
};

const topDown = (): void => {
  if (!track) return;
  const b = track.bounds;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const ext = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  camera.position.set(cx, ext * 0.95, cz + 1);
  controls.target.set(cx, 0, cz);
};

window.addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= ALL.length) {
    void buildCircuit(n - 1);
    return;
  }
  switch (e.key.toLowerCase()) {
    case 't':
      state.topDown = !state.topDown;
      if (state.topDown) topDown();
      break;
    case 'o':
      state.overlay = !state.overlay;
      plot.style.display = state.overlay ? 'block' : 'none';
      statsEl.style.display = state.overlay ? 'block' : 'none';
      break;
    case 'q':
      state.quality = (state.quality + 1) % QUALITIES.length;
      builder.setQuality(QUALITIES[state.quality]);
      break;
    case 'n':
      state.timeOfDay = (state.timeOfDay + 2) % 24;
      break;
    case 'w':
      state.wet = state.wet >= 1 ? 0 : Math.min(1, state.wet + 0.5);
      break;
    case 'l':
      state.lights = (state.lights + 1) % 6;
      break;
    case 'f':
      state.flag = (state.flag + 1) % FLAGS.length;
      break;
    case 'g':
      state.fly = !state.fly;
      break;
  }
  updateHud();
});

/* ─────────────────────────── frame loop ─────────────────────────── */

const resize = (): void => {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);
resize();

const skyDay = new THREE.Color(0x87b6e6);
const skyDusk = new THREE.Color(0xf0a060);
const skyNight = new THREE.Color(0x0a1020);
const sky = new THREE.Color();
const sunDir = new THREE.Vector3();
let last = performance.now();
let wander = 0;

const frame = (): void => {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const night = nightFactor(state.timeOfDay);
  const dusk = state.timeOfDay > 16.5 && state.timeOfDay < 20 ? 1 - Math.abs(state.timeOfDay - 18.3) / 1.8 : 0;
  sky.copy(skyDay).lerp(skyDusk, Math.max(0, dusk)).lerp(skyNight, night);
  scene.background = sky;
  scene.fog = scene.fog ?? new THREE.Fog(sky, 800, 9000);
  (scene.fog as THREE.Fog).color.copy(sky);
  const az = ((state.timeOfDay - 6) / 12) * Math.PI;
  const elev = Math.max(0.08, Math.sin(az) * 1.1);
  sunDir.set(Math.cos(az) * 0.8, elev, 0.45).normalize();
  sun.intensity = (1 - night) * 2.6 * (0.5 + 0.5 * Math.min(1, elev * 1.5)) + 0.08;
  sun.color.setHSL(0.09, Math.max(0, dusk) * 0.7, 0.5 + 0.5 * (1 - Math.max(0, dusk) * 0.5));
  hemi.intensity = 0.45 * (1 - night) + 0.1;
  scene.environmentIntensity = 0.4 * (1 - night * 0.8);
  renderer.toneMappingExposure = 1.0 - night * 0.25;

  // shadow frustum follows the camera target
  sunTarget.position.copy(controls.target);
  sun.position.copy(controls.target).addScaledVector(sunDir, 500);
  const span = state.topDown ? 2500 : 260;
  const sc = sun.shadow.camera;
  sc.left = -span;
  sc.right = span;
  sc.top = span;
  sc.bottom = -span;
  sc.far = 1800;
  sc.updateProjectionMatrix();

  if (state.fly && track) {
    wander += dt * 40;
    const sm = track.sampleAt(track.wrapS(wander));
    const ahead = track.sampleAt(track.wrapS(wander + 60));
    camera.position.copy(sm.position).addScaledVector(sm.left, 9).add(new THREE.Vector3(0, 6, 0));
    controls.target.copy(ahead.position);
  }
  controls.update();

  const w = world as unknown as { env: { timeOfDay: number; weather: { wetness: number } }; race: { phase: string; lightsOn: number; sectorFlags: FlagType[] } };
  w.env.timeOfDay = state.timeOfDay;
  w.env.weather.wetness = state.wet;
  w.race.phase = state.lights > 0 ? 'lights' : 'racing';
  w.race.lightsOn = state.lights;
  w.race.sectorFlags[0] = FLAGS[state.flag];
  w.race.sectorFlags[1] = state.flag > 0 ? 'green' : FLAGS[state.flag];
  w.race.sectorFlags[2] = FLAGS[state.flag];
  builder.update(world, camera, dt);
  renderer.render(scene, camera);
};

/** Move the camera to track coordinates: s along, lat left, h up; look `ahead` metres down the road. */
const view = (s: number, lat: number, h: number, ahead = 80): void => {
  if (!track) return;
  const a = track.sampleAt(track.wrapS(s));
  const b = track.sampleAt(track.wrapS(s + ahead));
  camera.position.copy(a.position).addScaledVector(a.left, lat).add(new THREE.Vector3(0, h, 0));
  controls.target.copy(b.position).add(new THREE.Vector3(0, 1.5, 0));
};
Object.assign(window as unknown as Record<string, unknown>, { dev: { camera, controls, scene, builder, renderer, view, state, get track() { return track; }, build: buildCircuit } });

updateHud();
void buildCircuit(0);
frame();
