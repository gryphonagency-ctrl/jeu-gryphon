import type { RaceEntry } from '../core/types';

/** Distance between the gap checkpoints used for broadcast-style time gaps. */
export const CP_SPACING = 20;
/** Heavy work (sorting, gaps, flags) runs once every N physics steps. */
export const CLASSIFY_EVERY = 4;
export const MAX_MESSAGES = 60;

/** Race director's private per-car bookkeeping (never exposed to other modules). */
export interface CarRecord {
  carId: number;
  entry: RaceEntry;
  /** Forward S/F crossings seen (0 = has not crossed yet). */
  crossings: number;
  lastLap: number;
  lastSector: number;
  /** race.time when the current timed lap / sector started; -1 = not timing yet. */
  lapStartTime: number;
  sectorStartTime: number;
  /** Bitmask of sectors already recorded on the current lap. */
  sectorsDone: number;
  /** Keep the previous lap's sector display alive for a moment after the line. */
  sectorHoldUntil: number;
  lapInvalid: boolean;
  lapTouchedPit: boolean;
  /** Car reversed over the S/F line: the next forward crossing is not a lap. */
  backwards: boolean;
  wasOff4: boolean;
  lastLimitsWarning: number;
  invalidMessageLap: number;

  /* gap checkpoint table (ring, keyed by absolute checkpoint index) */
  cpTime: Float64Array;
  cpIdx: Int32Array;
  lastCp: number;
  firstCp: number;
  prevProgress: number;
  prevS: number;

  /* DRS */
  drsZone: number;
  inZone: number;
  drsLastSet: boolean;

  /* pits */
  pitSpeeding: boolean;
  pitStopDuration: number;
  pitStationary: number;
  pitCooldown: number;
  pitBoxIndex: number;

  /* incidents */
  slowTime: number;
  collisionWarnings: number;
  lastCollision: number;
  retiredAt: number;

  /* classification */
  finishOrder: number;
  prevPosition: number;
  /** Cars that may finish their flying lap after the qualifying clock hits zero. */
  mayFinishLap: boolean;

  /* radio bookkeeping */
  lastTyreRadio: number;
  strategyRadioLap: number;
}

export const createRecord = (entry: RaceEntry, pitBoxIndex: number): CarRecord => ({
  carId: entry.carId,
  entry,
  crossings: 0,
  lastLap: 0,
  lastSector: 0,
  lapStartTime: -1,
  sectorStartTime: -1,
  sectorsDone: 0,
  sectorHoldUntil: -1,
  lapInvalid: false,
  lapTouchedPit: false,
  backwards: false,
  wasOff4: false,
  lastLimitsWarning: -Infinity,
  invalidMessageLap: -1,
  cpTime: new Float64Array(0),
  cpIdx: new Int32Array(0),
  lastCp: -1,
  firstCp: -1,
  prevProgress: -1,
  prevS: -1,
  drsZone: -1,
  inZone: -1,
  drsLastSet: false,
  pitSpeeding: false,
  pitStopDuration: 0,
  pitStationary: 0,
  pitCooldown: 0,
  pitBoxIndex,
  slowTime: 0,
  collisionWarnings: 0,
  lastCollision: -Infinity,
  retiredAt: -1,
  finishOrder: 0,
  prevPosition: entry.position,
  mayFinishLap: false,
  lastTyreRadio: -Infinity,
  strategyRadioLap: -1,
});

export const surname = (fullName: string): string => fullName.split(' ').pop() ?? fullName;
