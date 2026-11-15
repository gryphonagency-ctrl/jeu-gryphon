/**
 * Physics harness: 2D top-down view of Kingsmere, keyboard driving, telemetry, scripted tests and a headless benchmark.
 * Open http://localhost:5204/src/physics/dev.html (or the port vite was started on).
 */
import { PHYSICS_DT, TYRE_COMPOUNDS } from '../core/constants';
import { KINGSMERE } from '../core/circuits';
import { events, type GameEvents } from '../core/events';
import { clamp, clamp01 } from '../core/math';
import type { CarState, DriverInput, ErsMode } from '../core/types';
import { carYaw, createDefaultInput } from '../core/world';
import { AI_ASSISTS, FULL_ASSISTS, NO_ASSISTS, followerInput, makeSession, runBench, type TestSession } from './bench';
import { runTests } from './tests';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx2d = canvas.getContext('2d')!;
const telemetryEl = document.getElementById('telemetry')!;
const logEl = document.getElementById('log')!;
const helpEl = document.getElementById('help')!;

helpEl.textContent = [
  'W/↑ throttle  S/↓ brake  A/D ←/→ steer  E/Q gear  Space DRS  L limiter  V ERS  R reset  H hold',
  'X TC  Z ABS  G auto-gears  F steer-assist  K brake-assist  M wetness  1-5 tyres  O AI traffic',
  'N north-up  +/- zoom  P pause  T run tests  B bench (20 cars)',
].join('\n');

const logLines: string[] = [];
const log = (s: string): void => {
  logLines.push(s);
  if (logLines.length > 60) logLines.shift();
  logEl.textContent = logLines.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
  console.log(s);
};

/* ───────────────────────────── interactive session ───────────────────────────── */

const AI_COUNT = 19;
let ses: TestSession = makeSession(KINGSMERE, 1 + AI_COUNT, NO_ASSISTS);
const assists = { ...FULL_ASSISTS };
let trafficOn = false;
let paused = false;
let northUp = true;
let zoom = 6;
let wetness = 0;

const setup = (): void => {
  const { physics, world, cars } = ses;
  physics.setAssists(0, assists);
  physics.resetCar(0, world.track.wrapS(-60));
  for (let i = 1; i < cars.length; i++) {
    physics.setAssists(i, AI_ASSISTS);
    physics.resetCar(i, world.track.wrapS(150 + i * 60));
    cars[i].wheels.forEach((w) => (w.temp = 95));
  }
};
setup();

const eventNames: (keyof GameEvents)[] = ['car:collision', 'car:offtrack', 'car:ontrack', 'car:drs', 'car:gear', 'car:lockup', 'car:wheelspin', 'car:damage', 'car:bottoming', 'car:reset', 'car:limiter', 'car:airborne', 'car:engine-failure'];
const eventCounts: Record<string, number> = {};
for (const name of eventNames) {
  events.on(name, (p: unknown) => {
    eventCounts[name] = (eventCounts[name] ?? 0) + 1;
    const payload = p as { carId?: number };
    if (payload.carId !== 0) return;
    if (name === 'car:gear' || name === 'car:lockup' || name === 'car:limiter' || name === 'car:wheelspin' || name === 'car:bottoming') return;
    log(`${name} ${JSON.stringify(p, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : k === 'point' || k === 'normal' ? undefined : v))}`);
  });
}

