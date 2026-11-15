/**
 * Dev-only stand-in for physics + race director so the AI can be exercised headlessly (see dev.ts).
 * Bicycle model with a friction-circle grip budget; honours DriverInput, pit limiter, held flag.
 */
import * as THREE from 'three';
import { CAR, GRAVITY, TRACK, TYRE_DATA, type TyreCompound } from '../core/constants';
import { Rng, angleDelta, clamp, damp, loopDelta } from '../core/math';
import type { TrackProjection } from '../core/track/TrackSpline';
import type { CarState, PitPhase, RaceEntry, RaceState, SurfaceType, World } from '../core/types';
import { brakeAccel, compoundGrip, dragAccel, latAccel, wearGrip } from './VehicleModel';

const UP = new THREE.Vector3(0, 1, 0);
const SURFACE_GRIP: Record<SurfaceType, number> = { asphalt: 1, kerb: 0.9, pit: 1, grass: 0.45, gravel: 0.3, runoff: 0.75, wall: 0.4 };

export interface SimCar {
  x: number;
  z: number;
  yaw: number;
  v: number;
  yawRate: number;
  steerAngle: number;
  hintS: number;
  prevS: number;
  lapStart: number;
  lapTimes: number[];
  bestLap: number;
  contacts: number;
  contactWith: Set<number>;
  offTrackTime: number;
  power: number;
  aero: number;
}

const _proj: TrackProjection = { s: 0, lateral: 0, distance: 0 };
const _p = new THREE.Vector3();

export interface ContactEvent {
  t: number;
  a: number;
  b: number;
  s: number;
  ds: number;
  dl: number;
  va: number;
  vb: number;
}

export class KinematicSim {
  readonly cars: SimCar[] = [];
  readonly contactLog: ContactEvent[] = [];
  contacts = 0;
  time = 0;

  constructor(private readonly world: World) {
    for (const c of world.cars) {
      const team = world.teamById[c.teamId];
      this.cars.push({
        x: 0,
        z: 0,
        yaw: 0,
        v: 0,
        yawRate: 0,
        steerAngle: 0,
        hintS: 0,
        prevS: 0,
        lapStart: 0,
        lapTimes: [],
        bestLap: Infinity,
        contacts: 0,
        contactWith: new Set(),
        offTrackTime: 0,
        power: team ? team.performance.power : 0.95,
        aero: team ? team.performance.aero : 0.95,
      });
    }
  }

  placeAt(id: number, s: number, lateral: number): void {
    const track = this.world.track;
    const sc = this.cars[id];
    track.trackToWorld(s, lateral, _p);
    sc.x = _p.x;
    sc.z = _p.z;
    sc.yaw = track.sampleAt(s).heading;
    sc.v = 0;
    sc.yawRate = 0;
    sc.hintS = s;
    sc.prevS = s;
    const car = this.world.cars[id];
    car.track.s = track.wrapS(s);
    car.track.lateral = lateral;
    car.track.lap = 0;
    car.track.progress = car.track.s;
    this.writeState(id, 0, 0, 0, 0, false, 'asphalt');
  }

