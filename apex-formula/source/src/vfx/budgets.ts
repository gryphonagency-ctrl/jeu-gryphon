import type { QualityLevel } from '../core/constants';

export const QUALITY_SCALE: Record<QualityLevel, number> = { low: 0.4, medium: 0.7, high: 1, ultra: 1.6 };

/** Particle capacities at quality 'high'. */
export const BASE_BUDGET = {
  smoke: 4000,
  sparks: 3000,
  rain: 12000,
  spray: 6000,
  dust: 2500,
  stones: 500,
  debris: 400,
  confetti: 2500,
  pyro: 1500,
  splash: 600,
} as const;

export type BudgetKey = keyof typeof BASE_BUDGET;

export const budgetFor = (key: BudgetKey, q: QualityLevel): number => Math.round(BASE_BUDGET[key] * QUALITY_SCALE[q]);

export const SKID_SEGMENTS: Record<QualityLevel, { dry: number; wet: number }> = {
  low: { dry: 120, wet: 32 },
  medium: { dry: 180, wet: 40 },
  high: { dry: 240, wet: 48 },
  ultra: { dry: 360, wet: 64 },
};
