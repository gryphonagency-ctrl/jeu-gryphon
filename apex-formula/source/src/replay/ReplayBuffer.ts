import type { CarState } from '../core/types';

/** Float32 slots per car per frame. */
export const F = {
  PX: 0,
  PY: 1,
  PZ: 2,
  QX: 3,
  QY: 4,
  QZ: 5,
  QW: 6,
  SPEED: 7,
  /** 4 wheels × (spinAngle, spinRate, steerAngle, suspensionTravel, slip) */
  WHEELS: 8,
  WHEEL_STRIDE: 5,
  RPM: 28,
  THROTTLE: 29,
  BRAKE: 30,
  STEER: 31,
  AX: 32,
  AY: 33,
  AZ: 34,
  KERB: 35,
  BOTTOMING: 36,
  BATTERY: 37,
  COUNT: 38,
} as const;

/** Int8 slots per car per frame. */
export const I = {
  GEAR: 0,
  /** bit0 drs open, bit1 limiter, bit2 deploying, bit3 harvesting, bit4 airborne, bit5 held */
  FLAGS: 1,
  /** bit i = wheel i locked, bit 4+i = wheel i spinning */
  WHEEL_FLAGS: 2,
  /** bit i = wheel i contact */
  CONTACT: 3,
  COUNT: 4,
} as const;

export const FLAG_DRS = 1;
export const FLAG_LIMITER = 2;
export const FLAG_DEPLOY = 4;
export const FLAG_HARVEST = 8;
export const FLAG_AIRBORNE = 16;
export const FLAG_HELD = 32;

/**
 * Fixed-capacity ring buffer of car snapshots. Frame j (0 = oldest) for car c lives at
 * floats[((start + j) % capacity) * carCount + c) * F.COUNT ...]. No allocation after construction.
 */
export class ReplayBuffer {
  readonly capacity: number;
  readonly carCount: number;
  readonly floats: Float32Array;
  readonly ints: Int8Array;
  readonly times: Float64Array;
  private head = 0;
  private _count = 0;

  constructor(capacity: number, carCount: number) {
    this.capacity = Math.max(2, capacity);
    this.carCount = Math.max(1, carCount);
    this.floats = new Float32Array(this.capacity * this.carCount * F.COUNT);
    this.ints = new Int8Array(this.capacity * this.carCount * I.COUNT);
    this.times = new Float64Array(this.capacity);
  }

  get count(): number {
    return this._count;
  }

  get byteLength(): number {
    return this.floats.byteLength + this.ints.byteLength + this.times.byteLength;
  }

  clear(): void {
    this.head = 0;
    this._count = 0;
  }

  /** Physical slot of logical frame j (0 = oldest). */
  slot(j: number): number {
    const start = (this.head - this._count + this.capacity) % this.capacity;
    return (start + j) % this.capacity;
  }

  timeAt(j: number): number {
    return this.times[this.slot(j)];
  }

  floatBase(j: number, car: number): number {
    return (this.slot(j) * this.carCount + car) * F.COUNT;
  }

  intBase(j: number, car: number): number {
    return (this.slot(j) * this.carCount + car) * I.COUNT;
  }

  /** Append a frame from live cars (index === carId). */
  write(cars: CarState[], time: number): void {
    const slot = this.head;
    this.times[slot] = time;
    const n = Math.min(cars.length, this.carCount);
    const fl = this.floats;
    const it = this.ints;
    for (let c = 0; c < n; c++) {
      const car = cars[c];
      let b = (slot * this.carCount + c) * F.COUNT;
      fl[b + F.PX] = car.position.x;
      fl[b + F.PY] = car.position.y;
      fl[b + F.PZ] = car.position.z;
      fl[b + F.QX] = car.quaternion.x;
      fl[b + F.QY] = car.quaternion.y;
      fl[b + F.QZ] = car.quaternion.z;
      fl[b + F.QW] = car.quaternion.w;
      fl[b + F.SPEED] = car.speed;
      let wb = b + F.WHEELS;
      let wheelFlags = 0;
      let contact = 0;
      for (let w = 0; w < 4; w++) {
        const ws = car.wheels[w];
        fl[wb] = ws.spinAngle;
        fl[wb + 1] = ws.spinRate;
        fl[wb + 2] = ws.steerAngle;
        fl[wb + 3] = ws.suspensionTravel;
        fl[wb + 4] = ws.slip;
        wb += F.WHEEL_STRIDE;
        if (ws.locked) wheelFlags |= 1 << w;
        if (ws.spinning) wheelFlags |= 1 << (4 + w);
        if (ws.contact) contact |= 1 << w;
      }
      fl[b + F.RPM] = car.engine.rpm;
      fl[b + F.THROTTLE] = car.engine.throttle;
      fl[b + F.BRAKE] = car.engine.brake;
      fl[b + F.STEER] = car.engine.steer;
      fl[b + F.AX] = car.localAccel.x;
      fl[b + F.AY] = car.localAccel.y;
      fl[b + F.AZ] = car.localAccel.z;
      fl[b + F.KERB] = car.chassis.kerbRumble;
      fl[b + F.BOTTOMING] = car.chassis.bottoming;
      fl[b + F.BATTERY] = car.ers.battery;

      b = (slot * this.carCount + c) * I.COUNT;
      it[b + I.GEAR] = car.engine.gear;
      let flags = 0;
      if (car.drs.open) flags |= FLAG_DRS;
      if (car.engine.limiter) flags |= FLAG_LIMITER;
      if (car.ers.deploying) flags |= FLAG_DEPLOY;
      if (car.ers.harvesting) flags |= FLAG_HARVEST;
      if (car.chassis.airborne) flags |= FLAG_AIRBORNE;
      if (car.chassis.held) flags |= FLAG_HELD;
      it[b + I.FLAGS] = flags;
      it[b + I.WHEEL_FLAGS] = wheelFlags;
      it[b + I.CONTACT] = contact;
    }
    this.head = (this.head + 1) % this.capacity;
    if (this._count < this.capacity) this._count++;
  }
}
