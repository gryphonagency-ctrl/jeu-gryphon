/**
 * UI harness: mounts the UISystem over a fake scene with a simulated 20-car race so every screen can be polished
 * without the rest of the game. Open http://localhost:5200/src/ui/dev.html
 */
import { CAR, TYRE_COMPOUNDS, type TyreCompound } from '../core/constants';
import { KINGSMERE } from '../core/circuits';
import { events } from '../core/events';
import { Rng, wrap } from '../core/math';
import { DRIVERS, DRIVER_BY_ID, TEAMS, TEAM_BY_ID } from '../core/teams';
import { TrackSpline } from '../core/track/TrackSpline';
import type { AppPhase, RaceControlMessage, RaceEntry, RaceState, RenderStats, ResultRow, SessionConfig, SessionResults, TrackDefinition, UICommand, World } from '../core/types';
import { createEmptyCarState, createEnvironment } from '../core/world';
import * as THREE from 'three';
import { UISystem } from './UISystem';

const UP = new THREE.Vector3(0, 1, 0);

/* ───────────────────────────── a second circuit so circuit select has variety ───────────────────────────── */

const scaleCircuit = (base: TrackDefinition, id: string, name: string, gp: string, location: string, country: string, theme: TrackDefinition['environment']['theme'], tod: number, weather: TrackDefinition['environment']['weather'], rot: number, sx: number, sz: number): TrackDefinition => {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return {
    ...base,
    id,
    name,
    grandPrixName: gp,
    location,
    country,
    controlPoints: base.controlPoints.map((p) => ({ ...p, x: (p.x * c - p.z * s) * sx, z: (p.x * s + p.z * c) * sz })),
    environment: { theme, timeOfDay: tod, weather, vibe: `${theme} · harness variant` },
    description: `${name} — a harness variant of Kingsmere for testing circuit select (${theme}).`,
    defaultLaps: 6 + Math.round(sx * 4),
  };
};

const CIRCUITS: TrackDefinition[] = [
  KINGSMERE,
  scaleCircuit(KINGSMERE, 'marina-bay-h', 'Porto Lumen Street Circuit', 'Porto Lumen Grand Prix', 'Porto Lumen Harbour', 'PT', 'street', 21.5, 'dry', 0.8, 0.85, 1.1),
  scaleCircuit(KINGSMERE, 'dune-h', 'Al Sahra International', 'Al Sahra Grand Prix', 'Al Sahra', 'AE', 'desert', 18.5, 'dry', 2.1, 1.15, 0.9),
  scaleCircuit(KINGSMERE, 'forest-h', 'Schwarzwaldring', 'Schwarzwald Grand Prix', 'Baden', 'DE', 'forest', 14, 'light-rain', -1.2, 1.0, 1.05),
];

/* ───────────────────────────── fake world ───────────────────────────── */

const rng = new Rng(1234);
const track = new TrackSpline(KINGSMERE);
const LEN = track.length;

interface Sim {
  progress: number;
  speed: number;
  pace: number;
  lateral: number;
  sectorStart: number;
  lapStart: number;
  pitTimer: number;
  lastSector: number;
}

const config: SessionConfig = {
  mode: 'quick-race',
  sessionType: 'race',
  circuitId: 'kingsmere',
  laps: 10,
  playerDriverId: DRIVERS[0].id,
  aiDifficulty: 0.7,
  aiCount: 19,
  weather: 'dry',
  timeOfDay: -1,
  assists: { tractionControl: 'medium', abs: true, autoGears: true, steeringAssist: true, brakingAssist: false, racingLine: 'corners', pitAssist: true, ersAssist: true, drsAssist: true },
  startingCompound: 'medium',
  gridOrder: 'performance',
  randomEvents: true,
};

const cars = DRIVERS.map((d, i) => {
  const c = createEmptyCarState(i, d.id, d.teamId, i === 0, (['soft', 'medium', 'hard'] as TyreCompound[])[i % 3]);
  c.gridPosition = i + 1;
  return c;
});

