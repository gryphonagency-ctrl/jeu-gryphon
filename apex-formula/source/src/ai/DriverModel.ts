/**
 * Personality constants derived once per car from DriverDef.skill (plus a deterministic sprinkle of variance).
 */
import { lerp } from '../core/math';
import type { Rng } from '../core/math';
import type { DriverDef } from '../core/types';

export interface DriverModel {
  pace: number;
  consistency: number;
  aggression: number;
  racecraft: number;
  wet: number;
  defending: number;
  /** Base reaction time to lights out (s). */
  reaction: number;
  /** Following gap (s) when not attacking. */
  gapTime: number;
  /** Mistakes per second at base conditions. */
  mistakeRate: number;
  /** Stationary std-dev of the slow speed-multiplier noise. */
  speedNoiseStd: number;
  /** Stationary std-dev of the braking-point noise (m). */
  brakeNoiseStd: number;
  /** Per-decision-tick (10 Hz) probability of committing to an overtake when conditions allow. */
  attackProb: number;
  /** Probability of covering the inside when a rival is within range before a braking zone. */
  defendProb: number;
  /** Pit wear-threshold bias (so team-mates do not stop on the same lap). */
  pitBias: number;
}

const DEFAULT_SKILL = { pace: 0.85, consistency: 0.85, aggression: 0.7, racecraft: 0.85, wet: 0.85, defending: 0.85 };

export const buildDriverModel = (def: DriverDef | undefined, rng: Rng): DriverModel => {
  const sk = def ? def.skill : DEFAULT_SKILL;
  const c = sk.consistency;
  return {
    pace: sk.pace,
    consistency: c,
    aggression: sk.aggression,
    racecraft: sk.racecraft,
    wet: sk.wet,
    defending: sk.defending,
    reaction: lerp(0.45, 0.15, 0.5 * c + 0.5 * sk.pace),
    gapTime: lerp(0.42, 0.22, sk.aggression) + lerp(0.08, 0, sk.racecraft),
    mistakeRate: (1 - c) * 0.012 + 0.0004,
    speedNoiseStd: lerp(0.012, 0.002, c),
    brakeNoiseStd: lerp(6, 1.5, c),
    attackProb: 0.01 + 0.06 * sk.aggression,
    defendProb: 0.3 + 0.65 * sk.defending,
    pitBias: rng.range(-0.05, 0.05),
  };
};
