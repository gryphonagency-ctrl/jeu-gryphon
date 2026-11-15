/**
 * One AI driver: perception (traffic), decisions (racecraft, strategy, mistakes) and the low-level controller
 * (pure-pursuit steering, decel-request speed control). All state is preallocated; `drive()` allocates nothing.
 */
import * as THREE from 'three';
import { CAR, TYRE_DATA, type TyreCompound } from '../core/constants';
import { Rng, angleDelta, clamp, damp, hashString, lerp, smoothstep } from '../core/math';
import type { PitLaneSample, TrackSample, TrackSpline } from '../core/track/TrackSpline';
import type { CarState, DriverInput, EntryStatus, ErsMode, PitPhase, RaceEntry, RaceState, World } from '../core/types';
import { carForward, createDefaultInput } from '../core/world';
import { buildDriverModel, type DriverModel } from './DriverModel';
import type { RacingLine } from './RacingLine';
import { IN_PATH, computeNeighbours, createNeighbours, type Neighbours } from './Traffic';
import {
  CAR_LENGTH,
  MAX_STEER,
  V_TOP,
  WHEELBASE,
  brakeAccel,
  compoundGrip,
  dragAccel,
  driveAccel,
  isSlick,
  latAccel,
  throttleCapFor,
  wearGrip,
} from './VehicleModel';

export interface AIContext {
  line: RacingLine;
  difficulty: number;
  /** Pace multiplier at which the best driver laps in referenceLapTime (difficulty 1). */
  paceScale: number;
  /** Pace multiplier for ~15 % slower laps (difficulty 0). */
  paceScaleEasy: number;
}

type StartState = 'grid' | 'reacting' | 'launch' | 'running';
type Craft = 'line' | 'attack' | 'defend' | 'blue' | 'yield';
type Mistake = 'none' | 'lockup' | 'late' | 'wide';
type QualiMode = 'out' | 'push' | 'cool' | 'cruise';

/**
 * Look-ahead distances (m) over which the required deceleration is evaluated. The targets are already a
 * braking-consistent curve, so a short horizon suffices; longer ones would make the car brake early and softly
 * (mean decel to a far point is below the curve's slope until you are almost on it).
 */
const HORIZON = [3, 6, 10, 15, 21, 28];
const PIT_V = CAR.pitSpeedLimit - 0.6;
/** Lateral separation (centre to centre) aimed for when pulling alongside a car. */
const ATTACK_OFFSET = 3.1;
/** Wider berth when lapping a car that is moving over for us. */
const PASS_OFFSET = 4.6;
/** Line curvature below which a stretch counts as open road for lapping (radius > 200 m). */
const PASS_KAPPA = 0.03;
/** Track-side offset from the pit-lane centreline used to pass cars stopped in their boxes. */
const FAST_LANE_OFFSET = 2.7;
/** Comfortable deceleration used for the speed curve into the pit limit line. */
const PIT_APPROACH_DECEL = 11;

const makeSample = (): TrackSample => ({
  s: 0,
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  left: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  width: 0,
  curvature: 0,
  grade: 0,
  heading: 0,
  kerbL: false,
  kerbR: false,
  runoffL: 'grass',
  runoffR: 'grass',
  barrierL: 0,
  barrierR: 0,
  sector: 0,
  cpIndex: 0,
});
const makePitSample = (): PitLaneSample => ({ position: new THREE.Vector3(), tangent: new THREE.Vector3(), lateral: 0, d: 0, inTransition: false, speedLimited: false });

const _fwd = new THREE.Vector3();
const _sm = makeSample();
const _smA = makeSample();
const _pls = makePitSample();
const _pls2 = makePitSample();

export class CarBrain {
  readonly id: number;
  readonly input: DriverInput = createDefaultInput();
  readonly nb: Neighbours = createNeighbours();
  readonly model: DriverModel;
  private readonly rng: Rng;
  private readonly ctx: AIContext;
  private readonly boxS: number;

  private startState: StartState;
  private reactionTimer = 0;
  private launchTimer = 0;
  private blip = 0.2;

  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private tc = 1;
  private abs = 1;
  private gripTrim = 1;

  private speedNoise = 0;
  private brakeNoise = 0;
  private mistake: Mistake = 'none';
  private mistakeTimer = 0;
  private mistakeCooldown = 6;

  private offset = 0;
  private offsetTarget = 0;
  private craft: Craft = 'line';
  private craftSide = 1;
  private craftTimer = 0;
  /** Blue flag: true when the road ahead is open enough to move fully aside for the leader. */
  private blueOpen = false;
  private craftTarget = -1;
  private craftEndS = 0;
  private defendedS = -1e9;
  private decisionTimer = 0;

  private pitWanted = false;
  private pitCompound: TyreCompound | null = null;
  private pitSeen = false;
  private inPit = false;
  private wasInLane = false;
  private stopDone = false;
  private stopWait = 0;
  private pitOffset = 0;
  private lastPitLap = -10;
  private strategyTimer: number;

  private qualiMode: QualiMode = 'out';
  private qualiLap = -99;

  private recovering = false;
  private time = 0;

  constructor(id: number, world: World, ctx: AIContext) {
    this.id = id;
    this.ctx = ctx;
    const car = world.cars[id];
    const driver = car ? world.driverById[car.driverId] : undefined;
    this.rng = new Rng(hashString(car ? car.driverId : `car${id}`) ^ (id * 0x9e3779b9));
    this.model = buildDriverModel(driver, this.rng);
    const team = car ? world.teamById[car.teamId] : undefined;
    this.boxS = world.track.pitBox(team ? team.pitBoxIndex : 0).s;
    this.startState = world.race.sessionType === 'race' ? 'grid' : 'running';
    this.strategyTimer = this.rng.range(0.2, 1.2);
  }

  /* ───────────────────────────── main entry ───────────────────────────── */

