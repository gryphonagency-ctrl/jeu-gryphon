/**
 * Isolated harness for Agent 9's modules: a kinematic box car on the Kingsmere spline driven by InputSystem, dummy
 * cars, replay ghosts, every camera mode and cinematic. Serve with `npx vite --port 5209` → /src/camera/dev.html
 */
import * as THREE from 'three';
import { KINGSMERE } from '../core/circuits';
import { CAR, PHYSICS_DT } from '../core/constants';
import { events } from '../core/events';
import { clamp, wrap } from '../core/math';
import { DRIVERS, DRIVER_BY_ID, TEAMS, TEAM_BY_ID } from '../core/teams';
import { TrackSpline, type TrackSample } from '../core/track/TrackSpline';
import type { CarState, DriverInput, RaceEntry, RaceState, SessionConfig, World } from '../core/types';
import { createEmptyCarState, createEnvironment } from '../core/world';
import { InputSystem } from '../input/InputSystem';
import { ReplaySystem } from '../replay/ReplaySystem';
import { CameraSystem } from './CameraSystem';

const UP = new THREE.Vector3(0, 1, 0);
const CAR_COUNT = 6;

/* ───────────────────────────── world ───────────────────────────── */

const track = new TrackSpline(KINGSMERE);

const makeEntry = (carId: number, position: number): RaceEntry => ({
  carId,
  driverId: DRIVERS[carId].id,
  teamId: DRIVERS[carId].teamId,
  position,
  gridPosition: position,
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
  tyreCompound: 'medium',
  tyreAge: 0,
  penaltySeconds: 0,
  warnings: 0,
  penalties: [],
  drsAvailable: false,
  drsOpen: false,
  drsDetectionGap: 0,
  finishTime: 0,
  blueFlag: false,
  deltaAhead: 0,
  deltaBehind: 0,
  retireReason: '',
});

const config: SessionConfig = {
  mode: 'quick-race',
  sessionType: 'race',
  circuitId: KINGSMERE.id,
  laps: 5,
  playerDriverId: DRIVERS[0].id,
  aiDifficulty: 0.7,
  aiCount: CAR_COUNT - 1,
  weather: 'dry',
  timeOfDay: -1,
  assists: { tractionControl: 'medium', abs: true, autoGears: true, steeringAssist: false, brakingAssist: false, racingLine: 'off', pitAssist: true, ersAssist: true, drsAssist: false },
  startingCompound: 'medium',
  gridOrder: 'performance',
  randomEvents: false,
};

const liveCars: CarState[] = [];
for (let i = 0; i < CAR_COUNT; i++) liveCars.push(createEmptyCarState(i, DRIVERS[i].id, DRIVERS[i].teamId, i === 0, 'medium'));
const entries = liveCars.map((c, i) => makeEntry(c.id, i + 1));
const race: RaceState = {
  sessionType: 'race',
  phase: 'racing',
  time: 0,
  timeRemaining: -1,
  lightsOn: 0,
  totalLaps: 5,
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
  config,
  trackDef: KINGSMERE,
  track,
  cars: liveCars,
  race,
  env: createEnvironment(15.5),
  playerCarId: 0,
  time: 0,
  realTime: 0,
  paused: false,
  racingLine: null,
  teams: TEAMS,
  drivers: DRIVERS,
  teamById: TEAM_BY_ID,
  driverById: DRIVER_BY_ID,
};

/* ───────────────────────────── kinematic cars ───────────────────────────── */

const _scratch: TrackSample = track.sample(0);
const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _left = new THREE.Vector3();
const _qRoll = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);

class KinCar {
  s: number;
  lateral = 0;
  speed = 0;
  t = 0;
  readonly prevPos = new THREE.Vector3();
  readonly prevVel = new THREE.Vector3();
  constructor(
    readonly state: CarState,
    s: number,
    readonly ai: boolean,
    readonly phase: number,
  ) {
    this.s = s;
    track.trackToWorld(s, 0, this.prevPos);
  }