const keys = new Set<string>();
let steer = 0;
let gearUp = false;
let gearDown = false;
let resetEdge = false;
let limiter = false;
let held = false;
let ersMode: ErsMode = 'balanced';

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  switch (e.code) {
    case 'KeyE':
    case 'ShiftLeft':
      gearUp = true;
      break;
    case 'KeyQ':
    case 'ControlLeft':
      gearDown = true;
      break;
    case 'KeyR':
      resetEdge = true;
      break;
    case 'KeyL':
      limiter = !limiter;
      break;
    case 'KeyH':
      held = !held;
      ses.physics.holdCar(0, held);
      log(`hold ${held}`);
      break;
    case 'KeyV':
      ersMode = ersMode === 'harvest' ? 'balanced' : ersMode === 'balanced' ? 'overtake' : 'harvest';
      break;
    case 'KeyX':
      assists.tractionControl = assists.tractionControl === 'off' ? 'medium' : assists.tractionControl === 'medium' ? 'full' : 'off';
      ses.physics.setAssists(0, assists);
      break;
    case 'KeyZ':
      assists.abs = !assists.abs;
      ses.physics.setAssists(0, assists);
      break;
    case 'KeyG':
      assists.autoGears = !assists.autoGears;
      ses.physics.setAssists(0, assists);
      break;
    case 'KeyF':
      assists.steeringAssist = !assists.steeringAssist;
      ses.physics.setAssists(0, assists);
      break;
    case 'KeyK':
      assists.brakingAssist = !assists.brakingAssist;
      ses.physics.setAssists(0, assists);
      break;
    case 'KeyM':
      wetness = wetness === 0 ? 0.5 : wetness < 0.9 ? 0.95 : 0;
      ses.world.env.weather.wetness = wetness;
      ses.world.env.weather.rain = wetness;
      log(`wetness ${wetness}`);
      break;
    case 'KeyO':
      trafficOn = !trafficOn;
      log(`traffic ${trafficOn}`);
      break;
    case 'KeyN':
      northUp = !northUp;
      break;
    case 'KeyP':
      paused = !paused;
      break;
    case 'Equal':
    case 'NumpadAdd':
      zoom = Math.min(40, zoom * 1.3);
      break;
    case 'Minus':
    case 'NumpadSubtract':
      zoom = Math.max(0.3, zoom / 1.3);
      break;
    case 'KeyT':
      runTests(log);
      break;
    case 'KeyB': {
      const r = runBench(3000, 20);
      log(`BENCH 20 cars × ${r.steps} steps: ${r.msPerStep.toFixed(3)} ms/step  speeds ${r.minKmh.toFixed(0)}–${r.maxKmh.toFixed(0)} km/h  collisions ${r.collisions}`);
      break;
    }
    default: {
      const digit = /^Digit([1-5])$/.exec(e.code);
      if (digit) {
        const compound = TYRE_COMPOUNDS[+digit[1] - 1];
        ses.physics.serviceCar(0, { compound, repair: true });
        log(`service: ${compound}, repaired`);
      }
    }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

const playerInput: DriverInput = createDefaultInput();
const buildPlayerInput = (dt: number, car: CarState): DriverInput => {
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const target = left && !right ? 1 : right && !left ? -1 : 0;
  const rate = target === 0 ? 6 : clamp(5 - car.speedAbs * 0.04, 1.6, 5);
  steer += clamp(target - steer, -rate * dt, rate * dt);
  playerInput.steer = steer;
  playerInput.throttle = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
  playerInput.brake = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
  playerInput.gearUp = gearUp;
  playerInput.gearDown = gearDown;
  playerInput.reset = resetEdge;
  playerInput.drs = keys.has('Space');
  playerInput.pitLimiter = limiter;
  playerInput.ersMode = ersMode;
  gearUp = gearDown = resetEdge = false;
  return playerInput;
};

let acc = 0;
let last = performance.now();
let stepMs = 0;
const frame = (now: number): void => {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += dt;
    let n = 0;
    while (acc >= PHYSICS_DT && n < 8) {
      const { physics, world, cars, inputs } = ses;
      world.cars[0].drs.available = true;
      physics.setInput(0, buildPlayerInput(PHYSICS_DT, cars[0]));
      for (let i = 1; i < cars.length; i++) {
        if (trafficOn) physics.setInput(i, followerInput(cars[i], world.track, 50, ((i % 3) - 1) * 2, inputs[i]));
        else {
          inputs[i].throttle = 0;
          inputs[i].brake = 1;
          physics.setInput(i, inputs[i]);
        }
      }
      const t0 = performance.now();
      physics.step(world, PHYSICS_DT);
      stepMs = stepMs * 0.95 + (performance.now() - t0) * 0.05;
      world.time += PHYSICS_DT;
      acc -= PHYSICS_DT;
      n++;
    }
    if (n === 8) acc = 0;
  }
  draw();
};
requestAnimationFrame(frame);

/* ───────────────────────────── drawing ───────────────────────────── */

const resize = (): void => {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
};
window.addEventListener('resize', resize);
resize();

const SURFACE_COLORS: Record<string, string> = { asphalt: '#3a3f46', kerb: '#c33', grass: '#2f6b2f', gravel: '#b9a27a', runoff: '#5a5a5a', pit: '#4a4a55', wall: '#222' };

