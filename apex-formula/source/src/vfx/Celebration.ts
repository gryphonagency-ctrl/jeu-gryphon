/**
 * Podium celebration: confetti cannons at the start/finish line in the winner's team colours, and night-race
 * fireworks above the main straight.
 */
import * as THREE from 'three';
import type { TrackSpline } from '../core/track/TrackSpline';
import { SP, type ParticleSystem } from './ParticleSystem';
import { groundPlaneFromSample, rand, randSpread, type GroundPlane } from './util';

const CANNON_DURATION = 4.5;
const MAX_COLOURS = 3;

export class Celebration {
  private cannonTimer = 0;
  private readonly cannonPos = new Float32Array(6);
  private readonly cannonDir = new Float32Array(6);
  private readonly colours = new Float32Array(MAX_COLOURS * 3);
  private colourCount = 0;
  private fireworksTimer = 0;
  private nextBurst = 0;
  private confettiAcc = 0;
  private readonly ground: GroundPlane = { c: -1e9, gx: 0, gz: 0 };
  private readonly sfPos = new THREE.Vector3();
  private readonly sfFwd = new THREE.Vector3();
  private readonly sfLeft = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();

  get active(): boolean {
    return this.cannonTimer > 0 || this.fireworksTimer > 0;
  }

  private setColours(hex: string[]): void {
    this.colourCount = 0;
    for (const h of hex) {
      if (this.colourCount >= MAX_COLOURS) break;
      this.tmpColor.set(h);
      const o = this.colourCount * 3;
      this.colours[o] = this.tmpColor.r;
      this.colours[o + 1] = this.tmpColor.g;
      this.colours[o + 2] = this.tmpColor.b;
      this.colourCount++;
    }
    if (this.colourCount === 0) {
      this.colours.set([1, 0.85, 0.2, 1, 1, 1, 0.9, 0.2, 0.2]);
      this.colourCount = 3;
    }
  }

  /** Fire both cannons at the S/F line for a few seconds. */
  startCannons(track: TrackSpline, teamColours: string[]): void {
    const sm = track.sample(0);
    groundPlaneFromSample(sm, this.ground);
    this.sfPos.copy(sm.position);
    this.sfFwd.set(sm.tangent.x, 0, sm.tangent.z).normalize();
    this.sfLeft.copy(sm.left);
    const off = sm.width / 2 + 3;
    for (let side = 0; side < 2; side++) {
      const sgn = side === 0 ? 1 : -1;
      const o = side * 3;
      this.cannonPos[o] = sm.position.x + sm.left.x * off * sgn;
      this.cannonPos[o + 1] = sm.position.y + 0.4;
      this.cannonPos[o + 2] = sm.position.z + sm.left.z * off * sgn;
      // Up, tilted inward over the track and slightly forward.
      const dx = -sm.left.x * sgn * 0.45 + this.sfFwd.x * 0.15;
      const dz = -sm.left.z * sgn * 0.45 + this.sfFwd.z * 0.15;
      const len = Math.hypot(dx, 1, dz);
      this.cannonDir[o] = dx / len;
      this.cannonDir[o + 1] = 1 / len;
      this.cannonDir[o + 2] = dz / len;
    }
    this.setColours(teamColours);
    this.cannonTimer = CANNON_DURATION;
  }

  /** Fireworks above the main straight for `duration` seconds (night races). */
  startFireworks(track: TrackSpline, duration: number): void {
    if (this.cannonTimer <= 0) {
      const sm = track.sample(0);
      groundPlaneFromSample(sm, this.ground);
      this.sfPos.copy(sm.position);
      this.sfFwd.set(sm.tangent.x, 0, sm.tangent.z).normalize();
      this.sfLeft.copy(sm.left);
    }
    this.fireworksTimer = Math.max(this.fireworksTimer, duration);
    this.nextBurst = Math.min(this.nextBurst, 0.3);
  }

  stop(): void {
    this.cannonTimer = 0;
    this.fireworksTimer = 0;
  }

