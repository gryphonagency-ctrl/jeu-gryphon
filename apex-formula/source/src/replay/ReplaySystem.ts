import * as THREE from 'three';
import { TAU, clamp } from '../core/math';
import type { TrackProjection, TrackSpline } from '../core/track/TrackSpline';
import type { CarState, IReplaySystem, World } from '../core/types';
import { copyCarState, createEmptyCarState } from '../core/world';
import { F, FLAG_AIRBORNE, FLAG_DEPLOY, FLAG_DRS, FLAG_HARVEST, FLAG_HELD, FLAG_LIMITER, I, ReplayBuffer } from './ReplayBuffer';

const RECORD_HZ = 30;
const RECORD_SECONDS = 90;
const FRAME_DT = 1 / RECORD_HZ;

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);

/**
 * Records every car at 30 Hz into a 90 s ring buffer of typed arrays and plays it back into cloned CarStates
 * with interpolation. Zero allocation while recording or playing.
 */
export class ReplaySystem implements IReplaySystem {
  private buffer: ReplayBuffer | null = null;
  private recording = false;
  private accum = 0;
  private lastRecordTime = -Infinity;

  private replaying = false;
  private clones: CarState[] = [];
  private track: TrackSpline | null = null;
  private time = 0;
  private speed = 1;
  private cursor = 0;
  private loop = false;
  private readonly proj: TrackProjection = { s: 0, lateral: 0, distance: 0 };

  /* ───────────────────────────── recording ───────────────────────────── */

  startRecording(world: World): void {
    const cars = world.cars.length;
    if (!this.buffer || this.buffer.carCount !== cars) this.buffer = new ReplayBuffer(RECORD_HZ * RECORD_SECONDS, cars);
    else this.buffer.clear();
    this.track = world.track;
    this.recording = true;
    this.accum = FRAME_DT; // capture the very first frame immediately
    this.lastRecordTime = -Infinity;
  }

  record(world: World, dt: number): void {
    if (!this.recording || !this.buffer || world.mode === 'replay' || this.replaying) return;
    this.accum += dt;
    if (this.accum < FRAME_DT) return;
    // Timestamps must be strictly increasing for interpolation; skip duplicates (e.g. sim not advancing).
    if (world.time <= this.lastRecordTime) {
      this.accum = 0;
      return;
    }
    this.accum = Math.min(this.accum - FRAME_DT, FRAME_DT);
    this.buffer.write(world.cars, world.time);
    this.lastRecordTime = world.time;
  }

  stopRecording(): void {
    this.recording = false;
  }

  /* ───────────────────────────── playback ───────────────────────────── */

  enter(world: World): CarState[] {
    const live = world.cars;
    if (this.clones.length !== live.length) {
      this.clones = live.map((c) => createEmptyCarState(c.id, c.driverId, c.teamId, c.isPlayer, c.tyres.compound));
    }
    for (let i = 0; i < live.length; i++) copyCarState(live[i], this.clones[i]);
    this.track = world.track;
    this.replaying = true;
    this.speed = 1;
    this.loop = false;
    this.time = Math.max(0, this.getDuration() - 20);
    this.cursor = 0;
    this.applyFrame();
    return this.clones;
  }

  exit(): void {
    this.replaying = false;
  }

  isReplaying(): boolean {
    return this.replaying;
  }

  update(dt: number): void {
    if (!this.replaying || !this.buffer || this.buffer.count === 0) return;
    const duration = this.getDuration();
    this.time += dt * this.speed;
    if (this.time > duration) {
      if (this.loop) this.time = duration > 0 ? this.time % duration : 0;
      else this.time = duration;
    } else if (this.time < 0) {
      this.time = this.loop && duration > 0 ? duration + (this.time % duration) : 0;
    }
    this.applyFrame();
  }

  seek(time: number): void {
    this.time = clamp(time, 0, this.getDuration());
    if (this.replaying) this.applyFrame();
  }