const entries: RaceEntry[] = cars.map((c) => ({
  carId: c.id,
  driverId: c.driverId,
  teamId: c.teamId,
  position: c.id + 1,
  gridPosition: c.gridPosition,
  lap: 0,
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
  tyreCompound: c.tyres.compound,
  tyreAge: 0,
  penaltySeconds: 0,
  warnings: 0,
  penalties: [],
  drsAvailable: false,
  drsOpen: false,
  drsDetectionGap: Infinity,
  finishTime: 0,
  blueFlag: false,
  deltaAhead: Infinity,
  deltaBehind: Infinity,
  retireReason: '',
}));

const race: RaceState = {
  sessionType: 'race',
  phase: 'idle',
  time: 0,
  timeRemaining: -1,
  lightsOn: 0,
  totalLaps: 10,
  leaderLap: 0,
  entries: [...entries],
  entryByCar: entries,
  sectorFlags: ['green', 'green', 'green'],
  globalFlag: 'green',
  drsEnabled: false,
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
  cars,
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

const sims: Sim[] = cars.map((c, i) => {
  const team = TEAM_BY_ID[c.teamId];
  const d = DRIVER_BY_ID[c.driverId];
  return {
    progress: -(10 + 8 * i),
    speed: 0,
    pace: 0.86 + (team.performance.power + team.performance.aero) * 0.06 + d.skill.pace * 0.03 + rng.range(-0.01, 0.01),
    lateral: (i % 2 === 0 ? 1 : -1) * 3.2,
    sectorStart: 0,
    lapStart: 0,
    pitTimer: 0,
    lastSector: 2,
  };
});
// Place on grid.
cars.forEach((c, i) => {
  const slot = track.gridSlot(i);
  c.position.copy(slot.position);
  c.quaternion.copy(slot.quaternion);
  c.track.s = slot.s;
  c.chassis.held = true;
});

const bestSectorOverall: [number, number, number] = [0, 0, 0];
let running = false;
let simTime = 0;

const msgs = [
  { text: 'Track limits at turn 9 are being monitored', kind: 'info' as const },
  { text: 'DRS enabled', kind: 'drs' as const },
  { text: 'Car 22 — 5 second time penalty — causing a collision', kind: 'penalty' as const },
  { text: 'Yellow flag sector 2 — debris on track', kind: 'flag' as const },
  { text: 'Incident involving cars 20 and 31 noted', kind: 'warning' as const },
  { text: 'Light rain expected in 6 minutes', kind: 'info' as const },
  { text: 'Car 44 pit stop 2.3 s', kind: 'pit' as const },
];
const radios = ['Box box, box box. We are going to the hard tyre.', 'Gap to Hartwell is 1.2 and closing. You have DRS next lap.', 'Careful on the kerbs at the chicane, we are seeing floor damage.', 'That is P3. Keep it clean, bring it home.', 'Overtake mode available, use it on the back straight.'];

const speedAt = (s: number, pace: number): number => {
  let vmin = 92;
  for (let d = 0; d < 110; d += 10) {
    const k = Math.abs(track.sampleAt(s + d).curvature);
    const v = k < 1e-4 ? 92 : Math.min(92, Math.sqrt((4.2 * 9.81) / k));
    vmin = Math.min(vmin, v + d * 0.32);
  }
  return Math.max(18, vmin) * pace;
};

function stepSim(dt: number): void {
  if (!running) return;
  simTime += dt;
  world.time = simTime;
  race.time = simTime;
  if (race.phase === 'green' && simTime > greenAt + 3) race.phase = 'racing';
  const moving = race.phase === 'green' || race.phase === 'racing' || race.phase === 'finished';
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    const sim = sims[i];
    const e = entries[i];
    if (e.status !== 'racing') continue;
    car.chassis.held = !moving || e.pitPhase === 'stopped';
    const target = car.chassis.held ? 0 : e.pitPhase === 'in-lane' || e.pitPhase === 'stopped' || e.pitPhase === 'released' ? CAR.pitSpeedLimit : speedAt(wrap(sim.progress, LEN), sim.pace) * (e.tyreAge > 12 ? 0.97 : 1);
    sim.speed += (target - sim.speed) * Math.min(1, dt * (target > sim.speed ? 0.9 : 2.2));
    if (car.chassis.held) sim.speed = 0;
    sim.progress += sim.speed * dt;
    const s = wrap(sim.progress, LEN);
    const lap = Math.floor(sim.progress / LEN);
    car.track.s = s;
    car.track.progress = sim.progress;
    car.track.lap = Math.max(0, lap);
    car.speed = sim.speed;
    car.speedAbs = sim.speed;
    const sector = track.sectorOf(s);
    car.track.sector = sector;
    const sm = track.sampleAt(s);
    const curv = sm.curvature;
    const lat = e.pitPhase === 'in-lane' || e.pitPhase === 'stopped' || e.pitPhase === 'released' ? track.pitLane.offset : sim.lateral * 0.3 - Math.sign(curv) * Math.min(4, Math.abs(curv) * 400);
    track.trackToWorld(s, lat, car.position);
    car.quaternion.setFromAxisAngle(UP, sm.heading);
    car.engine.steer = Math.max(-1, Math.min(1, curv * 40));
    car.input.steer = car.engine.steer;
    const accel = (target - sim.speed) * 0.1;
    car.engine.throttle = Math.max(0, Math.min(1, 0.35 + accel * 2));
    car.engine.brake = Math.max(0, Math.min(1, -accel * 3));
    car.engine.gear = sim.speed < 1 ? 0 : Math.min(8, 1 + Math.floor(sim.speed / 11));
    const gearBase = (car.engine.gear - 1) * 11;
    car.engine.rpm = sim.speed < 1 ? CAR.idleRpm : 6500 + ((sim.speed - gearBase) / 11) * 8500;
    car.engine.limiter = car.engine.rpm > 14700;
    car.localAccel.x = -curv * sim.speed * sim.speed;
    car.ers.battery = Math.max(0, Math.min(1, car.ers.battery + (car.engine.brake > 0.3 ? 0.05 : car.engine.throttle > 0.8 ? -0.02 : 0) * dt));
    car.ers.deploying = car.engine.throttle > 0.8 && car.ers.battery > 0.05;
    car.ers.harvesting = car.engine.brake > 0.3;
    car.fuel = Math.max(0, 110 - simTime * 0.05 - lap * 1.6);
    for (const w of car.wheels) {
      w.temp += ((Math.abs(curv) > 0.01 ? 108 : 92) - w.temp) * dt * 0.3;
      w.wear = Math.min(1, e.tyreAge * 0.045 + (s / LEN) * 0.045);
    }
    car.tyres.wear = car.wheels[0].wear;
    car.tyres.age = e.tyreAge;
    // DRS
    const zone = track.drsZoneAt(s);
    e.drsAvailable = race.drsEnabled && !!zone && e.interval < 1 && e.position > 1;
    e.drsOpen = e.drsAvailable && car.engine.throttle > 0.7;
    car.drs.available = e.drsAvailable;
    car.drs.open = e.drsOpen;
    // Sector / lap timing
    e.currentLapTime = moving ? simTime - sim.lapStart : 0;
    e.lap = lap + 1;
    if (sector !== sim.lastSector && moving) {
      const finished = sim.lastSector;
      if (lap >= 1 || sector !== 0) {
        const t = simTime - sim.sectorStart;
        if (finished !== 2 || lap >= 1) {
          if (t > 5) {
            e.currentSectors[finished] = t;
            const pb = e.bestSectors[finished];
            const ob = bestSectorOverall[finished];
            let st: RaceEntry['currentSectorStatus'][number] = 'yellow';
            if (ob === 0 || t < ob) {
              st = 'purple';
              bestSectorOverall[finished] = t;
            } else if (pb === 0 || t < pb) st = 'green';
            if (pb === 0 || t < pb) e.bestSectors[finished] = t;
            e.currentSectorStatus[finished] = st;
            if (i === 0) events.emit('race:sector', { carId: 0, sector: finished as 0 | 1 | 2, time: t, status: st });
          }
        }
      }
      sim.sectorStart = simTime;
      if (sector === 0 && sim.lastSector === 2) {
        // Lap complete
        if (lap >= 1 && sim.lapStart > 0) {
          const lt = simTime - sim.lapStart;
          e.lastLap = lt;
          e.lapTimes.push(lt);
          const pb = e.bestLap === 0 || lt < e.bestLap;
          if (pb) e.bestLap = lt;
          const fo = !race.fastestLap || lt < race.fastestLap.time;
          if (fo) {
            race.fastestLap = { carId: i, time: lt, lap };
            if (lap > 1) events.emit('race:fastest-lap', { carId: i, time: lt });
          }
          events.emit('race:lap', { carId: i, lap, time: lt, personalBest: pb, fastestOverall: fo, position: e.position });
          e.tyreAge++;
          e.lapsCompleted = lap;
          if (i === 0 && lap === race.totalLaps) {
            e.status = 'finished';
            race.globalFlag = 'chequered';
            race.phase = 'finished';
            events.emit('race:finish', { carId: 0, position: e.position });
          }
        }
        sim.lapStart = simTime;
        e.currentSectors = [0, 0, 0];
        e.currentSectorStatus = ['none', 'none', 'none'];
        if (lap >= 1 && rng.next() < 0.08 && e.pitPhase === 'none' && i !== 0 && lap < race.totalLaps - 1) {
          e.pitPhase = 'requested';
          e.requestedCompound = rng.pick(['soft', 'medium', 'hard'] as TyreCompound[]);
        }
      }
      sim.lastSector = sector;
    }
    // Pit phases
    if (e.pitPhase === 'requested' && track.pitD(s) >= 0 && track.pitD(s) < 5) e.pitPhase = 'entering';
    if (e.pitPhase === 'entering' && track.pitD(s) > 40) {
      e.pitPhase = 'in-lane';
      car.track.inPitLane = true;
      events.emit('race:pit-entry', { carId: i });
    }
    if (e.pitPhase === 'in-lane' && Math.abs(track.deltaS(s, track.pitBox(TEAM_BY_ID[car.teamId].pitBoxIndex).s)) < 2) {
      e.pitPhase = 'stopped';
      e.pitStopTimer = 2.3 + rng.range(0, 1.2);
      events.emit('race:pit-stop-start', { carId: i });
    }
    if (e.pitPhase === 'stopped') {
      e.pitStopTimer -= dt;
      if (e.pitStopTimer <= 0) {
        e.pitPhase = 'released';
        const comp = e.requestedCompound ?? 'medium';
        events.emit('race:pit-stop-end', { carId: i, duration: 2.6, compound: comp });
        e.tyreCompound = comp;
        car.tyres.compound = comp;
        e.tyreAge = 0;
        e.pitStops++;
        e.requestedCompound = null;
      }
    }
    if (e.pitPhase === 'released' && sim.speed > 5) e.pitPhase = 'exiting';
    if (e.pitPhase === 'exiting' && track.pitD(s) < 0) {
      e.pitPhase = 'none';
      car.track.inPitLane = false;
      events.emit('race:pit-exit', { carId: i });
    }
    car.input.pitLimiter = e.pitPhase === 'in-lane' || e.pitPhase === 'stopped' || e.pitPhase === 'released';
  }
  // Positions & gaps
  const sorted = [...entries].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'finished' ? -1 : b.status === 'finished' ? 1 : a.status === 'racing' ? -1 : 1;
    return sims[b.carId].progress - sims[a.carId].progress;
  });
  sorted.forEach((e, idx) => {
    const np = idx + 1;
    if (e.position !== np && moving && race.phase === 'racing') {
      events.emit('race:position-change', { carId: e.carId, from: e.position, to: np });
      if (np < e.position && e.carId === 0) {
        const overtaken = sorted[idx + 1];
        if (overtaken) events.emit('race:overtake', { carId: 0, overtakenCarId: overtaken.carId, position: np });
      } else if (np > e.position && e.carId === 0) {
        const passer = sorted[idx - 1];
        if (passer) events.emit('race:overtake', { carId: passer.carId, overtakenCarId: 0, position: np - 1 });
      }
    }
    e.position = np;
  });
  race.entries.length = 0;
  race.entries.push(...sorted);
  const leader = sorted[0];
  race.leaderLap = leader ? Math.floor(sims[leader.carId].progress / LEN) + 1 : 1;
  for (let idx = 0; idx < sorted.length; idx++) {
    const e = sorted[idx];
    const sp = Math.max(20, sims[e.carId].speed);
    e.gapToLeader = idx === 0 ? 0 : (sims[leader.carId].progress - sims[e.carId].progress) / sp;
    e.lapsBehind = Math.max(0, Math.floor((sims[leader.carId].progress - sims[e.carId].progress) / LEN));
    e.interval = idx === 0 ? 0 : (sims[sorted[idx - 1].carId].progress - sims[e.carId].progress) / sp;
    e.deltaAhead = e.interval;
    e.deltaBehind = idx + 1 < sorted.length ? (sims[e.carId].progress - sims[sorted[idx + 1].carId].progress) / sp : Infinity;
    e.blueFlag = e.lapsBehind > 0 && idx > 0 && e.deltaBehind < 2;
  }
  if (!race.drsEnabled && race.leaderLap >= 3 && race.phase === 'racing') {
    race.drsEnabled = true;
    events.emit('race:drs-enabled', { enabled: true });
    pushMessage('DRS enabled', 'drs');
  }
  // Ambient events
  msgTimer -= dt;
  if (msgTimer < 0) {
    msgTimer = 9 + rng.range(0, 8);
    const m = rng.pick(msgs);
    pushMessage(m.text, m.kind);
  }
  radioTimer -= dt;
  if (radioTimer < 0 && race.phase === 'racing') {
    radioTimer = 22 + rng.range(0, 10);
    events.emit('radio:message', { carId: 0, from: 'engineer', text: rng.pick(radios) });
  }
  flagTimer -= dt;
  if (flagTimer < 0 && race.phase === 'racing') {
    flagTimer = 40 + rng.range(0, 30);
    const sec = rng.int(0, 2);
    race.sectorFlags[sec] = 'yellow';
    events.emit('race:flag', { flag: 'yellow', sector: sec });
    pushMessage(`Yellow flag sector ${sec + 1}`, 'flag');
    window.setTimeout(() => {
      race.sectorFlags[sec] = 'green';
    }, 6000);
  }
  world.env.timeOfDay += dt / 1200;
}

