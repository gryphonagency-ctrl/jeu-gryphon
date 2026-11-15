/**
 * Shared math helpers. Pure functions, no THREE dependency except where noted.
 * Owned by Lead. Read-only for module agents (add helpers inside your own folder instead).
 */

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const inverseLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v: number, a: number, b: number, c: number, d: number): number => lerp(c, d, inverseLerp(a, b, v));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Frame-rate independent exponential decay toward target. `lambda` ~ 1/time-constant. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Wrap angle to [-PI, PI]. */
export const wrapAngle = (a: number): number => {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
};

/** Shortest signed difference b - a in [-PI, PI]. */
export const angleDelta = (a: number, b: number): number => wrapAngle(b - a);

/** Wrap a value into [0, len). */
export const wrap = (v: number, len: number): number => {
  v = v % len;
  return v < 0 ? v + len : v;
};

/** Signed shortest distance from a to b along a loop of length len, in (-len/2, len/2]. */
export const loopDelta = (a: number, b: number, len: number): number => {
  let d = (b - a) % len;
  if (d > len / 2) d -= len;
  else if (d <= -len / 2) d += len;
  return d;
};

export const kmh = (ms: number): number => ms * 3.6;
export const ms = (kmh: number): number => kmh / 3.6;

/** Deterministic seeded PRNG (mulberry32). Use for anything that must be reproducible. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hiInclusive: number): number {
    return lo + Math.floor(this.next() * (hiInclusive - lo + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
}

/** Hash a string to a 32-bit uint (FNV-1a). */
export const hashString = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** Format seconds as m:ss.mmm (e.g. 1:23.456). Negative/NaN → "--:--.---" */
export const formatLapTime = (t: number): string => {
  if (!isFinite(t) || t <= 0) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

/** Format a gap in seconds as +1.234 (or +1 LAP / +2 LAPS when lapsBehind > 0). */
export const formatGap = (gap: number, lapsBehind = 0): string => {
  if (lapsBehind > 0) return lapsBehind === 1 ? '+1 LAP' : `+${lapsBehind} LAPS`;
  if (!isFinite(gap)) return '--';
  return `+${gap.toFixed(3)}`;
};
