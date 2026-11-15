import * as THREE from 'three';
import { Rng, TAU, clamp, smoothstep } from '../core/math';
import type { TrackSpline } from '../core/track/TrackSpline';
import type { CarState, World } from '../core/types';
import { CamPose } from './CamPose';
import { HelicopterCamera } from './HelicopterCamera';
import { TCamCamera } from './OnboardCameras';
import { TVCameras, TVOperator } from './TVCameras';

const _aim = new THREE.Vector3();
const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _a2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);

/** Menu showroom orbit around the origin (also used whenever there is no world). */
export class MenuOrbit {
  private t = 0;

  reset(): void {
    this.t = 0;
  }

  update(dt: number, pose: CamPose): void {
    this.t += dt;
    const angle = this.t * (TAU / 25) + 0.6;
    const radius = 7.25 + 0.75 * Math.sin(this.t * 0.23);
    const height = 1.3 + 0.3 * Math.sin(this.t * 0.17 + 0.5);
    pose.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    _aim.set(0, 0.55 + 0.05 * Math.sin(this.t * 0.11), 0);
    pose.lookAt(_aim, 0);
    pose.fov = 38;
  }
}

/** Pre-race: a slow dolly down the grid from the back toward the front, then settle behind the player. Loops. */
export class GridFlyover {
  private t = 0;
  private side = 1;
  private track: TrackSpline | null = null;
  private startS = 0;
  private dollyLength = 0;
  private readonly PERIOD = 25;
  private readonly DOLLY = 17;

  reset(): void {
    this.t = 0;
  }

  /** Returns true when the loop wrapped (caller may blend). */
  update(world: World, target: CarState, dt: number, pose: CamPose): boolean {
    const track = world.track;
    if (this.track !== track) {
      this.track = track;
      const back = track.gridSlot(19).s;
      const front = track.gridSlot(0).s;
      this.startS = track.wrapS(back - 18);
      this.dollyLength = track.distanceForward(this.startS, track.wrapS(front + 14));
      this.side = track.def.poleSide;
      this.t = 0;
    }
    this.t += dt;
    let wrapped = false;
    if (this.t >= this.PERIOD) {
      this.t -= this.PERIOD;
      this.side = -this.side;
      wrapped = true;
    }

    // Dolly phase.
    const u = clamp(this.t / this.DOLLY, 0, 1);
    const eased = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
    const s = this.startS + eased * this.dollyLength;
    track.trackToWorld(s, this.side * 6, _p);
    _p.y += 3.5 - 1.2 * eased;
    track.trackToWorld(s + 16, this.side * 1.0, _a2);
    _a2.y += 0.7;

    // Settle phase: above and behind the player car.
    _fwd.copy(_z).applyQuaternion(target.quaternion);
    _p2.copy(target.position).addScaledVector(_fwd, -9);
    _p2.y += 3.2;
    _p2.x += this.side * 1.5;
    _aim.copy(target.position).addScaledVector(_fwd, 3);
    _aim.y += 0.6;

    const k = smoothstep(this.DOLLY - 0.5, this.DOLLY + 2.0, this.t);
    pose.position.lerpVectors(_p, _p2, k);
    _aim.lerpVectors(_a2, _aim, k);
    pose.lookAt(_aim, 0);
    pose.fov = 44 - 6 * k;
    return wrapped;
  }
}

/** Results: slow orbit around the winner. */
export class PodiumOrbit {
  private t = 0;

  reset(): void {
    this.t = 0;
  }

  update(car: CarState, dt: number, pose: CamPose): void {
    this.t += dt;
    const angle = this.t * (TAU / 45) + 2.2;
    const radius = 9;
    const height = 2.0 + 0.35 * Math.sin(this.t * 0.3);
    const p = car.position;
    pose.position.set(p.x + Math.cos(angle) * radius, p.y + height, p.z + Math.sin(angle) * radius);
    _aim.copy(p);
    _aim.y += 0.55;
    pose.lookAt(_aim, 0);
    pose.fov = 34;
  }
}

type Shot = 'tv' | 'onboard' | 'low' | 'heli';

/** Replay auto-director: broadcast-style cuts between trackside, onboard, low and helicopter shots following the target. */
export class ReplayDirector {
  private shot: Shot = 'tv';
  private shotTime = 0;
  private shotDuration = 7;
  private cam = -1;
  private started = false;
  private lastTarget = -1;
  private readonly rng = new Rng(0x5eed);
  private readonly operator = new TVOperator();
  private readonly onboard = new TCamCamera();
  private readonly heli = new HelicopterCamera();

  reset(): void {
    this.started = false;
  }

  /** Returns true on a cut (caller should not blend — broadcast cuts are hard). */
  update(tv: TVCameras, car: CarState, carS: number, dt: number, baseFov: number, pose: CamPose): boolean {
    let cut = false;
    if (!this.started || this.lastTarget !== car.id) {
      this.started = true;
      this.lastTarget = car.id;
      this.shotTime = 0;
      this.beginShot('tv', tv, carS);
      cut = true;
    }
    this.shotTime += dt;

    let expired = this.shotTime >= this.shotDuration;
    if ((this.shot === 'tv' || this.shot === 'low') && this.cam >= 0) {
      const d = tv.deltaTo(this.cam, carS);
      if (d < -30 || d > 330) expired = true;
      // Don't cut while the car is passing right in front of the lens.
      if (expired && d > -30 && d < 10 && this.shotTime < this.shotDuration + 3) expired = false;
    }
    if (expired) {
      this.beginShot(this.nextShot(tv), tv, carS);
      this.shotTime = 0;
      cut = true;
    }

    switch (this.shot) {
      case 'tv':
      case 'low':
        if (this.cam >= 0 && this.cam < tv.cams.length) this.operator.update(tv.cams[this.cam], car, dt, pose);
        else this.heli.update(car, dt, pose);
        break;
      case 'onboard':
        this.onboard.update(car, dt, baseFov, 0, pose);
        break;
      case 'heli':
        this.heli.update(car, dt, pose);
        break;
    }
    return cut;
  }

  private nextShot(tv: TVCameras): Shot {
    const r = this.rng.next();
    const hasLow = tv.cams.some((c) => c.low);
    let next: Shot;
    if (r < 0.5) next = 'tv';
    else if (r < 0.7) next = 'onboard';
    else if (r < 0.85 && hasLow) next = 'low';
    else next = 'heli';
    if (next === this.shot && next !== 'tv') next = 'tv';
    return next;
  }

  private beginShot(shot: Shot, tv: TVCameras, carS: number): void {
    this.shot = shot;
    switch (shot) {
      case 'tv':
        this.cam = tv.pickAhead(carS, 40, 240, false, this.cam);
        this.shotDuration = 6 + 3 * this.rng.next();
        this.operator.snap();
        break;
      case 'low':
        this.cam = tv.pickAhead(carS, 30, 200, true, this.cam);
        this.shotDuration = 5 + 2 * this.rng.next();
        this.operator.snap();
        break;
      case 'onboard':
        this.shotDuration = 4 + 2.5 * this.rng.next();
        this.onboard.snap();
        break;
      case 'heli':
        this.shotDuration = 6 + 2 * this.rng.next();
        this.heli.snap();
        break;
    }
  }
}
