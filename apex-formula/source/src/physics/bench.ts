/**
 * Dev-only helpers: a simple centreline follower, a synthetic test oval, session construction and a headless benchmark.
 * Not imported by the game.
 */
import * as THREE from 'three';
import { PHYSICS_DT } from '../core/constants';
import { buildControlPoints, KINGSMERE } from '../core/circuits';
import { clamp, clamp01, wrapAngle } from '../core/math';
import { DRIVERS, DRIVER_BY_ID, TEAMS, TEAM_BY_ID } from '../core/teams';
import { TrackSpline } from '../core/track/TrackSpline';
import type { Assists, CarEntryConfig, CarState, DriverInput, RaceState, SessionConfig, TrackDefinition, World } from '../core/types';
import { carYaw, createDefaultInput, createEnvironment } from '../core/world';
import { VehiclePhysics } from './VehiclePhysics';

const _target = new THREE.Vector3();

export const FULL_ASSISTS: Assists = {
  tractionControl: 'medium',
  abs: true,
  autoGears: true,
  steeringAssist: true,
  brakingAssist: false,
  racingLine: 'off',
  pitAssist: false,
  ersAssist: false,
  drsAssist: false,
};

export const NO_ASSISTS: Assists = { ...FULL_ASSISTS, tractionControl: 'off', abs: false, autoGears: true, steeringAssist: false };
/** What the simple follower drives with: it does not modulate the throttle, so it needs TC/ABS. */
export const AI_ASSISTS: Assists = { ...FULL_ASSISTS, steeringAssist: false };

type RawPoint = [number, number, number] | [number, number, number, { barrierL: number; barrierR: number }];

/** Two 2.6 km straights joined by 200 m radius semicircles. The back straight has close walls (9 m) for wall tests. */
const ovalPoints = (): RawPoint[] => {
  const pts: RawPoint[] = [];
  for (let z = 0; z <= 2300; z += 500) pts.push([0, 0, z]);
  for (let k = 1; k <= 5; k++) {
    const th = (Math.PI * k) / 6;
    pts.push([200 - 200 * Math.cos(th), 0, 2400 + 200 * Math.sin(th)]);
  }
  for (let z = 2400; z >= -300; z -= 450) pts.push([400, 0, z, { barrierL: 9, barrierR: 9 }]);
  for (let k = 1; k <= 5; k++) {
    const th = Math.PI + (Math.PI * k) / 6;
    pts.push([200 - 200 * Math.cos(th), 0, -300 + 200 * Math.sin(th)]);
  }
  pts.push([0, 0, -300]);
  return pts;
};

export const TEST_OVAL: TrackDefinition = {
  id: 'testoval',
  name: 'Test Oval',
  grandPrixName: 'Test',
  country: 'XX',
  location: 'Nowhere',
  defaultWidth: 15,
  controlPoints: buildControlPoints(ovalPoints()),
  sectorEndCps: [8, 16],
  pitLane: { entryCp: 22, exitCp: 1, side: 1 },
  drsZones: [{ detectionCp: 21, startCp: 22, endCp: 4 }],
  corners: [{ cp: 8 }, { cp: 19 }],
  poleSide: 1,
  defaultLaps: 3,
  referenceLapTime: 100,
  environment: { theme: 'permanent', timeOfDay: 14, weather: 'dry', vibe: 'test' },
  description: 'test',
};

export interface TestSession {
  world: World;
  physics: VehiclePhysics;
  cars: CarState[];
  inputs: DriverInput[];
}

