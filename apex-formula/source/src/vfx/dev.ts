/**
 * VFX harness: Kingsmere ribbon, lights, orbit camera, 4 kinematic fake cars with scripted WheelState/chassis fields.
 * Serve with `npx vite --port 5210` and open /src/vfx/dev.html.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { KINGSMERE } from '../core/circuits';
import { WHEEL_LOCAL_POSITIONS, type QualityLevel } from '../core/constants';
import { events } from '../core/events';
import { DRIVERS, DRIVER_BY_ID, TEAMS, TEAM_BY_ID } from '../core/teams';
import { TrackSpline } from '../core/track/TrackSpline';
import type { CameraMode, CarState, RaceEntry, RaceState, RacingLineAssist, RacingLinePoint, SurfaceType, World } from '../core/types';
import { createEmptyCarState, createEnvironment } from '../core/world';
import { VFXSystem } from './VFXSystem';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a9d6);
scene.fog = new THREE.Fog(0x87a9d6, 400, 1800);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 3000);
camera.position.set(-30, 18, -40);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x3a4a2a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
sun.position.set(120, 180, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -80;
sun.shadow.camera.right = sun.shadow.camera.top = 80;
sun.shadow.camera.far = 600;
scene.add(sun);
scene.add(sun.target);

// ── track
const track = new TrackSpline(KINGSMERE);
{
  let minY = Infinity;
  for (const s of track.samples) minY = Math.min(minY, s.position.y);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = minY - 0.5;
  ground.receiveShadow = true;
  scene.add(ground);
  const n = track.samples.length;
  const pos = new Float32Array(n * 2 * 3);
  const idx: number[] = [];
  const asphalt = new THREE.BufferGeometry();
  for (let i = 0; i < n; i++) {
    const s = track.samples[i];
    const hw = s.width / 2;
    pos.set([s.position.x + s.left.x * hw, s.position.y, s.position.z + s.left.z * hw], i * 6);
    pos.set([s.position.x - s.left.x * hw, s.position.y, s.position.z - s.left.z * hw], i * 6 + 3);
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
  }
  asphalt.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  asphalt.setIndex(idx);
  asphalt.computeVertexNormals();
  const mesh = new THREE.Mesh(asphalt, new THREE.MeshStandardMaterial({ color: 0x4c4c51, roughness: 0.85, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  // Gravel / grass strips beside the track so surfaces are readable.
  const strip = (side: 1 | -1, from: number, to: number, color: number) => {
    const p = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
      const s = track.samples[i];
      const a = side * (s.width / 2 + from);
      const b = side * (s.width / 2 + to);
      p.set([s.position.x + s.left.x * a, s.position.y + 0.005, s.position.z + s.left.z * a], i * 6);
      p.set([s.position.x + s.left.x * b, s.position.y + 0.005, s.position.z + s.left.z * b], i * 6 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    scene.add(m);
  };
  strip(1, 9, 70, 0x3f6b2e);
  strip(-1, 1.6, 70, 0x3f6b2e);
  strip(1, 0, 1.6, 0xb03030);
  strip(-1, 0, 1.6, 0xd8d8d8);
  strip(1, 1.6, 9, 0xc9b58f);
}

// ── racing line (fake but plausible)
const racingLine: RacingLinePoint[] = [];
{
  const step = 3;
  const sm = track.sample(0);
  for (let s = 0; s < track.length; s += step) {
    track.sample(s, sm);
    const lateral = Math.max(-4, Math.min(4, sm.curvature * 520));
    const speed = Math.min(88, track.cornerSpeed(s, 3.6));
    const ahead = Math.min(88, track.cornerSpeed(s + 45, 3.6));
    racingLine.push({ s, lateral, speed, braking: ahead < speed - 6 });
  }
}

// ── world
const cars: CarState[] = [];
const carMeshes: THREE.Group[] = [];
const CAR_COUNT = Math.min(DRIVERS.length, Number(new URLSearchParams(location.search).get('cars')) || 4);
for (let i = 0; i < CAR_COUNT; i++) {
  const d = DRIVERS[(i * 2) % DRIVERS.length];
  const car = createEmptyCarState(i, d.id, d.teamId, i === 0, 'soft');
  cars.push(car);
  const g = new THREE.Group();
  const team = TEAM_BY_ID[d.teamId];
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.45, 4.6), new THREE.MeshStandardMaterial({ color: team.primaryColor, roughness: 0.4, metalness: 0.3 }));
  body.position.set(0, 0.35, 0);
  body.castShadow = true;
  g.add(body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.5), new THREE.MeshStandardMaterial({ color: team.secondaryColor }));
  wing.position.set(0, 0.85, -2.5);
  g.add(wing);
  const fw = wing.clone();
  fw.position.set(0, 0.15, 2.7);
  g.add(fw);
  for (let w = 0; w < 4; w++) {
    const [x, y, z] = WHEEL_LOCAL_POSITIONS[w];
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, w < 2 ? 0.305 : 0.405, 24), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
    tyre.rotation.z = Math.PI / 2;
    tyre.position.set(x, y, z);
    tyre.castShadow = true;
    g.add(tyre);
  }
  scene.add(g);
  carMeshes.push(g);
}

const entries: RaceEntry[] = cars.map((c, i) => ({
  carId: c.id,
  driverId: c.driverId,
  teamId: c.teamId,
  position: i + 1,
  gridPosition: i + 1,
  lap: 1,
  lapsCompleted: 0,
  status: 'racing',
  gapToLeader: 0,
  interval: 0,
  lapsBehind: 0,
  lastLap: 0,
  bestLap: 0,
  currentSectors: [0, 0, 0],
  bestSectors: [0, 0, 0],
  currentSectorStatus: ['none', 'none', 'none'],
  currentLapTime: 0,
  lapTimes: [],
  pitStops: 0,
  pitPhase: 'none',
  pitStopTimer: 0,
  requestedCompound: null,
  tyreCompound: 'soft',
  tyreAge: 0,
  penaltySeconds: 0,
  warnings: 0,
  penalties: [],
  drsAvailable: true,
  drsOpen: false,
  drsDetectionGap: 0,
  finishTime: 0,
  blueFlag: false,
  deltaAhead: 0,
  deltaBehind: 0,
  retireReason: '',
}));
const race: RaceState = {
  sessionType: 'race',
  phase: 'racing',
  time: 0,
  timeRemaining: -1,
  lightsOn: 0,
  totalLaps: 10,
  leaderLap: 1,
  entries,
  entryByCar: entries.slice(),
  sectorFlags: ['green', 'green', 'green'],
  globalFlag: 'green',
  drsEnabled: true,
  fastestLap: null,
  messages: [],
  safetyCarSpeed: 0,
  results: null,
};
const world: World = {
  mode: 'live',
  config: {
    mode: 'quick-race',
    sessionType: 'race',
    circuitId: KINGSMERE.id,
    laps: 10,
    playerDriverId: DRIVERS[0].id,
    aiDifficulty: 0.8,
    aiCount: 3,
    weather: 'dry',
    timeOfDay: -1,
    assists: { tractionControl: 'medium', abs: true, autoGears: true, steeringAssist: false, brakingAssist: false, racingLine: 'full', pitAssist: true, ersAssist: true, drsAssist: true },
    startingCompound: 'soft',
    gridOrder: 'performance',
    randomEvents: false,
  },
  trackDef: KINGSMERE,
  track,
  cars,
  race,
  env: createEnvironment(15.5),
  playerCarId: 0,
  time: 0,
  realTime: 0,
  paused: false,
  racingLine,
  teams: TEAMS,
  drivers: DRIVERS,
  teamById: TEAM_BY_ID,
  driverById: DRIVER_BY_ID,
};

const vfx = new VFXSystem();
vfx.createSession(world, scene);

// ── scripted state
const S = {
  speed: 45,
  slip: 0,
  locked: false,
  spinning: false,
  bottoming: 0,
  surface: 'asphalt' as SurfaceType,
  brake: 0,
  throttle: 0.7,
  drs: false,
  rain: 0,
  wetness: 0,
  wind: 2,
  timeOfDay: 15.5,
  follow: true,
  camMode: 'chase' as CameraMode,
  quality: 'high' as QualityLevel,
  racingLine: 'full' as RacingLineAssist,
  paused: false,
  allCars: false,
  freeze: false,
};

// ── panel
const panel = document.getElementById('panel') as HTMLElement;
const h3 = (t: string) => {
  const e = document.createElement('h3');
  e.textContent = t;
  panel.appendChild(e);
};
const slider = (label: string, key: keyof typeof S, min: number, max: number, step: number) => {
  const l = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = String(min);
  inp.max = String(max);
  inp.step = String(step);
  inp.value = String(S[key]);
  const v = document.createElement('span');
  v.className = 'v';
  v.textContent = String(S[key]);
  inp.oninput = () => {
    (S as unknown as Record<string, number>)[key] = parseFloat(inp.value);
    v.textContent = inp.value;
  };
  l.append(name, inp, v);
  panel.appendChild(l);
};
const check = (label: string, key: keyof typeof S, onChange?: (v: boolean) => void) => {
  const l = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'checkbox';
  inp.checked = !!S[key];
  inp.onchange = () => {
    (S as unknown as Record<string, boolean>)[key] = inp.checked;
    onChange?.(inp.checked);
  };
  l.append(name, inp);
  panel.appendChild(l);
};
const select = <K extends keyof typeof S>(label: string, key: K, options: string[], onChange?: (v: string) => void) => {
  const l = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = label;
  const sel = document.createElement('select');
  for (const o of options) {
    const op = document.createElement('option');
    op.value = o;
    op.textContent = o;
    sel.appendChild(op);
  }
  sel.value = String(S[key]);
  sel.onchange = () => {
    (S as unknown as Record<string, string>)[key] = sel.value;
    onChange?.(sel.value);
  };
  l.append(name, sel);
  panel.appendChild(l);
};
const buttons = (defs: [string, () => void][]) => {
  const row = document.createElement('div');
  row.className = 'row';
  for (const [t, fn] of defs) {
    const b = document.createElement('button');
    b.textContent = t;
    b.onclick = fn;
    row.appendChild(b);
  }
  panel.appendChild(row);
};

h3('Car 0');
slider('speed m/s', 'speed', 0, 90, 1);
slider('slip', 'slip', 0, 2.5, 0.05);
check('locked', 'locked');
check('wheelspin', 'spinning');
slider('bottoming', 'bottoming', 0, 1, 0.05);
select('surface', 'surface', ['asphalt', 'kerb', 'gravel', 'grass', 'runoff']);
slider('brake', 'brake', 0, 1, 0.05);
slider('throttle', 'throttle', 0, 1, 0.05);
check('DRS open', 'drs');
check('apply to all cars', 'allCars');
h3('Weather');
slider('rain', 'rain', 0, 1, 0.05);
slider('wetness', 'wetness', 0, 1, 0.05);
slider('wind m/s', 'wind', 0, 15, 0.5);
slider('time of day', 'timeOfDay', 0, 24, 0.25);
h3('Events');
buttons([
  ['collision', () => burst(0)],
  ['big crash', () => burst(0, 6000)],
  ['lockup evt', () => events.emit('car:lockup', { carId: 0, wheel: 0, active: true })],
  ['confetti', () => {
    events.emit('race:phase', { phase: 'formation', previous: 'idle' });
    events.emit('race:phase', { phase: 'finished', previous: 'racing' });
  }],
  ['night+fireworks', () => {
    S.timeOfDay = 21;
    world.env.timeOfDay = 21;
    events.emit('race:phase', { phase: 'formation', previous: 'idle' });
    events.emit('race:finish', { carId: 0, position: 1 });
  }],
]);
h3('View');
select('camera mode', 'camMode', ['chase', 'chase-far', 'tcam', 'cockpit', 'nose', 'tv', 'helicopter'], (v) => events.emit('camera:mode', { mode: v as CameraMode }));
check('follow car 0', 'follow');
select('racing line', 'racingLine', ['off', 'corners', 'full'], (v) => {
  world.config.assists.racingLine = v as RacingLineAssist;
});
select('quality', 'quality', ['low', 'medium', 'high', 'ultra'], (v) => vfx.setQuality(v as QualityLevel));
check('paused', 'paused');
check('freeze cars', 'freeze');
buttons([
  ['replay mode', () => {
    world.mode = world.mode === 'live' ? 'replay' : 'live';
  }],
  ['endSession()', () => vfx.endSession()],
  ['reset skid/marks', () => vfx.endSession()],
]);

const burst = (carId: number, impulse = 2600) => {
  const car = cars[carId];
  const p = car.position.clone();
  p.y += 0.3;
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion);
  p.addScaledVector(fwd, 1.5);
  const normal = new THREE.Vector3(fwd.z, 0.2, -fwd.x).normalize();
  events.emit('car:collision', { carId, withCar: -1, impulse, point: p, normal });
};

// ── kinematic cars
const carS = new Float64Array(CAR_COUNT);
const carLat = Array.from({ length: CAR_COUNT }, (_, i) => [0, -3.2, 2.8, -1.0][i % 4]);
for (let i = 0; i < CAR_COUNT; i++) carS[i] = 40 - i * 14;
const sm = track.sample(0);
const m4 = new THREE.Matrix4();
const tmp = new THREE.Vector3();
const zero = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const prevPos = cars.map(() => new THREE.Vector3());

const stepCars = (dt: number) => {
  for (let i = 0; i < CAR_COUNT; i++) {
    const car = cars[i];
    const speed = S.freeze ? 0 : i === 0 ? S.speed : S.speed * (0.92 + i * 0.03);
    carS[i] = track.wrapS(carS[i] + speed * dt);
    track.sample(carS[i], sm);
    prevPos[i].copy(car.position);
    car.position.copy(sm.position).addScaledVector(sm.left, carLat[i]);
    m4.lookAt(sm.tangent, zero, up);
    car.quaternion.setFromRotationMatrix(m4);
    if (dt > 0) car.velocity.subVectors(car.position, prevPos[i]).divideScalar(dt);
    car.speed = speed;
    car.speedAbs = speed;
    car.track.s = carS[i];
    car.track.lateral = carLat[i];
    const scripted = i === 0 || S.allCars;
    car.engine.brake = scripted ? S.brake : 0;
    car.engine.throttle = scripted ? S.throttle : 0.8;
    car.chassis.bottoming = scripted ? S.bottoming : 0;
    car.drs.open = scripted ? S.drs : false;
    for (let w = 0; w < 4; w++) {
      const ws = car.wheels[w];
      const [x, y, z] = WHEEL_LOCAL_POSITIONS[w];
      ws.worldPos.copy(tmp.set(x, y, z).applyQuaternion(car.quaternion)).add(car.position);
      ws.contact = true;
      ws.load = 2500 + (w < 2 ? 0 : 900);
      ws.surface = scripted ? S.surface : 'asphalt';
      ws.slip = scripted ? S.slip : 0.4;
      ws.locked = scripted && S.locked && w < 2;
      ws.spinning = scripted && S.spinning && w >= 2;
      ws.slipRatio = ws.spinning ? 0.8 : 0;
      ws.steerAngle = w < 2 ? sm.curvature * 12 : 0;
    }
    carMeshes[i].position.copy(car.position);
    carMeshes[i].quaternion.copy(car.quaternion);
  }
};

// ── loop
const stats = document.getElementById('stats') as HTMLElement;
let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
let fps = 0;
let vfxMsAvg = 0;
const camOffset = new THREE.Vector3();
const onboardLocal: Record<string, [number, number, number]> = { tcam: [0, 0.95, -0.6], cockpit: [0, 0.78, -0.35], nose: [0, 0.35, 2.4] };

const frame = (now: number) => {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  world.paused = S.paused;
  world.env.weather.rain = S.rain;
  world.env.weather.wetness = S.wetness;
  world.env.weather.windSpeed = S.wind;
  world.env.weather.cloud = Math.max(0.25, S.rain);
  world.env.timeOfDay = S.timeOfDay;
  if (!S.paused) stepCars(dt);
  world.time += S.paused ? 0 : dt;
  world.realTime += dt;

  const night = S.timeOfDay > 19.5 || S.timeOfDay < 5.5;
  const dusk = night ? 0 : 1 - Math.min(1, Math.abs(S.timeOfDay - 12.5) / 7.5);
  sun.intensity = night ? 0.25 : 0.6 + 1.8 * dusk;
  hemi.intensity = night ? 0.35 : 0.5 + 0.5 * dusk;
  const skyCol = night ? 0x0a0f1e : 0x87a9d6;
  (scene.background as THREE.Color).setHex(skyCol).multiplyScalar(night ? 1 : 0.4 + 0.6 * dusk);
  (scene.fog as THREE.Fog).color.copy(scene.background as THREE.Color);

  const car0 = cars[0];
  const onboard = onboardLocal[S.camMode];
  if (onboard) {
    camera.position.copy(tmp.set(...onboard).applyQuaternion(car0.quaternion)).add(car0.position);
    camera.quaternion.copy(car0.quaternion);
    controls.enabled = false;
  } else if (S.follow) {
    controls.enabled = false;
    camOffset.set(2.5, 3.2, -11).applyQuaternion(car0.quaternion);
    camera.position.lerp(tmp.copy(car0.position).add(camOffset), 1 - Math.exp(-dt * 8));
    camera.lookAt(tmp.copy(car0.position).addScaledVector(car0.velocity, 0.12).add(up));
    sun.target.position.copy(car0.position);
  } else {
    controls.enabled = true;
    controls.update();
  }
  sun.position.copy(car0.position).add(tmp.set(120, 180, 60));
  sun.target.position.copy(car0.position);

  vfx.update(world, camera, dt);
  renderer.render(scene, camera);

  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 0.5) {
    fps = fpsN / fpsAcc;
    fpsAcc = 0;
    fpsN = 0;
  }
  vfxMsAvg += (vfx.stats.updateMs - vfxMsAvg) * 0.1;
  const per = Object.entries(vfx.stats.perSystem)
    .map(([k, v]) => `${k.padEnd(11)}${String(v).padStart(6)}`)
    .join('\n');
  stats.textContent = `fps ${fps.toFixed(0)}   vfx ${vfxMsAvg.toFixed(2)} ms\nparticles ${vfx.stats.particles}\n${per}\ndraw calls ${renderer.info.render.calls}`;
};
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setSize(innerWidth, innerHeight);

// Expose for console poking / screenshots.
Object.assign(window as unknown as Record<string, unknown>, { vfx, world, S, cars, camera, controls, track });