  step(dt: number, input: DriverInput | null): void {
    this.t += dt;
    const st = this.state;
    let steer = 0;
    let throttle = 0;
    let brake = 0;
    if (this.ai || !input) {
      // AI: cruise at a curvature-limited speed, weave gently.
      const target = Math.min(78, track.cornerSpeed(this.s + 40, 3.2) * 1.05);
      throttle = this.speed < target ? 0.8 : 0;
      brake = this.speed > target + 4 ? 0.7 : 0;
      const wantLat = 2.5 * Math.sin(this.t * 0.35 + this.phase);
      steer = clamp((wantLat - this.lateral) * 0.4, -0.6, 0.6);
    } else {
      steer = input.steer;
      throttle = input.throttle;
      brake = input.brake;
      if (input.gearUp) hud.gearUpPulses++;
      if (input.gearDown) hud.gearDownPulses++;
      if (input.reset) {
        hud.resetPulses++;
        this.speed = 0;
        this.lateral = 0;
      }
    }
    const drag = (st.drs.open ? 0.0021 : 0.0027) * this.speed * this.speed;
    const limiter = input?.pitLimiter && !this.ai ? CAR.pitSpeedLimit : 999;
    let accel = throttle * 16 - brake * 40 - drag - 0.4;
    if (this.speed > limiter) accel = Math.min(accel, -8);
    this.speed = clamp(this.speed + accel * dt, 0, 95);

    const w = track.sample(this.s, _scratch).width;
    const latRate = steer * (5 + 0.12 * this.speed) * (this.speed > 0.5 ? 1 : 0);
    this.lateral = clamp(this.lateral + latRate * dt, -(w / 2 + 5), w / 2 + 5);
    this.s = wrap(this.s + this.speed * dt, track.length);

    const sm = track.sample(this.s, _scratch);
    _pos.copy(sm.position).addScaledVector(sm.left, this.lateral);
    const slide = steer * 0.18 * clamp(this.speed / 40, 0, 1);
    const heading = sm.heading + Math.atan2(latRate, Math.max(this.speed, 1)) + slide;
    st.position.copy(_pos);
    _vel.subVectors(_pos, this.prevPos).multiplyScalar(1 / dt);
    _acc.subVectors(_vel, this.prevVel).multiplyScalar(1 / dt);
    this.prevPos.copy(_pos);
    this.prevVel.copy(_vel);
    st.velocity.copy(_vel);
    st.speed = this.speed;
    st.speedAbs = _vel.length();
    _fwd.set(Math.sin(heading), 0, Math.cos(heading));
    _left.set(Math.cos(heading), 0, -Math.sin(heading));
    st.localAccel.set(_acc.dot(_left), _acc.y, _acc.dot(_fwd));
    const roll = clamp(-st.localAccel.x * 0.003, -0.08, 0.08);
    st.quaternion.setFromAxisAngle(UP, heading).multiply(_qRoll.setFromAxisAngle(Z, roll));

    const onKerb = Math.abs(this.lateral) > w / 2;
    for (let i = 0; i < 4; i++) {
      const ws = st.wheels[i];
      ws.spinRate = this.speed / CAR.wheelRadius;
      ws.spinAngle += ws.spinRate * dt;
      ws.steerAngle = i < 2 ? steer * 0.35 : 0;
      ws.suspensionTravel = 0.012 + 0.005 * Math.sin(this.t * 6 + i) + (onKerb ? 0.02 * Math.sin(this.t * 55 + i * 2) : 0) + brake * 0.01 * (i < 2 ? 1 : -1);
      ws.slip = Math.abs(steer) * this.speed / 90 + brake * 0.3;
      ws.locked = brake > 0.9 && this.speed > 30;
      ws.surface = onKerb ? 'kerb' : 'asphalt';
    }
    const gear = this.speed < 0.5 ? 1 : clamp(1 + Math.floor(this.speed / 11.5), 1, 8);
    st.engine.gear = gear;
    st.engine.rpm = clamp(CAR.idleRpm + ((this.speed - (gear - 1) * 11.5) / 11.5) * 9500 + throttle * 600, CAR.idleRpm, CAR.maxRpm);
    st.engine.throttle = throttle;
    st.engine.brake = brake;
    st.engine.steer = steer;
    st.engine.limiter = st.engine.rpm > CAR.maxRpm - 200;
    st.drs.available = true;
    st.drs.open = !!input?.drs && !this.ai && brake < 0.2;
    st.ers.mode = input?.ersMode ?? 'balanced';
    st.chassis.kerbRumble = onKerb ? 1 : 0;
    st.chassis.bottoming = this.speed > 75 && Math.sin(this.t * 3) > 0.9 ? 0.6 : 0;
    st.track.s = this.s;
    st.track.lateral = this.lateral;
    st.track.forwardSpeed = this.speed;
    st.track.surface = onKerb ? 'kerb' : 'asphalt';
    if (input) {
      st.input.steer = steer;
      st.input.throttle = throttle;
      st.input.brake = brake;
      st.input.drs = input.drs;
      st.input.pitLimiter = input.pitLimiter;
    }
  }
}

