/**
 * Internal per-car simulation state. Everything that is not part of the shared CarState contract lives here.
 * All buffers are preallocated in the constructor so the hot loop never allocates.
 */
import * as THREE from 'three';
import type { Assists, CarState, DriverDef, SurfaceType, TeamDef } from '../core/types';
import { BODY_BOX, INERTIA_SCALE } from './tuning';

export class PhysCar {
  readonly state: CarState;
  readonly team: TeamDef;
  readonly driver: DriverDef;
  readonly assists: Assists;

  mass = 900;
  invMass = 1 / 900;
  /** Diagonal inertia tensor in the car frame and its inverse. */
  readonly inertia = new THREE.Vector3();
  readonly invInertia = new THREE.Vector3();
  /** Centre of mass (world). CarState.position is derived from it every step. */
  readonly com = new THREE.Vector3();
  readonly force = new THREE.Vector3();
  readonly torque = new THREE.Vector3();
  readonly prevVel = new THREE.Vector3();
  /** Body axes (world), refreshed at the start of every substep. */
  readonly fwd = new THREE.Vector3(0, 0, 1);
  readonly left = new THREE.Vector3(1, 0, 0);
  readonly up = new THREE.Vector3(0, 1, 0);

  readonly preload = new Float64Array(4);
  readonly travel = new Float64Array(4);
  readonly travelPrev = new Float64Array(4);
  readonly travelRate = new Float64Array(4);
  readonly groundY = new Float64Array(4);
  readonly groundNormal: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  readonly wheelS = new Float64Array(4);
  readonly wheelLat = new Float64Array(4);
  readonly wheelSurface: SurfaceType[] = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
  readonly wheelOmega = new Float64Array(4);
  readonly wheelSteer = new Float64Array(4);
  readonly wheelMu = new Float64Array(4);
  readonly wheelRoll = new Float64Array(4);
  readonly wheelRollV = new Float64Array(4);
  readonly wheelWearMult = new Float64Array(4);
  readonly slipPower = new Float64Array(4);
  readonly driveTorque = new Float64Array(4);
  readonly brakeTorque = new Float64Array(4);
  readonly absFactor = new Float64Array(4);
  readonly lockedPrev: [boolean, boolean, boolean, boolean] = [false, false, false, false];

  /** Road-wheel steering angle after rate limiting (rad, + = left) and the current lock. */
  steer = 0;
  steerLock = 0.3;
  shiftTimer = 0;
  autoShiftTimer = 0;
  tcFactor = 1;
  brakeHold = 0;
  reverseLatch = false;
  /** Seconds of remaining ghosting after a reset (no car-car contact). */
  ghostTimer = 0;
  /** Retired and stopped: permanently ghosted and frozen. */
  parked = false;
  frozen = false;
  slipstream = 0;
  dirtyAir = 0;
  bottomingCooldown = 0;
  hintS = 0;
  prevS = 0;
  /** Per-step scalars parked here so the per-wheel helpers take no double arguments (avoids HeapNumber boxing). */
  stepH = 0;
  upY = 1;
  wet = 0;
  optimalTemp = 100;
  /** Local track frame from the last exact centre projection (see CarSim frameCoords). */
  frameValid = false;
  frameX = 0;
  frameZ = 0;
  frameS = 0;
  frameLat = 0;
  frameK = 0;
  frameTx = 0;
  frameTz = 1;
  frameLx = 1;
  frameLz = 0;
  wheelspinPrev = false;
  airbornePrev = false;
  offtrackPrev = false;
  limiterPrev = false;
  failed = false;
  aeroFactor = 1;
  powerFactor = 1;
  reflectedInertia = 0;
  throttleEff = 0;
  ersDeploy = false;
  ersHarvestPower = 0;
  harvestTorque = 0;
  minClearance = 1;
  kerbWheels = 0;
  aquaF = 1;
  compoundGrip = 1;
  heatMult = 1;
  wearMult = 1;
  fuelEmpty = false;
  anyContact = true;
  accelSmooth = new THREE.Vector3();

  constructor(state: CarState, team: TeamDef, driver: DriverDef, assists: Assists) {
    this.state = state;
    this.team = team;
    this.driver = driver;
    this.assists = { ...assists };
    this.groundNormal = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)];
    this.absFactor.fill(1);
    this.wheelMu.fill(1.7);
    this.wheelRoll.fill(0.012);
    this.wheelWearMult.fill(1);
    this.setMass(state.fuel);
  }

  setMass(fuel: number): void {
    const m = 798 + Math.max(0, fuel);
    this.mass = m;
    this.invMass = 1 / m;
    const { w, h, l } = BODY_BOX;
    const k = (m / 12) * INERTIA_SCALE;
    this.inertia.set(k * (h * h + l * l), k * (w * w + l * l), k * (w * w + h * h));
    this.invInertia.set(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);
  }

  /** Accumulate a world-space force applied at COM-relative offset r. */
  applyForce(f: THREE.Vector3, r: THREE.Vector3): void {
    this.force.add(f);
    this.torque.x += r.y * f.z - r.z * f.y;
    this.torque.y += r.z * f.x - r.x * f.z;
    this.torque.z += r.x * f.y - r.y * f.x;
  }
}
