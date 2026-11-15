/**
 * Per-frame emission driven by `world.cars`: tyre smoke, sparks, dust/gravel/grass, spray, brake glow, DRS wisps,
 * heat haze and skid marks. All emission uses fractional accumulators so rates are frame-rate independent.
 */
import * as THREE from 'three';
import { CAR } from '../core/constants';
import type { TrackSample, TrackSpline } from '../core/track/TrackSpline';
import type { CarState, SurfaceType, WheelState } from '../core/types';
import type { HeatHaze } from './HeatHaze';
import { SP, type ParticleSystem } from './ParticleSystem';
import type { SkidMarks } from './SkidMarks';
import { groundPlaneFromSample, groundY, rand, randSpread, type GroundPlane } from './util';

export interface EmitterSystems {
  smoke: ParticleSystem;
  sparks: ParticleSystem;
  dust: ParticleSystem;
  stones: ParticleSystem;
  spray: ParticleSystem;
  debris: ParticleSystem;
  glow: ParticleSystem;
  haze: HeatHaze;
  skids: SkidMarks;
}

export interface EmitterEnv {
  rain: number;
  wetness: number;
  time: number;
  /** Multiplies every rate (quality budget). */
  rateScale: number;
}

/** Camera-relative results gathered while iterating the cars (for screen rain). */
export interface CameraProximity {
  nearestCarDist: number;
  nearestCarSpeed: number;
  /** 0..1 how much spray from cars ahead is hitting the lens. */
  lensSpray: number;
}

const _fwd = new THREE.Vector3();
const _left = new THREE.Vector3();
const _p = new THREE.Vector3();
const _toCar = new THREE.Vector3();
const _camFwd = new THREE.Vector3();

const SPARK_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0.03, 0.4],
  [0.9, 0.03, 1.4],
  [-0.9, 0.03, 1.4],
  [0.9, 0.03, -1.4],
  [-0.9, 0.03, -1.4],
];
const EXHAUST: readonly [number, number, number] = [0, 0.45, -2.55];
const WING_TIPS: ReadonlyArray<readonly [number, number, number]> = [
  [0.95, 0.95, -2.6],
  [-0.95, 0.95, -2.6],
];

const isHard = (s: SurfaceType): boolean => s === 'asphalt' || s === 'kerb' || s === 'pit';

export class CarEmitters {
  private readonly carCount: number;
  private readonly smokeAcc: Float32Array;
  private readonly sprayAcc: Float32Array;
  private readonly dustAcc: Float32Array;
  private readonly stoneAcc: Float32Array;
  private readonly heat: Float32Array;
  private readonly sparkAcc: Float32Array;
  private readonly wispAcc: Float32Array;
  private readonly ground: GroundPlane = { c: 0, gx: 0, gz: 0 };
  private readonly sample: TrackSample;
  readonly proximity: CameraProximity = { nearestCarDist: Infinity, nearestCarSpeed: 0, lensSpray: 0 };

  constructor(
    private readonly sys: EmitterSystems,
    private readonly track: TrackSpline,
    carCount: number,
  ) {
    this.carCount = carCount;
    this.smokeAcc = new Float32Array(carCount * 4);
    this.sprayAcc = new Float32Array(carCount * 4);
    this.dustAcc = new Float32Array(carCount * 4);
    this.stoneAcc = new Float32Array(carCount * 4);
    this.heat = new Float32Array(carCount * 4);
    this.sparkAcc = new Float32Array(carCount);
    this.wispAcc = new Float32Array(carCount * 2);
    this.sample = track.sample(0);
  }

  reset(): void {
    this.smokeAcc.fill(0);
    this.sprayAcc.fill(0);
    this.dustAcc.fill(0);
    this.stoneAcc.fill(0);
    this.heat.fill(0);
    this.sparkAcc.fill(0);
    this.wispAcc.fill(0);
  }

  /** Ground plane under a car (matches the track slope at the car's s). */
  groundFor(car: CarState, out: GroundPlane): GroundPlane {
    this.track.sample(car.track.s, this.sample);
    return groundPlaneFromSample(this.sample, out);
  }

