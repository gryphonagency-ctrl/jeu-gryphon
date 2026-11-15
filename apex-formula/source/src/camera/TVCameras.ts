import * as THREE from 'three';
import { Rng, clamp, damp } from '../core/math';
import type { TrackSpline } from '../core/track/TrackSpline';
import type { CarState } from '../core/types';
import { CamPose, noiseSlow } from './CamPose';

export interface TVCam {
  s: number;
  position: THREE.Vector3;
  /** Gravel-level drama camera. */
  low: boolean;
  /** +1 left of travel, -1 right. */
  side: number;
}

const _aim = new THREE.Vector3();
const _toCar = new THREE.Vector3();

/** Trackside broadcast cameras auto-placed from the spline: one per corner (outside) plus straights every ~350 m. */
export class TVCameras {
  cams: TVCam[] = [];
  private track: TrackSpline | null = null;

  build(track: TrackSpline): void {
    this.track = track;
    const cams: TVCam[] = [];
    const rng = new Rng(1234 + Math.round(track.length));
    const corners = track.cornersWithS();

    for (let i = 0; i < corners.length; i++) {
      const cs = track.wrapS(corners[i].s + 12);
      const sm = track.sample(cs);
      // Average curvature around the apex decides which side is the outside.
      let curv = 0;
      for (let d = -30; d <= 30; d += 10) curv += track.sample(cs + d).curvature;
      const side = curv > 3e-4 ? -1 : curv < -3e-4 ? 1 : i % 2 === 0 ? 1 : -1;
      const low = i % 4 === 2;
      const lateral = side * (low ? 11 : 14);
      const position = sm.position.clone().addScaledVector(sm.left, lateral);
      position.y += low ? 0.9 : 5 + 4 * rng.next();
      cams.push({ s: cs, position, low, side });
    }

    // Straights: fill gaps so a car is never more than ~300 m from the next camera.
    let alt = 1;
    for (let s = 0; s < track.length; s += 175) {
      let nearest = Infinity;
      for (const c of cams) nearest = Math.min(nearest, Math.abs(track.deltaS(s, c.s)));
      if (nearest < 110) continue;
      const sm = track.sample(s);
      const side = alt;
      alt = -alt;
      const position = sm.position.clone().addScaledVector(sm.left, side * (sm.width / 2 + 10));
      position.y += 5.5 + 2 * rng.next();
      cams.push({ s: track.wrapS(s), position, low: false, side });
    }

    cams.sort((a, b) => a.s - b.s);
    this.cams = cams;
  }

  /**
   * Best camera ahead of the car: the nearest one whose forward distance lies in [minAhead, maxAhead]; otherwise the
   * nearest ahead; otherwise the nearest at all. Returns -1 with no cameras.
   */
  pickAhead(carS: number, minAhead = 20, maxAhead = 260, lowOnly = false, exclude = -1): number {
    const track = this.track;
    if (!track || this.cams.length === 0) return -1;
    let best = -1;
    let bestD = Infinity;
    let fallback = -1;
    let fallbackD = Infinity;
    let any = -1;
    let anyD = Infinity;
    for (let i = 0; i < this.cams.length; i++) {
      if (i === exclude) continue;
      const c = this.cams[i];
      if (lowOnly && !c.low) continue;
      const d = track.distanceForward(carS, c.s);
      if (d >= minAhead && d <= maxAhead && d < bestD) {
        bestD = d;
        best = i;
      }
      if (d >= minAhead && d < fallbackD) {
        fallbackD = d;
        fallback = i;
      }
      if (d < anyD) {
        anyD = d;
        any = i;
      }
    }
    return best >= 0 ? best : fallback >= 0 ? fallback : any;
  }

  /** Signed along-track distance from the car to camera `index` (+ = camera ahead). */
  deltaTo(index: number, carS: number): number {
    const track = this.track;
    if (!track || index < 0 || index >= this.cams.length) return 0;
    return track.deltaS(carS, this.cams[index].s);
  }
}

/** A broadcast camera operator: pans to follow the car with lag and zooms with distance. */
export class TVOperator {
  private readonly aim = new THREE.Vector3();
  private fov = 30;
  private hasState = false;
  private t = 0;

  snap(): void {
    this.hasState = false;
  }

  update(cam: TVCam, car: CarState, dt: number, pose: CamPose): void {
    this.t += dt;
    const target = car.position;
    if (!this.hasState) {
      this.hasState = true;
      // The operator "finds" the car: start slightly behind it and catch up.
      this.aim.copy(target).addScaledVector(car.velocity, -0.25);
      this.aim.y += 0.6;
      this.fov = 34;
    }
    const lambda = cam.low ? 7 : 5;
    this.aim.x = damp(this.aim.x, target.x, lambda, dt);
    this.aim.y = damp(this.aim.y, target.y + 0.6, lambda, dt);
    this.aim.z = damp(this.aim.z, target.z, lambda, dt);

    const dist = _toCar.subVectors(target, cam.position).length();
    // Keep roughly constant framing (~22 m of visible height at the car) instead of a linear fov ramp.
    const fovTarget = clamp((2 * Math.atan(11 / Math.max(dist, 1)) * 180) / Math.PI, 18, cam.low ? 44 : 40);
    this.fov = damp(this.fov, fovTarget, 3, dt);

    // Hand-held micro-drift, stronger when zoomed in.
    const zoom = (40 - this.fov) / 22;
    const drift = 0.0025 * (0.4 + zoom);
    _aim.copy(this.aim);
    _aim.x += drift * dist * noiseSlow(this.t * 0.35, 1.3) * 0.02;
    _aim.y += drift * dist * noiseSlow(this.t * 0.35, 4.7) * 0.02;

    pose.position.copy(cam.position);
    pose.lookAt(_aim, 0);
    pose.fov = this.fov;
  }
}

/** Gameplay TV mode: automatically selects the camera ahead of the target and cuts when the car passes it. */
export class TVCameraMode {
  private current = -1;
  private readonly operator = new TVOperator();

  snap(): void {
    this.current = -1;
    this.operator.snap();
  }

  update(tv: TVCameras, car: CarState, carS: number, dt: number, pose: CamPose): boolean {
    if (tv.cams.length === 0) return false;
    if (this.current >= 0) {
      const d = tv.deltaTo(this.current, carS);
      if (d < -35 || d > 330) this.current = -1;
    }
    if (this.current < 0) {
      this.current = tv.pickAhead(carS, 20, 260);
      this.operator.snap();
    }
    if (this.current < 0) return false;
    this.operator.update(tv.cams[this.current], car, dt, pose);
    return true;
  }
}