let msgTimer = 4;
let radioTimer = 8;
let flagTimer = 30;
let greenAt = 0;

function pushMessage(text: string, kind: RaceControlMessage['kind']): void {
  const m = { time: simTime, text, kind };
  race.messages.push(m);
  events.emit('race:message', m);
}

function lightsSequence(): void {
  race.phase = 'formation';
  let n = 0;
  const tick = () => {
    if (race.phase !== 'formation' && race.phase !== 'lights') return;
    n++;
    if (n <= 5) {
      race.phase = 'lights';
      race.lightsOn = n;
      events.emit('race:lights', { lightsOn: n });
      window.setTimeout(tick, 1000);
    } else {
      window.setTimeout(() => {
        race.lightsOn = 0;
        race.phase = 'green';
        greenAt = simTime;
        events.emit('race:lights', { lightsOn: 0 });
        for (const s of sims) s.lapStart = simTime;
        pushMessage('Lights out and away we go', 'info');
      }, 600 + rng.range(0, 1800));
    }
  };
  window.setTimeout(tick, 1800);
}

function makeResults(): SessionResults {
  const rows: ResultRow[] = race.entries.map((e, i) => ({
    position: i + 1,
    carId: e.carId,
    driverId: e.driverId,
    teamId: e.teamId,
    status: i === 17 ? 'retired' : 'finished',
    laps: race.totalLaps,
    time: i === 0 ? 87.4 * race.totalLaps + 3.2 : 0,
    gap: i === 0 ? 0 : 1.8 * i + rng.range(0, 1.5),
    lapsBehind: i > 15 ? 1 : 0,
    bestLap: 86.2 + rng.range(0, 2.4),
    pitStops: 1 + (i % 3 === 0 ? 1 : 0),
    penaltySeconds: i === 5 ? 5 : 0,
    points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1][i] ?? 0,
    fastestLap: false,
    positionChange: e.gridPosition - (i + 1),
  }));
  let fl = rows[0];
  for (const r of rows) if (r.bestLap < fl.bestLap) fl = r;
  fl.fastestLap = true;
  if (fl.position <= 10) fl.points += 1;
  const player = rows.find((r) => r.carId === 0)!;
  return { sessionType: 'race', circuitId: 'kingsmere', classification: rows, fastestLap: { carId: fl.carId, driverId: fl.driverId, time: fl.bestLap }, playerCarId: 0, playerPosition: player.position, gridDriverIds: rows.map((r) => r.driverId) };
}