  update(dt: number, confetti: ParticleSystem, pyro: ParticleSystem): void {
    if (this.cannonTimer > 0) {
      this.cannonTimer -= dt;
      // Front-loaded burst: heavy for the first second then a steady stream.
      const rate = (this.cannonTimer > CANNON_DURATION - 1.0 ? 420 : 140) * (confetti.max / 2500);
      this.confettiAcc += rate * dt;
      const n = Math.floor(this.confettiAcc);
      this.confettiAcc -= n;
      for (let k = 0; k < n; k++) this.spawnConfetti(confetti, k & 1);
    }
    if (this.fireworksTimer > 0) {
      this.fireworksTimer -= dt;
      this.nextBurst -= dt;
      if (this.nextBurst <= 0) {
        this.nextBurst = rand(0.45, 1.1);
        this.spawnFirework(pyro);
      }
    }
  }

  private spawnConfetti(sys: ParticleSystem, side: number): void {
    const o = side * 3;
    const speed = rand(15, 27);
    const ci = (Math.random() * this.colourCount) | 0;
    const shade = rand(0.75, 1.1);
    SP.x = this.cannonPos[o] + randSpread(0.15);
    SP.y = this.cannonPos[o + 1];
    SP.z = this.cannonPos[o + 2] + randSpread(0.15);
    SP.vx = this.cannonDir[o] * speed + randSpread(3.5);
    SP.vy = this.cannonDir[o + 1] * speed + randSpread(2.5);
    SP.vz = this.cannonDir[o + 2] * speed + randSpread(3.5);
    SP.life = rand(5, 8.5);
    SP.size = rand(0.11, 0.19);
    SP.r = this.colours[ci * 3] * shade;
    SP.g = this.colours[ci * 3 + 1] * shade;
    SP.b = this.colours[ci * 3 + 2] * shade;
    SP.a = 1;
    SP.rot = Math.random() * 6.283;
    SP.rotSpeed = randSpread(9);
    SP.gC = this.ground.c;
    SP.gX = this.ground.gx;
    SP.gZ = this.ground.gz;
    sys.spawn();
  }

  private spawnFirework(sys: ParticleSystem): void {
    const along = rand(-140, 90);
    const side = randSpread(45);
    const cx = this.sfPos.x + this.sfFwd.x * along + this.sfLeft.x * side;
    const cz = this.sfPos.z + this.sfFwd.z * along + this.sfLeft.z * side;
    const cy = this.sfPos.y + rand(38, 60);
    const ci = (Math.random() * this.colourCount) | 0;
    // Palette: team colour, or gold / white bursts.
    const pick = Math.random();
    let r: number;
    let g: number;
    let b: number;
    if (pick < 0.5) {
      r = this.colours[ci * 3];
      g = this.colours[ci * 3 + 1];
      b = this.colours[ci * 3 + 2];
    } else if (pick < 0.8) {
      r = 1;
      g = 0.75;
      b = 0.25;
    } else {
      r = 0.9;
      g = 0.95;
      b = 1;
    }
    const count = Math.min(220, Math.max(40, Math.floor(sys.max / 7)));
    const speed = rand(12, 19);
    for (let i = 0; i < count; i++) {
      // Uniform sphere direction.
      const u = Math.random() * 2 - 1;
      const th = Math.random() * 6.283;
      const rr = Math.sqrt(1 - u * u);
      const sp = speed * rand(0.55, 1);
      SP.x = cx;
      SP.y = cy;
      SP.z = cz;
      SP.vx = rr * Math.cos(th) * sp;
      SP.vy = u * sp;
      SP.vz = rr * Math.sin(th) * sp;
      SP.life = rand(1.4, 2.6);
      SP.size = rand(0.8, 1.4);
      const hot = rand(1.2, 2.6);
      SP.r = r * hot + 0.5;
      SP.g = g * hot + 0.45;
      SP.b = b * hot + 0.4;
      SP.a = 1;
      SP.rot = 0;
      SP.rotSpeed = 0;
      SP.gC = -1e9;
      sys.spawn();
    }
    // Flash.
    SP.x = cx;
    SP.y = cy;
    SP.z = cz;
    SP.vx = SP.vy = SP.vz = 0;
    SP.life = 0.3;
    SP.size = 12;
    SP.r = r * 2 + 1;
    SP.g = g * 2 + 1;
    SP.b = b * 2 + 1;
    SP.a = 0.7;
    sys.spawn();
  }
}
