import { FASTEST_LAP_POINT, POINTS_TABLE } from '../core/constants';
import type { RaceState, ResultRow, SessionResults, World } from '../core/types';

/** Build the final classification from `race.entries` (already sorted into final order). */
export const buildResults = (race: RaceState, world: Omit<World, 'race'>): SessionResults => {
  const isRace = race.sessionType === 'race';
  const winner = race.entries[0];
  const fl = race.fastestLap;
  const rows: ResultRow[] = race.entries.map((e, i) => {
    const position = i + 1;
    const classified = e.status === 'finished';
    let time = 0;
    let gap = 0;
    let lapsBehind = 0;
    let points = 0;
    if (isRace) {
      time = classified ? e.finishTime : 0;
      lapsBehind = Math.max(0, winner.lapsCompleted - e.lapsCompleted);
      gap = i === 0 ? 0 : classified && lapsBehind === 0 ? Math.max(0, e.finishTime - winner.finishTime) : classified ? 0 : Infinity;
      if (classified && position <= POINTS_TABLE.length) points = POINTS_TABLE[position - 1];
      if (classified && fl && fl.carId === e.carId && position <= 10) points += FASTEST_LAP_POINT;
    } else {
      time = e.bestLap > 0 ? e.bestLap : 0;
      gap = i === 0 ? 0 : e.bestLap > 0 && winner.bestLap > 0 ? e.bestLap - winner.bestLap : Infinity;
    }
    return {
      position,
      carId: e.carId,
      driverId: e.driverId,
      teamId: e.teamId,
      status: e.status,
      laps: e.lapsCompleted,
      time,
      gap,
      lapsBehind,
      bestLap: e.bestLap,
      pitStops: e.pitStops,
      penaltySeconds: e.penaltySeconds,
      points,
      fastestLap: !!fl && fl.carId === e.carId,
      positionChange: e.gridPosition - position,
    };
  });
  const player = rows.find((r) => r.carId === world.playerCarId);
  return {
    sessionType: race.sessionType,
    circuitId: world.trackDef.id,
    classification: rows,
    fastestLap: fl ? { carId: fl.carId, driverId: race.entryByCar[fl.carId].driverId, time: fl.time } : null,
    playerCarId: world.playerCarId,
    playerPosition: player ? player.position : 0,
    gridDriverIds: rows.map((r) => r.driverId),
  };
};
