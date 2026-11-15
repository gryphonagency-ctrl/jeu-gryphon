/**
 * Headless harness for the race director: kinematic stand-in cars move around Kingsmere's spline, a fake ICarService
 * logs calls, and a set of checks verify timing, classification, DRS, pits, penalties, flags and results.
 * Serve with `npx vite --port 5206` and open http://localhost:5206/src/race/dev.html#race (or #quali / #tt).
 */
import * as THREE from 'three';
import { KINGSMERE } from '../core/circuits';
import { PHYSICS_DT, POINTS_TABLE, TYRE_DATA, type TyreCompound } from '../core/constants';
import { events } from '../core/events';
import { Rng, formatGap, formatLapTime } from '../core/math';
import { DRIVERS, DRIVER_BY_ID, TEAMS, TEAM_BY_ID } from '../core/teams';
import { TrackSpline } from '../core/track/TrackSpline';
import type { CarState, ICarService, SessionConfig, World } from '../core/types';
import { createEmptyCarState, createEnvironment } from '../core/world';
import { RaceDirector } from './RaceDirector';

type Scenario = 'race' | 'quali' | 'tt';

/** The same file runs in the browser (timing tower page) or bundled for Node (`rolldown` + `node`, prints checks). */
const hasDom = typeof document !== 'undefined';
const nodeArgs = (globalThis as unknown as { process?: { argv: string[] } }).process?.argv ?? [];
const $ = (id: string): HTMLElement => (hasDom ? (document.getElementById(id) as HTMLElement) : ({ textContent: '', innerHTML: '', innerText: '', scrollTop: 0, scrollHeight: 0 } as unknown as HTMLElement));
const statusEl = $('status');
const towerEl = $('tower') as HTMLTableElement;
const logEl = $('log');
const checksEl = $('checks');

/* ────────────────────────────── checks ────────────────────────────── */

const checks = new Map<string, { ok: boolean; detail: string }>();
const check = (name: string, ok: boolean, detail = ''): void => {
  const prev = checks.get(name);
  if (prev && !prev.ok && ok) return; // never let a later pass hide an earlier failure
  checks.set(name, { ok, detail });
};
const renderChecks = (): void => {
  const rows = [...checks.entries()].map(([n, c]) => `<div class="${c.ok ? 'ok' : 'fail'}">${c.ok ? 'PASS' : 'FAIL'}  ${n}${c.detail ? ` — ${c.detail}` : ''}</div>`);
  const fails = [...checks.values()].filter((c) => !c.ok).length;
  checksEl.innerHTML = `<div><strong>${checks.size} checks, ${fails} failing</strong></div>${rows.join('')}`;
};

const logLines: string[] = [];
const log = (text: string, cls = 'k-info'): void => {
  logLines.push(`<div class="${cls}">${text}</div>`);
  if (logLines.length > 400) logLines.splice(0, logLines.length - 400);
  if (!hasDom) console.log(text);
};

/* ────────────────────────────── fake car service ────────────────────────────── */

class FakeCars implements ICarService {
  calls: string[] = [];
  serviceCalls: { carId: number; compound?: TyreCompound; repair?: boolean }[] = [];
  retired = new Set<number>();
  drsSets = 0;
  constructor(private readonly cars: CarState[]) {}
  holdCar(carId: number, held: boolean): void {
    this.cars[carId].chassis.held = held;
    this.calls.push(`holdCar(${carId},${held})`);
  }
  serviceCar(carId: number, opts: { compound?: TyreCompound; repair?: boolean }): void {
    if (opts.compound) this.cars[carId].tyres.compound = opts.compound;
    this.cars[carId].tyres.age = 0;
    this.serviceCalls.push({ carId, ...opts });
    this.calls.push(`serviceCar(${carId},${opts.compound})`);
  }
  resetCar(carId: number): void {
    this.calls.push(`resetCar(${carId})`);
  }
  retireCar(carId: number): void {
    this.retired.add(carId);
    this.calls.push(`retireCar(${carId})`);
  }
  placeOnGridSlot(): void {}
  placeInPitBox(): void {}
  setDrsAvailable(carId: number, available: boolean): void {
    this.cars[carId].drs.available = available;
    this.drsSets++;
  }
}

/* ────────────────────────────── kinematic movers ────────────────────────────── */

interface Mover {
  car: CarState;
  v: number;
  pace: number;
  lapNoise: number;
  pitting: boolean;
  stopDone: boolean;
  pitSpeed: number;
  lastS: number;
  lapStartSim: number;
  prevLapStartSim: number;
  limitsLaps: Set<number>;
  limitsFired: number;
  alwaysPit: boolean;
  alwaysInvalid: boolean;
}

const VMAX = 91;
const A_BRAKE = 38;

const buildSpeedProfile = (track: TrackSpline): Float32Array => {
  const n = Math.ceil(track.length);
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) p[i] = Math.min(VMAX, track.cornerSpeed(i, 4.4));
  for (let pass = 0; pass < 2; pass++) {
    for (let k = n * 2 - 1; k >= 0; k--) {
      const i = k % n;
      const next = p[(i + 1) % n];
      p[i] = Math.min(p[i], Math.sqrt(next * next + 2 * A_BRAKE * 1));
    }
  }
  return p;
};

/* ────────────────────────────── session ────────────────────────────── */