  update(cars: CarState[], camera: THREE.PerspectiveCamera, camPos: THREE.Vector3, env: EmitterEnv, dt: number): void {
    const prox = this.proximity;
    prox.nearestCarDist = Infinity;
    prox.nearestCarSpeed = 0;
    prox.lensSpray = 0;
    _camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.sys.haze.begin();
    let glowCount = 0;
    const n = Math.min(cars.length, this.carCount);
    for (let ci = 0; ci < n; ci++) {
      const car = cars[ci];
      const id = car.id < this.carCount ? car.id : ci;
      if (car.status === 'retired' || car.status === 'dsq') {
        // Retired cars sit still; nothing to emit but still cool the brakes.
        for (let w = 0; w < 4; w++) this.heat[id * 4 + w] *= Math.max(0, 1 - dt);
        continue;
      }
      _toCar.subVectors(car.position, camPos);
      const dist = _toCar.length();
      if (dist < prox.nearestCarDist) {
        prox.nearestCarDist = dist;
        prox.nearestCarSpeed = car.speedAbs;
      }
      if (env.wetness > 0.2 && dist > 2.5 && dist < 40 && car.speedAbs > 15) {
        const facing = _toCar.dot(_camFwd) / dist;
        if (facing > 0.8) {
          const near = 1 - Math.max(0, dist - 6) / 34;
          prox.lensSpray = Math.min(1, prox.lensSpray + near * near * Math.min(1, car.speedAbs / 55) * (env.wetness - 0.2) * 1.4 * ((facing - 0.8) / 0.2));
        }
      }
      // Distance LOD: full rate close, tapering off; spray keeps a floor because plumes matter at range.
      const lod = dist < 120 ? 1 : dist < 450 ? 1 - ((dist - 120) / 330) * 0.7 : dist < 800 ? 0.3 - ((dist - 450) / 350) * 0.3 : 0;
      const sprayLod = Math.max(lod, dist < 1000 ? 0.3 : 0);
      if (lod <= 0 && sprayLod <= 0) continue;

      _fwd.set(0, 0, 1).applyQuaternion(car.quaternion);
      const hl = Math.hypot(_fwd.x, _fwd.z) || 1;
      _left.set(_fwd.z / hl, 0, -_fwd.x / hl);
      this.groundFor(car, this.ground);
      const g = this.ground;
      const speed = car.speedAbs;
      const rate = env.rateScale;

      // ── wheels
      for (let w = 0; w < 4; w++) {
        const wheel = car.wheels[w];
        const slot = id * 4 + w;
        const wp = wheel.worldPos;
        const gy = groundY(g, wp.x, wp.z);
        const front = w < 2;
        this.updateBrake(wheel, slot, car, front, dt);
        if (this.heat[slot] > 0.04 && lod > 0) {
          const h = this.heat[slot];
          // The disc sits inside an opaque tyre, so glow on both faces (just outside the rim) rather than at the centre.
          const off = (front ? CAR.frontTyreWidth : CAR.rearTyreWidth) * 0.5 + 0.06;
          const ox = _left.x * off;
          const oz = _left.z * off;
          const size = 0.34 + 0.22 * h;
          const gr = 3.2 * h;
          const gg = 1.2 * h * h + 0.12 * h;
          const gb = 0.3 * h * h * h;
          const ga = h * Math.sqrt(h);
          this.sys.glow.set(glowCount++, wp.x + ox, wp.y, wp.z + oz, size, gr, gg, gb, ga, 0);
          this.sys.glow.set(glowCount++, wp.x - ox, wp.y, wp.z - oz, size, gr, gg, gb, ga, 0);
        }
        if (!wheel.contact || car.chassis.airborne) {
          this.sys.skids.endDry(slot);
          this.sys.skids.endWet(slot);
          continue;
        }
        const surface = wheel.surface;
        const loadF = Math.min(1.6, wheel.load / 3200);
        if (isHard(surface)) {
          if (lod > 0) this.emitSmoke(wheel, slot, car, gy, speed, env, lod * rate, dt, loadF);
          this.layMarks(wheel, slot, w, car, gy, speed, env, dt, loadF);
        } else {
          this.sys.skids.endDry(slot);
          this.sys.skids.endWet(slot);
          if (lod > 0) this.emitOffroad(wheel, slot, car, gy, speed, env, lod * rate, dt, surface);
        }
        if (env.wetness > 0.15 && sprayLod > 0) this.emitSpray(wheel, slot, car, gy, speed, env, sprayLod * rate, dt, front);
      }

      // ── chassis
      if (lod > 0) {
        if (car.chassis.bottoming > 0.15 && speed > 40) this.emitSparks(car, id, speed, lod * rate, dt);
        if (car.drs.open && env.wetness > 0.2 && speed > 30) this.emitWisps(car, id, speed, env, lod * rate, dt);
        if (dist < 160) this.emitHaze(car, speed, dist);
      }
    }
    this.sys.glow.setCount(glowCount);
  }

