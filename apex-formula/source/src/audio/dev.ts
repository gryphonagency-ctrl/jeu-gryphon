/**
 * Isolated harness for the audio system: fake World with 6 orbiting AI cars, sliders for the player car,
 * event buttons, per-bus meters. Serve with `npx vite` and open /src/audio/dev.html.
 */
import * as THREE from 'three';
import { CAR } from '../core/constants';
import { events } from '../core/events';
import { CORE_CIRCUITS } from '../core/circuits';
import { TrackSpline } from '../core/track/TrackSpline';
import { DRIVERS, DRIVER_BY_ID, TEAMS, TEAM_BY_ID } from '../core/teams';
import { createEmptyCarState, createEnvironment } from '../core/world';
import type { CameraMode, CarState, RaceEntry, RaceState, SessionConfig, SurfaceType, UISound, World } from '../core/types';
import type { QualityLevel } from '../core/constants';
import { AudioSystem, METER_NAMES } from './AudioSystem';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const logEl = $('log');
const log = (msg: string, cls = ''): void => {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  logEl.prepend(line);
  while (logEl.childElementCount > 60) logEl.lastElementChild?.remove();
};

// Surface console errors/warnings in the page log so a clean run is visible.
const origError = console.error.bind(console);
const origWarn = console.warn.bind(console);
console.error = (...args: unknown[]) => {
  origError(...args);
  log(`console.error: ${args.map(String).join(' ')}`, 'bad');
};
console.warn = (...args: unknown[]) => {
  origWarn(...args);
  log(`console.warn: ${args.map(String).join(' ')}`, 'bad');
};
window.addEventListener('error', (e) => log(`window.error: ${e.message}`, 'bad'));
window.addEventListener('unhandledrejection', (e) => log(`unhandledrejection: ${String(e.reason)}`, 'bad'));

/* ───────────── fake world ───────────── */

const AI_COUNT = 6;
const trackDef = CORE_CIRCUITS[0];
const track = new TrackSpline(trackDef);
const config: SessionConfig = {
  mode: 'quick-race',
  sessionType: 'race',
  circuitId: trackDef.id,
  laps: 5,
  playerDriverId: DRIVERS[0].id,
  aiDifficulty: 0.7,
  aiCount: AI_COUNT,
  weather: 'dry',
  timeOfDay: 14,
  assists: { tractionControl: 'medium', abs: true, autoGears: true, steeringAssist: true, brakingAssist: false, racingLine: 'corners', pitAssist: true, ersAssist: true, drsAssist: true },
  startingCompound: 'soft',
  gridOrder: 'performance',
  randomEvents: false,
};

const cars: CarState[] = [];
for (let i = 0; i <= AI_COUNT; i++) {
  const d = DRIVERS[i];
  cars.push(createEmptyCarState(i, d.id, d.teamId, i === 0, 'soft'));
}

const makeEntry = (car: CarState, pos: number): RaceEntry => ({
  carId: car.id,
  driverId: car.driverId,
  teamId: car.teamId,
  position: pos,
  gridPosition: pos,
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
  drsAvailable: false,
  drsOpen: false,
  drsDetectionGap: Infinity,
  finishTime: 0,
  blueFlag: false,
  deltaAhead: 0,
  deltaBehind: 0,
  retireReason: '',
});
const entries = cars.map((c, i) => makeEntry(c, i + 1));
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
  trackDef,
  track,
  cars,
  race,
  env: createEnvironment(14),
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

const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
camera.position.set(0, 1.2, -6);
camera.lookAt(0, 0.8, 10);
camera.updateMatrixWorld();

/* ───────────── controls ───────────── */

