/**
 * Per-car simulation: input processing & assists, powertrain, suspension, tyres, aero, integration and bookkeeping.
 * Split into three phases called by VehiclePhysics: prepareCar (once per step), substepCar (SUBSTEPS × per step),
 * finishCar (once per step). No allocations in any of them.
 */
import * as THREE from 'three';
import { CAR, DRS, GRAVITY, TYRE_DATA, WHEEL_LOCAL_POSITIONS } from '../core/constants';
import { events } from '../core/events';
import { TAU, clamp, clamp01, lerp, smoothstep } from '../core/math';
import type { TrackProjection, TrackSample, TrackSpline } from '../core/track/TrackSpline';
import type { PhysCar } from './PhysCar';
import { GEAR_RATIOS, RADS_TO_RPM, engineBrakeTorque, engineTorque, ratioFor } from './Powertrain';
import {
  MF_SLOPE0,
  SURFACE_GRIP,
  SURFACE_ROLL,
  SURFACE_ROLL_V,
  SURFACE_WEAR,
  aquaplaneFactor,
  compoundHeatMult,
  compoundWearMult,
  compoundWetGrip,
  isRacingSurface,
  magicFormula,
  tempFactor,
  wearFactor,
} from './Tyres';
import { AERO, BRAKES, COM_HEIGHT, COM_Z, ENGINE, ERS, MISC, STEER, SUSP, TYRE } from './tuning';

export interface SimContext {
  track: TrackSpline;
  wetness: number;
  trackTemp: number;
  time: number;
  /** Race phase forces every car to stay frozen (formation / lights). */
  phaseFrozen: boolean;
  fuelFloor: number;
}

export const makeScratchSample = (): TrackSample => ({
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

const _sample = makeScratchSample();
const _proj: TrackProjection = { s: 0, lateral: 0, distance: 0 };
const _o = new THREE.Vector3();
const _p = new THREE.Vector3();
const _r = new THREE.Vector3();
const _vp = new THREE.Vector3();
const _f = new THREE.Vector3();
const _a = new THREE.Vector3();
const _tl = new THREE.Vector3();
const _wl = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _fdir = new THREE.Vector3();

/**
 * Exact centre projection, cached as a local track frame (tangent/left/curvature at s). `track.project` allocates a
 * closure per call, so it is done once per car per step; wheels and body corners are then mapped through
 * `frameCoords`, a curvature-corrected linearisation that is accurate to a few cm within one car length.
 */
export function refreshFrame(car: PhysCar, track: TrackSpline, p: THREE.Vector3): void {
  const x = p.x;
  const z = p.z;
  track.project(x, z, car.hintS, _proj);
  track.sample(_proj.s, _sample);
  const tx = _sample.tangent.x;
  const tz = _sample.tangent.z;
  const inv = 1 / (Math.sqrt(tx * tx + tz * tz) || 1);
  car.frameX = x;
  car.frameZ = z;
  car.frameS = _proj.s;
  car.frameLat = _proj.lateral;
  car.frameK = _sample.curvature;
  car.frameTx = tx * inv;
  car.frameTz = tz * inv;
  car.frameLx = _sample.left.x;
  car.frameLz = _sample.left.z;
  car.hintS = _proj.s;
  car.frameValid = true;
}

export function frameCoords(car: PhysCar, track: TrackSpline, p: THREE.Vector3, out: TrackProjection): void {
  const dx = p.x - car.frameX;
  const dz = p.z - car.frameZ;
  const along = dx * car.frameTx + dz * car.frameTz;
  const across = dx * car.frameLx + dz * car.frameLz;
  const k = car.frameK;
  const lateral = car.frameLat + across - 0.5 * k * along * along;
  const scale = 1 - k * lateral;
  let s = car.frameS + along / (scale > 0.25 ? scale : 0.25);
  const L = track.length;
  if (s >= L) s -= L;
  else if (s < 0) s += L;
  out.s = s;
  out.lateral = lateral;
  out.distance = Math.abs(lateral);
}

const FLOOR_CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0.75, 1.9, 0],
  [-0.75, 1.9, 1],
  [0.75, -1.9, 2],
  [-0.75, -1.9, 3],
];

export const updateAxes = (car: PhysCar): void => {
  const q = car.state.quaternion;
  car.fwd.set(0, 0, 1).applyQuaternion(q);
  car.left.set(1, 0, 0).applyQuaternion(q);
  car.up.set(0, 1, 0).applyQuaternion(q);
};

/** World position of the car origin (centre of wheelbase on the ground plane) from the centre of mass. */
export const originOf = (car: PhysCar, out: THREE.Vector3): THREE.Vector3 =>
  out.copy(car.com).addScaledVector(car.up, -COM_HEIGHT).addScaledVector(car.fwd, -COM_Z);

const approachRpm = (rpm: number, target: number, h: number): number =>
  target > rpm ? Math.min(target, rpm + ENGINE.revUpRate * h) : Math.max(target, rpm - ENGINE.revDownRate * h);

