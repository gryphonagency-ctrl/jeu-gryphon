import * as THREE from 'three';
import { clamp01 } from '../core/math';
import { CamPose, Z_AXIS, noiseSlow } from './CamPose';

const _q = new THREE.Quaternion();
const _off = new THREE.Vector3();

/** Decaying random positional offset + roll layered on top of the final pose. */
export class CameraShake {
  private amp = 0;
  private time = 0;
  private duration = 0;
  private t = 0;

  add(intensity: number, duration = 0.4): void {
    intensity = clamp01(intensity);
    if (intensity <= 0) return;
    const remaining = Math.max(0, this.duration - this.time);
    const current = this.amp * (remaining > 0 ? (1 - this.time / this.duration) ** 2 : 0);
    if (intensity >= current) {
      this.amp = intensity;
      this.time = 0;
      this.duration = Math.max(duration, remaining);
    } else {
      this.duration = Math.max(this.duration, this.time + duration);
    }
  }

  reset(): void {
    this.amp = 0;
    this.time = 0;
    this.duration = 0;
  }

  /** Applies to `pose` in place. `scale` lets attached cameras (cockpit) use a smaller offset. */
  apply(pose: CamPose, dt: number, scale = 1): void {
    this.t += dt;
    if (this.duration <= 0 || this.time >= this.duration) return;
    this.time += dt;
    const k = this.amp * (1 - clamp01(this.time / this.duration)) ** 2;
    if (k <= 0) return;
    _off.set(noiseSlow(this.t, 0.4), noiseSlow(this.t, 2.6), noiseSlow(this.t, 5.1)).multiplyScalar(0.28 * k * scale);
    _off.applyQuaternion(pose.quaternion);
    pose.position.add(_off);
    pose.quaternion.multiply(_q.setFromAxisAngle(Z_AXIS, 0.035 * k * noiseSlow(this.t, 7.7)));
  }
}