const audio = new AudioSystem();
const state = {
  rpm: 6000,
  throttle: 0.3,
  speed: 40,
  slipF: 0.3,
  slipR: 0.3,
  kerb: 0,
  brake: 0,
  bottoming: 0,
  rain: 0,
  wetness: 0,
  wind: 3,
  limiter: false,
  deploying: false,
  harvesting: false,
  pitLimiter: false,
  locked: false,
  held: false,
  surface: 'asphalt' as SurfaceType,
  orbitSpeed: 35,
  autoDrive: false,
  nanTorture: false,
  sessionOn: false,
  muted: false,
  paused: false,
  music: false,
};

interface SliderDef {
  key: keyof typeof state;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
}
const sliders: SliderDef[] = [
  { key: 'rpm', label: 'rpm', min: 0, max: CAR.maxRpm, step: 50 },
  { key: 'throttle', label: 'throttle', min: 0, max: 1, step: 0.01 },
  { key: 'speed', label: 'speed m/s', min: 0, max: 100, step: 0.5, fmt: (v) => `${(v * 3.6).toFixed(0)} km/h` },
  { key: 'slipF', label: 'slip front', min: 0, max: 2, step: 0.01 },
  { key: 'slipR', label: 'slip rear', min: 0, max: 2, step: 0.01 },
  { key: 'kerb', label: 'kerb', min: 0, max: 1, step: 0.01 },
  { key: 'brake', label: 'brake', min: 0, max: 1, step: 0.01 },
  { key: 'bottoming', label: 'bottoming', min: 0, max: 1, step: 0.01 },
  { key: 'rain', label: 'rain', min: 0, max: 1, step: 0.01 },
  { key: 'wetness', label: 'wetness', min: 0, max: 1, step: 0.01 },
  { key: 'wind', label: 'wind m/s', min: 0, max: 30, step: 0.5 },
];
const slidersEl = $('sliders');
const sliderInputs = new Map<string, HTMLInputElement>();
for (const s of sliders) {
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('label');
  label.textContent = s.label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(s.min);
  input.max = String(s.max);
  input.step = String(s.step);
  input.value = String(state[s.key]);
  const out = document.createElement('output');
  const show = () => (out.textContent = s.fmt ? s.fmt(Number(input.value)) : Number(input.value).toFixed(s.step < 1 ? 2 : 0));
  input.addEventListener('input', () => {
    (state as Record<string, unknown>)[s.key] = Number(input.value);
    show();
  });
  show();
  row.append(label, input, out);
  slidersEl.append(row);
  sliderInputs.set(s.key, input);
}

const checksEl = $('checks');
const checkKeys: (keyof typeof state)[] = ['limiter', 'deploying', 'harvesting', 'pitLimiter', 'locked', 'held', 'nanTorture'];
for (const key of checkKeys) {
  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!state[key];
  cb.addEventListener('change', () => ((state as Record<string, unknown>)[key] = cb.checked));
  label.append(cb, document.createTextNode(key));
  checksEl.append(label);
}

$('surface').addEventListener('change', (e) => (state.surface = (e.target as HTMLSelectElement).value as SurfaceType));
$('camera').addEventListener('change', (e) => events.emit('camera:mode', { mode: (e.target as HTMLSelectElement).value as CameraMode }));
$('quality').addEventListener('change', (e) => events.emit('quality:change', { quality: (e.target as HTMLSelectElement).value as QualityLevel }));

const button = (parent: HTMLElement, text: string, onClick: (btn: HTMLButtonElement) => void): HTMLButtonElement => {
  const b = document.createElement('button');
  b.className = 'b';
  b.textContent = text;
  b.addEventListener('click', () => onClick(b));
  parent.append(b);
  return b;
};

const autoBtn = button($('autodrive'), 'AUTO-DRIVE (rpm sweep through gears)', (b) => {
  state.autoDrive = !state.autoDrive;
  b.classList.toggle('on', state.autoDrive);
});

