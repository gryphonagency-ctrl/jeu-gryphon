/**
 * Tyre grip model: a normalised combined-slip magic formula plus the multiplicative grip factors
 * (compound, temperature, wear, surface, wetness, aquaplaning).
 */
import { TYRE_DATA, type TyreCompound } from '../core/constants';
import { clamp01 } from '../core/math';
import type { SurfaceType } from '../core/types';

const MF_B = 6;
/** Shape factor: sliding friction settles at sin(C·π/2) ≈ 0.81 of peak. */
const MF_C = 1.4;
const MF_E = 0.6;

const mfRaw = (x: number): number => {
  const bx = MF_B * x;
  return Math.sin(MF_C * Math.atan(bx - MF_E * (bx - Math.atan(bx))));
};

let xPeak = 1;
let yPeak = 1;
{
  let best = 0;
  let bestX = 0.5;
  for (let x = 0.005; x < 8; x += 0.001) {
    const v = mfRaw(x);
    if (v > best) {
      best = v;
      bestX = x;
    }
  }
  xPeak = bestX;
  yPeak = best;
}

/** Normalised magic formula: input = combined slip in units of "peak slip" (1 = peak), output = grip fraction (1 at peak, ~0.81 sliding). */
export const magicFormula = (s: number): number => mfRaw(s * xPeak) / yPeak;

/** d(magicFormula)/ds at s = 0. */
export const MF_SLOPE0 = (MF_C * MF_B * xPeak) / yPeak;

/** Grip vs temperature: ~0.85 when 30 °C off-window, floor 0.76 when badly overheated (real slicks lose 15–30 %, not half). */
export const tempFactor = (temp: number, optimal: number): number => {
  const d = (temp - optimal) / 30;
  return 1 - 0.15 * Math.min(1.6, d * d);
};

export const wearFactor = (wear: number): number => 1 - 0.2 * wear - 0.3 * Math.max(0, (wear - 0.85) / 0.15);

export const SURFACE_GRIP: Record<SurfaceType, number> = {
  asphalt: 1,
  kerb: 0.92,
  runoff: 0.88,
  pit: 1,
  grass: 0.45,
  gravel: 0.4,
  wall: 0.5,
};

/** Rolling resistance coefficient (× load) and its speed-dependent part (× load × m/s). */
export const SURFACE_ROLL: Record<SurfaceType, number> = {
  asphalt: 0.012,
  kerb: 0.016,
  runoff: 0.03,
  pit: 0.012,
  grass: 0.09,
  gravel: 0.16,
  wall: 0.3,
};
export const SURFACE_ROLL_V: Record<SurfaceType, number> = {
  asphalt: 0,
  kerb: 0,
  runoff: 0,
  pit: 0,
  grass: 0.002,
  gravel: 0.008,
  wall: 0,
};

export const SURFACE_WEAR: Record<SurfaceType, number> = {
  asphalt: 1,
  kerb: 1.3,
  runoff: 1.6,
  pit: 1,
  grass: 1.5,
  gravel: 3,
  wall: 1,
};

export const isRacingSurface = (s: SurfaceType): boolean => s === 'asphalt' || s === 'kerb' || s === 'pit';

/** Compound grip in the current wetness (slicks lose 55 % when fully wet, inters/wets much less). */
export const compoundWetGrip = (compound: TyreCompound, wetness: number): number => {
  const d = TYRE_DATA[compound];
  return d.grip * (1 + (d.wetGrip - 1) * wetness);
};

/** Standing-water grip loss at very high speed. */
export const aquaplaneFactor = (compound: TyreCompound, wetness: number, speed: number): number => {
  if (wetness <= 0.7 || speed <= 69) return 1;
  const f = clamp01((speed - 69) / 15) * clamp01((wetness - 0.7) / 0.3);
  const severity = compound === 'wet' ? 0.25 : compound === 'intermediate' ? 0.4 : 0.55;
  return 1 - severity * f;
};

/** Rain tyres overheat and shred in the dry. */
export const compoundHeatMult = (compound: TyreCompound, wetness: number): number => {
  if (compound === 'intermediate') return 1 + 1.0 * (1 - wetness);
  if (compound === 'wet') return 1 + 1.6 * (1 - wetness);
  return 1 - 0.4 * wetness;
};

export const compoundWearMult = (compound: TyreCompound, wetness: number): number => {
  if (compound === 'intermediate') return 1 + 1.0 * (1 - wetness);
  if (compound === 'wet') return 1 + 2.0 * (1 - wetness);
  return 1 - 0.3 * wetness;
};