/** Engine spinning freely (neutral / held on the grid): rpm follows the throttle and bounces on the limiter. */
const freeRev = (car: PhysCar, h: number): void => {
  const eng = car.state.engine;
  const throttle = car.throttleEff;
  const target = ENGINE.idle + throttle * (ENGINE.limiter + 400 - ENGINE.idle);
  let rpm = approachRpm(eng.rpm, target, h);
  let limiter = false;
  if (rpm > ENGINE.limiter) {
    rpm = ENGINE.limiter - 350;
    limiter = true;
  }
  eng.rpm = rpm;
  eng.limiter = limiter || (throttle > 0.5 && rpm > ENGINE.limiter - 400);
  eng.powerKw = 0;
};

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * prepare: once per step
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export function prepareCar(car: PhysCar, ctx: SimContext, dt: number): void {
  const st = car.state;
  const input = st.input;
  const assists = car.assists;
  const track = ctx.track;
  const eng = st.engine;

  st.collision.active = false;
  st.collision.impulse = 0;
  if (car.ghostTimer > 0) car.ghostTimer = Math.max(0, car.ghostTimer - dt);
  if (car.bottomingCooldown > 0) car.bottomingCooldown -= dt;
  car.frozen = st.chassis.held || ctx.phaseFrozen || car.parked;
  car.setMass(st.fuel);
  updateAxes(car);

  const speedAbs = st.speedAbs;
  const racing = st.status === 'racing' || st.status === 'finished';

  /* ── steering ── */
  const lock = assists.steeringAssist ? lerp(STEER.lockRest, STEER.lockHighSpeed, smoothstep(0, 300 / 3.6, speedAbs)) : STEER.lockFixed;
  car.steerLock = lock;
  let target = clamp(input.steer, -1, 1) * lock;
  if (assists.steeringAssist && speedAbs > 8) {
    const rearSlip = 0.5 * (st.wheels[2].slipAngle + st.wheels[3].slipAngle);
    const excess = Math.abs(rearSlip) - STEER.counterSteerDeadband;
    if (excess > 0) target += clamp(Math.sign(rearSlip) * excess * STEER.counterSteerGain, -0.12, 0.12);
  }
  const dmg = st.damage.suspension;
  target += 0.03 * (dmg[0] + dmg[2] - dmg[1] - dmg[3]) * clamp01(speedAbs / 20);
  target = clamp(target, -STEER.lockRest, STEER.lockRest);
  const maxDelta = STEER.rate * dt;
  car.steer += clamp(target - car.steer, -maxDelta, maxDelta);
  eng.steer = clamp(car.steer / lock, -1, 1);
  const d = car.steer;
  if (Math.abs(d) > 1e-4) {
    const R = CAR.wheelbase / Math.tan(Math.abs(d));
    const tw = CAR.frontTrackHalf * 2;
    const inner = Math.atan(CAR.wheelbase / Math.max(0.5, R - tw / 2));
    const outer = Math.atan(CAR.wheelbase / (R + tw / 2));
    const ai = lerp(Math.abs(d), inner, STEER.ackermann);
    const ao = lerp(Math.abs(d), outer, STEER.ackermann);
    if (d > 0) {
      car.wheelSteer[0] = ai;
      car.wheelSteer[1] = ao;
    } else {
      car.wheelSteer[0] = -ao;
      car.wheelSteer[1] = -ai;
    }
  } else {
    car.wheelSteer[0] = d;
    car.wheelSteer[1] = d;
  }
  st.wheels[0].steerAngle = car.wheelSteer[0];
  st.wheels[1].steerAngle = car.wheelSteer[1];

  /* ── pedals & assists ── */
  let throttle = clamp01(input.throttle);
  let brake = clamp01(input.brake);
  if (!racing) {
    throttle = 0;
    brake = speedAbs > 0.3 ? Math.max(brake, 0.25) : 1;
    if (speedAbs < 0.3 && !car.parked) {
      car.parked = true;
      car.frozen = true;
      st.velocity.set(0, 0, 0);
      st.angularVelocity.set(0, 0, 0);
    }
  }
  if (input.pitLimiter && !car.frozen) {
    const lim = CAR.pitSpeedLimit;
    const v = st.speed;
    if (v > lim - 0.2) {
      throttle = 0;
      if (v > lim + 0.3) brake = Math.max(brake, Math.min(0.35, (v - lim) * 0.25));
    } else {
      throttle = Math.min(throttle, clamp((lim - v) * 1.0, 0.15, 1));
    }
  }
  if (assists.brakingAssist && !car.frozen && st.track.forwardSpeed > 12) {
    const v = st.track.forwardSpeed;
    const aB = 28 + 0.2 * v;
    let vAllow = 1e9;
    for (let dd = 0; dd <= 160; dd += 10) {
      const vc = track.cornerSpeed(st.track.s + dd, 3.6);
      const va = Math.sqrt(vc * vc + 2 * aB * dd);
      if (va < vAllow) vAllow = va;
    }
    if (v > vAllow + 0.5) {
      brake = Math.max(brake, clamp((v - vAllow) * 0.5, 0.25, 1));
      throttle = 0;
    }
  }
  if (car.fuelEmpty || car.failed) throttle = 0;
  if (assists.tractionControl !== 'off') throttle *= car.tcFactor;
  else car.tcFactor = 1;
  car.throttleEff = throttle;
  eng.throttle = throttle;
  eng.brake = brake;

  /* ── gearbox ── */
  if (car.shiftTimer > 0) car.shiftTimer -= dt;
  if (car.autoShiftTimer > 0) car.autoShiftTimer -= dt;
  const gear = eng.gear;
  const rpm = eng.rpm;
  // Shift decisions use the rpm implied by road speed so spinning or locked wheels don't trigger shifts.
  const rpmRoad = gear > 0 ? (speedAbs / CAR.wheelRadius) * GEAR_RATIOS[gear - 1] * RADS_TO_RPM : rpm;
  const auto = assists.autoGears;
  const stopped = speedAbs < 0.4;
  if (stopped && brake > 0.5 && throttle < 0.1 && !car.frozen) car.brakeHold += dt;
  else car.brakeHold = 0;
  if (brake < 0.3) car.reverseLatch = false;
  let newGear = gear;
  // Brake-hold reverse is a player convenience only: an AI car braking behind a stopped car would otherwise toggle
  // into reverse after 0.8 s and back into the queue.
  if (car.brakeHold > 0.8 && !car.reverseLatch && st.isPlayer) {
    car.reverseLatch = true;
    newGear = gear === -1 ? (auto ? 1 : 0) : -1;
  } else if (!auto) {
    if (input.gearUp && gear < CAR.gears && car.shiftTimer <= 0) newGear = gear + 1;
    else if (input.gearDown && car.shiftTimer <= 0) {
      if (gear > 1) {
        if ((rpmRoad * GEAR_RATIOS[gear - 2]) / GEAR_RATIOS[gear - 1] < 15200) newGear = gear - 1;
      } else if (gear === 1) newGear = 0;
      else if (gear === 0 && speedAbs < 1) newGear = -1;
    }
  } else {
    if (gear === 0 && throttle > 0.05) newGear = 1;
    else if (gear > 0 && car.shiftTimer <= 0 && car.autoShiftTimer <= 0) {
      if (rpmRoad > ENGINE.autoUpRpm && gear < CAR.gears && throttle > 0.05) newGear = gear + 1;
      else if (gear > 1) {
        const rpmAfter = (rpmRoad * GEAR_RATIOS[gear - 2]) / GEAR_RATIOS[gear - 1];
        if (rpmRoad < ENGINE.autoDownRpm || (throttle > 0.9 && rpmRoad < ENGINE.kickdownRpm && rpmAfter < ENGINE.kickdownMaxRpm)) newGear = gear - 1;
      }
    }
  }
  if (newGear !== gear) {
    eng.gear = newGear;
    car.shiftTimer = ENGINE.shiftTime;
    car.autoShiftTimer = ENGINE.autoHold;
    events.emit('car:gear', { carId: st.id, gear: newGear, up: newGear > gear });
  }

  /* ── DRS ── */
  const drs = st.drs;
  let open = drs.open;
  if (!drs.available || brake > 0.2) open = false;
  else if (input.drs || assists.drsAssist) open = true;
  if (open !== drs.open) {
    drs.open = open;
    events.emit('car:drs', { carId: st.id, open });
  }

  /* ── ERS ── */
  const ers = st.ers;
  const mode = assists.ersAssist ? 'balanced' : input.ersMode;
  ers.mode = mode;
  const speed = st.speed;
  const moving = speed > 5 && eng.gear > 0 && !car.frozen;
  let deploy = false;
  if (moving) {
    if (mode === 'balanced') deploy = throttle > 0.9 && speed > ERS.balancedMinSpeed && ers.battery > ERS.balancedMinBattery;
    else if (mode === 'overtake') deploy = throttle > 0.5 && ers.battery > ERS.overtakeMinBattery;
    if (!deploy && assists.ersAssist && throttle > 0.7 && speed > 25 && ers.battery > 0.1) {
      deploy = Math.abs(track.sample(st.track.s, _sample).curvature) < 0.004;
    }
  }
  let harvestPower = 0;
  if (!car.frozen) {
    if (brake > 0.1 && speed > 8) harvestPower = ERS.harvestW * clamp01(brake * 2);
    else if (mode === 'harvest' && throttle < 0.1 && speed > 15) harvestPower = ERS.harvestW * 0.5;
  }
  if (ers.battery >= 1) harvestPower = 0;
  car.ersDeploy = deploy;
  car.ersHarvestPower = harvestPower;
  ers.deploying = deploy;
  ers.harvesting = harvestPower > 0;
  let energy = ers.battery * ERS.capacityJ;
  if (deploy) energy -= ERS.deployW * dt;
  energy += harvestPower * ERS.harvestEff * dt;
  if (throttle > 0.5 && rpm > 6000 && !car.frozen) energy += ERS.mguhW * dt;
  ers.battery = clamp01(energy / ERS.capacityJ);

  /* ── fuel & engine health ── */
  if (!car.frozen && throttle > 0) {
    st.fuel -= ENGINE.fuelRate * throttle * (0.6 + (0.4 * rpm) / ENGINE.limiter) * dt;
    if (st.fuel < ctx.fuelFloor) st.fuel = ctx.fuelFloor;
  }
  car.fuelEmpty = st.fuel <= 0;
  if (st.damage.total > 0.9 && eng.health > 0) {
    eng.health = Math.max(0, eng.health - 0.04 * dt);
    if (eng.health <= 0 && !car.failed) {
      car.failed = true;
      events.emit('car:engine-failure', { carId: st.id });
    }
  }

  /* ── ground under each wheel (using the pose at the start of the step) ── */
  const wet = ctx.wetness;
  const compound = st.tyres.compound;
  car.compoundGrip = compoundWetGrip(compound, wet);
  car.aquaF = aquaplaneFactor(compound, wet, speedAbs);
  car.heatMult = compoundHeatMult(compound, wet);
  car.wearMult = compoundWearMult(compound, wet);
  car.wet = wet;
  car.optimalTemp = TYRE_DATA[compound].optimalTemp;
  originOf(car, _o);
  if (!car.frameValid) refreshFrame(car, track, _o);
  let kerbWheels = 0;
  for (let i = 0; i < 4; i++) {
    if (wheelGround(car, i, track)) kerbWheels++;
  }
  car.kerbWheels = kerbWheels;
  car.minClearance = 1;
  car.slipPower.fill(0);
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * substep
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const computeDrive = (car: PhysCar, h: number): void => {
  const st = car.state;
  const eng = st.engine;
  const gear = eng.gear;
  const ratio = ratioFor(gear);
  const throttle = car.throttleEff;
  const wAxle = 0.5 * (car.wheelOmega[2] + car.wheelOmega[3]);
  car.reflectedInertia = 0.5 * ENGINE.inertia * ratio * ratio;
  let tAxle = 0;
  if (gear === 0) {
    freeRev(car, h);
  } else {
    const shiftFactor = car.shiftTimer > 0 ? 0 : 1;
    const rpmWheels = wAxle * ratio * RADS_TO_RPM;
    let rpm: number;
    if (rpmWheels < ENGINE.idle) {
      // Clutch slipping (launch / crawl): revs follow the throttle and blend into the wheel speed.
      const launch = ENGINE.idle + throttle * ENGINE.launchRevs;
      const target = Math.max(ENGINE.idle, rpmWheels, lerp(launch, rpmWheels, clamp01(rpmWheels / ENGINE.idle)));
      rpm = approachRpm(eng.rpm, target, h);
    } else {
      rpm = rpmWheels;
    }
    const limiter = rpm > ENGINE.limiter;
    const cut = limiter ? 0 : 1;
    const health = car.failed ? 0 : 1;
    const ebScale = clamp01(rpmWheels / ENGINE.idle);
    const tEng = (throttle * engineTorque(rpm) * car.powerFactor * cut * health - (1 - throttle) * engineBrakeTorque(rpm) * ebScale) * shiftFactor;
    tAxle = tEng * ratio * ENGINE.drivelineEff;
    const wAbs = Math.max(Math.abs(wAxle), 25);
    if (car.ersDeploy && shiftFactor > 0) tAxle += Math.sign(ratio) * Math.min(ERS.deployTorqueCap, ERS.deployW / wAbs);
    car.harvestTorque = car.ersHarvestPower > 0 && wAxle > 1 ? Math.min(1500, car.ersHarvestPower / wAbs) : 0;
    tAxle -= car.harvestTorque;
    eng.rpm = rpm;
    eng.limiter = limiter || (throttle > 0.5 && rpm > ENGINE.limiter - 150);
    eng.powerKw = Math.max(0, tAxle * wAxle) / 1000;
  }
  const td = ENGINE.diffLock * (car.wheelOmega[2] - car.wheelOmega[3]);
  car.driveTorque[0] = 0;
  car.driveTorque[1] = 0;
  car.driveTorque[2] = 0.5 * tAxle - td;
  car.driveTorque[3] = 0.5 * tAxle + td;
};

/** Ground height / normal / surface and the resulting grip factors under one wheel. Returns true on a kerb. */
function wheelGround(car: PhysCar, i: number, track: TrackSpline): boolean {
  const st = car.state;
  const wet = car.wet;
  const wl = WHEEL_LOCAL_POSITIONS[i];
  _p.copy(_o).addScaledVector(car.left, wl[0]).addScaledVector(car.fwd, wl[2]);
  frameCoords(car, track, _p, _proj);
  car.wheelS[i] = _proj.s;
  car.wheelLat[i] = _proj.lateral;
  const surf = track.surfaceAt(_proj.s, _proj.lateral);
  car.wheelSurface[i] = surf;
  const w = st.wheels[i];
  w.surface = surf;
  // Height / normal interpolated straight from the stored samples (track.sample() is call-heavy).
  const samples = track.samples;
  const count = samples.length;
  const kf = _proj.s / track.spacing;
  const kFloor = Math.floor(kf);
  const u = kf - kFloor;
  const a = samples[kFloor % count];
  const b = samples[(kFloor + 1) % count];
  let gy = a.position.y + (b.position.y - a.position.y) * u;
  const kerb = surf === 'kerb';
  if (kerb) gy += MISC.kerbHeight + MISC.kerbAmplitude * Math.sin(_proj.s * (TAU / MISC.kerbWavelength));
  else if (surf === 'gravel') gy -= MISC.gravelSink;
  car.groundY[i] = gy;
  const an = a.normal;
  const bn = b.normal;
  const gn = car.groundNormal[i];
  const gx = an.x + (bn.x - an.x) * u;
  const gyn = an.y + (bn.y - an.y) * u;
  const gz = an.z + (bn.z - an.z) * u;
  const gl = 1 / (Math.sqrt(gx * gx + gyn * gyn + gz * gz) || 1);
  gn.x = gx * gl;
  gn.y = gyn * gl;
  gn.z = gz * gl;
  wheelGrip(car, i);
  car.wheelRoll[i] = SURFACE_ROLL[surf] + 0.004 * wet;
  car.wheelRollV[i] = SURFACE_ROLL_V[surf];
  car.wheelWearMult[i] = SURFACE_WEAR[surf];
  return kerb;
}

/** Peak friction coefficient for one wheel (compound × wet × temp × wear × surface × damage). */
function wheelGrip(car: PhysCar, i: number): void {
  const st = car.state;
  const w = st.wheels[i];
  car.wheelMu[i] =
    TYRE.muPeak *
    TYRE.muAxle[i] *
    car.compoundGrip *
    car.aquaF *
    tempFactor(w.temp, car.optimalTemp) *
    wearFactor(w.wear) *
    SURFACE_GRIP[car.wheelSurface[i]] *
    (1 - 0.35 * st.damage.suspension[i]);
}

/**
 * Suspension + tyre for one wheel. Written with scalar maths on purpose: Three.js method chains are not inlined
 * inside a function this size and every non-inlined call taking/returning a double allocates a HeapNumber.
 * Expects `_o` = chassis origin and car axes up to date. Returns true if the wheel is in contact.
 */
function wheelSubstep(car: PhysCar, i: number): boolean {
  const st = car.state;
  const h = car.stepH;
  const upY = car.upY;
  const wheel = st.wheels[i];
  const v = st.velocity;
  const w = st.angularVelocity;
  const com = car.com;
  const fwd = car.fwd;
  const left = car.left;
  const up = car.up;
  const R = CAR.wheelRadius;
  const wl = WHEEL_LOCAL_POSITIONS[i];
  const n = car.groundNormal[i];
  const nx = n.x;
  const ny = n.y;
  const nz = n.z;
  const lx = wl[0];
  const lz = wl[2];
  // Hard-point at rest, then the wheel centre after travel t along the body up axis.
  const hx = _o.x + left.x * lx + fwd.x * lz;
  const hy = _o.y + left.y * lx + fwd.y * lz;
  const hz = _o.z + left.z * lx + fwd.z * lz;
  let t = (car.groundY[i] - hy) / upY;
  let contact = true;
  if (t < -SUSP.maxDroop) {
    t = -SUSP.maxDroop;
    contact = false;
  } else if (t > 0.14) t = 0.14;
  const rx = hx + up.x * t - com.x;
  const ry = hy + up.y * t - com.y;
  const rz = hz + up.z * t - com.z;
  // Contact-patch velocity v + w × r.
  const vpx = v.x + w.y * rz - w.z * ry;
  const vpy = v.y + w.z * rx - w.x * rz;
  const vpz = v.z + w.x * ry - w.y * rx;
  const nDotV = vpx * nx + vpy * ny + vpz * nz;
  const tRate = contact ? -nDotV / (Math.max(0.5, ny) * upY) : 0;
  car.travelRate[i] = tRate;
  car.travel[i] = t;

  let fX = 0;
  let fY = 0;
  let fZ = 0;
  let load = 0;
  if (contact) {
    const k = i < 2 ? SUSP.springF : SUSP.springR;
    let f = k * t * (1 + SUSP.progressive * t * t) + car.preload[i] + (tRate > 0 ? SUSP.bump : SUSP.rebound) * tRate;
    f += (i < 2 ? SUSP.arbF : SUSP.arbR) * (t - car.travelPrev[i ^ 1]);
    if (t > SUSP.bumpStopTravel) f += SUSP.bumpStopK * (t - SUSP.bumpStopTravel);
    if (f < 0) f = 0;
    load = f;
    fX = up.x * f;
    fY = up.y * f;
    fZ = up.z * f;
  }

  // Wheel heading projected into the ground plane, and its lateral axis.
  const steer = car.wheelSteer[i];
  const cs = Math.cos(steer);
  const sn = Math.sin(steer);
  let fwx = fwd.x * cs + left.x * sn;
  let fwy = fwd.y * cs + left.y * sn;
  let fwz = fwd.z * cs + left.z * sn;
  const fwn = fwx * nx + fwy * ny + fwz * nz;
  fwx -= nx * fwn;
  fwy -= ny * fwn;
  fwz -= nz * fwn;
  const fwl = 1 / (Math.sqrt(fwx * fwx + fwy * fwy + fwz * fwz) || 1);
  fwx *= fwl;
  fwy *= fwl;
  fwz *= fwl;
  const lwx = ny * fwz - nz * fwy;
  const lwy = nz * fwx - nx * fwz;
  const lwz = nx * fwy - ny * fwx;
  const vgx = vpx - nx * nDotV;
  const vgy = vpy - ny * nDotV;
  const vgz = vpz - nz * nDotV;
  const vx = vgx * fwx + vgy * fwy + vgz * fwz;
  const vy = vgx * lwx + vgy * lwy + vgz * lwz;
  const omega = car.wheelOmega[i];
  const vRef = Math.max(Math.abs(vx), TYRE.vLow);
  const kappa = (omega * R - vx) / vRef;
  const sx = kappa / TYRE.kappaPeak;
  const sy = vy / (vRef * TYRE.tanAlphaPeak);
  const s = Math.sqrt(sx * sx + sy * sy);
  let fx = 0;
  let fy = 0;
  let mu = 0;
  if (contact && load > 1) {
    mu = car.wheelMu[i] * Math.pow(TYRE.loadRef / Math.max(load, 400), TYRE.loadSens);
    const fMag = mu * load * magicFormula(s);
    if (s > 1e-6) {
      fx = (fMag * sx) / s;
      fy = (-fMag * sy) / s;
    }
    fX += fwx * fx + lwx * fy;
    fY += fwy * fx + lwy * fy;
    fZ += fwz * fx + lwz * fy;
    const vgLen = Math.sqrt(vgx * vgx + vgy * vgy + vgz * vgz);
    if (vgLen > 0.3) {
      const crr = (-(car.wheelRoll[i] + car.wheelRollV[i] * vgLen) * load) / vgLen;
      fX += vgx * crr;
      fY += vgy * crr;
      fZ += vgz * crr;
    }
  }
  if (contact) {
    const F = car.force;
    const T = car.torque;
    F.x += fX;
    F.y += fY;
    F.z += fZ;
    T.x += ry * fZ - rz * fY;
    T.y += rz * fX - rx * fZ;
    T.z += rx * fY - ry * fX;
  }

  // Wheel spin: implicit in the linearised tyre stiffness so low speeds stay stable.
  const Iw = (i < 2 ? TYRE.inertiaF : TYRE.inertiaR) + (i >= 2 ? car.reflectedInertia : 0);
  const invS = 1 / Math.max(s, 1e-3);
  const Kx = contact && load > 1 ? ((mu * load * MF_SLOPE0) / TYRE.kappaPeak) * (invS < 0.2 ? 0.2 : invS > 1 ? 1 : invS) : 0;
  const denom = 1 + (h * Kx * R * R) / (Iw * vRef);
  let omega1 = omega + (h * (car.driveTorque[i] - fx * R)) / Iw / denom;
  const tb = car.brakeTorque[i];
  if (tb > 0) {
    // The brake torque is part of the same implicit balance (otherwise the tyre has to produce `denom`× the brake
    // force to hold the wheel, which locked the fronts at 20 % pedal below 100 km/h).
    const dw = (tb * h) / Iw / denom;
    if (Math.abs(omega1) <= dw) omega1 = 0;
    else omega1 -= (omega1 > 0 ? 1 : -1) * dw;
  }
  car.wheelOmega[i] = omega1;
  car.slipPower[i] += Math.abs(fx * (omega * R - vx)) + Math.abs(fy * vy);

  wheel.slipRatio = kappa;
  wheel.slipAngle = Math.atan2(vy, Math.abs(vx) + 0.05);
  wheel.slip = contact ? s : 0;
  wheel.load = load;
  wheel.contact = contact;
  wheel.locked = contact && Math.abs(omega1) < 0.5 && Math.abs(vx) > 3 && st.engine.brake > 0.05;
  wheel.spinning = contact && i >= 2 && kappa > 0.25 && car.throttleEff > 0.1;
  return contact;
}

/** Downforce, drag and plank contact. Separate function so its vector calls stay within V8's inlining budget. */
function aeroAndFloor(car: PhysCar): void {
  const st = car.state;
  const v = st.velocity;
  const w = st.angularVelocity;
  const com = car.com;
  const fwd = car.fwd;
  const left = car.left;
  const up = car.up;
  const v2 = v.lengthSq();
  const dmg = st.damage;
  const aeroBase = AERO.cl * v2 * car.aeroFactor * (1 - 0.3 * dmg.floor);
  const dfFront = aeroBase * AERO.frontShare * (1 - 0.8 * dmg.frontWing) * (1 - car.dirtyAir);
  const dfRear = aeroBase * (1 - AERO.frontShare) * (1 - 0.8 * dmg.rearWing) * (st.drs.open ? DRS.downforceLossFactor : 1);
  if (v2 > 1) {
    _p.copy(_o).addScaledVector(fwd, CAR.frontAxleZ);
    _r.subVectors(_p, com);
    _f.copy(up).multiplyScalar(-dfFront);
    car.applyForce(_f, _r);
    _p.copy(_o).addScaledVector(fwd, CAR.rearAxleZ);
    _r.subVectors(_p, com);
    _f.copy(up).multiplyScalar(-dfRear);
    car.applyForce(_f, _r);

    const bottoming = st.chassis.bottoming;
    const drag = AERO.cd * v2 * (st.drs.open ? DRS.dragReductionFactor : 1) * (1 - car.slipstream) * (1 - 0.15 * dmg.frontWing) + bottoming * AERO.bottomingDrag;
    const vLen = Math.sqrt(v2);
    _f.copy(v).multiplyScalar(-drag / vLen);
    _r.copy(up).multiplyScalar(AERO.dragHeight);
    car.applyForce(_f, _r);
  }

  /* ── floor / plank ── */
  let minClear = 1;
  for (let c = 0; c < 4; c++) {
    const fc = FLOOR_CORNERS[c];
    _p.copy(_o).addScaledVector(left, fc[0]).addScaledVector(fwd, fc[1]).addScaledVector(up, CAR.rideHeight);
    const clearance = _p.y - car.groundY[fc[2]];
    if (clearance < minClear) minClear = clearance;
    if (clearance < 0 && car.anyContact) {
      _r.subVectors(_p, com);
      _vp.crossVectors(w, _r).add(v);
      const fPlank = -SUSP.plankK * clearance + SUSP.plankC * Math.max(0, -_vp.y);
      _f.set(0, fPlank, 0);
      car.applyForce(_f, _r);
    }
  }
  if (minClear < car.minClearance) car.minClearance = minClear;
}

export function substepCar(car: PhysCar, h: number): void {
  const st = car.state;
  const q = st.quaternion;
  const v = st.velocity;
  const w = st.angularVelocity;
  const com = car.com;
  const wheels = st.wheels;
  const brake = st.engine.brake;
  const throttle = car.throttleEff;

  updateAxes(car);
  const fwd = car.fwd;
  const left = car.left;
  const up = car.up;
  car.upY = Math.max(0.35, up.y);
  car.stepH = h;
  originOf(car, _o);
  car.force.set(0, -car.mass * GRAVITY, 0);
  car.torque.set(0, 0, 0);

  computeDrive(car, h);

  /* ── assists that modulate wheel torques (use last substep's slip) ── */
  const absOn = car.assists.abs && brake > 0.05 && st.speedAbs > 2;
  for (let i = 0; i < 4; i++) {
    if (absOn) {
      if (wheels[i].slipRatio < BRAKES.absRelease) car.absFactor[i] = Math.max(0.05, car.absFactor[i] - 14 * h);
      else car.absFactor[i] = Math.min(1, car.absFactor[i] + 5 * h);
    } else car.absFactor[i] = 1;
    // Brake-by-wire: MGU-K harvest torque is taken out of the rear hydraulic budget.
    const hydraulic = i < 2 ? BRAKES.torqueF : Math.max(0, BRAKES.torqueR - 0.5 * car.harvestTorque);
    car.brakeTorque[i] = brake * hydraulic * car.absFactor[i];
  }
  const tc = car.assists.tractionControl;
  if (tc !== 'off') {
    const threshold = tc === 'full' ? 0.08 : 0.12;
    const rearSlip = Math.max(wheels[2].slipRatio, wheels[3].slipRatio);
    // Floor at 0.25 so a car buried in gravel can still dig itself out.
    const target = rearSlip > threshold && throttle > 0.05 ? clamp(1 - (rearSlip - threshold) / 0.1, 0.25, 1) : 1;
    car.tcFactor += clamp(target - car.tcFactor, -40 * h, 6 * h);
  }

  /* ── wheels: suspension + tyres ── */
  let anyContact = false;
  car.travelPrev.set(car.travel);
  for (let i = 0; i < 4; i++) {
    if (wheelSubstep(car, i)) anyContact = true;
  }
  car.anyContact = anyContact;

  aeroAndFloor(car);

  /* ── integrate ── */
  v.addScaledVector(car.force, car.invMass * h);
  _qi.copy(q).conjugate();
  _tl.copy(car.torque).applyQuaternion(_qi);
  _wl.copy(w).applyQuaternion(_qi);
  const invI = car.invInertia;
  _wl.x += _tl.x * invI.x * h;
  _wl.y += _tl.y * invI.y * h;
  _wl.z += _tl.z * invI.z * h;
  w.copy(_wl).applyQuaternion(q).multiplyScalar(1 - 0.25 * h);
  com.addScaledVector(v, h);
  const hx = w.x * h * 0.5;
  const hy = w.y * h * 0.5;
  const hz = w.z * h * 0.5;
  const qx = q.x;
  const qy = q.y;
  const qz = q.z;
  const qw = q.w;
  q.set(qx + (hx * qw + hy * qz - hz * qy), qy + (-hx * qz + hy * qw + hz * qx), qz + (hx * qy - hy * qx + hz * qw), qw + (-hx * qx - hy * qy - hz * qz));
  q.normalize();

  // Emergency: fell through the world.
  const gMin = Math.min(car.groundY[0], car.groundY[1], car.groundY[2], car.groundY[3]);
  if (com.y < gMin - 0.6) {
    com.y = gMin + COM_HEIGHT;
    if (v.y < 0) v.y = 0;
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * finish: once per step
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export function finishCar(car: PhysCar, ctx: SimContext, dt: number): void {
  const st = car.state;
  const track = ctx.track;
  const v = st.velocity;
  const eng = st.engine;

  if (car.frozen) {
    v.set(0, 0, 0);
    st.angularVelocity.set(0, 0, 0);
    freeRev(car, dt);
    car.anyContact = true;
    car.minClearance = 1;
    car.kerbWheels = 0;
  }

  updateAxes(car);
  originOf(car, _o);
  st.position.copy(_o);
  st.speed = v.dot(car.fwd);
  st.speedAbs = v.length();

  _a.subVectors(v, car.prevVel).multiplyScalar(1 / dt);
  car.prevVel.copy(v);
  _qi.copy(st.quaternion).conjugate();
  _a.applyQuaternion(_qi);
  car.accelSmooth.lerp(_a, 0.35);
  st.localAccel.copy(car.accelSmooth);

  /* ── track bookkeeping ── */
  const tr = st.track;
  refreshFrame(car, track, _o);
  const s = car.frameS;
  const L = track.length;
  const prevS = car.prevS;
  tr.s = s;
  tr.lateral = car.frameLat;
  car.prevS = s;
  tr.sector = track.sectorOf(s);
  tr.surface = track.surfaceAt(s, tr.lateral);
  tr.inPitLane = track.isInPitLane(s, tr.lateral);
  track.forwardAt(s, _fdir);
  tr.forwardSpeed = v.dot(_fdir);
  const win = MISC.lapLineWindow;
  if (prevS > L - win && s < win && tr.forwardSpeed > 0) {
    tr.lap++;
    st.tyres.age++;
  } else if (prevS < win && s > L - win && tr.forwardSpeed < 0 && tr.lap > 0) {
    tr.lap--;
  }
  tr.progress = tr.lap * L + s;
  let off = 0;
  for (let i = 0; i < 4; i++) if (!isRacingSurface(car.wheelSurface[i])) off++;
  tr.wheelsOff = off;
  const offNow = off === 4 && !car.frozen;
  if (offNow && !car.offtrackPrev) events.emit('car:offtrack', { carId: st.id, surface: tr.surface, wheelsOff: off });
  else if (!offNow && car.offtrackPrev) events.emit('car:ontrack', { carId: st.id });
  car.offtrackPrev = offNow;

  /* ── wheels ── */
  const trackTemp = ctx.trackTemp;
  const compound = st.tyres.compound;
  const data = TYRE_DATA[compound];
  const cool = (TYRE.coolBase + TYRE.coolSpeed * st.speedAbs) * (1 + ctx.wetness);
  let wearSum = 0;
  let tempFSum = 0;
  let wearFSum = 0;
  let spinning = false;
  for (let i = 0; i < 4; i++) {
    const w = st.wheels[i];
    const wl = WHEEL_LOCAL_POSITIONS[i];
    w.worldPos.copy(_o).addScaledVector(car.left, wl[0]).addScaledVector(car.fwd, wl[2]).addScaledVector(car.up, CAR.wheelRadius + car.travel[i]);
    w.suspensionTravel = car.travel[i];
    w.spinRate = car.wheelOmega[i];
    w.spinAngle += car.wheelOmega[i] * dt;
    if (w.spinAngle > 1e5 || w.spinAngle < -1e5) w.spinAngle %= TAU;
    if (car.frozen) {
      w.load = car.preload[i];
      w.contact = true;
      w.slip = 0;
      w.slipRatio = 0;
      w.slipAngle = 0;
      w.locked = false;
      w.spinning = false;
    } else {
      const heat = car.slipPower[i] * TYRE.heatPerJoule * car.heatMult + w.load * st.speedAbs * TYRE.rollHeat;
      w.temp += (heat - (w.temp - trackTemp) * cool) * dt;
      w.wear = Math.min(1, w.wear + car.slipPower[i] * TYRE.wearPerJoule * data.wearRate * car.wearMult * car.wheelWearMult[i] * dt);
    }
    if (w.locked !== car.lockedPrev[i]) {
      car.lockedPrev[i] = w.locked;
      events.emit('car:lockup', { carId: st.id, wheel: i, active: w.locked });
    }
    if (w.spinning) spinning = true;
    wearSum += w.wear;
    tempFSum += tempFactor(w.temp, data.optimalTemp);
    wearFSum += wearFactor(w.wear);
  }
  st.tyres.wear = wearSum * 0.25;
  st.tyres.gripFactor = data.grip * tempFSum * 0.25 * wearFSum * 0.25;

  /* ── chassis flags & edge events ── */
  const ch = st.chassis;
  const airborne = !car.anyContact;
  if (airborne !== car.airbornePrev) {
    car.airbornePrev = airborne;
    events.emit('car:airborne', { carId: st.id, airborne });
  }
  ch.airborne = airborne;
  ch.kerbRumble = car.kerbWheels > 0 ? clamp01(car.kerbWheels / 2) * clamp01(st.speedAbs / 40) : 0;
  const bottoming = car.frozen ? 0 : clamp01((SUSP.bottomingClearance - car.minClearance) / SUSP.bottomingClearance) * clamp01(st.speedAbs / 30);
  ch.bottoming = bottoming;
  if (bottoming > 0.25 && car.bottomingCooldown <= 0) {
    car.bottomingCooldown = MISC.bottomingEventInterval;
    events.emit('car:bottoming', { carId: st.id, intensity: bottoming });
  }
  if (spinning !== car.wheelspinPrev) {
    car.wheelspinPrev = spinning;
    events.emit('car:wheelspin', { carId: st.id, active: spinning });
  }
  if (eng.limiter !== car.limiterPrev) {
    car.limiterPrev = eng.limiter;
    events.emit('car:limiter', { carId: st.id, active: eng.limiter });
  }
}