const kin: KinCar[] = [];
const startS = track.wrapS(-120);
const offsets = [0, 90, 190, 330, -70, -160];
for (let i = 0; i < CAR_COUNT; i++) {
  const k = new KinCar(liveCars[i], track.wrapS(startS + offsets[i]), i !== 0, i * 1.3);
  k.speed = i === 0 ? 0 : 55;
  k.step(PHYSICS_DT, null);
  kin.push(k);
}

/* ───────────────────────────── scene ───────────────────────────── */

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a7c8);
scene.fog = new THREE.Fog(0x87a7c8, 400, 2500);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x3a4a2a, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(300, 500, -200);
scene.add(sun);

// Distant ground far below the lowest point of the circuit; the verge ribbon below follows the track elevation.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: 0x35592a }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = track.bounds.min.y + 60 - 1.5;
scene.add(ground);
const grid = new THREE.GridHelper(3000, 150, 0x2a4a20, 0x2a4a20);
grid.position.y = ground.position.y + 0.02;
scene.add(grid);

// Track + verge ribbons from spline samples.
const ribbon = (halfWidthOf: (sm: TrackSample) => number, yOffset: number, color: number): THREE.Mesh => {
  const n = track.samples.length;
  const pos = new Float32Array(n * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const sm = track.samples[i];
    const hw = halfWidthOf(sm);
    const l = sm.position.clone().addScaledVector(sm.left, hw);
    const r = sm.position.clone().addScaledVector(sm.left, -hw);
    l.y += yOffset;
    r.y += yOffset;
    pos.set([l.x, l.y, l.z, r.x, r.y, r.z], i * 6);
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
};
scene.add(ribbon(() => 60, -0.08, 0x3f6a2e));
scene.add(ribbon((sm) => sm.width / 2 + 1.6, -0.01, 0xb03030));
scene.add(ribbon((sm) => sm.width / 2, 0.02, 0x4a4a50));
{
  const edgeL: THREE.Vector3[] = [];
  const edgeR: THREE.Vector3[] = [];
  for (const sm of track.samples) {
    const hw = sm.width / 2;
    edgeL.push(sm.position.clone().addScaledVector(sm.left, hw).add(new THREE.Vector3(0, 0.03, 0)));
    edgeR.push(sm.position.clone().addScaledVector(sm.left, -hw).add(new THREE.Vector3(0, 0.03, 0)));
  }
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(edgeL), lineMat));
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(edgeR), lineMat));
  // Grid boxes.
  const slotMat = new THREE.LineBasicMaterial({ color: 0xffee88 });
  for (let i = 0; i < 20; i++) {
    const slot = track.gridSlot(i);
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.2, 0.02, 5.6)), slotMat);
    box.position.copy(slot.position);
    box.position.y += 0.03;
    box.quaternion.copy(slot.quaternion);
    scene.add(box);
  }
  // S/F line.
  const sf = new THREE.Mesh(new THREE.BoxGeometry(track.samples[0].width, 0.03, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sf.position.copy(track.samples[0].position);
  sf.position.y += 0.03;
  sf.rotation.y = track.samples[0].heading;
  scene.add(sf);
}

const makeCarMesh = (color: number, wire: boolean): THREE.Group => {
  const g = new THREE.Group();
  const mat = wire ? new THREE.MeshBasicMaterial({ color, wireframe: true }) : new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 4.0), mat);
  body.position.set(0, 0.35, -0.8);
  g.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 2.4), mat);
  nose.position.set(0, 0.15, 2.4);
  g.add(nose);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 6, 16), mat);
  halo.rotation.x = Math.PI / 2;
  halo.position.set(0, 0.95, -0.3);
  g.add(halo);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(CAR.width, 0.08, 0.5), mat);
  wing.position.set(0, 0.95, -CAR.length / 2 + 0.2);
  g.add(wing);
  const fwing = new THREE.Mesh(new THREE.BoxGeometry(CAR.width, 0.06, 0.4), mat);
  fwing.position.set(0, 0.15, CAR.length / 2 + 0.6);
  g.add(fwing);
  const wheelGeo = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.35, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = wire ? mat : new THREE.MeshLambertMaterial({ color: 0x151515 });
  for (let i = 0; i < 4; i++) {
    const wm = new THREE.Mesh(wheelGeo, wheelMat);
    wm.name = `wheel${i}`;
    g.add(wm);
  }
  return g;
};

