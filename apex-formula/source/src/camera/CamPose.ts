import * as THREE from 'three';
import type { CarState } from '../core/types';

export const UP = new THREE.Vector3(0, 1, 0);
export const Z_AXIS = new THREE.Vector3(0, 0, 1);
export const X_AXIS = new THREE.Vector3(1, 0, 0);
export const KMH300 = 300 / 3.6;
/** Cars face +Z but a THREE camera looks down -Z: car quaternion × FLIP_Y = camera looking forward. */
export const FLIP_Y = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _left = new THREE.Vector3();

/** A camera pose (world position, orientation, vertical fov in degrees). */
export class CamPose {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  fov = 70;

  copy(p: CamPose): this {
    this.position.copy(p.position);
    this.quaternion.copy(p.quaternion);
    this.fov = p.fov;
    return this;
  }

  /** Orient toward `target` from the current position with optional roll about the view axis. */
  lookAt(target: THREE.Vector3, roll = 0): this {
    _m.lookAt(this.position, target, UP);
    this.quaternion.setFromRotationMatrix(_m);
    if (roll !== 0) this.quaternion.multiply(_q.setFromAxisAngle(Z_AXIS, roll));
    return this;
  }

  /** Blend from `a` to `b` (position lerp, orientation slerp, fov lerp). */
  lerpPoses(a: CamPose, b: CamPose, t: number): this {
    this.position.lerpVectors(a.position, b.position, t);
    this.quaternion.slerpQuaternions(a.quaternion, b.quaternion, t);
    this.fov = a.fov + (b.fov - a.fov) * t;
    return this;
  }
}

/** Unit horizontal direction for a yaw (0 = +Z, increases turning left toward +X). */
export const dirFromYaw = (yaw: number, out: THREE.Vector3): THREE.Vector3 => out.set(Math.sin(yaw), 0, Math.cos(yaw));

/** Unit horizontal left vector for a yaw. */
export const leftFromYaw = (yaw: number, out: THREE.Vector3): THREE.Vector3 => out.set(Math.cos(yaw), 0, -Math.sin(yaw));

/** Car roll angle (radians, positive = left side up). */
export const carRoll = (car: CarState): number => {
  _left.set(1, 0, 0).applyQuaternion(car.quaternion);
  return Math.asin(Math.max(-1, Math.min(1, _left.y)));
};

/** Cheap deterministic "noise" in -1..1 from summed sines. */
export const noise1 = (t: number, seed: number): number => {
  return 0.55 * Math.sin(t * 61.7 + seed) + 0.3 * Math.sin(t * 113.3 + seed * 1.7) + 0.15 * Math.sin(t * 199.1 + seed * 2.3);
};

/** Slower noise (~5–15 Hz) for hand-held / shake feel. */
export const noiseSlow = (t: number, seed: number): number => {
  return 0.6 * Math.sin(t * 23.1 + seed) + 0.4 * Math.sin(t * 41.7 + seed * 2.1);
};