  drive(world: World, dt: number, forcePit: boolean): void {
    const car = world.cars[this.id];
    if (!car) return;
    const track = world.track;
    const race = world.race;
    const line = this.ctx.line;
    const inp = this.input;
    const entry: RaceEntry | undefined = race.entryByCar[this.id];
    inp.gearUp = false;
    inp.gearDown = false;
    inp.reset = false;
    this.time += dt;
    this.updateNoise(dt);
    computeNeighbours(car, world, this.nb, this.craft === 'attack' ? this.craftTarget : -1, car.track.inPitLane ? 2.0 : IN_PATH);

    const s = car.track.s;
    const lat = car.track.lateral;
    const v = car.speed;
    const fwd = carForward(car, _fwd);
    const heading = Math.atan2(fwd.x, fwd.z);
    track.sample(s, _sm);
    const hw = _sm.width * 0.5;
    const headingErr = angleDelta(_sm.heading, heading);
    const lineLat = line.lateralAt(s);
    const status: EntryStatus = entry ? entry.status : car.status;
    const phase = race.phase;
    const isRace = race.sessionType === 'race';

    if (isRace && this.startState !== 'running' && this.handleStart(car, race, dt, lat, lineLat)) return;

    this.strategyTimer -= dt;
    if (this.strategyTimer <= 0) {
      this.strategyTimer = 1;
      this.updateStrategy(world, car, entry);
    }
    const pitPhase: PitPhase = entry ? entry.pitPhase : 'none';
    this.updatePitHandshake(car, pitPhase);

    const pitD = track.pitD(s);
    const distToEntry = track.distanceForward(s, track.pitLane.entryS);
    this.updatePitMode(car, track, pitPhase, pitD, distToEntry, forcePit, lat, lineLat);
    if (this.inPit) {
      this.drivePit(world, car, dt, forcePit, s, lat, v, heading, hw, lineLat, pitPhase, pitD, distToEntry);
      return;
    }

    if (this.updateRecovery(world, car, dt, s, lat, v, heading, headingErr, lineLat)) return;

    /* ── situation ── */
    const wet = world.env.weather.wetness;
    const difficulty = this.ctx.difficulty;
    const m = this.model;
    const flagHere = race.sectorFlags[car.track.sector] ?? 'green';
    const flagNext = race.sectorFlags[track.sectorOf(s + 150)] ?? 'green';
    const g = race.globalFlag;
    // Local yellows only apply to the flagged sector (globalFlag mirrors "any sector yellow" for the HUD).
    const doubleYellow = flagHere === 'double-yellow' || flagNext === 'double-yellow';
    const yellow = doubleYellow || flagHere === 'yellow' || flagNext === 'yellow' || g === 'red';
    const sc = phase === 'safety-car' || phase === 'vsc' || g === 'sc' || g === 'vsc';
    const finished = status === 'finished' || phase === 'complete';
    const retired = status === 'retired' || status === 'dnf' || status === 'dsq';
    const lap1 = isRace && race.leaderLap <= 1 && (phase === 'racing' || phase === 'green');
    const launching = this.startState === 'launch';
    const offTrack = car.track.wheelsOff >= 3;

    let sessFactor = 1;
    if (!isRace) sessFactor = this.qualiPacing(car, race, s, track.length);

    /* ── pace ── */
    const wetSkill = lerp(1, lerp(0.8, 0.95, m.wet), smoothstep(0.25, 0.7, wet));
    const base = lerp(this.ctx.paceScaleEasy, this.ctx.paceScale, difficulty);
    let mult = base * (1 - (1 - m.pace) * 0.07) * (1 + this.speedNoise) * wetSkill * sessFactor;
    if (lap1) mult *= 0.985;
    if (yellow) mult *= doubleYellow ? 0.55 : 0.75;
    if (this.mistake === 'wide') mult *= 1.03;
    if (offTrack) mult *= 0.6;

    const gripMul = compoundGrip(car.tyres.compound, wet) * wearGrip(car.tyres.wear) * this.gripTrim;
    const gripSpeed = Math.sqrt(gripMul / line.profileGrip);
    this.updateGripTrim(car, dt, s, v, offTrack);

    /* ── decisions ── */
    const nb = this.nb;
    const pressure = nb.behindId >= 0 && nb.behindDs < 0.8 * Math.max(v, 10) + 6;
    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = 0.1;
      this.decide(world, car, entry, s, v, hw, lineLat, yellow || sc, finished, retired, lap1, isRace, mult, gripSpeed);
    }
    this.updateMistakes(dt, car, s, v, wet, pressure, difficulty, status);

    /* ── lateral target ── */
    let offT = this.offsetTarget;
    if (this.mistake === 'wide') {
      const k = line.kappaAt(s + 25);
      offT += (k >= 0 ? -1 : 1) * 2.2;
    }
    if (!isRace && this.qualiMode === 'out' && Math.abs(line.kappaAt(s)) < 0.002 && v > 10 && v < 60) offT += 1.6 * Math.sin(2.5 * this.time);
    const maxLat = hw - 1.0;
    offT = clamp(offT, -maxLat - lineLat, maxLat - lineLat);
    const rate = launching ? 0.8 : offTrack ? 1.2 : this.craft === 'attack' || this.craft === 'defend' ? 3 : 2;
    // Exponential approach, capped to a lane-change-like lateral speed so big targets are not violent swerves.
    const maxStep = (2.2 + 0.03 * Math.abs(v)) * dt;
    this.offset = clamp(damp(this.offset, offT, rate, dt), this.offset - maxStep, this.offset + maxStep);
    // Traffic terms act immediately (no damping): soft repulsion plus hard bounds from cars alongside, with the
    // bounds tightened by my own lateral velocity so I stop drifting before I reach them.
    let off = this.offset + nb.repulse;
    let squeezed = false;
    if (nb.latMin > -Infinity || nb.latMax < Infinity) {
      const latVel = car.velocity.x * _sm.left.x + car.velocity.z * _sm.left.z;
      const lo = Math.max(nb.latMin + Math.max(0, -latVel) * 0.4, -maxLat - 0.5);
      const hi = Math.min(nb.latMax - Math.max(0, latVel) * 0.4, maxLat + 0.5);
      if (lo <= hi) {
        off = clamp(off, lo - lineLat, hi - lineLat);
        this.offset = clamp(this.offset, lo - lineLat, hi - lineLat);
      } else squeezed = true;
    }

