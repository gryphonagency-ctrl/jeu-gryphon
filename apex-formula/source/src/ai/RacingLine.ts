/**
 * Racing line (minimum-curvature path within the track width) and speed profile.
 *
 * The lateral offsets are relaxed with a multi-scale biharmonic (min ∫κ²) Jacobi iteration constrained to the
 * usable width, then the speed profile is built from lateral grip (backward braking pass, forward power pass).
 * Everything is stored in typed arrays; lookups are O(1) by s.
 */
import * as THREE from 'three';
import { angleDelta, clamp, lerp, smoothstep, wrap } from '../core/math';
import type { TrackSample, TrackSpline } from '../core/track/TrackSpline';
import type { RacingLinePoint } from '../core/types';
import { V_TOP, brakeAccel, cornerSpeed, driveAccel, paceMultEff, throttleCapFor } from './VehicleModel';

const SPACING = 2;
const EDGE_MARGIN = 1.6;
const KERB_ALLOWANCE = 0.3;
const SLOW_CORNER_K = 1 / 70;
const SCALES = [64, 44, 32, 22, 16, 11, 8, 6, 4, 3, 2, 1];
const PASSES_PER_SCALE = 45;
const RELAX = 0.5;

/** Pace multipliers for which braking-consistent limit curves are precomputed (interpolated per car). */
export const PACE_MULTS = [0.5, 0.56, 0.62, 0.68, 0.74, 0.8, 0.86, 0.92, 0.98, 1.04, 1.08];
/** Driver target curves brake a little below the car's capability so the controller can hold them. */
const TARGET_BRAKE_FACTOR = 0.92;

const _sm: TrackSample = {
  s: 0,
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  left: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  width: 0,
  curvature: 0,
  grade: 0,
  heading: 0,
  kerbL: false,
  kerbR: false,
  runoffL: 'grass',
  runoffR: 'grass',
  barrierL: 0,
  barrierR: 0,
  sector: 0,
  cpIndex: 0,
};

export class RacingLine {
  readonly n: number;
  readonly ds: number;
  readonly invDs: number;
  readonly length: number;
  readonly lat: Float64Array;
  readonly px: Float64Array;
  readonly pz: Float64Array;
  /** Signed curvature of the line (+ = left). */
  readonly kappa: Float64Array;
  readonly segLen: Float64Array;
  readonly halfWidth: Float64Array;
  /** Corner-limited speed (grip 1, no braking constraint). */
  readonly vCorner: Float64Array;
  /** Corner + braking limited speed at pace 1. */
  readonly vLimit: Float64Array;
  /** Fully achievable profile (braking + power) at pace 1. */
  readonly vProfile: Float64Array;
  readonly braking: Uint8Array;
  readonly points: RacingLinePoint[];
  profileGrip = 1;
  idealLap = 0;

  private readonly lo: Float64Array;
  private readonly hi: Float64Array;
  private readonly cx: Float64Array;
  private readonly cz: Float64Array;
  private readonly lx: Float64Array;
  private readonly lz: Float64Array;
  private readonly limitByMult: Float64Array[];
  private readonly tmpA: Float64Array;
  private readonly tmpB: Float64Array;

  constructor(track: TrackSpline) {
    this.length = track.length;
    this.n = Math.max(64, Math.round(track.length / SPACING));
    this.ds = track.length / this.n;
    this.invDs = 1 / this.ds;
    const n = this.n;
    this.lat = new Float64Array(n);
    this.px = new Float64Array(n);
    this.pz = new Float64Array(n);
    this.kappa = new Float64Array(n);
    this.segLen = new Float64Array(n);
    this.halfWidth = new Float64Array(n);
    this.vCorner = new Float64Array(n);
    this.vLimit = new Float64Array(n);
    this.vProfile = new Float64Array(n);
    this.braking = new Uint8Array(n);
    this.lo = new Float64Array(n);
    this.hi = new Float64Array(n);
    this.cx = new Float64Array(n);
    this.cz = new Float64Array(n);
    this.lx = new Float64Array(n);
    this.lz = new Float64Array(n);
    this.tmpA = new Float64Array(n);
    this.tmpB = new Float64Array(n);
    this.limitByMult = PACE_MULTS.map(() => new Float64Array(n));
    this.points = new Array(n);
    for (let i = 0; i < n; i++) this.points[i] = { s: i * this.ds, lateral: 0, speed: 0, braking: false };

    this.sampleTrack(track);
    this.optimise();
    this.computeGeometry();
    this.computeProfile(1);
  }