interface Session {
  scenario: Scenario;
  world: World;
  director: RaceDirector;
  service: FakeCars;
  movers: Mover[];
  track: TrackSpline;
  profile: Float32Array;
  rng: Rng;
  simTime: number;
  timeScale: number;
  updateNs: number;
  updateCount: number;
  lightsTimes: number[];
  greenAt: number;
  racingAt: number;
  pitPhaseLog: Map<number, string[]>;
  drsGrants: number;
  drsViolations: number;
  flicker: number;
  gapViolations: number;
  swapAt: Map<number, number>;
  lapMismatch: number;
  lapsChecked: number;
  sectorMismatch: number;
  sectorMinSeen: number[];
  purpleViolations: number;
  collisionsFired: number;
  failureFired: boolean;
  endSessionCalled: boolean;
  finishedAt: number;
  done: boolean;
  lastRender: number;
  handlers: (() => void)[];
}

let session: Session | null = null;

const makeConfig = (scenario: Scenario): SessionConfig => ({
  mode: scenario === 'tt' ? 'time-trial' : 'quick-race',
  sessionType: scenario === 'race' ? 'race' : scenario === 'quali' ? 'qualifying' : 'practice',
  circuitId: 'kingsmere',
  laps: 5,
  playerDriverId: 'dekker',
  aiDifficulty: 0.8,
  aiCount: scenario === 'tt' ? 0 : 19,
  weather: scenario === 'tt' ? 'dynamic' : 'dry',
  timeOfDay: -1,
  assists: { tractionControl: 'medium', abs: true, autoGears: true, steeringAssist: false, brakingAssist: false, racingLine: 'corners', pitAssist: true, ersAssist: true, drsAssist: true },
  startingCompound: 'medium',
  gridOrder: 'performance',
  randomEvents: scenario === 'race',
});

