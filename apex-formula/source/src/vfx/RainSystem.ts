/**
 * Camera-attached rain volume: a 30×20×30 m box of falling streaks that wraps around the camera. Streaks are
 * velocity-stretched relative to the camera so driving through rain reads as slanted lines coming at you.
 */
import * as THREE from 'three';
import { ParticleSystem, SP } from './ParticleSystem';

const HX = 15;
const HZ = 15;
const Y_BELOW = 8;
const Y_ABOVE = 12;
const H = Y_BELOW + Y_ABOVE;

export class RainSystem extends ParticleSystem {
  private trueVel: Float32Array;
  private placed = 0;
  private rainAlpha = 0.42;

  constructor(capacity: number, texture: THREE.Texture) {
    super({
      name: 'rain',
      capacity,
      texture,
      blend: 'alpha',
      stretch: 0.05,
      stretchMax: 28,
      sizeOverLife: [1, 1],
      fade: [0, 0],
      softNear: 1.2,
      renderOrder: 14,
      manual: true,
    });
    this.trueVel = new Float32Array(this.max * 3);
  }

  override setCapacity(capacity: number): void {
    super.setCapacity(capacity);
    const old = this.trueVel;
    this.trueVel = new Float32Array(this.max * 3);
    this.trueVel.set(old.subarray(0, Math.min(old.length, this.trueVel.length)));
    this.placed = Math.min(this.placed, this.max);
  }

  private place(i: number, camX: number, camY: number, camZ: number, windX: number, windZ: number, fromTop: boolean): void {
    const { pos, data, color } = this.bufs;
    const i3 = i * 3;
    const i4 = i * 4;
    pos[i3] = camX + (Math.random() * 2 - 1) * HX;
    pos[i3 + 1] = fromTop ? camY + Y_ABOVE - Math.random() * 1.5 : camY - Y_BELOW + Math.random() * H;
    pos[i3 + 2] = camZ + (Math.random() * 2 - 1) * HZ;
    const tv = this.trueVel;
    tv[i3] = windX * 0.9 + (Math.random() - 0.5) * 0.8;
    tv[i3 + 1] = -(7.5 + Math.random() * 3.5);
    tv[i3 + 2] = windZ * 0.9 + (Math.random() - 0.5) * 0.8;
    data[i4] = 0;
    data[i4 + 1] = 0.025 + Math.random() * 0.02;
    data[i4 + 2] = 0;
    data[i4 + 3] = Math.random();
    const l = 0.72 + Math.random() * 0.2;
    color[i4] = l * 0.92;
    color[i4 + 1] = l * 0.96;
    color[i4 + 2] = l;
    color[i4 + 3] = this.rainAlpha * (0.6 + Math.random() * 0.4);
  }

  /**
   * @param intensity 0..1 rain
   * @param cam camera world position, camVel camera velocity (m/s)
   * @param ground plane y = gC + gX·x + gZ·z under the camera
   * @param splash optional ground-aligned ring system fed with impacts near the camera
   */
  updateRain(
    dt: number,
    intensity: number,
    cam: THREE.Vector3,
    camVel: THREE.Vector3,
    windX: number,
    windZ: number,
    gC: number,
    gX: number,
    gZ: number,
    splash: ParticleSystem | null,
    splashBudget: number,
  ): void {
    const target = intensity <= 0.01 ? 0 : Math.round(this.max * Math.min(1, Math.pow(intensity, 0.8)));
    const { pos, vel, capacity } = this.bufs;
    const camX = cam.x;
    const camY = cam.y;
    const camZ = cam.z;
    while (this.placed < target && this.placed < capacity) {
      this.place(this.placed, camX, camY, camZ, windX, windZ, false);
      this.placed++;
    }
    const n = Math.min(target, this.placed);
    this.setAliveRaw(n);
    if (n === 0) {
      this.uploadRaw();
      return;
    }
    const tv = this.trueVel;
    const cvx = camVel.x;
    const cvy = camVel.y;
    const cvz = camVel.z;
    let splashes = 0;
    const splashChance = Math.max(0, intensity - 0.3) * 0.9;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      let x = pos[i3] + tv[i3] * dt;
      let y = pos[i3 + 1] + tv[i3 + 1] * dt;
      let z = pos[i3 + 2] + tv[i3 + 2] * dt;
      // Wrap into the camera box (handles teleports too).
      let dx = x - camX;
      if (dx > HX || dx < -HX) {
        dx = ((((dx + HX) % (2 * HX)) + 2 * HX) % (2 * HX)) - HX;
        x = camX + dx;
      }
      let dz = z - camZ;
      if (dz > HZ || dz < -HZ) {
        dz = ((((dz + HZ) % (2 * HZ)) + 2 * HZ) % (2 * HZ)) - HZ;
        z = camZ + dz;
      }
      const gy = gC + gX * x + gZ * z;
      if (y < gy) {
        if (splash && splashes < splashBudget && dx * dx + dz * dz < 14 * 14 && Math.random() < splashChance) {
          splashes++;
          SP.x = x;
          SP.y = gy + 0.015;
          SP.z = z;
          SP.vx = 0;
          SP.vy = 0;
          SP.vz = 0;
          SP.life = 0.28 + Math.random() * 0.15;
          SP.size = 0.06 + Math.random() * 0.05;
          SP.r = 0.85;
          SP.g = 0.9;
          SP.b = 1.0;
          SP.a = 0.55;
          SP.rot = Math.random() * 6.283;
          SP.rotSpeed = 0;
          SP.gC = -1e9;
          splash.spawn();
        }
        y = camY + Y_ABOVE - Math.random() * 2;
        x = camX + (Math.random() * 2 - 1) * HX;
        z = camZ + (Math.random() * 2 - 1) * HZ;
        tv[i3] = windX * 0.9 + (Math.random() - 0.5) * 0.8;
        tv[i3 + 2] = windZ * 0.9 + (Math.random() - 0.5) * 0.8;
      } else if (y > camY + Y_ABOVE + 0.5) {
        y -= H;
      } else if (y < camY - Y_BELOW - 0.5) {
        y += H;
      }
      pos[i3] = x;
      pos[i3 + 1] = y;
      pos[i3 + 2] = z;
      vel[i3] = tv[i3] - cvx;
      vel[i3 + 1] = tv[i3 + 1] - cvy;
      vel[i3 + 2] = tv[i3 + 2] - cvz;
    }
    this.uploadRaw();
  }

  override clear(): void {
    super.clear();
    this.placed = 0;
  }
}