  private updateBrake(wheel: WheelState, slot: number, car: CarState, front: boolean, dt: number): void {
    const heat = this.heat;
    const brake = car.engine.brake;
    const speed = car.speedAbs;
    let h = heat[slot];
    h += brake * speed * 0.016 * (front ? 1.15 : 0.8) * dt * (wheel.locked ? 1.4 : 1);
    h -= h * (0.55 + speed * 0.012) * dt;
    heat[slot] = h > 1 ? 1 : h < 0 ? 0 : h;
  }

  private emitSmoke(wheel: WheelState, slot: number, car: CarState, gy: number, speed: number, env: EmitterEnv, scale: number, dt: number, loadF: number): void {
    const dry = 1 - Math.min(1, env.wetness * 1.7);
    if (dry <= 0.02) return;
    const slipEx = Math.max(0, wheel.slip - 0.9);
    const locked = wheel.locked && speed > 6;
    const burnout = wheel.spinning || (wheel.slipRatio > 0.35 && speed < 30 && car.engine.throttle > 0.5);
    let rate = 0;
    if (slipEx > 0) rate += Math.min(2.5, slipEx) * 62 * loadF;
    if (locked) rate += 70 + speed * 0.6;
    if (burnout) rate += 55;
    if (rate <= 0) return;
    rate *= dry * scale;
    const acc = this.smokeAcc;
    acc[slot] += rate * dt;
    const count = Math.floor(acc[slot]);
    if (count <= 0) return;
    acc[slot] -= count;
    const wp = wheel.worldPos;
    const v = car.velocity;
    const sys = this.sys.smoke;
    const g = this.ground;
    // Spread spawns along the distance travelled this frame so fast cars leave a continuous plume, not beads.
    const sx = v.x * dt;
    const sz = v.z * dt;
    for (let k = 0; k < count; k++) {
      const f = k / count;
      SP.x = wp.x - _fwd.x * 0.3 - sx * f + randSpread(0.12);
      SP.y = gy + 0.1 + Math.random() * 0.12;
      SP.z = wp.z - _fwd.z * 0.3 - sz * f + randSpread(0.12);
      const back = 1.4 + Math.random() * 1.6;
      SP.vx = v.x * 0.12 - _fwd.x * back + randSpread(0.8);
      SP.vy = 1.1 + Math.random() * 1.3;
      SP.vz = v.z * 0.12 - _fwd.z * back + randSpread(0.8);
      if (burnout) {
        SP.life = rand(2.8, 4.5);
        SP.size = rand(0.55, 0.85);
        SP.a = rand(0.45, 0.62);
      } else {
        SP.life = rand(1.4, 2.6);
        SP.size = rand(0.42, 0.7);
        SP.a = rand(0.36, 0.55);
      }
      if (locked) {
        SP.r = 0.9;
        SP.g = 0.93;
        SP.b = 1.0;
        SP.a *= 1.1;
        SP.size *= 1.15;
      } else {
        const l = rand(0.86, 0.95);
        SP.r = l;
        SP.g = l;
        SP.b = l * 1.02;
      }
      SP.rot = Math.random() * 6.283;
      SP.rotSpeed = randSpread(1.2);
      SP.gC = g.c;
      SP.gX = g.gx;
      SP.gZ = g.gz;
      sys.spawn();
    }
  }