export const makeSession = (def: TrackDefinition, carCount: number, assists: Assists, sessionType: SessionConfig['sessionType'] = 'practice'): TestSession => {
  const track = new TrackSpline(def);
  const config: SessionConfig = {
    mode: 'quick-race',
    sessionType,
    circuitId: def.id,
    laps: 10,
    playerDriverId: DRIVERS[0].id,
    aiDifficulty: 0.8,
    aiCount: carCount - 1,
    weather: 'dry',
    timeOfDay: -1,
    assists,
    startingCompound: 'soft',
    gridOrder: 'performance',
    randomEvents: false,
  };
  const entries: CarEntryConfig[] = [];
  for (let i = 0; i < carCount; i++) {
    const d = DRIVERS[i % DRIVERS.length];
    entries.push({ carId: i, driverId: d.id, teamId: d.teamId, isPlayer: i === 0, compound: 'soft', gridPosition: i + 1 });
  }
  const physics = new VehiclePhysics();
  const partial = { trackDef: def, track, teams: TEAMS, drivers: DRIVERS, teamById: TEAM_BY_ID, driverById: DRIVER_BY_ID, config };
  const cars = physics.createSession(partial, entries);
  for (const c of cars) physics.setAssists(c.id, assists);
  const race = { sessionType, phase: 'racing', time: 0, timeRemaining: -1, lightsOn: 0, totalLaps: 10, leaderLap: 0, entries: [], entryByCar: [], sectorFlags: ['green', 'green', 'green'], globalFlag: 'green', drsEnabled: true, fastestLap: null, messages: [], safetyCarSpeed: 0, results: null } as RaceState;
  const world: World = {
    mode: 'live',
    config,
    trackDef: def,
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
  const inputs = cars.map(() => createDefaultInput());
  return { world, physics, cars, inputs };
};

/** Pure-pursuit centreline follower with a curvature-based speed profile. */
export const followerInput = (car: CarState, track: TrackSpline, speedCap: number, latOffset: number, out: DriverInput, lateralG = 3.2): DriverInput => {
  const v = Math.max(car.speed, 4);
  const la = 7 + 0.5 * v;
  const s0 = car.track.s;
  track.trackToWorld(s0 + la, latOffset, _target);
  const dx = _target.x - car.position.x;
  const dz = _target.z - car.position.z;
  const err = wrapAngle(Math.atan2(dx, dz) - carYaw(car));
  const delta = Math.atan((2 * 3.6 * Math.sin(err)) / la);
  out.steer = clamp(delta / 0.3, -1, 1);
  let vt = speedCap;
  for (let d = 0; d <= 220; d += 20) {
    const vc = track.cornerSpeed(s0 + d, lateralG);
    const allowed = Math.sqrt(vc * vc + 2 * 30 * d);
    if (allowed < vt) vt = allowed;
  }
  const dv = vt - car.speed;
  if (dv < -1.5) {
    out.throttle = 0;
    out.brake = clamp01(-dv * 0.12);
  } else {
    out.brake = 0;
    out.throttle = clamp01(0.2 + dv * 0.35);
  }
  out.gearUp = false;
  out.gearDown = false;
  out.ersMode = 'balanced';
  out.drs = false;
  return out;
};

export interface BenchResult {
  msPerStep: number;
  steps: number;
  minKmh: number;
  maxKmh: number;
  collisions: number;
}

/** Headless: 20 cars following the Kingsmere centreline with a speed cap; measures ms per physics step. */
export const runBench = (steps = 3000, carCount = 20): BenchResult => {
  const ses = makeSession(KINGSMERE, carCount, AI_ASSISTS);
  const { world, physics, cars, inputs } = ses;
  const L = world.track.length;
  for (let i = 0; i < carCount; i++) {
    physics.resetCar(i, world.track.wrapS(-40 - i * (L / carCount) * 0.5));
    cars[i].ers.battery = 1;
    cars[i].wheels.forEach((w) => (w.temp = 95));
  }
  // warm-up
  for (let k = 0; k < 240; k++) {
    for (let i = 0; i < carCount; i++) physics.setInput(i, followerInput(cars[i], world.track, 45 + (i % 4) * 4, (i % 3) * 1.5 - 1.5, inputs[i]));
    physics.step(world, PHYSICS_DT);
  }
  let collisions = 0;
  let minV = Infinity;
  let maxV = 0;
  let total = 0;
  for (let k = 0; k < steps; k++) {
    for (let i = 0; i < carCount; i++) physics.setInput(i, followerInput(cars[i], world.track, 45 + (i % 4) * 4, (i % 3) * 1.5 - 1.5, inputs[i]));
    const t0 = performance.now();
    physics.step(world, PHYSICS_DT);
    total += performance.now() - t0;
    for (let i = 0; i < carCount; i++) {
      if (cars[i].collision.active) collisions++;
      const v = cars[i].speedAbs * 3.6;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  return { msPerStep: total / steps, steps, minKmh: minV, maxKmh: maxV, collisions };
};