const carMeshes: THREE.Group[] = [];
const ghostMeshes: THREE.Group[] = [];
for (let i = 0; i < CAR_COUNT; i++) {
  const color = new THREE.Color(TEAM_BY_ID[DRIVERS[i].teamId].primaryColor).getHex();
  const m = makeCarMesh(color, false);
  scene.add(m);
  carMeshes.push(m);
  const gm = makeCarMesh(0x00ffcc, true);
  gm.visible = false;
  scene.add(gm);
  ghostMeshes.push(gm);
}

const _wp = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const poseMesh = (mesh: THREE.Group, car: CarState): void => {
  mesh.position.copy(car.position);
  mesh.quaternion.copy(car.quaternion);
  for (let i = 0; i < 4; i++) {
    const wm = mesh.getObjectByName(`wheel${i}`) as THREE.Mesh;
    const lp = i === 0 ? [CAR.frontTrackHalf, CAR.frontAxleZ] : i === 1 ? [-CAR.frontTrackHalf, CAR.frontAxleZ] : i === 2 ? [CAR.rearTrackHalf, CAR.rearAxleZ] : [-CAR.rearTrackHalf, CAR.rearAxleZ];
    _wp.set(lp[0], CAR.wheelRadius - car.wheels[i].suspensionTravel * 0.5, lp[1]);
    wm.position.copy(_wp);
    _wq.setFromAxisAngle(UP, car.wheels[i].steerAngle);
    wm.quaternion.copy(_wq).multiply(_wq.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -car.wheels[i].spinAngle));
  }
};

/* ───────────────────────────── systems ───────────────────────────── */

const input = new InputSystem();
const cameraSys = new CameraSystem(window.innerWidth / window.innerHeight);
const replay = new ReplaySystem();
replay.startRecording(world);
cameraSys.setTarget(0);
cameraSys.snap();
input.setDrivingEnabled(true);

// TV camera markers.
const tvGroup = new THREE.Group();
scene.add(tvGroup);
const refreshTvMarkers = (): void => {
  tvGroup.clear();
  const cams = cameraSys.getTVCameras();
  const geoHi = new THREE.ConeGeometry(0.8, 2.4, 8);
  const geoLo = new THREE.SphereGeometry(0.7, 10, 8);
  for (const c of cams) {
    const m = new THREE.Mesh(c.low ? geoLo : geoHi, new THREE.MeshBasicMaterial({ color: c.low ? 0xff8800 : 0xff2266 }));
    m.position.copy(c.position);
    tvGroup.add(m);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, c.position.y - track.heightAt(c.s)), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    pole.position.set(c.position.x, (c.position.y + track.heightAt(c.s)) / 2, c.position.z);
    tvGroup.add(pole);
  }
};

const hudEl = document.getElementById('hud') as HTMLDivElement;
const helpEl = document.getElementById('help') as HTMLDivElement;
helpEl.textContent = [
  'DRIVE  W/S throttle-brake  A/D steer  E/Q gears  Space DRS  R ERS-OT  V ERS  L limiter  Backspace reset',
  'CAM    C cycle  B look back  1 menu-orbit  2 grid-flyover  3 podium  4 replay-director  0 gameplay',
  'MISC   K shake  N next target  I replay toggle  [ ] replay speed  J -5s  U +5s  Y loop  Esc pause  F8 shot',
  'MENU   F toggle driving-enabled (menu routing)   G gamepad rumble test',
].join('\n');