  step(dt: number, wetness: number): void {
    this.time += dt;
    const world = this.world;
    const track = world.track;
    for (let i = 0; i < world.cars.length; i++) {
      const car = world.cars[i];
      const sc = this.cars[i];
      const inp = car.input;
      if (car.chassis.held) {
        sc.v = 0;
        sc.yawRate = 0;
        car.engine.rpm = damp(car.engine.rpm, 4000 + inp.throttle * 9500, 6, dt);
        this.writeState(i, 0, 0, 0, 0, false, car.track.surface);
        continue;
      }
      const surface = track.surfaceAt(car.track.s, car.track.lateral);
      const grip = SURFACE_GRIP[surface] * compoundGrip(car.tyres.compound, wetness) * wearGrip(car.tyres.wear) * (0.97 + 0.03 * sc.aero);
      const v = sc.v;

      const targetSteer = clamp(inp.steer, -1, 1) * 0.3;
      sc.steerAngle += clamp(targetSteer - sc.steerAngle, -2.5 * dt, 2.5 * dt);

      const traction = GRAVITY * 1.35 * grip;
      let aDrive = Math.min((clamp(inp.throttle, 0, 1) * 900 * (0.95 + 0.05 * sc.power)) / Math.max(v, 8), traction);
      const brakeCap = brakeAccel(v, grip) * 1.02;
      const aBrakeCmd = clamp(inp.brake, 0, 1) * brakeAccel(v, 1) * 1.05;
      const locked = aBrakeCmd > brakeCap;
      const aBrake = locked ? brakeCap * 0.85 : aBrakeCmd;
      const drsOpen = inp.drs && car.drs.available && inp.brake < 0.2;

      const yawDes = (v * Math.tan(sc.steerAngle)) / CAR.wheelbase;
      const aLatDes = v * yawDes;
      const aLatMax = latAccel(v, grip);
      const longUse = (aDrive + aBrake) / Math.max(1, traction + brakeCap) * 1.3;
      const aLatAvail = aLatMax * Math.sqrt(Math.max(0.12, 1 - longUse * longUse));
      let frontSlip: number;
      let yawAct: number;
      if (Math.abs(aLatDes) > aLatAvail) {
        yawAct = (Math.sign(aLatDes) * aLatAvail) / Math.max(v, 1);
        frontSlip = Math.abs(aLatDes) / aLatAvail;
      } else {
        yawAct = yawDes;
        frontSlip = (0.7 * Math.abs(aLatDes)) / Math.max(1, aLatAvail);
      }
      let rearSlip = Math.hypot(aDrive / Math.max(1, traction), (0.75 * Math.abs(aLatDes)) / Math.max(1, aLatMax));
      if (rearSlip > 1.05) {
        aDrive *= 0.65;
        yawAct *= 1.05;
      }
      if (locked) frontSlip = Math.max(frontSlip, 1.5);
      sc.yawRate = damp(sc.yawRate, yawAct, 12, dt);

      let aLong = aDrive - aBrake - dragAccel(v) * (drsOpen ? 0.84 : 1) - 0.4;
      if (v <= 0.01 && aLong < 0) aLong = 0;
      let nv = Math.max(0, v + aLong * dt);
      if (inp.pitLimiter && nv > CAR.pitSpeedLimit) nv = Math.max(CAR.pitSpeedLimit, nv - 15 * dt);
      sc.v = nv;
      sc.yaw += sc.yawRate * dt;
      sc.x += Math.sin(sc.yaw) * nv * dt;
      sc.z += Math.cos(sc.yaw) * nv * dt;

      const wearRate = TYRE_DATA[car.tyres.compound].wearRate;
      car.tyres.wear = Math.min(1, car.tyres.wear + ((dt * (Math.abs(aLatDes) * 0.5 + aBrake * 0.3 + aDrive * 0.25)) / GRAVITY) * wearRate * 0.0011);

      this.writeState(i, aLong, frontSlip, rearSlip, nv * sc.yawRate, locked, surface);
      car.drs.open = drsOpen;
      if (car.track.wheelsOff >= 4) sc.offTrackTime += dt;
    }
    this.resolveContacts();
  }

  private writeState(i: number, aLong: number, frontSlip: number, rearSlip: number, aLat: number, locked: boolean, surface: SurfaceType): void {
    const world = this.world;
    const track = world.track;
    const car = world.cars[i];
    const sc = this.cars[i];
    track.project(sc.x, sc.z, sc.hintS, _proj);
    const s = _proj.s;
    sc.hintS = s;
    if (sc.prevS > track.length - 120 && s < 120 && sc.v > 1) {
      car.track.lap++;
      if (car.track.lap > 1) {
        const lt = this.time - sc.lapStart;
        sc.lapTimes.push(lt);
        if (lt < sc.bestLap) sc.bestLap = lt;
      }
      sc.lapStart = this.time;
    } else if (sc.prevS < 120 && s > track.length - 120 && sc.v > 1) {
      car.track.lap = Math.max(0, car.track.lap - 1);
    }
    sc.prevS = s;
    car.track.s = s;
    car.track.lateral = _proj.lateral;
    car.track.progress = car.track.lap * track.length + s;
    car.track.sector = track.sectorOf(s);
    car.track.surface = surface;
    car.track.inPitLane = track.isInPitLane(s, _proj.lateral);
    const sm = track.sampleAt(s);
    const hw = sm.width * 0.5;
    const a = Math.abs(_proj.lateral);
    const kerb = _proj.lateral > 0 ? sm.kerbL : sm.kerbR;
    const edge = hw + (kerb ? TRACK.kerbWidth : 0);
    car.track.wheelsOff = car.track.inPitLane ? 0 : a - 0.85 > edge ? 4 : a + 0.85 > edge ? 2 : 0;
    car.track.forwardSpeed = sc.v * Math.cos(angleDelta(sm.heading, sc.yaw));
    car.position.set(sc.x, track.heightAt(s), sc.z);
    car.quaternion.setFromAxisAngle(UP, sc.yaw);
    car.velocity.set(Math.sin(sc.yaw) * sc.v, 0, Math.cos(sc.yaw) * sc.v);
    car.speed = sc.v;
    car.speedAbs = sc.v;
    car.angularVelocity.set(0, sc.yawRate, 0);
    car.localAccel.set(aLat, 0, aLong);
    for (let w = 0; w < 4; w++) {
      const ws = car.wheels[w];
      ws.slip = w < 2 ? frontSlip : rearSlip;
      ws.locked = w < 2 && locked;
      ws.spinning = w >= 2 && rearSlip > 1.05;
      ws.surface = surface;
      ws.wear = car.tyres.wear;
    }
    if (!car.chassis.held) car.engine.rpm = 5500 + 8500 * (((sc.v * 0.9 + 3) % 14) / 14);
    car.engine.throttle = car.input.throttle;
    car.engine.brake = car.input.brake;
    car.engine.steer = car.input.steer;
    car.tyres.gripFactor = wearGrip(car.tyres.wear);
    car.ers.mode = car.input.ersMode;
  }

