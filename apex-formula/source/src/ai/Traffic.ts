/**
 * Per-car traffic awareness: nearest car ahead in my path, nearest car behind, and lateral constraints from cars
 * overlapping me longitudinally. O(n) per car, allocation-free.
 */
import { CAR } from '../core/constants';
import { loopDelta } from '../core/math';
import type { CarState, World } from '../core/types';

/** A car ahead within this lateral distance is followed (the racing line will pull us together). */
export const IN_PATH = 3.4;
/** Narrower path when deliberately going alongside the car we are attacking. */
export const IN_PATH_ATTACK = 2.2;
export const SIDE_CLEARANCE = 2.6;
const OVERLAP = CAR.length + 1.2;
/** Lateral offset below which a longitudinally overlapping car is treated as nose-to-tail rather than alongside. */
const IN_LINE = 1.5;
const NEAR = 14;

export interface Neighbours {
  aheadId: number;
  /** Centre-to-centre distance along the track (m). */
  aheadDs: number;
  aheadDlat: number;
  aheadSpeed: number;
  /** Brake pedal of the car ahead (0..1): lets followers anticipate its deceleration. */
  aheadBrake: number;
  behindId: number;
  behindDs: number;
  behindDlat: number;
  behindSpeed: number;
  /** Hard lateral bounds imposed by cars alongside (±Infinity when free). */
  latMin: number;
  latMax: number;
  /** Soft lateral push away from nearby cars (m). */
  repulse: number;
  alongside: number;
  /** Laterally closest car overlapping me (id -1 when none). */
  sideId: number;
  sideDs: number;
  sideDl: number;
}

export const createNeighbours = (): Neighbours => ({
  aheadId: -1,
  aheadDs: Infinity,
  aheadDlat: 0,
  aheadSpeed: 0,
  aheadBrake: 0,
  behindId: -1,
  behindDs: Infinity,
  behindDlat: 0,
  behindSpeed: 0,
  latMin: -Infinity,
  latMax: Infinity,
  repulse: 0,
  alongside: 0,
  sideId: -1,
  sideDs: 0,
  sideDl: Infinity,
});

export const computeNeighbours = (me: CarState, world: World, out: Neighbours, attackId: number, pathWidth = IN_PATH): void => {
  out.aheadId = -1;
  out.aheadDs = Infinity;
  out.aheadDlat = 0;
  out.aheadSpeed = 0;
  out.aheadBrake = 0;
  out.behindId = -1;
  out.behindDs = Infinity;
  out.behindDlat = 0;
  out.behindSpeed = 0;
  out.latMin = -Infinity;
  out.latMax = Infinity;
  out.repulse = 0;
  out.alongside = 0;
  out.sideId = -1;
  out.sideDs = 0;
  out.sideDl = Infinity;

  const cars = world.cars;
  const len = world.track.length;
  const s = me.track.s;
  const lat = me.track.lateral;
  const myPit = me.track.inPitLane;
  for (let j = 0; j < cars.length; j++) {
    const other = cars[j];
    if (other === me || other.id === me.id) continue;
    if (other.track.inPitLane !== myPit) continue;
    const ds = loopDelta(s, other.track.s, len);
    if (ds > 130 || ds < -80) continue;
    const dl = other.track.lateral - lat;
    const adl = Math.abs(dl);
    if (ds > 0) {
      if (adl < (other.id === attackId ? IN_PATH_ATTACK : pathWidth) && ds < out.aheadDs) {
        out.aheadId = other.id;
        out.aheadDs = ds;
        out.aheadDlat = dl;
        out.aheadSpeed = other.speed;
        out.aheadBrake = other.input.brake;
      }
    } else if (-ds < out.behindDs) {
      out.behindId = other.id;
      out.behindDs = -ds;
      out.behindDlat = dl;
      out.behindSpeed = other.speed;
    }
    const ads = Math.abs(ds);
    // A car in line with me (nose-to-tail) is a following situation, not side-by-side, unless we already interpenetrate.
    if (ads < OVERLAP && (adl > IN_LINE || ads < CAR.length - 1)) {
      out.alongside++;
      if (adl < Math.abs(out.sideDl)) {
        out.sideId = other.id;
        out.sideDs = ds;
        out.sideDl = dl;
      }
      const dir = dl >= 0 ? 1 : -1;
      // Anyone overlapping me longitudinally (even by a wheel) constrains my lateral freedom: never turn into them.
      if (dir > 0) out.latMax = Math.min(out.latMax, other.track.lateral - SIDE_CLEARANCE);
      else out.latMin = Math.max(out.latMin, other.track.lateral + SIDE_CLEARANCE);
      if (adl < 3.8) out.repulse -= dir * (3.8 - adl) * (adl < SIDE_CLEARANCE ? 1.4 : 0.7);
    } else if (ads < NEAR && adl < 3.2) {
      const dir = dl >= 0 ? 1 : -1;
      out.repulse -= dir * (3.2 - adl) * 0.3 * Math.min(1, 1 - (ads - OVERLAP) / (NEAR - OVERLAP));
    }
  }
};