const ev = $('events');
const player = cars[0];
button(ev, 'gear up', () => {
  player.engine.gear = Math.min(8, player.engine.gear + 1);
  events.emit('car:gear', { carId: 0, gear: player.engine.gear, up: true });
});
button(ev, 'gear down', () => {
  player.engine.gear = Math.max(1, player.engine.gear - 1);
  events.emit('car:gear', { carId: 0, gear: player.engine.gear, up: false });
});
button(ev, 'DRS open', () => events.emit('car:drs', { carId: 0, open: true }));
button(ev, 'DRS close', () => events.emit('car:drs', { carId: 0, open: false }));
const collide = (impulse: number) =>
  events.emit('car:collision', { carId: 0, withCar: 1, impulse, point: player.position.clone(), normal: new THREE.Vector3(1, 0, 0) });
button(ev, 'collision small', () => collide(900));
button(ev, 'collision large', () => collide(9000));
button(ev, 'AI collision far', () => events.emit('car:collision', { carId: 2, withCar: 3, impulse: 6000, point: new THREE.Vector3(40, 0, 40), normal: new THREE.Vector3(1, 0, 0) }));
button(ev, 'lights sequence', () => {
  let n = 1;
  const tick = () => {
    race.lightsOn = n <= 5 ? n : 0;
    events.emit('race:lights', { lightsOn: race.lightsOn });
    if (n <= 5) {
      n++;
      setTimeout(tick, n === 6 ? 900 + Math.random() * 1500 : 1000);
    }
  };
  tick();
});
button(ev, 'radio (engineer)', () => events.emit('radio:message', { carId: 0, from: 'engineer', text: 'Box box, box this lap. We are going to the hard tyre. Great pace, keep it up.' }));
button(ev, 'radio (race control)', () => events.emit('radio:message', { carId: 0, from: 'race-control', text: 'Track limits warning, turn 9. Final warning.' }));
button(ev, 'radio (other car)', () => events.emit('radio:message', { carId: 3, from: 'engineer', text: 'This should be silent.' }));
button(ev, 'overtake (player)', () => events.emit('race:overtake', { carId: 0, overtakenCarId: 2, position: 2 }));
button(ev, 'fastest lap', () => events.emit('race:fastest-lap', { carId: 0, time: 81.2 }));
button(ev, 'finish (player)', () => events.emit('race:finish', { carId: 0, position: 1 }));
button(ev, 'off-track', () => events.emit('car:offtrack', { carId: 0, surface: 'gravel', wheelsOff: 4 }));
button(ev, 'reset', () => events.emit('car:reset', { carId: 0 }));
button(ev, 'engine failure', () => events.emit('car:engine-failure', { carId: 0 }));

const uiEl = $('uisounds');
const uiSounds: UISound[] = ['nav', 'confirm', 'back', 'error', 'start', 'lights', 'lights-out', 'notify', 'purple', 'penalty', 'finish'];
for (const s of uiSounds) button(uiEl, s, () => audio.playUI(s));

const sessionEl = $('session');
const sessionBtn = button(sessionEl, 'createSession', (b) => {
  if (state.sessionOn) {
    audio.endSession();
    state.sessionOn = false;
    b.textContent = 'createSession';
    log('endSession()');
  } else {
    audio.createSession(world);
    state.sessionOn = true;
    b.textContent = 'endSession';
    log('createSession(world)');
  }
  b.classList.toggle('on', state.sessionOn);
});
button(sessionEl, 'menu music', (b) => {
  state.music = !state.music;
  audio.setMenuMusic(state.music);
  b.classList.toggle('on', state.music);
});
button(sessionEl, 'pause', (b) => {
  state.paused = !state.paused;
  world.paused = state.paused;
  events.emit('session:pause', { paused: state.paused });
  b.classList.toggle('on', state.paused);
});
button(sessionEl, 'mute', (b) => {
  state.muted = !state.muted;
  audio.setMuted(state.muted);
  b.classList.toggle('on', state.muted);
});
button(sessionEl, 'dispose()', () => {
  audio.dispose();
  log('dispose() called — reload the page to restart.', 'bad');
});
const volume = $<HTMLInputElement>('volume');
const volumeOut = $('volume-out');
volume.addEventListener('input', () => {
  audio.setMasterVolume(Number(volume.value));
  volumeOut.textContent = Number(volume.value).toFixed(2);
});
audio.setMasterVolume(Number(volume.value));