  private resolveContacts(): void {
    const world = this.world;
    const cars = world.cars;
    const track = world.track;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      if (a.chassis.held) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        if (b.chassis.held) continue;
        if (a.track.inPitLane !== b.track.inPitLane) continue;
        const ds = loopDelta(a.track.s, b.track.s, track.length);
        const dl = b.track.lateral - a.track.lateral;
        const touching = Math.abs(ds) < CAR.length * 0.95 && Math.abs(dl) < CAR.width * 0.97;
        const sa = this.cars[i];
        const sb = this.cars[j];
        if (touching) {
          if (!sa.contactWith.has(j)) {
            sa.contactWith.add(j);
            sa.contacts++;
            sb.contacts++;
            this.contacts++;
            if (this.contactLog.length < 400) this.contactLog.push({ t: this.time, a: i, b: j, s: a.track.s, ds, dl, va: sa.v, vb: sb.v });
          }
          // Separate laterally and let the car behind lose speed.
          const push = (CAR.width * 0.97 - Math.abs(dl)) * 0.5 + 0.02;
          const dir = dl >= 0 ? 1 : -1;
          this.nudge(i, -dir * push);
          this.nudge(j, dir * push);
          if (ds > 0 && sa.v > sb.v) sa.v = sb.v;
          else if (ds < 0 && sb.v > sa.v) sb.v = sa.v;
        } else if (Math.abs(ds) > CAR.length * 1.3 || Math.abs(dl) > CAR.width * 1.3) sa.contactWith.delete(j);
      }
    }
  }

  private nudge(i: number, dLat: number): void {
    const car = this.world.cars[i];
    const sc = this.cars[i];
    this.world.track.trackToWorld(car.track.s, car.track.lateral + dLat, _p);
    sc.x = _p.x;
    sc.z = _p.z;
    car.track.lateral += dLat;
    car.position.x = _p.x;
    car.position.z = _p.z;
  }
}

/* ───────────────────────────── fake race director ───────────────────────────── */

