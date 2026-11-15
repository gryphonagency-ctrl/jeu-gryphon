import * as THREE from 'three';
import { angleDelta, clamp, damp, smoothstep, wrapAngle } from '../core/math';
import type { CarState } from '../core/types';
import { carYaw } from '../core/world';
import { CamPose, KMH300, carRoll, dirFromYaw, leftFromYaw, noise1 } from './CamPose';

const _dir = new THREE.Vector3();
const _left = new THREE.Vector3();
const _aim = new THREE.Vector3();

/**
 * Third-person chase camera. Yaw is a spring-damped follow of the velocity direction (so slides show the car rotating),
 * distance/height and FOV grow with speed, g-forces sway the camera, kerbs and bottoming add a high-frequency jitter.
 */
export class ChaseCamera {
  private readonly far: boolean;
  private yaw = 0;
  private yawVel = 0;
  private readonly pivot = new THREE.Vector3();
  private sway = 0;
  private dip = 0;
  private lag = 0;
  private roll = 0;
  private rumble = 0;
  private t = 0;
  private hasState = false;

  constructor(far: boolean) {
    this.far = far;
  }

  snap(): void {
    this.hasState = false;
  }

  update(car: CarState, dt: number, baseFov: number, lookBack: number, pose: CamPose): void {
    this.t += dt;
    const speed = car.speedAbs;
    const speedT = clamp(speed / KMH300, 0, 1.15);
    const heading = carYaw(car);

    // Follow the velocity direction once moving; fall back to the heading at low speed or when reversing.
    let targetYaw = heading;
    if (speed > 3 && car.speed > -0.5) {
      const v = car.velocity;
      const velYaw = Math.atan2(v.x, v.z);
      const w = smoothstep(3, 12, speed);
      targetYaw = wrapAngle(heading + clamp(angleDelta(heading, velYaw), -1.1, 1.1) * w);
    }

    if (!this.hasState) {
      this.hasState = true;
      this.yaw = targetYaw;
      this.yawVel = 0;
      this.pivot.copy(car.position);
      this.sway = 0;
      this.dip = 0;
      this.lag = 0;
      this.roll = carRoll(car) * 0.2;
      this.rumble = 0;
    }

    // Spring-damper on yaw (sub-stepped for stability at low frame rates).
    const k = 42;
    const c = 10.5;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const acc = k * angleDelta(this.yaw, targetYaw) - c * this.yawVel;
      this.yawVel += acc * h;
      this.yaw = wrapAngle(this.yaw + this.yawVel * h);
    }

    // Pivot follows the car tightly; longitudinal g pulls the camera back under acceleration / forward under braking.
    this.pivot.x = damp(this.pivot.x, car.position.x, 30, dt);
    this.pivot.y = damp(this.pivot.y, car.position.y, 14, dt);
    this.pivot.z = damp(this.pivot.z, car.position.z, 30, dt);
    const ax = car.localAccel.x;
    const az = car.localAccel.z;
    this.lag = damp(this.lag, clamp(az * 0.03, -0.6, 0.9), 4, dt);
    this.dip = damp(this.dip, clamp(-az * 0.012, -0.15, 0.4), 5, dt);
    this.sway = damp(this.sway, clamp(-ax * 0.03, -0.5, 0.5), 5, dt);
    this.roll = damp(this.roll, carRoll(car) * 0.2, 6, dt);
    this.rumble = damp(this.rumble, clamp(car.chassis.kerbRumble, 0, 1) * 0.025 + clamp(car.chassis.bottoming, 0, 1) * 0.05, 18, dt);

    const dist = (this.far ? 13 : 7.5) + 2.0 * clamp(speedT, 0, 1) + this.lag;
    const height = (this.far ? 4.0 : 2.4) + 0.4 * clamp(speedT, 0, 1) - this.dip;
    const viewYaw = this.yaw + Math.PI * lookBack;
    dirFromYaw(viewYaw, _dir);
    leftFromYaw(viewYaw, _left);

    const jx = this.rumble * noise1(this.t, 0.3);
    const jy = this.rumble * noise1(this.t, 2.1);

    pose.position
      .copy(this.pivot)
      .addScaledVector(_dir, -dist)
      .addScaledVector(_left, this.sway + jx);
    pose.position.y += height + jy;

    _aim.copy(this.pivot).addScaledVector(_dir, this.far ? 4 : 6);
    _aim.y += (this.far ? 1.2 : 1.0) - this.dip * 0.5;

    pose.lookAt(_aim, -this.roll + this.rumble * 0.25 * noise1(this.t, 4.2));
    pose.fov = baseFov + (this.far ? 6 : 0) + 8 * speedT;
  }
}