const orbit = $<HTMLInputElement>('orbit');
const orbitOut = $('orbit-out');
orbit.addEventListener('input', () => {
  state.orbitSpeed = Number(orbit.value);
  orbitOut.textContent = `${state.orbitSpeed} m/s`;
});

$<HTMLButtonElement>('start').addEventListener('click', async (e) => {
  const b = e.currentTarget as HTMLButtonElement;
  b.disabled = true;
  await audio.resume();
  audio.enableMetering();
  log(`resume() → ${audio.getDebugInfo().state}`, 'ok');
  if (!state.sessionOn) sessionBtn.click();
});

/* ───────────── meters ───────────── */

const metersEl = $<HTMLTableElement>('meters');
metersEl.innerHTML = `<tr><th>bus</th><th>rms</th><th>peak</th><th style="width:40%">level</th></tr>` + METER_NAMES.map((b) => `<tr><td>${b}</td><td id="m-${b}-rms">0.000</td><td id="m-${b}-peak">0.000</td><td><div class="meter"><i id="m-${b}-bar"></i></div></td></tr>`).join('');
const statusEl = $('status');
let peakNodes = 0;

/* ───────────── loop ───────────── */

const gearRatio = [0, 0.32, 0.45, 0.58, 0.7, 0.8, 0.88, 0.95, 1.0];
let autoT = 0;
let last = performance.now();
const mapCanvas = $<HTMLCanvasElement>('map');
const mapCtx = mapCanvas.getContext('2d');
const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
let angleBase = 0;

