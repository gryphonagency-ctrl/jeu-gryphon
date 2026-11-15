/**
 * ICE torque curve, gear ratios and small powertrain helpers.
 */
import { CAR } from '../core/constants';
import { TAU } from '../core/math';
import { ENGINE } from './tuning';

const RPM_PTS = [0, 2000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 10500, 11000, 11500, 12000, 12500, 13000, 13500, 14000, 14500, 15000, 16000];
const TQ_PTS = [120, 220, 330, 400, 450, 490, 520, 545, 558, 562, 560, 552, 535, 515, 490, 460, 425, 385, 340, 200];
/** Lifts the curve so peak power ≈ 745 kW at 12.5k (ICE alone). */
const TQ_SCALE = 1.1;

/** Crank torque (N·m) at full throttle. Peaks ≈ 620 N·m at 10.5–11k, ≈ 745 kW at 12.5k. */
export const engineTorque = (rpm: number): number => {
  if (rpm <= RPM_PTS[0]) return TQ_PTS[0] * TQ_SCALE;
  const n = RPM_PTS.length;
  if (rpm >= RPM_PTS[n - 1]) return TQ_PTS[n - 1] * TQ_SCALE;
  let i = 1;
  while (i < n - 1 && RPM_PTS[i] < rpm) i++;
  const r0 = RPM_PTS[i - 1];
  const r1 = RPM_PTS[i];
  const u = (rpm - r0) / (r1 - r0);
  return (TQ_PTS[i - 1] + (TQ_PTS[i] - TQ_PTS[i - 1]) * u) * TQ_SCALE;
};

/** Closed-throttle drag torque at the crank (positive number). */
export const engineBrakeTorque = (rpm: number): number => ENGINE.engineBrakeBase + ENGINE.engineBrakePerRpm * rpm;

export const RADS_TO_RPM = 60 / TAU;

/** Road speed (km/h) reached in each gear at 12 500 rpm. */
const GEAR_SPEEDS_KMH = [112, 152, 188, 222, 252, 282, 312, 340];

/** Overall ratio: engine rpm per wheel rpm, gears 1..8. */
export const GEAR_RATIOS: number[] = GEAR_SPEEDS_KMH.map((kmh) => 12500 / (((kmh / 3.6) / CAR.wheelRadius) * RADS_TO_RPM));
export const REVERSE_RATIO = GEAR_RATIOS[0] * 1.15;

export const ratioFor = (gear: number): number => (gear > 0 ? GEAR_RATIOS[Math.min(gear, 8) - 1] : gear < 0 ? -REVERSE_RATIO : 0);
