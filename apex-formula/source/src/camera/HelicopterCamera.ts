import * as THREE from 'three';
import { TAU, damp } from '../core/math';
import type { CarState } from '../core/types';
import { CamPose } from './CamPose';

const _aim = new THREE.Vector3();

/** Slow orbiting helicopter shot: 60–90 m radius, 45–70 m up, gentle bob, narrow lens. */
export class HelicopterCamera {
  private angle = 0.7;
  private t = 0;
  private readonly center = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private hasState = false;

  snap(): void {
    this.hasState = false;
  }

  update(car: CarState, dt: number, pose: CamPose): void {
    this.t += dt;
    this.angle = (this.angle + dt * 0.11) % TAU;
    const p = car.position;
    if (!this.hasState) {
      this.hasState = true;
      this.center.copy(p);
      this.aim.copy(p);
    }
    this.center.x = damp(this.center.x, p.x, 1.6, dt);
    this.center.y = damp(this.center.y, p.y, 1.6, dt);
    this.center.z = damp(this.center.z, p.z, 1.6, dt);
    this.aim.x = damp(this.aim.x, p.x, 4.5, dt);
    this.aim.y = damp(this.aim.y, p.y, 4.5, dt);
    this.aim.z = damp(this.aim.z, p.z, 4.5, dt);

    const radius = 75 + 15 * Math.sin(this.t * 0.07);
    const height = 57.5 + 12.5 * Math.sin(this.t * 0.05 + 1.0);
    pose.position.set(this.center.x + Math.cos(this.angle) * radius, this.center.y + height, this.center.z + Math.sin(this.angle) * radius);

    _aim.copy(this.aim);
    _aim.y += 0.6 + 0.9 * Math.sin(this.t * 0.9) + 0.4 * Math.sin(this.t * 1.7 + 0.5);
    _aim.x += 0.6 * Math.sin(this.t * 0.6 + 2.0);
    pose.lookAt(_aim, 0.01 * Math.sin(this.t * 0.4));
    pose.fov = 35;
  }
}