  /* ───────────────────────────── construction ───────────────────────────── */

  private sampleTrack(track: TrackSpline): void {
    const n = this.n;
    const kc = this.tmpA;
    for (let i = 0; i < n; i++) {
      track.sample(i * this.ds, _sm);
      this.cx[i] = _sm.position.x;
      this.cz[i] = _sm.position.z;
      this.lx[i] = _sm.left.x;
      this.lz[i] = _sm.left.z;
      this.halfWidth[i] = _sm.width * 0.5;
      kc[i] = _sm.curvature;
    }
    // Smoothed centreline curvature decides where the inside kerb may be used.
    const ks = this.tmpB;
    const win = 5;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let j = -win; j <= win; j++) acc += kc[(i + j + n) % n];
      ks[i] = acc / (2 * win + 1);
    }
    for (let i = 0; i < n; i++) {
      track.sample(i * this.ds, _sm);
      const hw = this.halfWidth[i];
      let lo = -(hw - EDGE_MARGIN);
      let hi = hw - EDGE_MARGIN;
      if (Math.abs(ks[i]) > SLOW_CORNER_K) {
        if (ks[i] > 0 && _sm.kerbL) hi = hw + KERB_ALLOWANCE;
        if (ks[i] < 0 && _sm.kerbR) lo = -(hw + KERB_ALLOWANCE);
      }
      this.lo[i] = lo;
      this.hi[i] = hi;
    }
  }

  private updatePositions(): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      this.px[i] = this.cx[i] + this.lx[i] * this.lat[i];
      this.pz[i] = this.cz[i] + this.lz[i] * this.lat[i];
    }
  }

  private optimise(): void {
    const n = this.n;
    const { lat, px, pz, cx, cz, lx, lz, lo, hi } = this;
    lat.fill(0);
    for (const k of SCALES) {
      if (4 * k >= n / 2) continue;
      const k2 = 2 * k;
      for (let pass = 0; pass < PASSES_PER_SCALE; pass++) {
        this.updatePositions();
        for (let i = 0; i < n; i++) {
          const im1 = (i - k + n) % n;
          const ip1 = (i + k) % n;
          const im2 = (i - k2 + n) % n;
          const ip2 = (i + k2) % n;
          // Stationary point of Σ|P'' |² : P_i = (4(P_{i-1}+P_{i+1}) − (P_{i-2}+P_{i+2})) / 6
          const tx = (4 * (px[im1] + px[ip1]) - (px[im2] + px[ip2])) / 6;
          const tz = (4 * (pz[im1] + pz[ip1]) - (pz[im2] + pz[ip2])) / 6;
          let nl = (tx - cx[i]) * lx[i] + (tz - cz[i]) * lz[i];
          nl = clamp(nl, lo[i], hi[i]);
          lat[i] += RELAX * (nl - lat[i]);
        }
      }
    }
    // Final smoothing to remove clamping kinks.
    const tmp = this.tmpA;
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < n; i++) tmp[i] = (lat[(i - 1 + n) % n] + 2 * lat[i] + lat[(i + 1) % n]) * 0.25;
      for (let i = 0; i < n; i++) lat[i] = clamp(tmp[i], lo[i], hi[i]);
    }
    this.updatePositions();
    for (let i = 0; i < n; i++) this.points[i].lateral = lat[i];
  }

  private computeGeometry(): void {
    const n = this.n;
    const { px, pz, segLen, kappa } = this;
    const hs = this.tmpA;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = px[j] - px[i];
      const dz = pz[j] - pz[i];
      segLen[i] = Math.max(0.05, Math.hypot(dx, dz));
      hs[i] = Math.atan2(dx, dz);
    }
    const raw = this.tmpB;
    for (let i = 0; i < n; i++) {
      const im1 = (i - 1 + n) % n;
      raw[i] = angleDelta(hs[im1], hs[i]) / ((segLen[im1] + segLen[i]) * 0.5);
    }
    const win = 2;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let j = -win; j <= win; j++) acc += raw[(i + j + n) % n];
      kappa[i] = acc / (2 * win + 1);
    }
  }

  /* ───────────────────────────── speed profile ───────────────────────────── */

  /** Backward (braking) pass over `limit` in place, closed loop. */
  private brakingPass(limit: Float64Array, grip: number): void {
    const n = this.n;
    const seg = this.segLen;
    for (let t = 2 * n - 1; t >= 0; t--) {
      const j = t % n;
      const jn = (j + 1) % n;
      const vn = limit[jn];
      const allow = Math.sqrt(vn * vn + 2 * brakeAccel(vn, grip) * seg[j]);
      if (allow < limit[j]) limit[j] = allow;
    }
  }

  /** Forward (power) pass: `out` ← achievable speeds given `limit`. Returns lap time. */
  private powerPass(limit: Float64Array, out: Float64Array, grip: number, throttleCap = 1): number {
    const n = this.n;
    const seg = this.segLen;
    out.set(limit);
    for (let t = 0; t < 2 * n; t++) {
      const j = t % n;
      const jn = (j + 1) % n;
      const v = out[j];
      const allow = Math.sqrt(v * v + 2 * driveAccel(v, grip, throttleCap) * seg[j]);
      if (allow < out[jn]) out[jn] = allow;
    }
    let time = 0;
    for (let j = 0; j < n; j++) time += (2 * seg[j]) / Math.max(1, out[j] + out[(j + 1) % n]);
    return time;
  }

  private fillLimit(out: Float64Array, mult: number, grip: number, brakeFactor: number): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const vc = this.vCorner[i];
      out[i] = Math.min(V_TOP, vc * paceMultEff(vc, mult));
    }
    this.brakingPass(out, grip * brakeFactor);
  }

  /** (Re)compute corner speeds, braking-consistent limits per pace multiplier and the display profile. */
  computeProfile(grip: number): void {
    const n = this.n;
    this.profileGrip = grip;
    for (let i = 0; i < n; i++) this.vCorner[i] = cornerSpeed(this.kappa[i], grip);
    for (let m = 0; m < PACE_MULTS.length; m++) this.fillLimit(this.limitByMult[m], PACE_MULTS[m], grip, TARGET_BRAKE_FACTOR);
    this.fillLimit(this.vLimit, 1, grip, 1);
    this.idealLap = this.powerPass(this.vLimit, this.vProfile, grip);
    for (let i = 0; i < n; i++) {
      const jn = (i + 1) % n;
      const br = this.vProfile[jn] < this.vProfile[i] - 0.03;
      this.braking[i] = br ? 1 : 0;
      const p = this.points[i];
      p.speed = this.vProfile[i];
      p.braking = br;
    }
  }

  /** Estimated lap time for a driver applying pace multiplier `mult` (corner speeds + matching throttle cap). */
  lapTime(mult: number, grip = this.profileGrip): number {
    this.fillLimit(this.tmpA, mult, grip, TARGET_BRAKE_FACTOR);
    return this.powerPass(this.tmpA, this.tmpB, grip, throttleCapFor(mult));
  }

  /** Pace multiplier at which the profile laps in `referenceLap` seconds (bisection), clamped to the sane range. */
  calibrate(referenceLap: number): number {
    let lo = PACE_MULTS[0];
    let hi = PACE_MULTS[PACE_MULTS.length - 1];
    if (this.lapTime(hi) > referenceLap) return hi;
    if (this.lapTime(lo) < referenceLap) return lo;
    // lapTime is monotonic decreasing in mult.
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) * 0.5;
      if (this.lapTime(mid) > referenceLap) lo = mid;
      else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  /* ───────────────────────────── lookups ───────────────────────────── */

  index(s: number): number {
    return wrap(s, this.length) * this.invDs;
  }

  private interp(arr: Float64Array, s: number): number {
    const f = this.index(s);
    const i0 = Math.floor(f);
    const i1 = (i0 + 1) % this.n;
    const u = f - i0;
    const a = arr[i0 % this.n];
    return a + (arr[i1] - a) * u;
  }

  lateralAt(s: number): number {
    return this.interp(this.lat, s);
  }

  kappaAt(s: number): number {
    return this.interp(this.kappa, s);
  }

  halfWidthAt(s: number): number {
    return this.interp(this.halfWidth, s);
  }

  cornerLimitAt(s: number): number {
    return this.interp(this.vCorner, s);
  }

  profileSpeedAt(s: number): number {
    return this.interp(this.vProfile, s);
  }

  /**
   * Braking-consistent target speed at s for a driver with pace multiplier `mult` and grip speed factor `gripSpeed`
   * (= sqrt(grip / profileGrip)); multiplying speeds by a constant keeps the braking curve consistent (decel ∝ grip).
   */
  targetAt(s: number, mult: number, gripSpeed: number): number {
    const mults = PACE_MULTS;
    const last = mults.length - 1;
    let m = 0;
    if (mult <= mults[0]) m = 0;
    else if (mult >= mults[last]) m = last - 1;
    else {
      while (m < last - 1 && mults[m + 1] < mult) m++;
    }
    const mu = clamp((mult - mults[m]) / (mults[m + 1] - mults[m]), 0, 1);
    const a = this.interp(this.limitByMult[m], s);
    const b = this.interp(this.limitByMult[m + 1], s);
    const lim = a + (b - a) * mu;
    // Grip only scales corner-limited speeds; a flat-out section is power-limited and stays at V_TOP.
    return lim * lerp(gripSpeed, 1, smoothstep(0.8 * V_TOP, V_TOP, lim));
  }

  /** Distance (m) to the next braking zone start from s within maxDist, or -1. */
  nextBrakingDistance(s: number, maxDist: number): number {
    const n = this.n;
    let i = Math.floor(this.index(s)) % n;
    const steps = Math.min(n - 1, Math.ceil(maxDist * this.invDs));
    if (this.braking[i]) return 0;
    for (let k = 1; k <= steps; k++) {
      i = (i + 1) % n;
      if (this.braking[i]) return k * this.ds;
    }
    return -1;
  }

  /** Signed curvature of the corner following the braking zone at distance `dBrake` (peak |κ| within the next 160 m). */
  /** Largest |curvature| of the line over the next `dist` metres. */
  maxKappaWithin(s: number, dist: number): number {
    const n = this.n;
    let i = Math.floor(this.index(s)) % n;
    const steps = Math.min(n - 1, Math.ceil(dist * this.invDs));
    let best = 0;
    for (let k = 0; k <= steps; k++) {
      const kk = Math.abs(this.kappa[i]);
      if (kk > best) best = kk;
      i = (i + 1) % n;
    }
    return best;
  }

  cornerDirectionAfter(s: number): number {
    const n = this.n;
    let i = Math.floor(this.index(s)) % n;
    const steps = Math.ceil(160 * this.invDs);
    let best = 0;
    for (let k = 0; k < steps; k++) {
      const kk = this.kappa[i];
      if (Math.abs(kk) > Math.abs(best)) best = kk;
      i = (i + 1) % n;
    }
    return best;
  }
}