  setSpeed(speed: number): void {
    this.speed = clamp(speed, -8, 8);
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  getTime(): number {
    return this.time;
  }

  getDuration(): number {
    const b = this.buffer;
    if (!b || b.count < 2) return 0;
    return b.timeAt(b.count - 1) - b.timeAt(0);
  }

  getSpeed(): number {
    return this.speed;
  }

  /** Bytes held by the recording buffer. */
  getMemoryBytes(): number {
    return this.buffer ? this.buffer.byteLength : 0;
  }

  dispose(): void {
    this.recording = false;
    this.replaying = false;
    this.buffer = null;
    this.clones = [];
    this.track = null;
  }

  /* ───────────────────────────── interpolation ───────────────────────────── */

  /** Move the frame cursor so that timeAt(cursor) <= t < timeAt(cursor + 1). */
  private locate(t: number): void {
    const b = this.buffer!;
    const n = b.count;
    if (n < 2) {
      this.cursor = 0;
      return;
    }
    let j = clamp(this.cursor, 0, n - 2);
    // Frames are ~uniform: jump close, then walk.
    const t0 = b.timeAt(0);
    const guess = Math.floor(t / FRAME_DT);
    if (Math.abs(guess - j) > 4) j = clamp(guess, 0, n - 2);
    const abs = t0 + t;
    while (j > 0 && b.timeAt(j) > abs) j--;
    while (j < n - 2 && b.timeAt(j + 1) <= abs) j++;
    this.cursor = j;
  }

  private applyFrame(): void {
    const b = this.buffer;
    const track = this.track;
    if (!b || b.count === 0 || this.clones.length === 0) return;
    const t = this.time;
    this.locate(t);
    const j = this.cursor;
    const single = b.count < 2;
    const ta = b.timeAt(j);
    const tb = single ? ta + FRAME_DT : b.timeAt(j + 1);
    const span = Math.max(1e-4, tb - ta);
    const abs = b.timeAt(0) + t;
    const u = single ? 0 : clamp((abs - ta) / span, 0, 1);
    const jb = single ? j : j + 1;
    const fl = b.floats;
    const it = b.ints;
    const n = Math.min(this.clones.length, b.carCount);

    for (let c = 0; c < n; c++) {
      const car = this.clones[c];
      const a = b.floatBase(j, c);
      const bb = b.floatBase(jb, c);

      _pa.set(fl[a + F.PX], fl[a + F.PY], fl[a + F.PZ]);
      _pb.set(fl[bb + F.PX], fl[bb + F.PY], fl[bb + F.PZ]);
      car.position.lerpVectors(_pa, _pb, u);
      car.velocity.subVectors(_pb, _pa).multiplyScalar(1 / span);
      if (single) car.velocity.set(0, 0, 0);

      _qa.set(fl[a + F.QX], fl[a + F.QY], fl[a + F.QZ], fl[a + F.QW]);
      _qb.set(fl[bb + F.QX], fl[bb + F.QY], fl[bb + F.QZ], fl[bb + F.QW]);
      car.quaternion.slerpQuaternions(_qa, _qb, u);

      car.speed = lerpF(fl[a + F.SPEED], fl[bb + F.SPEED], u);
      car.speedAbs = car.velocity.length();
      car.localAccel.set(lerpF(fl[a + F.AX], fl[bb + F.AX], u), lerpF(fl[a + F.AY], fl[bb + F.AY], u), lerpF(fl[a + F.AZ], fl[bb + F.AZ], u));

      const ia = b.intBase(j, c);
      const ib = b.intBase(jb, c);
      const useB = u >= 0.5;
      const flags = it[(useB ? ib : ia) + I.FLAGS];
      const wheelFlags = it[(useB ? ib : ia) + I.WHEEL_FLAGS];
      const contact = it[(useB ? ib : ia) + I.CONTACT];

      let wa = a + F.WHEELS;
      let wb = bb + F.WHEELS;
      for (let w = 0; w < 4; w++) {
        const ws = car.wheels[w];
        const rateA = fl[wa + 1];
        const rateB = fl[wb + 1];
        const rate = lerpF(rateA, rateB, u);
        const spinA = fl[wa];
        let d = fl[wb] - spinA;
        // If the physics wraps spinAngle the raw delta disagrees with spinRate × dt; pick the 2π-equivalent that matches.
        const expected = 0.5 * (rateA + rateB) * span;
        if (Math.abs(d - expected) > Math.PI) d += TAU * Math.round((expected - d) / TAU);
        ws.spinAngle = spinA + d * u;
        ws.spinRate = rate;
        ws.steerAngle = lerpF(fl[wa + 2], fl[wb + 2], u);
        ws.suspensionTravel = lerpF(fl[wa + 3], fl[wb + 3], u);
        ws.slip = lerpF(fl[wa + 4], fl[wb + 4], u);
        ws.locked = (wheelFlags & (1 << w)) !== 0;
        ws.spinning = (wheelFlags & (1 << (4 + w))) !== 0;
        ws.contact = (contact & (1 << w)) !== 0;
        ws.slipRatio = ws.locked ? -1 : ws.spinning ? 1 : 0;
        wa += F.WHEEL_STRIDE;
        wb += F.WHEEL_STRIDE;
      }

      const eng = car.engine;
      eng.rpm = lerpF(fl[a + F.RPM], fl[bb + F.RPM], u);
      eng.throttle = lerpF(fl[a + F.THROTTLE], fl[bb + F.THROTTLE], u);
      eng.brake = lerpF(fl[a + F.BRAKE], fl[bb + F.BRAKE], u);
      eng.steer = lerpF(fl[a + F.STEER], fl[bb + F.STEER], u);
      eng.gear = it[(useB ? ib : ia) + I.GEAR];
      eng.limiter = (flags & FLAG_LIMITER) !== 0;
      car.drs.open = (flags & FLAG_DRS) !== 0;
      car.ers.deploying = (flags & FLAG_DEPLOY) !== 0;
      car.ers.harvesting = (flags & FLAG_HARVEST) !== 0;
      car.ers.battery = lerpF(fl[a + F.BATTERY], fl[bb + F.BATTERY], u);
      car.chassis.airborne = (flags & FLAG_AIRBORNE) !== 0;
      car.chassis.held = (flags & FLAG_HELD) !== 0;
      car.chassis.kerbRumble = lerpF(fl[a + F.KERB], fl[bb + F.KERB], u);
      car.chassis.bottoming = lerpF(fl[a + F.BOTTOMING], fl[bb + F.BOTTOMING], u);
      car.collision.active = false;

      car.input.throttle = eng.throttle;
      car.input.brake = eng.brake;
      car.input.steer = eng.steer;
      car.input.drs = car.drs.open;

      if (track) {
        track.project(car.position.x, car.position.z, car.track.s, this.proj);
        car.track.s = this.proj.s;
        car.track.lateral = this.proj.lateral;
        _fwd.copy(_z).applyQuaternion(car.quaternion);
        car.track.forwardSpeed = car.velocity.dot(_fwd);
        car.track.surface = track.surfaceAt(this.proj.s, this.proj.lateral);
        car.track.inPitLane = track.isInPitLane(this.proj.s, this.proj.lateral);
      }
    }
  }
}

const lerpF = (a: number, b: number, u: number): number => a + (b - a) * u;