  private emitOffroad(wheel: WheelState, slot: number, car: CarState, gy: number, speed: number, env: EmitterEnv, scale: number, dt: number, surface: SurfaceType): void {
    if (speed < 1.5) return;
    const dry = 1 - Math.min(1, env.wetness * 1.2);
    const slip = Math.min(2, wheel.slip);
    let dustRate: number;
    let stoneRate: number;
    let dr: number;
    let dg: number;
    let db: number;
    let da: number;
    let sr: number;
    let sg: number;
    let sb: number;
    let stoneSize: number;
    if (surface === 'gravel') {
      dustRate = (0.45 + slip) * speed * 0.95;
      stoneRate = (0.3 + slip) * speed * 0.3;
      dr = 0.68;
      dg = 0.6;
      db = 0.46;
      da = 0.45;
      sr = 0.55;
      sg = 0.5;
      sb = 0.42;
      stoneSize = 0.05;
    } else if (surface === 'grass') {
      dustRate = (0.3 + slip) * speed * 0.55;
      stoneRate = (0.4 + slip) * speed * 0.45;
      dr = 0.36;
      dg = 0.4;
      db = 0.2;
      da = 0.38;
      sr = 0.28;
      sg = 0.5;
      sb = 0.14;
      stoneSize = 0.065;
    } else if (surface === 'runoff') {
      dustRate = (0.2 + slip) * speed * 0.3;
      stoneRate = 0;
      dr = 0.7;
      dg = 0.68;
      db = 0.63;
      da = 0.24;
      sr = sg = sb = 0.5;
      stoneSize = 0.04;
    } else {
      return;
    }
    const wp = wheel.worldPos;
    const v = car.velocity;
    const g = this.ground;
    const dacc = this.dustAcc;
    dacc[slot] += dustRate * dry * scale * dt;
    let count = Math.floor(dacc[slot]);
    if (count > 0) {
      dacc[slot] -= count;
      const sys = this.sys.dust;
      const sx = v.x * dt;
      const sz = v.z * dt;
      for (let k = 0; k < count; k++) {
        const f = k / count;
        SP.x = wp.x - _fwd.x * 0.3 - sx * f + randSpread(0.25);
        SP.y = gy + 0.1 + Math.random() * 0.15;
        SP.z = wp.z - _fwd.z * 0.3 - sz * f + randSpread(0.25);
        const back = 1 + Math.random() * 2;
        SP.vx = v.x * 0.28 - _fwd.x * back + randSpread(1.4);
        SP.vy = 1 + Math.random() * 2.2;
        SP.vz = v.z * 0.28 - _fwd.z * back + randSpread(1.4);
        SP.life = rand(1.2, 2.4);
        SP.size = rand(0.35, 0.7);
        const l = rand(0.85, 1.1);
        SP.r = dr * l;
        SP.g = dg * l;
        SP.b = db * l;
        SP.a = da * rand(0.8, 1.1);
        SP.rot = Math.random() * 6.283;
        SP.rotSpeed = randSpread(1.5);
        SP.gC = g.c;
        SP.gX = g.gx;
        SP.gZ = g.gz;
        sys.spawn();
      }
    }
    if (stoneRate <= 0) return;
    const sacc = this.stoneAcc;
    sacc[slot] += stoneRate * scale * dt;
    count = Math.floor(sacc[slot]);
    if (count <= 0) return;
    sacc[slot] -= count;
    const sys = this.sys.stones;
    for (let k = 0; k < count; k++) {
      SP.x = wp.x - _fwd.x * 0.25 + randSpread(0.15);
      SP.y = gy + 0.1;
      SP.z = wp.z - _fwd.z * 0.25 + randSpread(0.15);
      const back = 3 + Math.random() * 6;
      SP.vx = v.x * 0.45 - _fwd.x * back + randSpread(2.5);
      SP.vy = 2.5 + Math.random() * 5.5;
      SP.vz = v.z * 0.45 - _fwd.z * back + randSpread(2.5);
      SP.life = rand(0.9, 2.0);
      SP.size = stoneSize * rand(0.6, 1.4);
      const l = rand(0.7, 1.15);
      SP.r = sr * l;
      SP.g = sg * l;
      SP.b = sb * l;
      SP.a = 1;
      SP.rot = Math.random() * 6.283;
      SP.rotSpeed = randSpread(18);
      SP.gC = g.c;
      SP.gX = g.gx;
      SP.gZ = g.gz;
      sys.spawn();
    }
  }

