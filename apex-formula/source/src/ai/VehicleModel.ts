/**
 * Simplified performance envelope the AI assumes for an F1 car. All accelerations in m/s², speeds in m/s.
 * Downforce makes lateral / braking capability grow with speed; power limits acceleration at speed.
 */
import { CAR, GRAVITY, TYRE_DATA, type TyreCompound } from '../core/constants';
import { clamp, lerp, smoothstep } from '../core/math';

export const V_TOP = 93.5; // ≈ 336 km/h
export const WHEELBASE = CAR.wheelbase;
export const MAX_STEER = 0.3;
export const CAR_LENGTH = CAR.length;

const V_REF = 250 / 3.6;
const V_REF2 = V_REF * V_REF;
// Calibrated against the physics module's steady-state cornering tests (≈3.9 g at 270 km/h, loses it near 4.2 g).
const LAT_DF = 2.4 / V_REF2; // g per (m/s)²
const LAT_LOW = 1.45;
const LAT_CAP = 3.9;
const BRAKE_DF = 2.1 / V_REF2;
const BRAKE_LOW = 1.7;
const BRAKE_CAP = 3.8;
const DRAG = 0.00108; // m/s² per (m/s)²
const POWER_OVER_MASS = 760; // W/kg at the wheels (physics: 0–300 km/h in ≈ 11 s)
const TRACTION_G = 1.0;

export const latAccel = (v: number, grip = 1): number => GRAVITY * grip * Math.min(LAT_CAP, LAT_LOW + LAT_DF * v * v);
export const brakeAccel = (v: number, grip = 1): number => GRAVITY * grip * Math.min(BRAKE_CAP, BRAKE_LOW + BRAKE_DF * v * v);
export const dragAccel = (v: number): number => DRAG * v * v;
export const driveAccel = (v: number, grip = 1, throttleCap = 1): number => {
  if (v >= V_TOP) return 0;
  const power = (throttleCap * POWER_OVER_MASS) / Math.max(v, 8);
  const traction = GRAVITY * TRACTION_G * grip;
  return Math.max(0, Math.min(power, traction) - DRAG * v * v);
};

/**
 * Slow pace comes from the speed profile (corner speeds and, via paceMultEff, lower straight-line targets that the
 * driver lifts-and-coasts to). A pedal cap is only a light touch at the very bottom of the range: the physics engine
 * deploys ERS only near full throttle, so part-throttle costs far more than the kinematic model can predict.
 */
export const throttleCapFor = (mult: number): number => clamp(0.85 + 0.15 * ((mult - 0.5) / 0.12), 0.85, 1);

/** Speed at which lateral capability equals v²·k. */
export const cornerSpeed = (k: number, grip = 1): number => {
  k = Math.abs(k);
  if (k < 1e-5) return V_TOP;
  const denom = k - GRAVITY * grip * LAT_DF;
  const vDf = denom > 1e-6 ? Math.sqrt((LAT_LOW * GRAVITY * grip) / denom) : V_TOP;
  const vCap = Math.sqrt((LAT_CAP * GRAVITY * grip) / k);
  return Math.min(vDf, vCap, V_TOP);
};

/** Absolute grip of a compound on a track of given wetness (new soft on a dry track = 1). */
export const compoundGrip = (compound: TyreCompound, wetness: number): number => {
  const w = clamp(wetness, 0, 1);
  switch (compound) {
    case 'intermediate':
      return 0.9 - 0.3 * Math.abs(w - 0.5);
    case 'wet':
      return 0.6 + 0.3 * smoothstep(0.2, 0.75, w);
    default:
      return lerp(1, TYRE_DATA[compound].grip, 0.7) * (1 - 0.45 * w);
  }
};

/** Grip retained at a given wear level (with a cliff near the end). */
export const wearGrip = (wear: number): number => {
  const w = clamp(wear, 0, 1);
  return 1 - 0.1 * w * w - (w > 0.85 ? (w - 0.85) * 1.6 : 0);
};

export const isSlick = (c: TyreCompound): boolean => c === 'soft' || c === 'medium' || c === 'hard';

/** Pace multipliers bite hardest in slow corners; fast corners keep roughly half the deficit, straights none. */
export const paceMultEff = (vCorner: number, mult: number): number => lerp(mult, 1, 0.55 * smoothstep(60, 93, vCorner));