/* ───────────────────────────── mount ───────────────────────────── */

const root = document.getElementById('ui-root') as HTMLElement;
const ui = new UISystem(root);
ui.setData(TEAMS, DRIVERS, CIRCUITS);
let phase: AppPhase = 'title';
const logEl = document.getElementById('dev-log') as HTMLElement;
const log = (s: string) => {
  logEl.textContent = `${s}\n${logEl.textContent ?? ''}`.split('\n').slice(0, 8).join('\n');
};
events.on('ui:sound', ({ sound }) => log(`sound:${sound}`));

function setPhase(p: AppPhase): void {
  phase = p;
  ui.setPhase(p);
  running = p === 'session' || p === 'pre-session' || p === 'results';
  world.paused = p === 'paused';
  if (p === 'session' && race.phase === 'idle') {
    race.phase = 'racing';
    greenAt = simTime;
    for (const s of sims) s.lapStart = simTime;
  }
}

function fakeLoad(then: () => void): void {
  setPhase('loading');
  let p = 0;
  const labels = ['Laying asphalt', 'Painting kerbs', 'Planting trees', 'Filling grandstands', 'Building cars', 'Applying liveries', 'Ready'];
  const t = window.setInterval(() => {
    p += 0.035 + Math.random() * 0.03;
    ui.setLoading(Math.min(1, p), labels[Math.min(labels.length - 1, Math.floor(p * labels.length))]);
    if (p >= 1) {
      window.clearInterval(t);
      window.setTimeout(then, 500);
    }
  }, 120);
}