const makeEntry = (car: CarState): RaceEntry => ({
  carId: car.id,
  driverId: car.driverId,
  teamId: car.teamId,
  position: car.gridPosition,
  gridPosition: car.gridPosition,
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
  tyreCompound: car.tyres.compound,
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

export const createFakeRaceState = (world: Omit<World, 'race'>, sessionType: RaceState['sessionType'], totalLaps: number): RaceState => {
  const entries = world.cars.map(makeEntry);
  const entryByCar: RaceEntry[] = [];
  for (const e of entries) entryByCar[e.carId] = e;
  return {
    sessionType,
    phase: 'idle',
    time: 0,
    timeRemaining: sessionType === 'race' ? -1 : 480,
    lightsOn: 0,
    totalLaps,
    leaderLap: 0,
    entries,
    entryByCar,
    sectorFlags: ['green', 'green', 'green'],
    globalFlag: 'green',
    drsEnabled: false,
    fastestLap: null,
    messages: [],
    safetyCarSpeed: 0,
    results: null,
  };
};

export class FakeDirector {
  private readonly rng = new Rng(0x5eed);
  private t = 0;
  private lightsHold = 0;
  private yellowTimers = [0, 0, 0];
  private pitTimers: number[] = [];
  private lastLap: number[] = [];
  private lastPos: number[] = [];
  overtakes = 0;
  pitStops = 0;
  maxBoxError = 0;
  blueFlagEvents = 0;
  speedingEvents = 0;

  constructor(private readonly world: World, private readonly sim: KinematicSim) {
    for (const c of world.cars) {
      this.pitTimers[c.id] = 0;
      this.lastLap[c.id] = 0;
      this.lastPos[c.id] = c.gridPosition;
    }
  }

  startProcedure(): void {
    const race = this.world.race;
    race.phase = 'formation';
    this.t = 0;
  }

  update(dt: number): void {
    const world = this.world;
    const race = world.race;
    const track = world.track;
    const cars = world.cars;
    this.t += dt;
    if (race.phase !== 'idle' && race.phase !== 'formation') race.time += dt;
    if (race.sessionType !== 'race' && race.timeRemaining > 0) race.timeRemaining = Math.max(0, race.timeRemaining - dt);

    switch (race.phase) {
      case 'formation':
        if (this.t > 2) {
          race.phase = 'lights';
          this.t = 0;
          race.lightsOn = 0;
        }
        break;
      case 'lights':
        if (race.lightsOn < 5) {
          race.lightsOn = Math.min(5, Math.floor(this.t / 1) + 1);
          if (race.lightsOn === 5) this.lightsHold = this.rng.range(0.6, 2.6);
        } else if (this.t > 5 + this.lightsHold) {
          race.lightsOn = 0;
          race.phase = 'green';
          this.t = 0;
          for (const c of cars) c.chassis.held = false;
        }
        break;
      case 'green':
        if (this.t > 3) race.phase = 'racing';
        break;
      default:
        break;
    }

    // Entries: laps, status, positions, gaps.
    let leader: RaceEntry | null = null;
    for (const c of cars) {
      const e = race.entryByCar[c.id];
      e.lap = c.track.lap;
      e.lapsCompleted = Math.max(0, c.track.lap - 1);
      if (c.track.lap !== this.lastLap[c.id]) {
        this.lastLap[c.id] = c.track.lap;
        const sc = this.sim.cars[c.id];
        e.lastLap = sc.lapTimes.length ? sc.lapTimes[sc.lapTimes.length - 1] : 0;
        e.bestLap = isFinite(sc.bestLap) ? sc.bestLap : 0;
        e.tyreAge++;
        c.tyres.age = e.tyreAge;
      }
      if (race.sessionType === 'race' && e.status === 'racing' && c.track.lap > race.totalLaps) {
        e.status = 'finished';
        c.status = 'finished';
        e.finishTime = race.time;
      }
      e.tyreCompound = c.tyres.compound;
    }
    race.entries.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'finished' ? -1 : 1;
      if (a.status === 'finished') return a.finishTime - b.finishTime;
      return cars[b.carId].track.progress - cars[a.carId].track.progress;
    });
    race.entries.forEach((e, i) => {
      e.position = i + 1;
      if (i === 0) leader = e;
      if (race.phase === 'racing' && e.position !== this.lastPos[e.carId]) {
        if (e.position < this.lastPos[e.carId] && e.status === 'racing') this.overtakes++;
        this.lastPos[e.carId] = e.position;
      }
    });
    if (leader) {
      const l: RaceEntry = leader;
      race.leaderLap = l.lap;
      const lc = cars[l.carId];
      for (const e of race.entries) {
        const c = cars[e.carId];
        e.gapToLeader = (lc.track.progress - c.track.progress) / Math.max(30, lc.speed);
        e.lapsBehind = Math.floor((lc.track.progress - c.track.progress) / track.length);
      }
      for (let i = 1; i < race.entries.length; i++) {
        const e = race.entries[i];
        const ahead = race.entries[i - 1];
        e.interval = (cars[ahead.carId].track.progress - cars[e.carId].track.progress) / Math.max(30, cars[e.carId].speed);
      }
      if (race.sessionType === 'race' && race.phase === 'racing' && l.status === 'finished') race.phase = 'finished';
      if (race.phase === 'finished' && race.entries.every((e) => e.status !== 'racing')) race.phase = 'complete';
    }

    // DRS.
    race.drsEnabled = race.sessionType !== 'race' || (race.phase === 'racing' && race.leaderLap >= 2 && world.env.weather.wetness < 0.3);
    for (const c of cars) {
      const e = race.entryByCar[c.id];
      let avail = false;
      if (race.drsEnabled && track.drsZoneAt(c.track.s) && !c.track.inPitLane) {
        if (race.sessionType !== 'race') avail = true;
        else {
          let best = Infinity;
          for (const o of cars) {
            if (o === c || o.track.inPitLane) continue;
            const ds = loopDelta(c.track.s, o.track.s, track.length);
            if (ds > 0 && ds < best) best = ds;
          }
          avail = best / Math.max(c.speed, 20) < 1.0;
        }
      }
      c.drs.available = avail;
      e.drsAvailable = avail;
      e.drsOpen = c.drs.open;
    }

    // Blue flags.
    for (const c of cars) {
      const e = race.entryByCar[c.id];
      let blue = false;
      if (race.phase === 'racing' && e.status === 'racing') {
        for (const o of cars) {
          if (o === c || o.track.inPitLane) continue;
          if (o.track.progress - c.track.progress > track.length * 0.6) {
            const ds = loopDelta(o.track.s, c.track.s, track.length);
            if (ds > -8 && ds < Math.max(o.speed, 20) * 2.0) blue = true;
          }
        }
      }
      if (blue && !e.blueFlag) this.blueFlagEvents++;
      e.blueFlag = blue;
    }

    // Yellow flags: stopped / spun cars on the racing surface.
    for (let i = 0; i < 3; i++) this.yellowTimers[i] = Math.max(0, this.yellowTimers[i] - dt);
    for (const c of cars) {
      if (c.chassis.held || c.track.inPitLane || race.phase !== 'racing') continue;
      const sm = track.sampleAt(c.track.s);
      const yaw = Math.atan2(2 * (c.quaternion.w * c.quaternion.y), 1 - 2 * c.quaternion.y * c.quaternion.y);
      const spun = Math.abs(angleDelta(sm.heading, yaw)) > 1.2;
      const slow = c.speed < 4 && race.entryByCar[c.id].status === 'racing';
      if (spun || slow) this.yellowTimers[c.track.sector] = 8;
    }
    for (let i = 0; i < 3; i++) race.sectorFlags[i] = this.yellowTimers[i] > 0 ? 'yellow' : 'green';

    // Pit stops.
    for (const c of cars) {
      const e = race.entryByCar[c.id];
      const pitD = track.pitD(c.track.s);
      const team = world.teamById[c.teamId];
      const box = track.pitBox(team ? team.pitBoxIndex : 0);
      const phase: PitPhase = e.pitPhase;
      switch (phase) {
        case 'none':
          if (c.input.pitRequest) {
            e.pitPhase = 'requested';
            e.requestedCompound = c.input.pitCompound;
          }
          break;
        case 'requested':
          if (!c.input.pitRequest) e.pitPhase = 'none';
          else if (pitD >= 0 && pitD <= track.pitLane.transition) e.pitPhase = 'entering';
          break;
        case 'entering':
          if (c.track.inPitLane) e.pitPhase = 'in-lane';
          else if (pitD > track.pitLane.transition || pitD < 0) e.pitPhase = 'requested';
          break;
        case 'in-lane': {
          const dist = Math.hypot(c.position.x - box.position.x, c.position.z - box.position.z);
          if (dist < 1.5 && c.speedAbs < 0.5) {
            e.pitPhase = 'stopped';
            c.chassis.held = true;
            this.pitTimers[c.id] = this.rng.range(2.3, 3.2);
            this.maxBoxError = Math.max(this.maxBoxError, dist);
            this.pitStops++;
          }
          if (pitD > track.pitLane.limitStartD && pitD < track.pitLane.limitEndD && c.speed > CAR.pitSpeedLimit + 1) this.speedingEvents++;
          break;
        }
        case 'stopped':
          this.pitTimers[c.id] -= dt;
          if (this.pitTimers[c.id] <= 0) {
            const next: TyreCompound = e.requestedCompound ?? (c.tyres.compound === 'soft' ? 'medium' : 'hard');
            c.tyres.compound = next;
            c.tyres.wear = 0;
            c.tyres.age = 0;
            e.tyreAge = 0;
            e.pitStops++;
            c.chassis.held = false;
            e.pitPhase = 'released';
          }
          break;
        case 'released':
          if (c.speedAbs > 0.5) e.pitPhase = 'exiting';
          break;
        case 'exiting':
          if (!c.track.inPitLane) e.pitPhase = 'none';
          break;
      }
    }
  }
}