  private emitSpray(wheel: WheelState, slot: number, car: CarState, gy: number, speed: number, env: EmitterEnv, scale: number, dt: number, front: boolean): void {
    if (speed < 4 || !isHard(wheel.surface)) return;
    const wet = (env.wetness - 0.15) / 0.85;
    const rate = speed * speed * 0.0095 * wet * (front ? 0.65 : 1.3) * scale;
    const acc = this.sprayAcc;
    acc[slot] += rate * dt;
    const count = Math.floor(acc[slot]);
    if (count <= 0) return;
    acc[slot] -= count;
    const wp = wheel.worldPos;
    const v = car.velocity;
    const sys = this.sys.spray;
    const g = this.ground;
    const lift = 1.4 + speed * 0.045;
    const spread = 0.7 + speed * 0.022;
    const sx = v.x * dt;
    const sz = v.z * dt;
    for (let k = 0; k < count; k++) {
      const f = k / count;
      SP.x = wp.x - _fwd.x * 0.38 - sx * f + randSpread(0.12);
      SP.y = gy + 0.12 + Math.random() * 0.2;
      SP.z = wp.z - _fwd.z * 0.38 - sz * f + randSpread(0.12);
      const keep = 0.28 + Math.random() * 0.18;
      SP.vx = v.x * keep - _fwd.x * 1.2 + randSpread(spread);
      SP.vy = lift * rand(0.5, 1.1);
      SP.vz = v.z * keep - _fwd.z * 1.2 + randSpread(spread);
      SP.life = rand(1.0, 2.0);
      SP.size = rand(0.35, 0.6);
      const l = rand(0.84, 0.95);
      SP.r = l;
      SP.g = l * 1.01;
      SP.b = l * 1.04;
      SP.a = rand(0.13, 0.24) * (0.6 + 0.4 * wet);
      SP.rot = Math.random() * 6.283;
      SP.rotSpeed = randSpread(0.8);
      SP.gC = g.c;
      SP.gX = g.gx;
      SP.gZ = g.gz;
      sys.spawn();
    }
  }

  private layMarks(wheel: WheelState, slot: number, w: number, car: CarState, gy: number, speed: number, env: EmitterEnv, dt: number, loadF: number): void {
    const skids = this.sys.skids;
    const wp = wheel.worldPos;
    const halfW = (w < 2 ? CAR.frontTyreWidth : CAR.rearTyreWidth) * 0.5;
    // Wheel lateral axis: car left rotated by the steer angle (positive = left).
    let lx = _left.x;
    let lz = _left.z;
    if (w < 2 && wheel.steerAngle !== 0) {
      const c = Math.cos(wheel.steerAngle);
      const s = Math.sin(wheel.steerAngle);
      const fx = _fwd.x * c + _fwd.z * s;
      const fz = _fwd.z * c - _fwd.x * s;
      const hl = Math.hypot(fx, fz) || 1;
      lx = fz / hl;
      lz = -fx / hl;
    }
    const y = gy + 0.012;
    const ax = wp.x + lx * halfW;
    const az = wp.z + lz * halfW;
    const bx = wp.x - lx * halfW;
    const bz = wp.z - lz * halfW;
    const dryOk = wheel.slip > 0.7 && speed > 1.5 && env.wetness < 0.6 && wheel.surface !== 'pit';
    if (dryOk) {
      let alpha = Math.min(1, (wheel.slip - 0.7) / 0.7) * Math.min(1.2, loadF) * (1 - env.wetness * 1.4);
      if (wheel.locked) alpha *= 1.25;
      alpha = Math.min(0.85, alpha * 0.8);
      if (alpha > 0.03) skids.layDry(slot, ax, y, az, bx, y, bz, alpha, speed);
      else skids.endDry(slot);
    } else {
      skids.endDry(slot);
    }
    if (env.wetness > 0.3 && wheel.surface === 'asphalt' && speed > 5) {
      skids.layWet(slot, ax, y + 0.002, az, bx, y + 0.002, bz, 0.25 * env.wetness, env.time, dt);
    } else {
      skids.endWet(slot);
    }
  }