const draw = (): void => {
  const { world, cars } = ses;
  const track = world.track;
  const player = cars[0];
  const W = canvas.width;
  const H = canvas.height;
  const g = ctx2d;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#1d2a1d';
  g.fillRect(0, 0, W, H);
  const scale = zoom * devicePixelRatio;
  g.translate(W / 2, H * 0.6);
  g.scale(scale, -scale);
  if (!northUp) g.rotate(carYaw(player));
  g.translate(-player.position.x, -player.position.z);
  // world: x right, z "up" on screen (we flipped y); heading +Z points up.

  const samples = track.samples;
  const n = samples.length;
  const stride = Math.max(1, Math.floor(1.5 / Math.max(0.05, zoom / 6)));
  // run-off + kerbs + asphalt
  const band = (offA: (i: number) => number, offB: (i: number) => number, color: string): void => {
    g.fillStyle = color;
    g.beginPath();
    for (let k = 0; k <= n; k += stride) {
      const sm = samples[k % n];
      const o = offA(k % n);
      const x = sm.position.x + sm.left.x * o;
      const z = sm.position.z + sm.left.z * o;
      if (k === 0) g.moveTo(x, z);
      else g.lineTo(x, z);
    }
    for (let k = n; k >= 0; k -= stride) {
      const sm = samples[k % n];
      const o = offB(k % n);
      g.lineTo(sm.position.x + sm.left.x * o, sm.position.z + sm.left.z * o);
    }
    g.closePath();
    g.fill();
  };
  band((i) => samples[i].barrierL, (i) => -samples[i].barrierR, '#3d5b3d');
  band((i) => samples[i].width / 2 + (samples[i].kerbL ? track.kerbWidth : 0), (i) => -(samples[i].width / 2 + (samples[i].kerbR ? track.kerbWidth : 0)), '#b84040');
  band((i) => samples[i].width / 2, (i) => -samples[i].width / 2, SURFACE_COLORS.asphalt);
  // pit lane
  g.strokeStyle = '#6a6a80';
  g.lineWidth = track.pitLane.width;
  g.beginPath();
  for (let d = 0; d <= track.pitLane.length; d += 5) {
    const s = track.wrapS(track.pitLane.entryS + d);
    const p = track.pitLaneSample(s);
    if (d === 0) g.moveTo(p.position.x, p.position.z);
    else g.lineTo(p.position.x, p.position.z);
  }
  g.stroke();
  // barriers
  g.strokeStyle = '#e8e8e8';
  g.lineWidth = 0.4;
  for (const side of [1, -1]) {
    g.beginPath();
    for (let k = 0; k <= n; k += stride) {
      const sm = samples[k % n];
      const o = side > 0 ? sm.barrierL : -sm.barrierR;
      const x = sm.position.x + sm.left.x * o;
      const z = sm.position.z + sm.left.z * o;
      if (k === 0) g.moveTo(x, z);
      else g.lineTo(x, z);
    }
    g.stroke();
  }
  // S/F line
  const sf = samples[0];
  g.strokeStyle = '#fff';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(sf.position.x + sf.left.x * (sf.width / 2), sf.position.z + sf.left.z * (sf.width / 2));
  g.lineTo(sf.position.x - sf.left.x * (sf.width / 2), sf.position.z - sf.left.z * (sf.width / 2));
  g.stroke();

  // cars
  for (const car of cars) {
    const yaw = carYaw(car);
    g.save();
    g.translate(car.position.x, car.position.z);
    g.rotate(yaw);
    // local +X (left) maps to screen: with our transform x is right → left vector = +x... draw in local coords (x left, z fwd)
    g.fillStyle = car.isPlayer ? '#ffd600' : car.chassis.held ? '#888' : '#39f';
    if (car.status !== 'racing') g.fillStyle = '#555';
    g.fillRect(-1.0, -2.8, 2.0, 5.6);
    g.fillStyle = '#111';
    g.fillRect(-0.3, 1.9, 0.6, 0.9);
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const lx = [0.83, -0.83, 0.78, -0.78][i];
      const lz = i < 2 ? 1.8 : -1.8;
      g.save();
      g.translate(lx, lz);
      g.rotate(w.steerAngle);
      const slip = clamp01(w.slip / 1.5);
      g.fillStyle = w.locked ? '#f0f' : w.spinning ? '#f80' : `rgb(${Math.round(60 + slip * 195)},${Math.round(60 * (1 - slip))},60)`;
      if (!w.contact) g.fillStyle = '#0ff';
      g.fillRect(-0.2, -0.36, 0.4, 0.72);
      g.restore();
    }
    if (car.drs.open) {
      g.fillStyle = '#0f0';
      g.fillRect(-0.9, -2.9, 1.8, 0.3);
    }
    g.restore();
  }

  // telemetry
  const c = player;
  const gx = c.localAccel.x / 9.81;
  const gz = c.localAccel.z / 9.81;
  const w = c.wheels;
  const fmt = (v: number, d = 2) => (v >= 0 ? ' ' : '') + v.toFixed(d);
  const cnt = Object.entries(eventCounts)
    .map(([k, v]) => `${k.replace('car:', '')}:${v}`)
    .join(' ');
  telemetryEl.textContent = [
    `speed ${(c.speed * 3.6).toFixed(0).padStart(4)} km/h   gear ${c.engine.gear}   rpm ${c.engine.rpm.toFixed(0)}${c.engine.limiter ? ' LIM' : ''}  ${c.engine.powerKw.toFixed(0)} kW`,
    `thr ${c.engine.throttle.toFixed(2)} brk ${c.engine.brake.toFixed(2)} steer ${fmt(c.engine.steer)}  δFL ${fmt(w[0].steerAngle * 57.3, 1)}°`,
    `g: lat ${fmt(gx)} long ${fmt(gz)}   yawRate ${fmt(c.angularVelocity.y)}  ${c.chassis.airborne ? 'AIRBORNE' : ''}`,
    `ERS ${c.ers.mode} ${(c.ers.battery * 100).toFixed(0)}% ${c.ers.deploying ? 'DEPLOY' : c.ers.harvesting ? 'HARVEST' : ''}  DRS ${c.drs.open ? 'OPEN' : c.drs.available ? 'avail' : '-'}  fuel ${c.fuel.toFixed(1)}`,
    `track s ${c.track.s.toFixed(1)} lat ${fmt(c.track.lateral)} sec ${c.track.sector} lap ${c.track.lap} ${c.track.surface} off ${c.track.wheelsOff} ${c.track.inPitLane ? 'PIT' : ''} ${limiter ? 'LIMITER' : ''}`,
    `bottoming ${c.chassis.bottoming.toFixed(2)} kerb ${c.chassis.kerbRumble.toFixed(2)} held ${c.chassis.held}  dmg ${c.damage.total.toFixed(2)} (fw ${c.damage.frontWing.toFixed(2)} rw ${c.damage.rearWing.toFixed(2)})`,
    `tyres ${c.tyres.compound} wear ${(c.tyres.wear * 100).toFixed(1)}% grip ${c.tyres.gripFactor.toFixed(2)} age ${c.tyres.age}  wet ${wetness}`,
    '      load    κ      α°    slip  temp  wear  travel',
    ...w.map((x, i) => `${['FL', 'FR', 'RL', 'RR'][i]} ${x.load.toFixed(0).padStart(6)} ${fmt(x.slipRatio)} ${fmt(x.slipAngle * 57.3, 1).padStart(6)} ${x.slip.toFixed(2).padStart(5)} ${x.temp.toFixed(0).padStart(5)} ${(x.wear * 100).toFixed(1).padStart(5)} ${(x.suspensionTravel * 1000).toFixed(0).padStart(5)}mm ${x.surface}${x.locked ? ' LOCK' : ''}${x.spinning ? ' SPIN' : ''}`),
    `assists TC:${assists.tractionControl} ABS:${assists.abs} auto:${assists.autoGears} steer:${assists.steeringAssist} brake:${assists.brakingAssist}`,
    `step ${stepMs.toFixed(3)} ms (${cars.length} cars, traffic ${trafficOn})  ${cnt}`,
  ].join('\n');
};


// Expose for automated browser runs.
(window as unknown as { __runTests: () => void; __runBench: () => unknown }).__runTests = () => runTests(log);
(window as unknown as { __runTests: () => void; __runBench: () => unknown }).__runBench = () => runBench(3000, 20);