ui.onCommand((cmd: UICommand) => {
  log(`cmd:${cmd.type}${'config' in cmd ? ` ${cmd.config.mode}/${cmd.config.sessionType} ${cmd.config.circuitId} ${cmd.config.laps}L` : ''}${'driverId' in cmd ? ` ${cmd.driverId}` : ''}${'compound' in cmd ? ` ${cmd.compound}` : ''}${'mode' in cmd ? ` ${cmd.mode}` : ''}${'time' in cmd ? ` ${cmd.time.toFixed(1)}` : ''}${'speed' in cmd ? ` ${cmd.speed}` : ''}`);
  switch (cmd.type) {
    case 'start-session':
      race.totalLaps = cmd.config.laps;
      fakeLoad(() => setPhase(cmd.config.sessionType === 'race' ? 'pre-session' : 'session'));
      break;
    case 'ready':
      setPhase('session');
      lightsSequence();
      break;
    case 'resume':
      setPhase('session');
      break;
    case 'pause':
      setPhase('paused');
      break;
    case 'quit-to-menu':
      setPhase('menu');
      break;
    case 'restart-session':
    case 'next-session':
      fakeLoad(() => setPhase('pre-session'));
      break;
    case 'replay-start':
      setPhase('replay');
      break;
    case 'replay-stop':
      setPhase('paused');
      break;
    case 'skip-to-end':
      setPhase('results');
      ui.showResults(makeResults(), world, null);
      break;
    case 'request-pit':
      entries[0].pitPhase = 'requested';
      entries[0].requestedCompound = cmd.compound;
      break;
    case 'cancel-pit':
      entries[0].pitPhase = 'none';
      entries[0].requestedCompound = null;
      break;
    case 'set-ers-mode':
      cars[0].ers.mode = cmd.mode;
      break;
    default:
      break;
  }
});