const hud = {
  gearUpPulses: 0,
  gearDownPulses: 0,
  resetPulses: 0,
  log: [] as string[],
  paused: false,
  drivingEnabled: true,
};
const log = (s: string): void => {
  hud.log.push(s);
  if (hud.log.length > 14) hud.log.shift();
};

events.on('input:gamepad', ({ connected, id }) => log(`gamepad ${connected ? 'connected' : 'disconnected'}: ${id}`));
events.on('camera:mode', ({ mode }) => log(`camera:mode ${mode}`));

let replaying = false;
const toggleReplay = (): void => {
  if (replaying) {
    replay.exit();
    world.cars = liveCars;
    world.mode = 'live';
    cameraSys.setCinematic(null);
    cameraSys.snap();
    for (const g of ghostMeshes) g.visible = false;
    replaying = false;
    log('replay exit');
  } else {
    if (replay.getDuration() < 1) return;
    world.cars = replay.enter(world);
    world.mode = 'replay';
    cameraSys.setCinematic('replay-director');
    for (const g of ghostMeshes) g.visible = true;
    replaying = true;
    log(`replay enter t=${replay.getTime().toFixed(1)} / ${replay.getDuration().toFixed(1)}`);
  }
};

window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'Digit1':
      cameraSys.setCinematic('menu-orbit');
      break;
    case 'Digit2':
      cameraSys.setCinematic('grid-flyover');
      break;
    case 'Digit3':
      cameraSys.setCinematic('podium');
      break;
    case 'Digit4':
      cameraSys.setCinematic('replay-director');
      break;
    case 'Digit0':
      cameraSys.setCinematic(null);
      break;
    case 'KeyK':
      cameraSys.shake(0.8, 0.6);
      log('shake 0.8');
      break;
    case 'KeyN':
      cameraSys.setTarget((cameraSys.getTarget() + 1) % CAR_COUNT);
      log(`target ${cameraSys.getTarget()}`);
      break;
    case 'BracketRight':
      replay.setSpeed(replay.getSpeed() === 0 ? 0.25 : clamp(replay.getSpeed() * 2, -8, 8));
      log(`replay speed ${replay.getSpeed()}`);
      break;
    case 'BracketLeft':
      replay.setSpeed(Math.abs(replay.getSpeed()) <= 0.25 ? -replay.getSpeed() : replay.getSpeed() / 2);
      log(`replay speed ${replay.getSpeed()}`);
      break;
    case 'KeyJ':
      replay.seek(replay.getTime() - 5);
      break;
    case 'KeyU':
      replay.seek(replay.getTime() + 5);
      break;
    case 'KeyY':
      replay.setLoop(true);
      log('replay loop on');
      break;
    case 'KeyF':
      hud.drivingEnabled = !hud.drivingEnabled;
      input.setDrivingEnabled(hud.drivingEnabled);
      log(`drivingEnabled=${hud.drivingEnabled}`);
      break;
    case 'KeyG':
      input.rumble(0.8, 0.5);
      log('rumble 0.8');
      break;
  }
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  cameraSys.resize(window.innerWidth / window.innerHeight);
});

/* ───────────────────────────── loop ───────────────────────────── */

let last = performance.now();
let accumulator = 0;
let tvMarkersBuilt = false;
let groundViolations = 0;
let minClearance = Infinity;
const _proj = { s: 0, lateral: 0, distance: 0 };
let clearanceHint = 0;
const _rel = new THREE.Vector3();
const _invQ = new THREE.Quaternion();