const frame = (now: number): void => {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  world.time += dt;
  world.realTime += dt;

  // Auto-drive: sweep rpm through gears with a throttle lift on each up-shift.
  if (state.autoDrive) {
    autoT += dt;
    const period = 2.4;
    const phase = (autoT % period) / period;
    const gear = 1 + Math.floor((autoT / period) % 7);
    const rpm = 7000 + phase * 8000;
    state.rpm = rpm;
    state.throttle = phase < 0.92 ? 1 : 0.1;
    state.speed = Math.min(100, 12 + gearRatio[gear] * 88 * (0.75 + 0.25 * phase));
    state.limiter = rpm > 14700;
    if (player.engine.gear !== gear) {
      const up = gear > player.engine.gear;
      player.engine.gear = gear;
      events.emit('car:gear', { carId: 0, gear, up });
    }
    sliderInputs.get('rpm')!.value = String(rpm);
    sliderInputs.get('throttle')!.value = String(state.throttle);
    sliderInputs.get('speed')!.value = String(state.speed);
  }

  // Player car from sliders.
  const bad = state.nanTorture ? NaN : 0;
  player.engine.rpm = state.rpm + bad;
  player.engine.throttle = state.throttle + bad;
  player.engine.brake = state.brake + bad;
  player.engine.limiter = state.limiter;
  player.speed = state.speed + bad;
  player.speedAbs = state.speed + (state.nanTorture ? Infinity : 0);
  player.velocity.set(0, 0, state.speed);
  player.ers.deploying = state.deploying;
  player.ers.harvesting = state.harvesting;
  player.input.pitLimiter = state.pitLimiter;
  player.chassis.kerbRumble = state.kerb + bad;
  player.chassis.bottoming = state.bottoming;
  player.chassis.held = state.held;
  player.track.s = (world.time * state.speed) % track.length;
  for (let i = 0; i < 4; i++) {
    const w = player.wheels[i];
    w.slip = (i < 2 ? state.slipF : state.slipR) + bad;
    w.load = 4500 + bad;
    w.locked = state.locked && i < 2;
    w.surface = state.surface;
    w.contact = true;
    w.suspensionTravel = 0.01 * Math.sin(world.time * 3 + i) + (state.kerb > 0.5 ? 0.03 * Math.sin(world.time * 40 + i) : 0);
  }
  world.env.weather.rain = state.rain + bad;
  world.env.weather.wetness = state.wetness;
  world.env.weather.windSpeed = state.wind;

  // AI cars orbit the listener at staggered radii; velocity from the orbit for Doppler.
  angleBase += (state.orbitSpeed / 30) * dt;
  for (let i = 1; i <= AI_COUNT; i++) {
    const c = cars[i];
    const r = 14 + i * 7;
    const w = state.orbitSpeed / r;
    const a = angleBase * (30 / r) + (i * Math.PI * 2) / AI_COUNT;
    _pos.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    _vel.set(-Math.sin(a) * r * w, 0, Math.cos(a) * r * w);
    c.position.copy(_pos);
    c.velocity.copy(_vel);
    c.speed = c.speedAbs = _vel.length();
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _vel.clone().normalize());
    c.engine.rpm = 9000 + 4500 * Math.abs(Math.sin(world.time * 0.7 + i));
    c.engine.throttle = 0.5 + 0.5 * Math.sin(world.time * 0.9 + i * 1.3);
    if (state.nanTorture && i === 3) c.engine.rpm = NaN;
  }

  audio.update(state.sessionOn ? world : null, camera, dt);

  // Meters & status
  const info = audio.getDebugInfo();
  peakNodes = Math.max(peakNodes, info.liveNodes);
  statusEl.innerHTML = `<span>context</span><b class="${info.state === 'running' ? 'ok' : ''}">${info.state}</b><span>sample rate</span><b>${info.sampleRate}</b><span>live nodes</span><b>${info.liveNodes} (peak ${peakNodes})</b><span>spatial</span><b>${info.spatialVoices} voices · ${info.hrtf ? 'HRTF' : 'equalpower'}</b><span>camera</span><b>${audio.getCameraMode()}</b>`;
  for (const b of METER_NAMES) {
    const m = info.buses[b];
    $(`m-${b}-rms`).textContent = m.rms.toFixed(3);
    $(`m-${b}-peak`).textContent = m.peak.toFixed(3);
    ($(`m-${b}-bar`) as HTMLElement).style.width = `${Math.min(100, m.peak * 100)}%`;
    if (!Number.isFinite(m.rms) || !Number.isFinite(m.peak)) log(`non-finite meter on ${b}`, 'bad');
  }

  // Map
  if (mapCtx) {
    const W = mapCanvas.width;
    const H = mapCanvas.height;
    mapCtx.clearRect(0, 0, W, H);
    const scale = H / 130;
    const cx = W / 2;
    const cy = H / 2;
    mapCtx.strokeStyle = '#262c3b';
    for (let i = 1; i <= AI_COUNT; i++) {
      mapCtx.beginPath();
      mapCtx.arc(cx, cy, (14 + i * 7) * scale, 0, Math.PI * 2);
      mapCtx.stroke();
    }
    mapCtx.fillStyle = '#e10600';
    mapCtx.beginPath();
    mapCtx.arc(cx, cy, 5, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.fillStyle = '#e6e9f2';
    mapCtx.font = '10px system-ui';
    mapCtx.fillText('listener', cx + 8, cy - 4);
    for (let i = 1; i <= AI_COUNT; i++) {
      const c = cars[i];
      mapCtx.fillStyle = TEAM_BY_ID[c.teamId]?.primaryColor ?? '#fff';
      mapCtx.beginPath();
      mapCtx.arc(cx + c.position.x * scale, cy - c.position.z * scale, 4, 0, Math.PI * 2);
      mapCtx.fill();
    }
  }
};
requestAnimationFrame(frame);

log('Harness ready. Press START AUDIO (user gesture) to create the AudioContext.');