// Emulate main's keyboard behaviour for the keys it owns.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (phase === 'session') setPhase('paused');
    else if (phase === 'paused') setPhase('session');
    else if (phase === 'replay') setPhase('paused');
    else ui.handleCommand({ type: 'pause' });
  } else if (e.key === 'Tab') {
    e.preventDefault();
    ui.handleCommand({ type: 'mfd-toggle' });
  } else if (e.key === 'p' || e.key === 'P') ui.handleCommand({ type: 'request-pit' });
  else if (e.key === ',') ui.handleCommand({ type: 'mfd-prev' });
  else if (e.key === '.') ui.handleCommand({ type: 'mfd-next' });
  else if (e.key === 'g' || e.key === 'G') {
    gamepad = !gamepad;
    ui.setGamepadConnected(gamepad);
  } else if (e.key === 'h' || e.key === 'H') {
    hud = !hud;
    ui.setHudVisible(hud);
  } else if (e.key === 'm' || e.key === 'M') ui.handleCommand({ type: 'toggle-mute' });
  else if (e.key === 't' || e.key === 'T') ui.handleCommand({ type: 'radio' });
  else if (e.key === 'i' || e.key === 'I') {
    if (phase === 'session' || phase === 'paused') setPhase('replay');
  }
});
let gamepad = false;
let hud = true;