const frame = (now: number): void => {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  input.update(dt);
  input.setSpeedHint(liveCars[0].speedAbs);
  for (const cmd of input.consumeCommands()) {
    switch (cmd.type) {
      case 'cycle-camera':
        events.emit('camera:mode', { mode: cameraSys.cycle() });
        break;
      case 'look-back':
        cameraSys.setLookBack(cmd.active);
        log(`look-back ${cmd.active}`);
        break;
      case 'toggle-replay':
        toggleReplay();
        break;
      case 'pause':
        if (replaying) toggleReplay();
        else {
          hud.paused = !hud.paused;
          log(`pause ${hud.paused}`);
        }
        break;
      default:
        log(`cmd ${JSON.stringify(cmd)}`);
    }
  }

  if (!replaying && !hud.paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= PHYSICS_DT && steps < 8) {
      const di = input.getDriverInput();
      world.time += PHYSICS_DT;
      for (let i = 0; i < CAR_COUNT; i++) kin[i].step(PHYSICS_DT, i === 0 ? di : null);
      accumulator -= PHYSICS_DT;
      steps++;
    }
    if (steps === 8) accumulator = 0;
    replay.record(world, dt);
  } else if (replaying) {
    replay.update(dt);
  }
  world.realTime += dt;

  cameraSys.update(world, dt);
  if (!tvMarkersBuilt && cameraSys.getTVCameras().length > 0) {
    tvMarkersBuilt = true;
    refreshTvMarkers();
    log(`tv cams: ${cameraSys.getTVCameras().length}`);
  }

  for (let i = 0; i < CAR_COUNT; i++) poseMesh(carMeshes[i], liveCars[i]);
  if (replaying) for (let i = 0; i < CAR_COUNT; i++) poseMesh(ghostMeshes[i], world.cars[i]);

  // Ground-safety check for non-attached cameras.
  const cam = cameraSys.camera;
  const mode = cameraSys.getMode();
  const cine = cameraSys.getCinematic();
  const attached = cine === null && (mode === 'cockpit' || mode === 'tcam' || mode === 'nose' || mode === 'helicopter');
  track.project(cam.position.x, cam.position.z, clearanceHint, _proj);
  clearanceHint = _proj.s;
  const clearance = cam.position.y - track.heightAt(_proj.s);
  if (!attached && cine !== 'menu-orbit' && _proj.distance < 80) {
    minClearance = Math.min(minClearance, clearance);
    if (clearance < 0.34) groundViolations++;
    if (clearance < 1.0 && hud.log[hud.log.length - 1]?.startsWith('LOW') !== true) log(`LOW clearance ${clearance.toFixed(2)} mode ${mode} cine ${cine} y ${cam.position.y.toFixed(1)} s ${_proj.s.toFixed(0)} d ${_proj.distance.toFixed(0)}`);
  }

  renderer.render(scene, cam);

  const p = liveCars[0];
  const di = p.input;
  const shown = world.cars[cameraSys.getTarget()] ?? p;
  _rel.copy(cam.position).sub(shown.position).applyQuaternion(_invQ.copy(shown.quaternion).invert());
  hudEl.textContent = [
    `mode ${mode}${cine ? `  cinematic ${cine}` : ''}  target ${cameraSys.getTarget()}  fov ${cam.fov.toFixed(1)}`,
    `cam y ${cam.position.y.toFixed(2)}  clearance ${clearance.toFixed(2)}  min ${isFinite(minClearance) ? minClearance.toFixed(2) : '-'}  violations ${groundViolations}  rel(car) ${_rel.x.toFixed(1)} ${_rel.y.toFixed(1)} ${_rel.z.toFixed(1)}`,
    `speed ${(shown.speedAbs * 3.6).toFixed(0)} km/h  gear ${shown.engine.gear}  rpm ${shown.engine.rpm.toFixed(0)}  s ${shown.track.s.toFixed(0)}  lat ${shown.track.lateral.toFixed(1)}`,
    `steer raw ${input.getRawSteer().toFixed(2)} out ${di.steer.toFixed(2)}  thr ${di.throttle.toFixed(2)}  brk ${di.brake.toFixed(2)}  drs ${di.drs}  ers ${input.getErsMode()}  limiter ${di.pitLimiter}`,
    `pulses gearUp ${hud.gearUpPulses} gearDown ${hud.gearDownPulses} reset ${hud.resetPulses}  gamepad ${input.isGamepadConnected()}  driving ${hud.drivingEnabled}  paused ${hud.paused}`,
    `replay ${replaying ? 'PLAYING' : 'recording'}  t ${replay.getTime().toFixed(1)} / ${replay.getDuration().toFixed(1)} s  speed ${replay.getSpeed()}  mem ${(replay.getMemoryBytes() / 1048576).toFixed(2)} MB`,
    '',
    ...hud.log,
  ].join('\n');
};
requestAnimationFrame(frame);