const createSession = (scenario: Scenario): Session => {
  session?.handlers.forEach((off) => off());
  session?.director.dispose();
  checks.clear();
  logLines.length = 0;

  const config = makeConfig(scenario);
  const track = new TrackSpline(KINGSMERE);
  const env = createEnvironment(KINGSMERE.environment.timeOfDay);
  const rng = new Rng(1234);
  const n = scenario === 'tt' ? 1 : 20;
  const lineup = DRIVERS.slice(0, n);
  const perf = (d: (typeof DRIVERS)[number]) => {
    const t = TEAM_BY_ID[d.teamId];
    return (t.performance.power + t.performance.aero) * 0.35 + d.skill.pace * 0.3;
  };
  const ordered = [...lineup].sort((a, b) => perf(b) - perf(a));
  const gridPos = new Map(ordered.map((d, i) => [d.id, i + 1]));

  const cars: CarState[] = lineup.map((d, i) => {
    const c = createEmptyCarState(i, d.id, d.teamId, i === 0, config.startingCompound);
    c.gridPosition = gridPos.get(d.id) ?? i + 1;
    return c;
  });
  const service = new FakeCars(cars);
  const director = new RaceDirector();
  const worldNoRace: Omit<World, 'race'> = {
    mode: 'live',
    config,
    trackDef: KINGSMERE,
    track,
    cars,
    env,
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
  const race = director.createSession(worldNoRace, service);
  const world: World = { ...worldNoRace, race };

  // Place cars like main.ts does.
  const movers: Mover[] = cars.map((c, i) => {
    let s: number;
    let lateral = 0;
    if (scenario === 'race') {
      const slot = track.gridSlot(c.gridPosition - 1);
      s = slot.s;
      lateral = slot.lateral;
      c.chassis.held = true;
    } else {
      const gap = track.length / Math.max(1, n);
      s = track.wrapS(-250 - gap * (n - 1 - i) * 0.6);
    }
    c.track.s = s;
    c.track.lateral = lateral;
    c.track.lap = 0;
    c.track.progress = s;
    c.track.sector = track.sectorOf(s);
    track.trackToWorld(s, lateral, c.position);
    const d = DRIVER_BY_ID[c.driverId];
    return {
      car: c,
      v: 0,
      pace: 0.9 + d.skill.pace * 0.1 + rng.range(-0.01, 0.01),
      lapNoise: 1,
      pitting: false,
      stopDone: false,
      pitSpeed: 21.5,
      lastS: s,
      lapStartSim: -1,
      prevLapStartSim: -1,
      limitsLaps: new Set(),
      limitsFired: 0,
      alwaysPit: false,
      alwaysInvalid: false,
    };
  });

  // Scenario scripts.
  if (scenario === 'race') {
    movers[5].pitSpeed = 25.5; // pit-lane speeder
    movers[7].limitsLaps = new Set([2, 3, 4]); // track-limits offender
  } else if (scenario === 'quali') {
    movers[4].alwaysInvalid = true; // exceeds track limits every lap → no time
    movers[6].alwaysPit = true; // in/out laps only → no time
  }

  const sess: Session = {
    scenario,
    world,
    director,
    service,
    movers,
    track,
    profile: buildSpeedProfile(track),
    rng,
    simTime: 0,
    timeScale: scenario === 'quali' ? 40 : scenario === 'tt' ? 30 : 25,
    updateNs: 0,
    updateCount: 0,
    lightsTimes: [],
    greenAt: -1,
    racingAt: -1,
    pitPhaseLog: new Map(),
    drsGrants: 0,
    drsViolations: 0,
    flicker: 0,
    gapViolations: 0,
    swapAt: new Map(),
    lapMismatch: 0,
    lapsChecked: 0,
    sectorMismatch: 0,
    sectorMinSeen: [Infinity, Infinity, Infinity],
    purpleViolations: 0,
    collisionsFired: 0,
    failureFired: false,
    endSessionCalled: false,
    finishedAt: -1,
    done: false,
    lastRender: 0,
    handlers: [],
  };
  subscribe(sess);
  log(`Scenario ${scenario}: ${n} cars, track ${track.length.toFixed(0)} m, sector ends ${track.sectorS.map((v) => v.toFixed(0)).join('/')}`);
  return sess;
};

const code = (carId: number): string => DRIVER_BY_ID[session!.world.cars[carId].driverId].code;

const subscribe = (s: Session): void => {
  const h = s.handlers;
  h.push(
    events.on('race:lights', ({ lightsOn }) => {
      s.lightsTimes.push(s.simTime);
      log(`LIGHTS ${lightsOn} @ ${s.simTime.toFixed(2)}`, 'k-flag');
      if (lightsOn === 0) s.greenAt = s.simTime;
    }),
    events.on('race:phase', ({ phase, previous }) => {
      log(`PHASE ${previous} → ${phase} @ race.time ${s.world.race.time.toFixed(2)} sim ${s.simTime.toFixed(2)}`, 'k-flag');
      if (phase === 'racing' && previous === 'green') s.racingAt = s.simTime;
      if (phase === 'finished') s.finishedAt = s.simTime;
    }),
    events.on('race:message', (m) => log(`[${m.time.toFixed(1)}] ${m.kind.toUpperCase()}: ${m.text}`, `k-${m.kind}`)),
    events.on('radio:message', (r) => log(`📻 ${code(r.carId)} (${r.from}): ${r.text}`, 'k-radio')),
    events.on('race:lap', ({ carId, lap, time, personalBest, fastestOverall }) => {
      const m = s.movers[carId];
      if (m.prevLapStartSim >= 0 && s.scenario !== 'race') {
        // harness-measured lap time (interpolated crossings) vs director's (step-quantised): must agree within a step
        const mine = m.lapStartSim - m.prevLapStartSim;
        s.lapsChecked++;
        if (Math.abs(mine - time) > PHYSICS_DT * 1.5) {
          s.lapMismatch++;
          if (s.lapMismatch <= 3) log(`LAP MISMATCH ${code(carId)} harness ${mine.toFixed(4)} director ${time.toFixed(4)}`, 'k-warning');
        }
      }
      const e = s.world.race.entryByCar[carId];
      const sum = e.currentSectors[0] + e.currentSectors[1] + e.currentSectors[2];
      if (e.currentSectors[0] > 0 && e.currentSectors[1] > 0 && e.currentSectors[2] > 0 && Math.abs(sum - time) > 0.02) s.sectorMismatch++;
      if (carId === 0 || fastestOverall) log(`LAP ${code(carId)} L${lap} ${formatLapTime(time)}${personalBest ? ' PB' : ''}${fastestOverall ? ' FASTEST' : ''}`);
    }),
    events.on('race:sector', ({ sector, time, status }) => {
      if (status === 'purple' && time > s.sectorMinSeen[sector] + 1e-9) s.purpleViolations++;
      if (status === 'purple' || status === 'green') s.sectorMinSeen[sector] = Math.min(s.sectorMinSeen[sector], time);
    }),
    events.on('race:drs-available', ({ carId, available }) => {
      if (!available) return;
      const race = s.world.race;
      const car = s.world.cars[carId];
      const e = race.entryByCar[carId];
      s.drsGrants++;
      const ok = race.drsEnabled && s.track.drsZoneAt(car.track.s) !== null && !car.track.inPitLane && (s.scenario !== 'race' || (race.leaderLap >= 3 && e.drsDetectionGap < 1));
      if (!ok) {
        s.drsViolations++;
        log(`DRS VIOLATION ${code(carId)} enabled=${race.drsEnabled} leaderLap=${race.leaderLap} gap=${e.drsDetectionGap.toFixed(2)}`, 'k-penalty');
      }
    }),
    events.on('race:pit-entry', ({ carId }) => log(`PIT ENTRY ${code(carId)}`, 'k-pit')),
    events.on('race:pit-stop-start', ({ carId }) => log(`PIT STOP START ${code(carId)} timer ${s.world.race.entryByCar[carId].pitStopTimer.toFixed(2)}`, 'k-pit')),
    events.on('race:pit-stop-end', ({ carId, duration, compound }) => log(`PIT STOP END ${code(carId)} ${duration.toFixed(2)}s ${compound}`, 'k-pit')),
    events.on('race:pit-exit', ({ carId }) => log(`PIT EXIT ${code(carId)}`, 'k-pit')),
    events.on('race:penalty', ({ carId, seconds, reason }) => log(`PENALTY ${code(carId)} +${seconds}s ${reason}`, 'k-penalty')),
    events.on('race:warning', ({ carId, reason, count }) => log(`WARNING ${code(carId)} ${reason} (${count})`, 'k-warning')),
    events.on('race:overtake', ({ carId, overtakenCarId, position }) => {
      if (position <= 3) log(`OVERTAKE ${code(carId)} passes ${code(overtakenCarId)} for P${position}`);
    }),
    events.on('race:retire', ({ carId, reason }) => log(`RETIRE ${code(carId)} ${reason}`, 'k-penalty')),
    events.on('race:finish', ({ carId, position }) => log(`FINISH ${code(carId)} P${position} t=${s.world.race.entryByCar[carId].finishTime.toFixed(2)}`, 'k-flag')),
    events.on('race:flag', ({ flag, sector }) => log(`FLAG ${flag} ${sector < 0 ? 'GLOBAL' : `S${sector + 1}`}`, 'k-flag')),
    events.on('race:weather', ({ description, weather }) => log(`WEATHER ${description} rain=${weather.rain.toFixed(2)} wet=${weather.wetness.toFixed(2)}`)),
    events.on('race:blue-flag', ({ carId, active }) => {
      if (active) log(`BLUE FLAG ${code(carId)}`, 'k-flag');
    }),
    events.on('race:drs-enabled', ({ enabled }) => log(`DRS ENABLED=${enabled} leaderLap=${s.world.race.leaderLap}`, 'k-drs')),
    events.on('race:fastest-lap', ({ carId, time }) => log(`FASTEST LAP ${code(carId)} ${formatLapTime(time)}`)),
  );
};

/* ────────────────────────────── kinematic step ────────────────────────────── */

const _tan = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const stepMover = (s: Session, m: Mover, dt: number): void => {
  const car = m.car;
  const track = s.track;
  const race = s.world.race;
  const e = race.entryByCar[car.id];
  const L = track.length;

  if (s.service.retired.has(car.id)) {
    m.v = Math.max(0, m.v - 15 * dt);
  }
  if (car.chassis.held) m.v = 0;

  // Pit lane driving.
  const d = track.pitD(car.track.s);
  if (!m.pitting && (e.pitPhase === 'requested' || e.pitPhase === 'entering') && d >= 0 && d <= track.pitLane.transition) {
    m.pitting = true;
    m.stopDone = false;
  }
  let target: number;
  let lateral = car.track.lateral;
  if (m.pitting) {
    if (d < 0) {
      m.pitting = false;
      car.track.inPitLane = false;
      lateral = 0;
      target = s.profile[Math.floor(car.track.s) % s.profile.length] * m.pace * m.lapNoise;
    } else {
      const width = track.sampleAt(car.track.s).width;
      lateral = track.pitLaneLateralAtD(d, width);
      car.track.inPitLane = track.isInPitLane(car.track.s, lateral);
      // slow down ahead of the limit line like a real driver would (the deliberate speeder keeps pitSpeed above the limit)
      const limited = d >= track.pitLane.limitStartD - 40 && d <= track.pitLane.limitEndD;
      target = limited ? m.pitSpeed : 32;
      if (e.pitPhase === 'in-lane' || e.pitPhase === 'stopped') car.input.pitRequest = false;
      if (!m.stopDone) {
        const boxS = track.pitBox(TEAM_BY_ID[car.teamId].pitBoxIndex).s;
        const dist = track.distanceForward(car.track.s, boxS);
        if (dist < L / 2) {
          target = Math.min(target, Math.sqrt(2 * 6 * Math.max(0, dist - 0.15)));
          if (dist < 0.25 || (dist < 1 && m.v < 0.6)) {
            target = 0;
            m.v = 0;
          }
        }
        if (e.pitPhase === 'released') m.stopDone = true;
      }
    }
  } else {
    car.track.inPitLane = false;
    lateral = m.alwaysInvalid ? lateral : 0;
    target = s.profile[Math.floor(car.track.s) % s.profile.length] * m.pace * m.lapNoise;
    if (race.phase === 'vsc') target = Math.min(target, race.safetyCarSpeed);
    if (race.phase === 'finished' && e.status === 'finished') target = Math.min(target, 40);
  }
  if (race.phase === 'idle' || race.phase === 'formation' || race.phase === 'lights') target = 0;

  if (m.v < target) m.v = Math.min(target, m.v + Math.max(2, 14 - m.v * 0.11) * dt);
  else m.v = Math.max(target, m.v - A_BRAKE * dt);

  const prevS = car.track.s;
  let sNew = prevS + m.v * dt;
  if (sNew >= L) {
    sNew -= L;
    car.track.lap++;
    m.prevLapStartSim = m.lapStartSim;
    m.lapStartSim = s.simTime - dt + (L - prevS) / Math.max(1e-3, m.v);
    m.lapNoise = 1 + s.rng.gaussian() * 0.004;
    // Scripted per-lap behaviour (AI pit requests).
    if (s.scenario === 'race') {
      if (car.id === 3 && car.track.lap === 2) {
        car.input.pitRequest = true;
        car.input.pitCompound = null;
      }
      if (car.id === 5 && car.track.lap === 3) {
        car.input.pitRequest = true;
        car.input.pitCompound = 'hard';
      }
      if (car.id === 0 && car.track.lap === 3) s.director.requestPit(0, 'soft');
    }
    if (m.alwaysPit && car.track.lap >= 1) {
      car.input.pitRequest = true;
      car.input.pitCompound = 'soft';
    }
  }
  car.track.s = sNew;
  car.track.progress = car.track.lap * L + sNew;
  car.track.sector = track.sectorOf(sNew);
  car.track.lateral = lateral;
  car.track.forwardSpeed = m.v;
  car.speed = m.v;
  car.speedAbs = m.v;
  car.track.surface = car.track.inPitLane ? 'pit' : 'asphalt';

  // Track limits script: four wheels off on an asphalt run-off at speed, once per scripted lap.
  const off = (m.limitsLaps.has(car.track.lap) || (m.alwaysInvalid && car.track.lap >= 1)) && sNew > 600 && sNew < 640 && !car.track.inPitLane;
  const wasOff = car.track.wheelsOff === 4;
  car.track.wheelsOff = off ? 4 : 0;
  if (off && !wasOff) {
    car.track.surface = 'runoff';
    car.input.brake = 0;
    events.emit('car:offtrack', { carId: car.id, surface: 'runoff', wheelsOff: 4 });
    m.limitsFired++;
  } else if (!off && wasOff) events.emit('car:ontrack', { carId: car.id });

  track.trackToWorld(sNew, lateral, car.position);
  track.forwardAt(sNew, _tan);
  car.velocity.copy(_tan).multiplyScalar(m.v);
  car.quaternion.setFromAxisAngle(_up, Math.atan2(_tan.x, _tan.z));
  car.drs.open = car.drs.available && m.v > 30;
  car.tyres.age = e.tyreAge;
};

/* ────────────────────────────── scripted incidents ────────────────────────────── */

let lastCollisionSim = -Infinity;
const runScripts = (s: Session): void => {
  if (s.scenario !== 'race') return;
  const race = s.world.race;
  const cars = s.world.cars;
  if (race.phase !== 'racing') return;
  // Two collisions between cars 8 and 9 (impulse above the fault threshold), 60 s apart.
  if (s.collisionsFired < 2 && race.time > 45 + s.collisionsFired * 60 && s.simTime - lastCollisionSim > 1) {
    const a = cars[8];
    const b = cars[9];
    if (!a.track.inPitLane && !b.track.inPitLane && race.entryByCar[8].status === 'racing' && race.entryByCar[9].status === 'racing') {
      lastCollisionSim = s.simTime;
      s.collisionsFired++;
      const culprit = a.track.progress < b.track.progress ? 8 : 9;
      log(`SCRIPT: collision 8↔9 impulse 3600 (car behind = ${code(culprit)})`, 'k-warning');
      events.emit('car:collision', { carId: 8, withCar: 9, impulse: 3600, point: a.position, normal: _up });
      events.emit('car:collision', { carId: 9, withCar: 8, impulse: 3600, point: b.position, normal: _up });
    }
  }
  // Engine failure for car 12 at 150 s (on track) → retirement + VSC.
  if (!s.failureFired && race.time > 150 && race.entryByCar[12].status === 'racing') {
    s.failureFired = true;
    log('SCRIPT: engine failure car 12', 'k-warning');
    events.emit('car:engine-failure', { carId: 12 });
  }
};

/* ────────────────────────────── continuous checks ────────────────────────────── */

const prevOrder: number[] = [];
const auditClassification = (s: Session): void => {
  const race = s.world.race;
  const cars = s.world.cars;
  const entries = race.entries;
  // entryByCar indexes the same objects
  for (const e of entries) if (race.entryByCar[e.carId] !== e) check('entryByCar aliases entries', false, `car ${e.carId}`);
  // positions are 1..n in array order
  for (let i = 0; i < entries.length; i++) if (entries[i].position !== i + 1) check('positions match array order', false);
  // race: racing cars ordered by progress (allow hysteresis window)
  if (s.scenario === 'race') {
    for (let i = 0; i < entries.length - 1; i++) {
      const a = entries[i];
      const b = entries[i + 1];
      if (a.status === 'racing' && b.status === 'racing') {
        const dp = cars[a.carId].track.progress - cars[b.carId].track.progress;
        // classification runs every 4 steps with a 3 m hysteresis window, so allow a little drift between passes
        if (dp < -6) check('racing order follows progress', false, `${code(a.carId)} vs ${code(b.carId)} dp=${dp.toFixed(1)}`);
        if (race.phase === 'racing' && isFinite(a.gapToLeader) && isFinite(b.gapToLeader) && b.lapsBehind === a.lapsBehind && b.gapToLeader < a.gapToLeader - 0.15) {
          s.gapViolations++;
          if (s.gapViolations <= 5) {
            const ca = cars[a.carId];
            const cb = cars[b.carId];
            log(`GAP ORDER: P${a.position} ${code(a.carId)} gap ${a.gapToLeader.toFixed(3)} prog ${ca.track.progress.toFixed(1)} v ${ca.speedAbs.toFixed(1)} ${a.pitPhase} | P${b.position} ${code(b.carId)} gap ${b.gapToLeader.toFixed(3)} prog ${cb.track.progress.toFixed(1)} v ${cb.speedAbs.toFixed(1)} ${b.pitPhase} | leader ${code(entries[0].carId)} prog ${cars[entries[0].carId].track.progress.toFixed(1)} v ${cars[entries[0].carId].speedAbs.toFixed(1)} ${entries[0].pitPhase}`, 'k-warning');
          }
        }
        if (race.phase === 'racing' && b.interval < -1e-6) s.gapViolations++;
      }
    }
    // flicker: a pair swapping back within 1 s
    if (prevOrder.length === entries.length) {
      for (let i = 0; i < entries.length - 1; i++) {
        const a = entries[i].carId;
        const b = entries[i + 1].carId;
        const pi = prevOrder.indexOf(a);
        const pj = prevOrder.indexOf(b);
        if (pi > pj && entries[i].status === 'racing' && entries[i + 1].status === 'racing' && !cars[a].track.inPitLane && !cars[b].track.inPitLane) {
          const key = Math.min(a, b) * 64 + Math.max(a, b);
          const last = s.swapAt.get(key);
          if (last !== undefined && s.simTime - last < 1) s.flicker++;
          s.swapAt.set(key, s.simTime);
        }
      }
    }
    prevOrder.length = 0;
    for (const e of entries) prevOrder.push(e.carId);
  }
  // DRS never available in the pit lane or while disabled
  for (const e of entries) {
    if (e.drsAvailable && (!race.drsEnabled || cars[e.carId].track.inPitLane)) s.drsViolations++;
  }
  // pit phase transitions log
  for (const e of entries) {
    const arr = s.pitPhaseLog.get(e.carId) ?? [];
    if (arr[arr.length - 1] !== e.pitPhase) {
      arr.push(e.pitPhase);
      s.pitPhaseLog.set(e.carId, arr);
    }
  }
};

const finalChecks = (s: Session): void => {
  const race = s.world.race;
  const res = race.results!;
  check('results present at complete', !!res && race.phase === 'complete');
  if (!res) return;
  check('classification length', res.classification.length === race.entries.length);
  check('player position set', res.playerPosition >= 1);
  check('no gap ordering violations', s.gapViolations === 0, `${s.gapViolations}`);
  check('no position flicker', s.flicker === 0, `${s.flicker} swap-backs`);
  check('no DRS rule violations', s.drsViolations === 0, `${s.drsViolations}`);
  check('sector sum ≈ lap time', s.sectorMismatch === 0, `${s.sectorMismatch} mismatches`);
  check('purple only when session best', s.purpleViolations === 0, `${s.purpleViolations}`);
  check('update() cheap', s.updateNs / Math.max(1, s.updateCount) < 300_000, `${(s.updateNs / Math.max(1, s.updateCount) / 1000).toFixed(1)} µs avg over ${s.updateCount} calls`);
  if (s.scenario === 'race') {
    const rows = res.classification;
    const finished = rows.filter((r) => r.status === 'finished');
    check('leader completes totalLaps', rows[0].laps === race.totalLaps, `laps=${rows[0].laps}`);
    check('finishers sorted by laps then time', finished.every((r, i) => i === 0 || finished[i - 1].laps > r.laps || (finished[i - 1].laps === r.laps && finished[i - 1].time <= r.time)));
    check('points per table', rows.every((r) => (r.status === 'finished' && r.position <= 10 ? r.points >= POINTS_TABLE[r.position - 1] : r.points === 0)));
    const flRow = rows.find((r) => r.fastestLap);
    check('fastest lap point', !!flRow && (flRow.position <= 10 && flRow.status === 'finished' ? flRow.points === POINTS_TABLE[flRow.position - 1] + 1 : true), flRow ? `${code(flRow.carId)} P${flRow.position} pts=${flRow.points}` : 'no FL');
    check('positionChange = grid − pos', rows.every((r) => r.positionChange === race.entryByCar[r.carId].gridPosition - r.position));
    check('retired car classified last', rows.filter((r) => r.status === 'retired').every((r) => r.position > finished.length));
    check('DRS grants happened', s.drsGrants > 0, `${s.drsGrants}`);
    check('penalties added to time', rows.filter((r) => r.penaltySeconds > 0).length >= 2, `${rows.filter((r) => r.penaltySeconds > 0).map((r) => `${code(r.carId)}+${r.penaltySeconds}`).join(' ')}`);
    const e5 = race.entryByCar[5];
    check('pit speeding penalty (car 5)', e5.penalties.some((p) => p.reason.includes('Speeding')), e5.penalties.map((p) => p.reason).join(', '));
    const e7 = race.entryByCar[7];
    check('track limits: 3 warnings → penalty (car 7)', e7.penalties.filter((p) => p.type === 'warning' && p.reason === 'Track limits').length >= 3 && e7.penalties.some((p) => p.type === 'time' && p.reason.startsWith('Track limits')), `${e7.penalties.map((p) => p.type[0] + ':' + p.reason).join(', ')}`);
    const collisionPens = [8, 9].flatMap((id) => race.entryByCar[id].penalties.filter((p) => p.reason === 'Causing a collision'));
    check('collision: warning then penalty', collisionPens.some((p) => p.type === 'warning') && collisionPens.some((p) => p.type === 'time'), collisionPens.map((p) => p.type).join(','));
    check('engine failure → retired', race.entryByCar[12].status === 'retired' && s.service.retired.has(12), race.entryByCar[12].retireReason);
    const seq3 = s.pitPhaseLog.get(3) ?? [];
    check('pit protocol sequence (car 3)', seq3.join('>') === 'none>requested>entering>in-lane>stopped>released>exiting>none', seq3.join('>'));
    check('serviceCar called for car 3 with repair', s.service.serviceCalls.some((c) => c.carId === 3 && c.repair && !!c.compound), s.service.serviceCalls.map((c) => `${c.carId}:${c.compound}`).join(' '));
    check('player pit stop done (car 0)', race.entryByCar[0].pitStops === 1 && race.entryByCar[0].tyreCompound === 'soft');
    check('tyre age reset after stop', race.entryByCar[3].tyreAge < race.entryByCar[1].tyreAge);
    const dl = s.lightsTimes;
    const intervals = dl.slice(1, 5).map((t, i) => t - dl[i]);
    check('lights 1..5 at 1.0 s intervals', intervals.length === 4 && intervals.every((v) => Math.abs(v - 1) < 0.03), intervals.map((v) => v.toFixed(3)).join(' '));
    const hold = dl.length >= 6 ? dl[5] - dl[4] : -1;
    check('lights hold 0.6..2.6 s', hold >= 0.59 && hold <= 2.62, hold.toFixed(3));
    check('racing 3 s after green', s.racingAt > 0 && Math.abs(s.racingAt - s.greenAt - 3) < 0.03, `${(s.racingAt - s.greenAt).toFixed(3)}`);
    check('VSC happened after retirement', s.world.race.messages.some((m) => m.text.includes('VIRTUAL SAFETY CAR DEPLOYED')) || logLines.some((l) => l.includes('vsc')), '');
  } else if (s.scenario === 'quali') {
    const rows = res.classification;
    const timed = rows.filter((r) => r.time > 0);
    const untimed = rows.filter((r) => r.time <= 0);
    check('quali ordered by best lap', timed.every((r, i) => i === 0 || timed[i - 1].time <= r.time));
    check('no-time cars at the back in grid order', untimed.every((r) => r.position > timed.length) && untimed.every((r, i) => i === 0 || race.entryByCar[untimed[i - 1].carId].gridPosition < race.entryByCar[r.carId].gridPosition), untimed.map((r) => code(r.carId)).join(' '));
    check('invalid-lap car has no time (car 4)', race.entryByCar[4].bestLap === 0, `${race.entryByCar[4].lapTimes.length} laps driven`);
    check('pit-touching car has no time (car 6)', race.entryByCar[6].bestLap === 0, `${race.entryByCar[6].lapTimes.length} laps driven`);
    check('gridDriverIds = classification order', res.gridDriverIds.join() === rows.map((r) => r.driverId).join());
    check('session ended on clock', race.timeRemaining === 0 && s.finishedAt > 0);
    check('harness lap times match', s.lapMismatch === 0, `${s.lapMismatch}/${s.lapsChecked}`);
    check('flying laps completed after flag', race.time - (s.finishedAt - (s.simTime - race.time)) < 100.5, `${(race.time - (s.finishedAt - (s.simTime - race.time))).toFixed(1)} s after flag`);
  } else {
    check('endSession completes immediately', s.endSessionCalled && race.phase === 'complete');
    check('time trial has timeRemaining -1', race.timeRemaining === -1);
    check('harness lap times match', s.lapMismatch === 0, `${s.lapMismatch}/${s.lapsChecked}`);
  }
  renderChecks();
  log(`DONE. avg update ${(s.updateNs / Math.max(1, s.updateCount) / 1000).toFixed(1)} µs, service calls: ${s.service.calls.length}, drsSets ${s.service.drsSets}`);
};

/* ────────────────────────────── loop ────────────────────────────── */

const stepSim = (s: Session, dt: number): void => {
  s.simTime += dt;
  s.world.time += dt;
  for (const m of s.movers) stepMover(s, m, dt);
  runScripts(s);
  const t0 = performance.now();
  s.director.update(s.world, dt);
  s.updateNs += (performance.now() - t0) * 1e6;
  s.updateCount++;
  auditClassification(s);

  const race = s.world.race;
  if (s.scenario === 'race' && race.phase === 'idle' && s.simTime > 1) {
    s.director.startProcedure();
    log('startProcedure() called');
  }
  if (s.scenario === 'tt' && !s.endSessionCalled && race.time > 200) {
    s.endSessionCalled = true;
    log('endSession() called');
    s.director.endSession();
  }
  if (race.phase === 'complete' && race.results && !s.done) {
    s.done = true;
    finalChecks(s);
  }
};

const render = (s: Session): void => {
  const race = s.world.race;
  const w = s.world.env.weather;
  statusEl.textContent =
    `phase ${race.phase.padEnd(10)} time ${race.time.toFixed(1).padStart(7)}  remaining ${race.timeRemaining.toFixed(0)}  lap ${race.leaderLap}/${race.totalLaps}  lights ${race.lightsOn}  ` +
    `DRS ${race.drsEnabled ? 'ON ' : 'off'}  flags ${race.sectorFlags.join('/')} global ${race.globalFlag}  SC ${race.safetyCarSpeed}\n` +
    `tod ${s.world.env.timeOfDay.toFixed(2)}  rain ${w.rain.toFixed(2)} wet ${w.wetness.toFixed(2)} cloud ${w.cloud.toFixed(2)} track ${w.trackTempC.toFixed(1)}°C  ` +
    `fastest ${race.fastestLap ? `${code(race.fastestLap.carId)} ${formatLapTime(race.fastestLap.time)}` : '--'}  sim ${s.simTime.toFixed(0)} s  ×${s.timeScale}  update ${(s.updateNs / Math.max(1, s.updateCount) / 1000).toFixed(1)} µs`;

  const cls = (st: string) => `s-${st}`;
  const rows = race.entries
    .map((e) => {
      const car = s.world.cars[e.carId];
      const statusCls = e.status === 'retired' ? 'ret' : e.status === 'finished' ? 'fin' : '';
      return `<tr class="${statusCls}"><td class="pos">${e.position}</td><td>${code(e.carId)}</td><td>${e.lap}/${e.lapsCompleted}</td>` +
        `<td>${e.position === 1 ? (e.status === 'finished' ? 'WINNER' : 'LEADER') : formatGap(e.gapToLeader, e.lapsBehind)}</td><td>${e.position === 1 ? '' : formatGap(e.interval)}</td>` +
        `<td>${formatLapTime(e.currentLapTime)}</td><td>${formatLapTime(e.lastLap)}</td><td>${formatLapTime(e.bestLap)}</td>` +
        `<td class="${cls(e.currentSectorStatus[0])}">${e.currentSectors[0] ? e.currentSectors[0].toFixed(3) : '-'}</td>` +
        `<td class="${cls(e.currentSectorStatus[1])}">${e.currentSectors[1] ? e.currentSectors[1].toFixed(3) : '-'}</td>` +
        `<td class="${cls(e.currentSectorStatus[2])}">${e.currentSectors[2] ? e.currentSectors[2].toFixed(3) : '-'}</td>` +
        `<td style="color:${TYRE_DATA[e.tyreCompound].color}">${TYRE_DATA[e.tyreCompound].short}${e.tyreAge}</td>` +
        `<td class="drs">${e.drsAvailable ? (e.drsOpen ? 'DRS◆' : 'DRS') : ''}${e.blueFlag ? ' BLUE' : ''}</td>` +
        `<td class="pit">${e.pitPhase !== 'none' ? e.pitPhase + (e.pitPhase === 'stopped' ? ` ${e.pitStopTimer.toFixed(1)}` : '') : ''} ${e.pitStops ? `(${e.pitStops})` : ''}</td>` +
        `<td class="pen">${e.penaltySeconds ? `+${e.penaltySeconds}s` : ''}${e.warnings ? ` W${e.warnings}` : ''}</td>` +
        `<td>${(car.speedAbs * 3.6).toFixed(0)}</td><td>${e.status}${e.retireReason ? ` (${e.retireReason})` : ''}</td></tr>`;
    })
    .join('');
  towerEl.innerHTML =
    `<tr><th>P</th><th>DRV</th><th>LAP</th><th>GAP</th><th>INT</th><th>CUR</th><th>LAST</th><th>BEST</th><th>S1</th><th>S2</th><th>S3</th><th>TYRE</th><th>DRS</th><th>PIT</th><th>PEN</th><th>KM/H</th><th>STATUS</th></tr>` + rows;
  logEl.innerHTML = logLines.slice(-60).join('');
  logEl.scrollTop = logEl.scrollHeight;
  renderChecks();
};

let lastFrame = performance.now();
const frame = (now: number): void => {
  requestAnimationFrame(frame);
  const dtWall = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const s = session;
  if (!s) return;
  if (!s.done || s.simTime - s.finishedAt < 30) {
    const steps = Math.min(400, Math.round((dtWall * s.timeScale) / PHYSICS_DT));
    for (let i = 0; i < steps; i++) stepSim(s, PHYSICS_DT);
  }
  if (now - s.lastRender > 250) {
    s.lastRender = now;
    render(s);
  }
};

const start = (scenario: Scenario): void => {
  document.querySelectorAll<HTMLButtonElement>('header button').forEach((b) => b.classList.toggle('active', b.dataset.scenario === scenario));
  location.hash = scenario;
  session = createSession(scenario);
  render(session);
};

const printTower = (s: Session): void => {
  const race = s.world.race;
  console.log(`\n${'P'.padStart(2)} ${'DRV'.padEnd(4)} ${'LAPS'.padEnd(5)} ${'GAP'.padStart(9)} ${'INT'.padStart(8)} ${'LAST'.padStart(9)} ${'BEST'.padStart(9)} TYRE  PIT  PEN   STATUS`);
  for (const e of race.entries) {
    console.log(
      `${String(e.position).padStart(2)} ${code(e.carId).padEnd(4)} ${String(e.lapsCompleted).padEnd(5)} ${(e.position === 1 ? '' : formatGap(e.gapToLeader, e.lapsBehind)).padStart(9)} ${(e.position === 1 ? '' : formatGap(e.interval)).padStart(8)} ${formatLapTime(e.lastLap).padStart(9)} ${formatLapTime(e.bestLap).padStart(9)} ${(TYRE_DATA[e.tyreCompound].short + e.tyreAge).padEnd(5)} ${String(e.pitStops).padEnd(4)} ${(e.penaltySeconds ? `+${e.penaltySeconds}` : '').padEnd(5)} ${e.status}${e.retireReason ? ` (${e.retireReason})` : ''}`,
    );
  }
  if (race.results) {
    console.log('RESULTS: ' + race.results.classification.map((r) => `P${r.position} ${code(r.carId)} ${r.status[0]} L${r.laps} t=${r.time.toFixed(1)} +${r.penaltySeconds} pts${r.points}${r.fastestLap ? '*' : ''} Δ${r.positionChange}`).join(' | '));
    console.log('GRID: ' + race.results.gridDriverIds.join(','));
  }
};

if (hasDom) {
  document.querySelectorAll<HTMLButtonElement>('header button').forEach((b) => b.addEventListener('click', () => start(b.dataset.scenario as Scenario)));
  const initial = (location.hash.slice(1) as Scenario) || 'race';
  start(['race', 'quali', 'tt'].includes(initial) ? initial : 'race');
  requestAnimationFrame(frame);
  (window as unknown as { harness: () => Session | null }).harness = () => session;
} else {
  const wanted = nodeArgs.slice(2).filter((a): a is Scenario => a === 'race' || a === 'quali' || a === 'tt');
  const scenarios: Scenario[] = wanted.length ? wanted : ['race', 'quali', 'tt'];
  let failures = 0;
  for (const sc of scenarios) {
    console.log(`\n================ SCENARIO ${sc} ================`);
    const s = createSession(sc);
    session = s;
    const limit = 2400;
    while (!s.done && s.simTime < limit) stepSim(s, PHYSICS_DT);
    if (!s.done) check('scenario completed within sim limit', false, `sim ${s.simTime.toFixed(0)} s phase ${s.world.race.phase}`);
    printTower(s);
    console.log('\nCHECKS:');
    for (const [name, c] of checks) {
      console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${name}${c.detail ? ` — ${c.detail}` : ''}`);
      if (!c.ok) failures++;
    }
    s.handlers.forEach((off) => off());
    s.director.dispose();
  }
  console.log(`\nTOTAL FAILURES: ${failures}`);
}