const bar = document.getElementById('dev-bar') as HTMLElement;
const btn = (label: string, fn: () => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', fn);
  bar.appendChild(b);
};
const sep = () => {
  const s = document.createElement('span');
  s.className = 'sep';
  bar.appendChild(s);
};
for (const p of ['title', 'menu', 'loading', 'pre-session', 'session', 'paused', 'replay'] as AppPhase[]) {
  btn(p, () => {
    if (p === 'loading') fakeLoad(() => setPhase('pre-session'));
    else setPhase(p);
  });
}
btn('results', () => {
  setPhase('results');
  ui.showResults(makeResults(), world, null);
});
btn('results→race', () => {
  setPhase('results');
  ui.showResults({ ...makeResults(), sessionType: 'qualifying' }, world, 'race');
});
sep();
btn('lights', () => lightsSequence());
btn('msg', () => pushMessage(rng.pick(msgs).text, 'info'));
btn('radio', () => events.emit('radio:message', { carId: 0, from: 'engineer', text: rng.pick(radios) }));
btn('penalty', () => events.emit('race:penalty', { carId: 0, type: 'time', seconds: 5, reason: 'track limits' }));
btn('warn', () => events.emit('race:warning', { carId: 0, reason: 'track limits', count: 2 }));
btn('purple', () => events.emit('race:lap', { carId: 0, lap: 3, time: 86.412, personalBest: true, fastestOverall: true, position: 4 }));
btn('overtake', () => events.emit('race:overtake', { carId: 0, overtakenCarId: 3, position: 3 }));
btn('yellow', () => {
  race.sectorFlags[1] = race.sectorFlags[1] === 'yellow' ? 'green' : 'yellow';
});
btn('blue', () => (entries[0].blueFlag = !entries[0].blueFlag));
btn('red', () => (race.globalFlag = race.globalFlag === 'red' ? 'green' : 'red'));
btn('SC', () => (race.phase = race.phase === 'safety-car' ? 'racing' : 'safety-car'));
btn('rain', () => {
  world.env.weather.rain = world.env.weather.rain > 0 ? 0 : 0.6;
  world.env.weather.wetness = world.env.weather.rain;
  events.emit('race:weather', { weather: world.env.weather, description: world.env.weather.rain > 0 ? 'Rain is falling — track getting wet' : 'Rain has stopped' });
});
btn('damage', () => {
  cars[0].damage.frontWing = Math.min(1, cars[0].damage.frontWing + 0.35);
  cars[0].damage.floor = Math.min(1, cars[0].damage.floor + 0.2);
});
btn('finish', () => {
  entries[0].status = 'finished';
  race.globalFlag = 'chequered';
  events.emit('race:finish', { carId: 0, position: entries[0].position });
});
btn('notify', () => ui.notify('SETTINGS SAVED', 'info', 3));
btn('tele', () => {
  ui.getSettings().showTelemetry = !ui.getSettings().showTelemetry;
});
btn('compound+', () => {
  const i = TYRE_COMPOUNDS.indexOf(entries[0].tyreCompound);
  const c = TYRE_COMPOUNDS[(i + 1) % TYRE_COMPOUNDS.length];
  entries[0].tyreCompound = c;
  cars[0].tyres.compound = c;
});

