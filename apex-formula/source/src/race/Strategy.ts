import type { TyreCompound } from '../core/constants';

/**
 * Default compound for a stop when the driver has not asked for one.
 * Wet track → inters/wets; drying → medium; dry → soft/medium/hard by the laps remaining (and not the same compound).
 */
export const chooseCompound = (current: TyreCompound, lapsRemaining: number, totalLaps: number, wetness: number, rainTrend: number): TyreCompound => {
  if (wetness > 0.75 || (wetness > 0.6 && rainTrend > 0)) return 'wet';
  if (wetness > 0.45 || (wetness > 0.3 && rainTrend > 0)) return 'intermediate';
  const onRainTyres = current === 'intermediate' || current === 'wet';
  if (onRainTyres) {
    if (wetness < 0.25) return 'medium';
    return 'intermediate';
  }
  if (wetness >= 0.25 && rainTrend >= 0) return 'intermediate';
  const frac = totalLaps > 0 ? lapsRemaining / totalLaps : 0.5;
  let pick: TyreCompound = frac > 0.55 ? 'hard' : frac > 0.28 ? 'medium' : 'soft';
  if (pick === current) pick = pick === 'hard' ? 'medium' : pick === 'medium' ? (frac > 0.4 ? 'hard' : 'soft') : 'medium';
  return pick;
};

/** Suggested lap (1-based) for a one-stop race on the given starting compound. */
export const suggestedStopLap = (compound: TyreCompound, totalLaps: number): number => {
  const frac = compound === 'soft' ? 0.38 : compound === 'medium' ? 0.5 : compound === 'hard' ? 0.62 : 0.5;
  return Math.max(2, Math.round(totalLaps * frac));
};