  private emitSparks(car: CarState, id: number, speed: number, scale: number, dt: number): void {
    const bott = car.chassis.bottoming;
    const rate = (bott - 0.15) * 340 * Math.min(1, speed / 75) * scale;
    const acc = this.sparkAcc;
    acc[id] += rate * dt;
    const count = Math.floor(acc[id]);
    if (count <= 0) return;
    acc[id] -= count;
    const g = this.ground;
    const v = car.velocity;
    const sys = this.sys.sparks;
    for (let k = 0; k < count; k++) {
      // Plank scrapes most; floor edges when the car rolls.
      const r = Math.random();
      const pt = SPARK_POINTS[r < 0.45 ? 0 : 1 + ((Math.random() * 4) | 0)];
      _p.set(pt[0] + randSpread(0.25), pt[1], pt[2] + randSpread(0.3)).applyQuaternion(car.quaternion).add(car.position);
      SP.x = _p.x;
      SP.y = groundY(g, _p.x, _p.z) + 0.04;
      SP.z = _p.z;
      const keep = 0.86 + Math.random() * 0.08;
      SP.vx = v.x * keep + randSpread(1.5);
      SP.vy = 0.3 + Math.random() * 2.2;
      SP.vz = v.z * keep + randSpread(1.5);
      SP.life = rand(0.4, 1.2);
      SP.size = rand(0.06, 0.11);
      const hot = Math.random();
      if (hot > 0.85) {
        SP.r = 4.0;
        SP.g = 3.0;
        SP.b = 1.8;
        SP.size *= 1.3;
      } else {
        SP.r = 3.2;
        SP.g = 1.0 + hot * 0.8;
        SP.b = 0.15 + hot * 0.2;
      }
      SP.a = 1;
      SP.rot = 0;
      SP.rotSpeed = 0;
      SP.gC = g.c;
      SP.gX = g.gx;
      SP.gZ = g.gz;
      sys.spawn();
    }
  }

  /** Burst of sparks (and optionally debris) from a world point — collisions / bottoming spikes. */
  burstAt(car: CarState, x: number, y: number, z: number, nx: number, ny: number, nz: number, sparkCount: number, debrisCount: number): void {
    this.groundFor(car, this.ground);
    const g = this.ground;
    const v = car.velocity;
    const gy = groundY(g, x, z);
    if (y < gy + 0.03) y = gy + 0.03;
    const sparks = this.sys.sparks;
    for (let k = 0; k < sparkCount; k++) {
      SP.x = x + randSpread(0.2);
      SP.y = y + randSpread(0.15);
      SP.z = z + randSpread(0.2);
      const out = 2 + Math.random() * 9;
      SP.vx = v.x * 0.5 + nx * out + randSpread(4);
      SP.vy = Math.abs(ny) * out + 1 + Math.random() * 4;
      SP.vz = v.z * 0.5 + nz * out + randSpread(4);
      SP.life = rand(0.35, 1.0);
      SP.size = rand(0.04, 0.08);
      SP.r = 3.6;
      SP.g = 1.9;
      SP.b = 0.6;
      SP.a = 1;
      SP.rot = 0;
      SP.rotSpeed = 0;
      SP.gC = g.c;
      SP.gX = g.gx;
      SP.gZ = g.gz;
      sparks.spawn();
    }
    const debris = this.sys.debris;
    for (let k = 0; k < debrisCount; k++) {
      SP.x = x + randSpread(0.4);
      SP.y = y + 0.1 + Math.random() * 0.4;
      SP.z = z + randSpread(0.4);
      const out = 1.5 + Math.random() * 6;
      SP.vx = v.x * 0.6 + nx * out + randSpread(3.5);
      SP.vy = 1.5 + Math.random() * 5;
      SP.vz = v.z * 0.6 + nz * out + randSpread(3.5);
      SP.life = rand(3, 6);
      SP.size = rand(0.05, 0.15);
      const l = Math.random() < 0.8 ? rand(0.04, 0.12) : rand(0.5, 0.8);
      SP.r = l;
      SP.g = l;
      SP.b = l * 1.05;
      SP.a = 1;
      SP.rot = Math.random() * 6.283;
      SP.rotSpeed = randSpread(16);
      SP.gC = g.c;
      SP.gX = g.gx;
      SP.gZ = g.gz;
      debris.spawn();
    }
  }