    /* ── steering ── */
    const L = clamp(6 + 0.25 * Math.abs(v), 8, 45);
    const sA = s + L;
    track.sample(sA, _smA);
    const hwA = _smA.width * 0.5 - 0.9;
    const latA = clamp(line.lateralAt(sA) + off, -hwA, hwA);
    const tx = _smA.position.x + _smA.left.x * latA;
    const tz = _smA.position.z + _smA.left.z * latA;
    this.steerToward(car, dt, tx, tz, lineLat + off - lat, v, heading, offTrack ? 0.5 : 1);

    /* ── speed ── */
    let aReq = 0;
    let vTarget = V_TOP;
    const shift = this.brakeNoise + (this.mistake === 'late' ? lerp(8, 18, 1 - m.consistency) : 0);
    for (let k = 0; k < HORIZON.length; k++) {
      const d = HORIZON[k];
      const vt = line.targetAt(s + d + shift, mult, gripSpeed);
      if (k === 0) vTarget = vt;
      const a = (v * v - vt * vt) / (2 * d);
      if (a > aReq) aReq = a;
    }
    if (offTrack) vTarget = Math.min(vTarget, 28);
    if (sc) vTarget = Math.min(vTarget, race.safetyCarSpeed > 1 ? race.safetyCarSpeed : 45);
    if (finished) vTarget = Math.min(vTarget, 24);
    if (!isRace && this.qualiMode === 'cruise') vTarget = Math.min(vTarget, 50);
    // Blue flag: lift (never below a rolling pace, so the leader can always get by) while the leader is close behind.
    if (this.craft === 'blue' && nb.behindId >= 0 && nb.behindDs < 45) {
      const alongside = nb.behindDs < CAR_LENGTH + 3 && Math.abs(nb.behindDlat) > 1.8;
      vTarget = Math.max(15, vTarget * (!this.blueOpen ? 0.93 : alongside ? 0.68 : 0.8));
    }
    if (this.craft === 'yield') vTarget *= 0.85;
    if (retired) vTarget = 0;

    if (nb.aheadId >= 0 && !finished && !retired) {
      const attackingThis = this.craft === 'attack' && nb.aheadId === this.craftTarget;
      let gapTime = attackingThis ? 0.1 : m.gapTime;
      if (lap1) gapTime += 0.12;
      if (yellow || sc) gapTime += 0.3;
      if (launching) gapTime = 0.12;
      const vA = Math.max(0, nb.aheadSpeed);
      const dMin = CAR_LENGTH + 0.8 + gapTime * vA;
      const vDes = Math.max(0, vA + 0.8 * (nb.aheadDs - dMin));
      if (vDes < vTarget) vTarget = vDes;
      if (v > vDes) aReq = Math.max(aReq, (v - vDes) * 2.2);
      const free = Math.max(0.5, nb.aheadDs - CAR_LENGTH - 1);
      // Closing on constant-speed leader, plus matching the leader's own braking when we are near the minimum gap.
      const closing = v > vA ? ((v - vA) * (v - vA)) / (2 * free) : 0;
      const leadDecel = nb.aheadBrake > 0.05 ? nb.aheadBrake * brakeAccel(vA, gripMul) * clamp((2 * dMin - nb.aheadDs) / dMin, 0, 1) : 0;
      aReq = Math.max(aReq, closing + leadDecel);
    }
    if (squeezed) aReq = Math.max(aReq, 3.5);
    // Wheel-to-wheel: the car behind backs out when too close (harder the closer), or when the line ahead sweeps
    // toward the other car (chicanes); with no clear leader, the one running wider of the line yields.
    if (nb.sideId >= 0 && !finished) {
      const adl = Math.abs(nb.sideDl);
      const sweep = (line.lateralAt(s + 30) - lat) * (nb.sideDl >= 0 ? 1 : -1);
      const behind = nb.sideDs > 0.5 || (Math.abs(nb.sideDs) <= 0.5 && Math.abs(lat - lineLat) > Math.abs(lat + nb.sideDl - lineLat));
      if (behind) {
        const sideEntry = race.entryByCar[nb.sideId];
        const theyYield = !!sideEntry && sideEntry.blueFlag && !(entry && entry.blueFlag);
        const aggr = lerp(1.2, 0.8, m.aggression);
        if (adl < (theyYield ? 2.6 : 3.0)) aReq = Math.max(aReq, lerp(2.5, 9, clamp((3.0 - adl) / 1.2, 0, 1)) * aggr);
        else if (!theyYield && sweep > 1.5 && adl < 4.5 && line.nextBrakingDistance(s, 70) >= 0) aReq = Math.max(aReq, 4.5 * aggr);
      }
    }
    if (v > vTarget + 0.5) aReq = Math.max(aReq, Math.min(4, (v - vTarget) * 0.6));
    if (retired) aReq = Math.max(aReq, Math.abs(v) > 1 ? 2.5 : 10);

    const launchTh = launching ? 0.62 + 0.38 * Math.min(1, this.launchTimer / 1.6) : 0;
    const thCap = launching ? 1 : Math.min(1, throttleCapFor(mult) + (this.craft === 'attack' ? 0.08 : 0));
    this.speedControl(car, dt, vTarget, aReq, gripMul, launchTh, thCap);

