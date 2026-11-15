import * as THREE from 'three';
import { CAR } from '../core/constants';
import { clamp, damp } from '../core/math';
import type { CarState } from '../core/types';
import { CamPose, FLIP_Y, KMH300, UP, X_AXIS, Z_AXIS, noise1 } from './CamPose';

const TCAM_LOCAL = new THREE.Vector3(0, 0.98, -0.55);
const EYE_LOCAL = new THREE.Vector3(0, 0.78, -0.35);
const NOSE_LOCAL = new THREE.Vector3(0, 0.32, 2.35);

const _off = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

/** Onboard T-cam: rigidly mounted above the airbox with a touch of rotational lag and engine/kerb vibration. */
export class TCamCamera {
  private readonly rot = new THREE.Quaternion();
  private hasState = false;
  private t = 0;

  snap(): void {
    this.hasState = false;
  }

  update(car: CarState, dt: number, baseFov: number, lookBack: number, pose: CamPose): void {
    this.t += dt;
    if (!this.hasState) {
      this.hasState = true;
      this.rot.copy(car.quaternion);
    }
    this.rot.slerp(car.quaternion, 1 - Math.exp(-22 * dt));

    const rpmT = clamp(car.engine.rpm / CAR.maxRpm, 0, 1);
    const amp = 0.003 * rpmT * rpmT + 0.008 * clamp(car.chassis.kerbRumble, 0, 1) + 0.012 * clamp(car.chassis.bottoming, 0, 1);
    _off.copy(TCAM_LOCAL);
    _off.x += amp * noise1(this.t, 1.1);
    _off.y += amp * noise1(this.t, 3.7);
    pose.position.copy(_off).applyQuaternion(car.quaternion).add(car.position);

    pose.quaternion.copy(this.rot).multiply(FLIP_Y);
    if (lookBack > 0) pose.quaternion.multiply(_q.setFromAxisAngle(UP, Math.PI * lookBack));
    if (amp > 0) {
      pose.quaternion.multiply(_q.setFromAxisAngle(Z_AXIS, amp * 0.6 * noise1(this.t, 5.3)));
      pose.quaternion.multiply(_q2.setFromAxisAngle(X_AXIS, amp * 0.4 * noise1(this.t, 7.9)));
    }
    pose.fov = baseFov;
  }
}

/** Helmet camera at the driver's eye point: head bob from the suspension, g-force lean, looks into corners. */
export class CockpitCamera {
  private bob = 0;
  private lean = 0;
  private leanRoll = 0;
  private nod = 0;
  private lookYaw = 0;
  private hasState = false;
  private t = 0;

  snap(): void {
    this.hasState = false;
  }

  update(car: CarState, dt: number, baseFov: number, lookBack: number, pose: CamPose): void {
    this.t += dt;
    const w = car.wheels;
    const travel = (w[0].suspensionTravel + w[1].suspensionTravel + w[2].suspensionTravel + w[3].suspensionTravel) * 0.25;
    const ax = car.localAccel.x;
    const az = car.localAccel.z;
    const bobTarget = -travel * 0.4;
    const leanTarget = clamp(-ax * 0.0035, -0.06, 0.06);
    const leanRollTarget = clamp(-ax * 0.0025, -0.09, 0.09);
    const nodTarget = clamp(az * 0.0012, -0.06, 0.04);
    const lookTarget = clamp(car.engine.steer, -1, 1) * (8 * Math.PI / 180);

    if (!this.hasState) {
      this.hasState = true;
      this.bob = bobTarget;
      this.lean = leanTarget;
      this.leanRoll = leanRollTarget;
      this.nod = nodTarget;
      this.lookYaw = lookTarget;
    }
    this.bob = damp(this.bob, bobTarget, 14, dt);
    this.lean = damp(this.lean, leanTarget, 6, dt);
    this.leanRoll = damp(this.leanRoll, leanRollTarget, 6, dt);
    this.nod = damp(this.nod, nodTarget, 7, dt);
    this.lookYaw = damp(this.lookYaw, lookTarget, 8, dt);

    const rpmT = clamp(car.engine.rpm / CAR.maxRpm, 0, 1);
    const vib = 0.0015 * rpmT * rpmT + 0.006 * clamp(car.chassis.kerbRumble, 0, 1) + 0.01 * clamp(car.chassis.bottoming, 0, 1);

    _off.copy(EYE_LOCAL);
    _off.x += this.lean + vib * noise1(this.t, 0.7) + (lookBack > 0 ? -0.1 * lookBack : 0);
    _off.y += this.bob + vib * noise1(this.t, 2.9);
    pose.position.copy(_off).applyQuaternion(car.quaternion).add(car.position);

    pose.quaternion.copy(car.quaternion).multiply(FLIP_Y);
    pose.quaternion.multiply(_q.setFromAxisAngle(UP, this.lookYaw + Math.PI * 0.92 * lookBack));
    pose.quaternion.multiply(_q.setFromAxisAngle(X_AXIS, this.nod + vib * 0.3 * noise1(this.t, 6.1)));
    pose.quaternion.multiply(_q.setFromAxisAngle(Z_AXIS, this.leanRoll + vib * 0.5 * noise1(this.t, 8.3)));

    const speedT = clamp(car.speedAbs / KMH300, 0, 1);
    pose.fov = baseFov + 8 + 7 * speedT;
  }
}

/** Nose camera: rigid, wide. */
export class NoseCamera {
  update(car: CarState, baseFov: number, pose: CamPose): void {
    pose.position.copy(NOSE_LOCAL).applyQuaternion(car.quaternion).add(car.position);
    pose.quaternion.copy(car.quaternion).multiply(FLIP_Y);
    pose.fov = baseFov + 5;
  }
}