  /** Lock-up puff: a handful of smoke particles immediately at a wheel. */
  lockupPuff(car: CarState, wheelIndex: number, count: number): void {
    if (wheelIndex < 0 || wheelIndex > 3) return;
    const wheel = car.wheels[wheelIndex];
    this.groundFor(car, this.ground);
    const g = this.ground;
    const wp = wheel.worldPos;
    const gy = groundY(g, wp.x, wp.z);
    const sys = this.sys.smoke;
    for (let k = 0; k < count; k++) {
      SP.x = wp.x + randSpread(0.2);
      SP.y = gy + 0.1;
      SP.z = wp.z + randSpread(0.2);
      SP.vx = car.velocity.x * 0.12 + randSpread(1.2);
      SP.vy = 0.8 + Math.random() * 1.2;
      SP.vz = car.velocity.z * 0.12 + randSpread(1.2);
      SP.life = rand(1.4, 2.4);
      SP.size = rand(0.4, 0.6);
      SP.r = 0.86;
      SP.g = 0.9;
      SP.b = 1.0;
      SP.a = 0.5;
      SP.rot = Math.random() * 6.283;
      SP.rotSpeed = randSpread(1.5);
      SP.gC = g.c;
      SP.gX = g.gx;
      SP.gZ = g.gz;
      sys.spawn();
    }
  }

  private emitWisps(car: CarState, id: number, speed: number, env: EmitterEnv, scale: number, dt: number): void {
    const rate = 22 * Math.min(1, (speed - 30) / 40) * Math.min(1, (env.wetness - 0.2) / 0.5) * scale;
    const sys = this.sys.spray;
    const v = car.velocity;
    for (let t = 0; t < 2; t++) {
      const ai = id * 2 + t;
      this.wispAcc[ai] += rate * dt;
      const count = Math.floor(this.wispAcc[ai]);
      if (count <= 0) continue;
      this.wispAcc[ai] -= count;
      const tip = WING_TIPS[t];
      for (let k = 0; k < count; k++) {
        _p.set(tip[0] + randSpread(0.04), tip[1] + randSpread(0.04), tip[2]).applyQuaternion(car.quaternion).add(car.position);
        SP.x = _p.x;
        SP.y = _p.y;
        SP.z = _p.z;
        const keep = 0.82 + Math.random() * 0.1;
        SP.vx = v.x * keep + randSpread(0.4);
        SP.vy = 0.2 + randSpread(0.3);
        SP.vz = v.z * keep + randSpread(0.4);
        SP.life = rand(0.45, 0.9);
        SP.size = rand(0.1, 0.16);
        SP.r = 0.9;
        SP.g = 0.92;
        SP.b = 0.96;
        SP.a = 0.2;
        SP.rot = Math.random() * 6.283;
        SP.rotSpeed = randSpread(2);
        SP.gC = -1e9;
        sys.spawn();
      }
    }
  }

  private emitHaze(car: CarState, speed: number, dist: number): void {
    const throttle = car.engine.throttle;
    const intensity = (0.3 + 0.7 * throttle) * (1 - Math.min(1, Math.max(0, dist - 60) / 100));
    if (intensity <= 0.02) return;
    _p.set(EXHAUST[0], EXHAUST[1], EXHAUST[2]).applyQuaternion(car.quaternion).add(car.position);
    const k = Math.min(1, speed / 25);
    const dx = -_fwd.x * k * 2.4;
    const dy = 1.0 - k * 0.55;
    const dz = -_fwd.z * k * 2.4;
    this.sys.haze.add(_p.x, _p.y, _p.z, dx, dy, dz, intensity, (car.id % 7) / 7, 0.55 + k * 0.25, 1.0 + k * 1.8 + throttle * 0.5);
  }
}
