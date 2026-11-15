import type { TrackSample } from '../core/track/TrackSpline';

/** Ground plane y = c + gx·x + gz·z matching the track slope at a sample (flat across the width). */
export interface GroundPlane {
  c: number;
  gx: number;
  gz: number;
}

export const groundPlaneFromSample = (sm: TrackSample, out: GroundPlane): GroundPlane => {
  const t = sm.tangent;
  const h = Math.hypot(t.x, t.z);
  const grade = h > 1e-6 ? t.y / h : 0;
  const hx = h > 1e-6 ? t.x / h : 0;
  const hz = h > 1e-6 ? t.z / h : 1;
  out.gx = grade * hx;
  out.gz = grade * hz;
  out.c = sm.position.y - out.gx * sm.position.x - out.gz * sm.position.z;
  return out;
};

export const groundY = (g: GroundPlane, x: number, z: number): number => g.c + g.gx * x + g.gz * z;

export const rand = (lo: number, hi: number): number => lo + (hi - lo) * Math.random();
export const randSpread = (amount: number): number => (Math.random() * 2 - 1) * amount;