const stats: RenderStats = { fps: 60, frameMs: 16.6, drawCalls: 412, triangles: 1_842_331, quality: 'high' };
let last = performance.now();
let fpsAcc = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsAcc += (1 / Math.max(1e-3, dt) - fpsAcc) * 0.05;
  stats.fps = fpsAcc;
  stats.frameMs = dt * 1000;
  if (!world.paused) stepSim(dt);
  world.realTime += dt;
  ui.update(world, dt, stats);
}
/* URL hash options for headless screenshots: #phase=session&warm=120&keys=Enter,ArrowDown&mfd=1&evt=penalty,radio&tele=1&gamepad=1 */
const q = new URLSearchParams(location.hash.slice(1));
const warm = Number(q.get('warm') ?? 0);
if (warm > 0) {
  running = true;
  race.phase = 'racing';
  for (const s of sims) s.lapStart = 0;
  for (let t = 0; t < warm; t += 1 / 60) stepSim(1 / 60);
}
setPhase('title');
const wantPhase = q.get('phase') as AppPhase | null;
if (wantPhase) {
  if (wantPhase === 'results') {
    setPhase('results');
    ui.showResults(makeResults(), world, q.get('next') === '1' ? 'race' : null);
  } else if (wantPhase === 'loading') {
    setPhase('loading');
    ui.setLoading(0.62, 'Filling grandstands');
  } else setPhase(wantPhase);
}
if (q.get('gamepad') === '1') {
  gamepad = true;
  ui.setGamepadConnected(true);
}
if (q.get('tele') === '1') ui.getSettings().showTelemetry = true;
// main.ts feeds the world every frame before any input arrives; mirror that so the HUD is bound first.
ui.update(world, 0, stats);
for (const k of (q.get('keys') ?? '').split(',').filter(Boolean)) window.dispatchEvent(new KeyboardEvent('keydown', { key: k === 'Space' ? ' ' : k, bubbles: true }));
if (q.get('mfd') === '1') ui.handleCommand({ type: 'mfd-toggle' });
if (q.get('lights') === '1') lightsSequence();
for (const ev of (q.get('evt') ?? '').split(',').filter(Boolean)) {
  const b = [...bar.querySelectorAll('button')].find((x) => x.textContent === ev);
  b?.click();
}
requestAnimationFrame(frame);