    inp.pitLimiter = false;
    inp.drs = car.drs.available && this.brake < 0.05 && Math.abs(line.kappaAt(s + 30)) < 0.0025 && !yellow && !finished && this.craft !== 'blue';
    inp.ersMode = this.chooseErs(car, yellow, finished || retired, isRace);
  }

  /* ───────────────────────────── start procedure ───────────────────────────── */

  /** Returns true when the car is still on the grid / reacting (inputs already written). */
  private handleStart(car: CarState, race: RaceState, dt: number, lat: number, lineLat: number): boolean {
    const inp = this.input;
    const phase = race.phase;
    if (this.startState === 'grid') {
      const released = !car.chassis.held && (phase === 'green' || phase === 'racing');
      if (released) {
        this.startState = 'reacting';
        this.reactionTimer = this.model.reaction * lerp(1.35, 0.9, this.ctx.difficulty) + this.rng.range(-0.03, 0.06);
        this.offset = lat - lineLat;
        this.offsetTarget = 0;
      } else if (!car.chassis.held && phase !== 'idle' && phase !== 'formation' && phase !== 'lights') {
        this.startState = 'running';
        this.offset = lat - lineLat;
        return false;
      } else {
        this.steer = damp(this.steer, 0, 10, dt);
        inp.steer = this.steer;
        inp.brake = 0;
        this.brake = 0;
        if (phase === 'lights' && race.lightsOn >= 2) {
          this.blip = clamp(this.blip + (7000 - car.engine.rpm) * 0.000025 * dt * 120, 0.05, 0.5);
          inp.throttle = this.blip;
        } else inp.throttle = 0;
        this.throttle = inp.throttle;
        inp.drs = false;
        inp.ersMode = 'balanced';
        inp.pitLimiter = false;
        return true;
      }
    }
    if (this.startState === 'reacting') {
      this.reactionTimer -= dt;
      inp.throttle = 0;
      inp.brake = 0;
      this.throttle = 0;
      this.brake = 0;
      this.steer = damp(this.steer, 0, 10, dt);
      inp.steer = this.steer;
      inp.drs = false;
      inp.ersMode = 'overtake';
      inp.pitLimiter = false;
      if (this.reactionTimer <= 0) {
        this.startState = 'launch';
        this.launchTimer = 0;
      }
      return true;
    }
    this.launchTimer += dt;
    if (this.launchTimer > 3.5) this.startState = 'running';
    return false;
  }

  /* ───────────────────────────── low-level control ───────────────────────────── */

  private steerToward(car: CarState, dt: number, tx: number, tz: number, eLat: number, v: number, heading: number, kE: number): void {
    const dx = tx - car.position.x;
    const dz = tz - car.position.z;
    const ld = Math.max(2, Math.hypot(dx, dz));
    const alpha = angleDelta(heading, Math.atan2(dx, dz));
    const kpp = (2 * Math.sin(alpha)) / ld;
    let delta = Math.atan(kpp * WHEELBASE);
    const va = Math.max(Math.abs(v), 3);
    delta += Math.atan((0.55 * kE * eLat) / (va + 2));
    delta -= 0.1 * (car.angularVelocity.y - v * kpp) * smoothstep(3, 10, va);
    // Never ask for more lock than the tyres can use at this speed: past the peak slip angle extra steering only
    // deepens the understeer, and the pursuit term would otherwise wind up to full lock on a saturated front axle.
    const kMax = (1.25 * latAccel(va)) / (va * va);
    const dMax = Math.atan(kMax * WHEELBASE) + 0.08;
    delta = clamp(delta, -dMax, dMax);
    if (v < -0.3) delta = -delta;
    const cmd = clamp(delta / MAX_STEER, -1, 1);
    this.steer = damp(this.steer, cmd, 22, dt);
    this.input.steer = this.steer;
  }

  private speedControl(car: CarState, dt: number, vTarget: number, aReq: number, gripMul: number, launchTh: number, thCap = 1): void {
    const inp = this.input;
    const v = car.speed;
    const va = Math.abs(v);
    const aCap = brakeAccel(Math.max(va, 4), gripMul) * 0.97;
    const hold = va > 2 ? clamp(dragAccel(va) / Math.max(0.5, driveAccel(va, 1) + dragAccel(va)), 0, 1) : 0;
    let th: number;
    let br: number;
    if (aReq > 0.35) {
      br = clamp(aReq / aCap, 0, 1);
      th = 0;
    } else {
      const err = vTarget - v;
      th = clamp(hold + err * 0.15 - Math.max(0, aReq) * 0.4, 0, 1);
      br = err < -1.5 ? clamp((-err - 1.5) * 0.12, 0, 0.4) : 0;
      if (vTarget < 0.05 && va < 0.6) {
        th = 0;
        br = 1;
      }
    }
    if (launchTh > 0 && aReq <= 0.35) th = Math.max(th, launchTh);

    const w = car.wheels;
    // Longitudinal slip ratio only (peak ≈ 0.1): the combined `slip` saturates laterally mid-corner and must not cut power.
    const rs = Math.max(w[2].slipRatio, w[3].slipRatio) / 0.1;
    if (rs > 1.3 && th > 0.1) this.tc = Math.max(0.2, this.tc - (rs - 1.3) * 5 * dt);
    else this.tc = Math.min(1, this.tc + 1.2 * dt);
    const aLatMeasured = Math.max(Math.abs(car.localAccel.x), va * Math.abs(car.angularVelocity.y));
    const latUse = aLatMeasured / Math.max(1, latAccel(va, gripMul));
    const cap = hold + (1 - hold) * clamp(1.3 - latUse * 1.2, 0.05, 1);
    th = Math.min(th * this.tc, cap, launchTh > 0 ? 1 : thCap);

    if (br > 0.2 && (w[0].locked || w[1].locked || w[0].slipRatio < -0.2 || w[1].slipRatio < -0.2)) this.abs = Math.max(0.4, this.abs - 4 * dt);
    else this.abs = Math.min(1, this.abs + 1.5 * dt);
    br *= this.abs;
    (globalThis as any).__dbg = { aReq, aCap, brRaw: br / Math.max(this.abs, 1e-3), abs: this.abs, sr: w.map((x) => x.slipRatio), vT: vTarget, v: va, hold, latUse, thCap, tc: this.tc };
    if (this.mistake === 'lockup' && br > 0.3) br = 1;

    this.throttle = damp(this.throttle, th, 14, dt);
    this.brake = damp(this.brake, br, 20, dt);
    inp.throttle = this.throttle;
    inp.brake = this.brake;
  }

  private updateGripTrim(car: CarState, dt: number, s: number, v: number, offTrack: boolean): void {
    const k = Math.abs(this.ctx.line.kappaAt(s));
    if (k < 0.003 || Math.abs(v) < 15 || offTrack) return;
    const fs = (car.wheels[0].slip + car.wheels[1].slip) * 0.5;
    if (fs > 1.2 || car.track.wheelsOff >= 2) this.gripTrim = Math.max(0.78, this.gripTrim - 0.2 * dt);
    else if (fs < 0.9) this.gripTrim = Math.min(1, this.gripTrim + 0.006 * dt);
  }

  private updateNoise(dt: number): void {
    const th = 0.12;
    const m = this.model;
    const sq = Math.sqrt(2 * th * dt);
    this.speedNoise = clamp(this.speedNoise - th * this.speedNoise * dt + m.speedNoiseStd * sq * this.rng.gaussian(), -0.04, 0.04);
    this.brakeNoise = clamp(this.brakeNoise - th * this.brakeNoise * dt + m.brakeNoiseStd * sq * this.rng.gaussian(), -15, 15);
  }

  /* ───────────────────────────── recovery ───────────────────────────── */

  private updateRecovery(world: World, car: CarState, dt: number, s: number, lat: number, v: number, heading: number, headingErr: number, lineLat: number): boolean {
    const ahe = Math.abs(headingErr);
    const spun = ahe > 1.35 || (ahe > 0.75 && Math.abs(v) < 6 && !car.chassis.held);
    if (!this.recovering) {
      if (spun && !car.chassis.held && this.startState === 'running') this.recovering = true;
      else return false;
    }
    if (ahe < 0.3 && v > 2 && car.track.wheelsOff < 3) {
      this.recovering = false;
      this.offset = lat - lineLat;
      this.offsetTarget = 0;
      this.craft = 'line';
      return false;
    }
    const inp = this.input;
    const track = world.track;
    const sA = s + 14;
    track.sample(sA, _smA);
    const hwA = _smA.width * 0.5 - 1;
    const latA = clamp(this.ctx.line.lateralAt(sA), -hwA, hwA);
    const tx = _smA.position.x + _smA.left.x * latA;
    const tz = _smA.position.z + _smA.left.z * latA;
    const alpha = angleDelta(heading, Math.atan2(tx - car.position.x, tz - car.position.z));
    let th = 0;
    let br = 0;
    if (Math.abs(v) > 8 || v < -0.3) {
      br = 1;
      this.steer = damp(this.steer, 0, 8, dt);
    } else {
      // Beached in gravel: full lock just ploughs, so straighten up and feed the power in gently.
      const beached = car.track.wheelsOff >= 3 && Math.abs(v) < 3;
      this.steer = damp(this.steer, clamp(alpha * 1.6, -1, 1) * (beached ? 0.45 : 1), 12, dt);
      const nb = this.nb;
      const wait = nb.behindId >= 0 && nb.behindDs < 40 && nb.behindSpeed > 8 && ahe > 0.6;
      if (wait) br = 0.7;
      else th = beached ? 0.16 : v < 6 ? 0.28 : 0.1;
    }
    inp.steer = this.steer;
    this.throttle = damp(this.throttle, th, 14, dt);
    this.brake = damp(this.brake, br, 20, dt);
    inp.throttle = this.throttle;
    inp.brake = this.brake;
    inp.drs = false;
    inp.ersMode = 'harvest';
    inp.pitLimiter = false;
    return true;
  }

  /* ───────────────────────────── racecraft ───────────────────────────── */

  private decide(
    world: World,
    car: CarState,
    entry: RaceEntry | undefined,
    s: number,
    v: number,
    hw: number,
    lineLat: number,
    noRacing: boolean,
    finished: boolean,
    retired: boolean,
    lap1: boolean,
    isRace: boolean,
    mult: number,
    gripSpeed: number,
  ): void {
    const nb = this.nb;
    const line = this.ctx.line;
    const m = this.model;
    const rng = this.rng;
    const cars = world.cars;
    const track = world.track;
    this.craftTimer += 0.1;
    const maxLat = hw - 1.0;

    if (retired) {
      this.craft = 'yield';
      this.offsetTarget = (lineLat >= 0 ? -1 : 1) * (hw - 1.4) - lineLat;
      return;
    }
    if (finished) {
      this.craft = 'yield';
      this.offsetTarget = 1.8 * Math.sin(0.8 * this.time);
      return;
    }
    if (entry && entry.blueFlag) {
      // Move to the outside of the next corner, unless the leader has already committed to that side: then swap
      // (only while it is still clearly behind, never once alongside).
      const leaderSide = nb.behindId >= 0 && nb.behindDs < 40 && Math.abs(nb.behindDlat) > 3 ? (nb.behindDlat > 0 ? 1 : -1) : 0;
      if (this.craft !== 'blue') {
        this.craft = 'blue';
        this.craftTimer = 0;
        const kNext = line.cornerDirectionAfter(s);
        this.craftSide = leaderSide !== 0 ? -leaderSide : kNext !== 0 ? (kNext > 0 ? -1 : 1) : 1;
      } else if (leaderSide === this.craftSide && nb.behindDs > 10 && this.craftTimer < 1.5) this.craftSide = -leaderSide;
      // Through twisty sections just hold the line (the leader waits); move fully aside once the road opens up.
      this.blueOpen = line.maxKappaWithin(s, 90) < PASS_KAPPA;
      this.offsetTarget = this.blueOpen ? this.craftSide * (hw - 2.0) - lineLat : 0;
      return;
    }
    if (this.craft === 'blue') this.craft = 'line';

    const aheadEntry = nb.aheadId >= 0 ? world.race.entryByCar[nb.aheadId] : undefined;
    const aheadBlue = !!aheadEntry && aheadEntry.blueFlag && nb.aheadDs < 60 && line.maxKappaWithin(s, 90) < PASS_KAPPA;

    if (!isRace) {
      const yieldNow = this.qualiMode !== 'push' && nb.behindId >= 0 && nb.behindDs < 80 && nb.behindSpeed > v + 2;
      if (yieldNow) {
        if (this.craft !== 'yield') {
          this.craft = 'yield';
          this.craftSide = nb.behindDlat >= 0 ? -1 : 1;
        }
        this.offsetTarget = this.craftSide * (hw - 1.8) - lineLat;
        return;
      }
    }
    if (this.craft === 'yield') this.craft = 'line';

    if (this.craft === 'attack') {
      const t = cars[this.craftTarget];
      if (!t) {
        this.craft = 'line';
        this.offsetTarget = 0;
        return;
      }
      const ds = track.deltaS(s, t.track.s);
      const done = ds < -(CAR_LENGTH + 1.5);
      const lost = ds > 45 || (this.craftTimer > 7 && ds > 12) || noRacing;
      const dBrake = line.nextBrakingDistance(s, 80);
      const tEntry = world.race.entryByCar[t.id];
      const tBlue = !!tEntry && tEntry.blueFlag;
      if (tBlue && ds > 4 && line.maxKappaWithin(s, 60) >= PASS_KAPPA) {
        this.craft = 'line';
        this.offsetTarget = 0;
        return;
      }
      const tooLate = !tBlue && dBrake >= 0 && dBrake < 20 + v * 0.25 && ds > CAR_LENGTH * (0.5 + 0.7 * m.aggression) && ds > 3;
      if (done || lost || tooLate) {
        this.craft = 'line';
        this.offsetTarget = 0;
        return;
      }
      let side = this.craftSide;
      const passOff = tBlue ? PASS_OFFSET : ATTACK_OFFSET;
      if (Math.abs(t.track.lateral + side * ATTACK_OFFSET) > maxLat) {
        if (Math.abs(t.track.lateral - side * ATTACK_OFFSET) <= maxLat && ds > 6) side = -side;
        else if (ds > 4) {
          this.craft = 'line';
          this.offsetTarget = 0;
          return;
        }
      }
      this.craftSide = side;
      this.offsetTarget = clamp(t.track.lateral + side * passOff, -maxLat, maxLat) - lineLat;
      return;
    }

    if (this.craft === 'defend') {
      const stuck = nb.aheadId >= 0 && nb.aheadDs < 30 && (aheadBlue || nb.aheadSpeed < line.targetAt(s + 10, mult, gripSpeed) - 6);
      if (track.distanceForward(this.craftEndS, s) < track.length * 0.5 || noRacing || stuck) this.craft = 'line';
      else {
        this.offsetTarget = this.craftSide * (hw - 2.0) - lineLat;
        return;
      }
    }

    if (noRacing || (lap1 && car.track.lap <= 1 && s < 250)) {
      this.offsetTarget = 0;
      return;
    }

    if (nb.aheadId >= 0 && nb.aheadDs < 45 && (v > 15 || aheadBlue) && (isRace || this.qualiMode === 'push')) {
      const t = cars[nb.aheadId];
      const tPitting = !!aheadEntry && aheadEntry.pitPhase !== 'none' && aheadEntry.pitPhase !== 'requested';
      const myTarget = line.targetAt(s + 10, mult, gripSpeed);
      const slipstream = nb.aheadDs < 22 && Math.abs(line.kappaAt(s + 40)) < 0.003 && v > 40;
      const faster = myTarget > nb.aheadSpeed + 1.5 || car.drs.available || slipstream;
      const go = aheadBlue || rng.next() < m.attackProb * (car.drs.available ? 1.6 : 1) * lerp(0.6, 1.1, this.ctx.difficulty);
      if (faster && !tPitting && go) {
        const kNext = line.cornerDirectionAfter(s);
        const inside = kNext > 0 ? 1 : kNext < 0 ? -1 : rng.next() < 0.5 ? 1 : -1;
        const roomInside = inside > 0 ? maxLat - t.track.lateral : t.track.lateral + maxLat;
        const roomOutside = inside > 0 ? t.track.lateral + maxLat : maxLat - t.track.lateral;
        let side = 0;
        // A lapped car is moving over for us: simply take whichever side it leaves open.
        if (aheadBlue) side = roomInside >= roomOutside ? inside : -inside;
        else if (roomInside >= ATTACK_OFFSET) side = inside;
        else if (roomOutside >= ATTACK_OFFSET && m.aggression > 0.55) side = -inside;
        if (side !== 0) {
          this.craft = 'attack';
          this.craftSide = side;
          this.craftTarget = t.id;
          this.craftTimer = 0;
          this.offsetTarget = clamp(t.track.lateral + side * (aheadBlue ? PASS_OFFSET : ATTACK_OFFSET), -maxLat, maxLat) - lineLat;
          return;
        }
      }
    }

    if (isRace && nb.behindId >= 0 && nb.behindDs < Math.max(v, 10) * 1.0 + 4 && nb.behindSpeed > v - 1) {
      const dBrake = line.nextBrakingDistance(s, 240);
      if (dBrake > 30) {
        const sBrake = track.wrapS(s + dBrake);
        if (Math.abs(track.deltaS(this.defendedS, sBrake)) > 40) {
          this.defendedS = sBrake;
          if (rng.next() < m.defendProb) {
            const k = line.cornerDirectionAfter(sBrake);
            this.craft = 'defend';
            this.craftSide = k > 0 ? 1 : -1;
            this.craftEndS = track.wrapS(sBrake + 90);
            this.craftTimer = 0;
            this.offsetTarget = this.craftSide * (hw - 2.0) - lineLat;
            return;
          }
        }
      }
    }
    this.offsetTarget = 0;
  }

  private updateMistakes(dt: number, car: CarState, s: number, v: number, wet: number, pressure: boolean, difficulty: number, status: EntryStatus): void {
    if (this.mistake !== 'none') {
      this.mistakeTimer -= dt;
      if (this.mistakeTimer <= 0) this.mistake = 'none';
      return;
    }
    if (this.mistakeCooldown > 0) {
      this.mistakeCooldown -= dt;
      return;
    }
    if (v < 20 || status !== 'racing' || this.recovering) return;
    const m = this.model;
    const rate = m.mistakeRate * (1 + (pressure ? 1.5 : 0)) * (1 + 2 * Math.max(0, car.tyres.wear - 0.5)) * (1 + wet * (1.6 - m.wet)) * lerp(2.2, 0.7, difficulty);
    if (this.rng.next() >= rate * dt) return;
    const line = this.ctx.line;
    const dBrake = line.nextBrakingDistance(s, 90);
    if (dBrake >= 0) {
      if (dBrake < 15 && this.rng.next() < 0.4) {
        this.mistake = 'lockup';
        this.mistakeTimer = 0.5;
      } else {
        this.mistake = 'late';
        this.mistakeTimer = 2.2;
      }
    } else if (Math.abs(line.kappaAt(s + 20)) > 0.004) {
      this.mistake = 'wide';
      this.mistakeTimer = 2.5;
    } else return;
    this.mistakeCooldown = this.rng.range(8, 25);
  }

  private qualiPacing(car: CarState, race: RaceState, s: number, length: number): number {
    const lap = car.track.lap;
    if (lap !== this.qualiLap) {
      this.qualiLap = lap;
      this.qualiMode = lap <= 0 ? 'out' : lap % 2 === 1 ? 'push' : 'cool';
    }
    const tr = race.timeRemaining;
    if (this.qualiMode === 'cool' && tr >= 0 && tr < 120 && tr < (length - s) / 50 + 4) this.qualiMode = 'cruise';
    switch (this.qualiMode) {
      case 'out':
        return 0.86;
      case 'push':
        return 1;
      case 'cool':
        return 0.8;
      default:
        return 0.7;
    }
  }

  private chooseErs(car: CarState, yellow: boolean, cruising: boolean, isRace: boolean): ErsMode {
    const b = car.ers.battery;
    if (b < 0.12 || yellow || cruising) return 'harvest';
    if (!isRace) return this.qualiMode === 'push' ? (b > 0.15 ? 'overtake' : 'balanced') : 'harvest';
    if ((this.craft === 'attack' || this.craft === 'defend' || car.drs.available) && b > 0.2) return 'overtake';
    return 'balanced';
  }

  /* ───────────────────────────── strategy & pits ───────────────────────────── */

  private updateStrategy(world: World, car: CarState, entry: RaceEntry | undefined): void {
    const race = world.race;
    if (!entry || race.sessionType !== 'race' || this.pitWanted) return;
    const phase = race.phase;
    if (phase !== 'racing' && phase !== 'safety-car' && phase !== 'vsc') return;
    if (entry.status !== 'racing') return;
    const lap = car.track.lap;
    if (lap === this.lastPitLap) return;
    const lapsAfter = race.totalLaps - lap;
    if (lapsAfter < 1) return;
    const wear = car.tyres.wear;
    const age = car.tyres.age;
    const comp = car.tyres.compound;
    const wet = world.env.weather.wetness;
    const slick = isSlick(comp);
    const wearPerLap = age > 0 ? wear / age : TYRE_DATA[comp].wearRate * 0.06;
    let want = false;
    let next: TyreCompound | null = null;
    if (slick && wet > 0.45) {
      want = true;
      next = wet > 0.75 ? 'wet' : 'intermediate';
    } else if (comp === 'intermediate' && wet > 0.85) {
      want = true;
      next = 'wet';
    } else if (comp === 'wet' && wet < 0.5 && wet >= 0.25) {
      want = true;
      next = 'intermediate';
    } else if (!slick && wet < 0.25) {
      want = true;
      next = this.dryChoice(lapsAfter, wearPerLap, comp);
    } else if (slick) {
      const threshold = 0.62 + this.model.pitBias;
      if (wear > 0.9) want = true;
      else if (lapsAfter >= 2) {
        if (wear > threshold) want = true;
        else if (lapsAfter > 3 && wear > 0.3 && wear + wearPerLap * lapsAfter > 0.98) want = true;
      }
      if (want) next = this.dryChoice(lapsAfter, wearPerLap, comp);
    }
    if (!want) return;
    this.pitWanted = true;
    this.pitSeen = false;
    this.pitCompound = next;
    this.input.pitRequest = true;
    this.input.pitCompound = next;
  }

  /** Softest dry compound expected to survive `laps` with ≤ 85 % wear. */
  private dryChoice(laps: number, wearPerLap: number, current: TyreCompound): TyreCompound {
    const unit = wearPerLap / TYRE_DATA[current].wearRate;
    if (unit * TYRE_DATA.soft.wearRate * laps < 0.85) return 'soft';
    if (unit * TYRE_DATA.medium.wearRate * laps < 0.85) return 'medium';
    return 'hard';
  }

  private updatePitHandshake(car: CarState, pitPhase: PitPhase): void {
    const inp = this.input;
    if (!this.pitWanted) {
      inp.pitRequest = false;
      inp.pitCompound = null;
      return;
    }
    inp.pitRequest = true;
    inp.pitCompound = this.pitCompound;
    if (pitPhase !== 'none') this.pitSeen = true;
    if (this.pitSeen && pitPhase === 'none' && !car.track.inPitLane && !this.inPit) this.clearPitRequest(car);
  }

  private clearPitRequest(car: CarState): void {
    this.pitWanted = false;
    this.pitSeen = false;
    this.pitCompound = null;
    this.input.pitRequest = false;
    this.input.pitCompound = null;
    this.lastPitLap = car.track.lap;
  }

  private updatePitMode(car: CarState, track: TrackSpline, pitPhase: PitPhase, pitD: number, distToEntry: number, forcePit: boolean, lat: number, lineLat: number): void {
    const pl = track.pitLane;
    const inLane = car.track.inPitLane;
    const active = pitPhase === 'entering' || pitPhase === 'in-lane' || pitPhase === 'stopped' || pitPhase === 'released' || pitPhase === 'exiting';
    if (!this.inPit) {
      let enter = forcePit || active || inLane;
      if (!enter && (this.pitWanted || pitPhase === 'requested') && car.track.lap !== this.lastPitLap) enter = distToEntry < 260 || (pitD >= 0 && pitD < 25);
      if (enter) {
        this.inPit = true;
        this.wasInLane = inLane;
        this.stopDone = pitPhase === 'released' || pitPhase === 'exiting';
        this.stopWait = 0;
        this.pitOffset = lat - lineLat;
        this.craft = 'line';
      }
      return;
    }
    if (inLane) this.wasInLane = true;
    if (forcePit) return;
    let leave = false;
    if (pitD < 0 && !inLane && !active) {
      if (distToEntry > 300 || this.wasInLane) leave = true;
    } else if (pitD > pl.transition && !inLane && !active && !this.wasInLane) {
      leave = true;
      this.lastPitLap = car.track.lap;
    } else if (this.wasInLane && !inLane && !active && pitD > pl.length - pl.transition * 0.5) {
      leave = true;
    }
    if (leave) {
      this.inPit = false;
      this.offset = lat - lineLat;
      this.offsetTarget = 0;
      this.craft = 'line';
      if (this.wasInLane && this.pitWanted) this.clearPitRequest(car);
      this.wasInLane = false;
      this.stopDone = false;
    }
  }

  private drivePit(
    world: World,
    car: CarState,
    dt: number,
    forcePit: boolean,
    s: number,
    lat: number,
    v: number,
    heading: number,
    hw: number,
    lineLat: number,
    pitPhase: PitPhase,
    pitD: number,
    distToEntry: number,
  ): void {
    const track = world.track;
    const pl = track.pitLane;
    const side = pl.side;
    const inp = this.input;
    const line = this.ctx.line;
    const L = clamp(5 + 0.3 * Math.abs(v), 6, 12);
    let tx: number;
    let tz: number;
    let eLat: number;
    let vCap = V_TOP;
    let aReq = 0;
    let limiter = false;
    let stopping = false;

    // Corner awareness for the approach and the exit (both on the pit straight).
    for (let k = 0; k < HORIZON.length; k++) {
      const d = HORIZON[k];
      const vt = line.targetAt(s + d, 1, 0.95);
      if (k === 0) vCap = Math.min(vCap, vt);
      const a = (v * v - vt * vt) / (2 * d);
      if (a > aReq) aReq = a;
    }

    if (pitD < 0) {
      this.pitOffset = damp(this.pitOffset, 0, 1.5, dt);
      const edge = side * (hw - 1.2);
      const t = smoothstep(0, 1, 1 - distToEntry / 240);
      eLat = lerp(lineLat + this.pitOffset, edge, t) - lat;
      const sA = s + L;
      track.sample(sA, _smA);
      const tA = smoothstep(0, 1, 1 - (distToEntry - L) / 240);
      const latA = lerp(line.lateralAt(sA) + this.pitOffset, side * (_smA.width * 0.5 - 1.2), tA);
      tx = _smA.position.x + _smA.left.x * latA;
      tz = _smA.position.z + _smA.left.z * latA;
      const dLimit = Math.max(0, distToEntry + pl.limitStartD - 6);
      const vCurve = Math.sqrt(PIT_V * PIT_V + 2 * PIT_APPROACH_DECEL * dLimit);
      vCap = Math.min(vCap, vCurve);
      if (v > vCurve) aReq = Math.max(aReq, PIT_APPROACH_DECEL + (v - vCurve) * 1.5);
      limiter = distToEntry < 25 && v < PIT_V + 3;
    } else {
      if (pitPhase === 'released' || pitPhase === 'exiting') this.stopDone = true;
      const mustStop = forcePit ? pitPhase === 'entering' || pitPhase === 'in-lane' || pitPhase === 'stopped' : !this.stopDone;
      const dBox = track.deltaS(s, this.boxS);
      // Boxes sit on the lane centreline, so drive the track-side "fast lane" and only move to the centre for my box.
      let fast = smoothstep(pl.transition - 10, pl.transition + 30, pitD) * (1 - smoothstep(pl.length - pl.transition - 40, pl.length - pl.transition, pitD));
      fast *= mustStop ? smoothstep(10, 60, dBox) : smoothstep(4, 22, -dBox);
      const laneOff = -side * FAST_LANE_OFFSET * fast;
      const ahead = track.pitLaneSample(s + L, _pls);
      track.sample(s + L, _smA);
      tx = ahead.position.x + _smA.left.x * laneOff;
      tz = ahead.position.z + _smA.left.z * laneOff;
      eLat = track.pitLaneSample(s, _pls2).lateral + laneOff - lat;
      if (pitD < pl.limitStartD) {
        const vCurve = Math.sqrt(PIT_V * PIT_V + 2 * PIT_APPROACH_DECEL * Math.max(0, pl.limitStartD - pitD - 6));
        vCap = Math.min(vCap, vCurve);
        if (v > vCurve) aReq = Math.max(aReq, PIT_APPROACH_DECEL + (v - vCurve) * 1.5);
      }
      if (pitD <= pl.limitEndD) vCap = Math.min(vCap, PIT_V);
      limiter = pitD < pl.limitEndD && v < PIT_V + 3;
      if (mustStop) {
        if (pitPhase === 'stopped') stopping = true;
        else if (dBox > -0.8) {
          const stopD = Math.max(0, dBox - 0.15);
          let vStop = Math.sqrt(2 * 2.4 * stopD);
          if (stopD < 3) vStop = Math.min(vStop, Math.max(0.8 * stopD, stopD > 0.3 ? 0.7 : 0));
          vCap = Math.min(vCap, vStop);
          aReq = Math.max(aReq, (v * v - vStop * vStop) / (2 * Math.max(stopD, 0.25)));
          if (stopD <= 0.05 || (Math.abs(v) < 0.35 && stopD < 0.5)) stopping = true;
        } else stopping = true;
        if (stopping && Math.abs(v) < 0.3) {
          this.stopWait += dt;
          if (!forcePit && this.stopWait > 14) this.stopDone = true;
        }
      }
    }

    const nb = this.nb;
    if (nb.aheadId >= 0 && nb.aheadDs < 60) {
      const vA = Math.max(0, nb.aheadSpeed);
      const dMin = CAR_LENGTH + 1.5 + 0.3 * vA;
      const vDes = Math.max(0, vA + 0.8 * (nb.aheadDs - dMin));
      if (vDes < vCap) vCap = vDes;
      if (v > vDes) aReq = Math.max(aReq, (v - vDes) * 2.5);
      const free = Math.max(0.5, nb.aheadDs - CAR_LENGTH - 1);
      if (v > vA) aReq = Math.max(aReq, ((v - vA) * (v - vA)) / (2 * free));
    }

    this.steerToward(car, dt, tx, tz, eLat, v, heading, 0.8);
    if (stopping) {
      this.throttle = 0;
      this.brake = damp(this.brake, 1, 25, dt);
      inp.throttle = 0;
      inp.brake = this.brake;
    } else {
      if (v > vCap + 0.3) aReq = Math.max(aReq, Math.min(4, (v - vCap) * 0.8));
      this.speedControl(car, dt, vCap, aReq, 1, 0);
    }
    inp.pitLimiter = limiter || pitPhase === 'stopped';
    inp.drs = false;
    inp.ersMode = 'harvest';
  }
}
