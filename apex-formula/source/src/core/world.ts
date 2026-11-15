/**
 * Helpers for building/reading World & CarState objects. Owned by Lead.
 */
import * as THREE from 'three';
import { CAR, WHEEL_LOCAL_POSITIONS, type TyreCompound } from './constants';
import type { CarState, DriverInput, EnvironmentState, WeatherState, WheelState } from './types';

export const createDefaultInput = (): DriverInput => ({
  steer: 0,
  throttle: 0,
  brake: 0,
  gearUp: false,
  gearDown: false,
  drs: false,
  ersMode: 'balanced',
  pitLimiter: false,
  pitRequest: false,
  pitCompound: null,
  reset: false,
});

export const copyInput = (from: DriverInput, to: DriverInput): DriverInput => {
  to.steer = from.steer;
  to.throttle = from.throttle;
  to.brake = from.brake;
  to.gearUp = from.gearUp;
  to.gearDown = from.gearDown;
  to.drs = from.drs;
  to.ersMode = from.ersMode;
  to.pitLimiter = from.pitLimiter;
  to.pitRequest = from.pitRequest;
  to.pitCompound = from.pitCompound;
  to.reset = from.reset;
  return to;
};

export const createWheelState = (index: number): WheelState => ({
  worldPos: new THREE.Vector3(...WHEEL_LOCAL_POSITIONS[index]),
  suspensionTravel: 0,
  spinAngle: 0,
  spinRate: 0,
  steerAngle: 0,
  slipRatio: 0,
  slipAngle: 0,
  slip: 0,
  load: 0,
  contact: true,
  surface: 'asphalt',
  temp: 80,
  wear: 0,
  locked: false,
  spinning: false,
});

/** A fully-initialised, stationary CarState. Physics may use this as its starting point. */
export const createEmptyCarState = (id: number, driverId: string, teamId: string, isPlayer: boolean, compound: TyreCompound): CarState => ({
  id,
  driverId,
  teamId,
  isPlayer,
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  velocity: new THREE.Vector3(),
  angularVelocity: new THREE.Vector3(),
  speed: 0,
  speedAbs: 0,
  localAccel: new THREE.Vector3(),
  wheels: [createWheelState(0), createWheelState(1), createWheelState(2), createWheelState(3)],
  engine: { rpm: CAR.idleRpm, gear: 0, throttle: 0, brake: 0, steer: 0, limiter: false, powerKw: 0, health: 1 },
  ers: { battery: 1, mode: 'balanced', deploying: false, harvesting: false },
  drs: { available: false, open: false },
  fuel: CAR.maxFuel,
  tyres: { compound, age: 0, wear: 0, gripFactor: 1 },
  damage: { frontWing: 0, rearWing: 0, floor: 0, suspension: [0, 0, 0, 0], total: 0 },
  track: { s: 0, lateral: 0, lap: 0, progress: 0, sector: 0, surface: 'asphalt', wheelsOff: 0, inPitLane: false, forwardSpeed: 0 },
  chassis: { bottoming: 0, airborne: false, held: false, kerbRumble: 0 },
  collision: { active: false, impulse: 0, withCar: -1, point: new THREE.Vector3(), normal: new THREE.Vector3() },
  status: 'racing',
  gridPosition: 0,
  input: createDefaultInput(),
});

/** Deep copy of the dynamic parts of a CarState into `to` (used by the replay recorder). */
export const copyCarState = (from: CarState, to: CarState): CarState => {
  to.position.copy(from.position);
  to.quaternion.copy(from.quaternion);
  to.velocity.copy(from.velocity);
  to.angularVelocity.copy(from.angularVelocity);
  to.speed = from.speed;
  to.speedAbs = from.speedAbs;
  to.localAccel.copy(from.localAccel);
  for (let i = 0; i < 4; i++) {
    const a = from.wheels[i];
    const b = to.wheels[i];
    b.worldPos.copy(a.worldPos);
    b.suspensionTravel = a.suspensionTravel;
    b.spinAngle = a.spinAngle;
    b.spinRate = a.spinRate;
    b.steerAngle = a.steerAngle;
    b.slipRatio = a.slipRatio;
    b.slipAngle = a.slipAngle;
    b.slip = a.slip;
    b.load = a.load;
    b.contact = a.contact;
    b.surface = a.surface;
    b.temp = a.temp;
    b.wear = a.wear;
    b.locked = a.locked;
    b.spinning = a.spinning;
  }
  Object.assign(to.engine, from.engine);
  Object.assign(to.ers, from.ers);
  Object.assign(to.drs, from.drs);
  to.fuel = from.fuel;
  Object.assign(to.tyres, from.tyres);
  to.damage.frontWing = from.damage.frontWing;
  to.damage.rearWing = from.damage.rearWing;
  to.damage.floor = from.damage.floor;
  to.damage.suspension = [...from.damage.suspension] as [number, number, number, number];
  to.damage.total = from.damage.total;
  Object.assign(to.track, from.track);
  Object.assign(to.chassis, from.chassis);
  to.collision.active = from.collision.active;
  to.collision.impulse = from.collision.impulse;
  to.collision.withCar = from.collision.withCar;
  to.collision.point.copy(from.collision.point);
  to.collision.normal.copy(from.collision.normal);
  to.status = from.status;
  to.gridPosition = from.gridPosition;
  copyInput(from.input, to.input);
  return to;
};

const _fwd = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);

/** World-space forward vector of a car (local +Z). */
export const carForward = (car: CarState, out = _fwd): THREE.Vector3 => out.copy(_z).applyQuaternion(car.quaternion);

/** Yaw of a car (radians, 0 = facing +Z, increases turning left). */
export const carYaw = (car: CarState): number => {
  const f = carForward(car);
  return Math.atan2(f.x, f.z);
};

export const createDefaultWeather = (): WeatherState => ({
  rain: 0,
  wetness: 0,
  cloud: 0.25,
  fog: 0,
  airTempC: 24,
  trackTempC: 38,
  windSpeed: 2,
  windDir: 0.7,
});

export const createEnvironment = (timeOfDay: number): EnvironmentState => ({ timeOfDay, weather: createDefaultWeather() });
