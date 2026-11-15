/**
 * Core circuit definitions. Owned by Lead. The track module (src/track/circuits.ts) adds more circuits.
 *
 * Authoring notes:
 *  - Top-down mental picture: +X to the right, +Z DOWN the page. Control point 0 is the S/F line; travel starts heading +Z.
 *  - heading θ = atan2(T.x, T.z). LEFT turns INCREASE θ (toward +X when heading +Z). RIGHT turns decrease θ.
 *  - Spacing 50-150 m between points; corners need 2-4 points. The spline is centripetal Catmull-Rom so it will not overshoot.
 *  - The straight before the S/F line must be ≥ 250 m (grid = 20 slots × 8 m + 10 m). Pit entry cp is on that straight; pit exit
 *    cp is shortly after the S/F line, before turn 1 braking.
 */
import type { TrackControlPoint, TrackDefinition } from './types';

type RawPoint = [number, number, number] | [number, number, number, Partial<Omit<TrackControlPoint, 'x' | 'y' | 'z'>>];

/** Scale XZ by `scale`, elevation by `yScale`, and expand attributes. */
export const buildControlPoints = (raw: RawPoint[], scale = 1, yScale = 1): TrackControlPoint[] =>
  raw.map((p) => {
    const [x, y, z, attrs] = p;
    return { x: x * scale, y: y * yScale, z: z * scale, ...(attrs ?? {}) };
  });

const K = 1.35;
const KY = 2.2;

/**
 * KINGSMERE — a classic British parkland circuit: an 850 m pit straight, a fast left-hander into a rising run to a tight hairpin,
 * a flowing esses section over the crest, a long double-apex sweeper, a downhill back straight into a chicane, and a
 * high-speed final double right-hander back onto the straight.
 */
export const KINGSMERE: TrackDefinition = {
  id: 'kingsmere',
  name: 'Kingsmere Circuit',
  grandPrixName: 'Kingsmere Grand Prix',
  country: 'GB',
  location: 'Kingsmere, Northamptonshire',
  defaultWidth: 13,
  controlPoints: buildControlPoints(
    [
      [0, 0, 0, { width: 15, barrierR: 13, barrierL: 26 }], // 0  S/F line
      [0, 0, 280, { width: 15, barrierR: 13, barrierL: 26 }], // 1  end of straight, pit exit rejoins
      [12, 1, 360, { width: 14, kerbL: true }], // 2  T1 Abbey Bend entry (left)
      [60, 2, 420, { kerbL: true, kerbR: true }], // 3  T1 apex
      [150, 3, 445, { kerbR: true }], // 4  T1 exit
      [300, 8, 450], // 5  climbing run
      [390, 10, 440, { width: 15, kerbR: true }], // 6  T2 Millers Hairpin braking (right)
      [430, 11, 480, { width: 15, kerbR: true }], // 7  T2 apex
      [400, 12, 560, { width: 14, kerbL: true }], // 8  T2 exit
      [350, 14, 680], // 9  run over the crest
      [330, 16, 760, { width: 12, kerbL: true }], // 10 esses entry
      [370, 17, 830, { width: 12, kerbL: true, kerbR: true }], // 11 T3 (left)
      [340, 17, 900, { width: 12, kerbR: true, kerbL: true }], // 12 T4 (right)
      [280, 15, 960, { kerbR: true }], // 13 T5 Ravenscar entry (right sweeper)
      [200, 12, 1020, { kerbR: true }], // 14 T5 first apex
      [100, 8, 1050, { kerbR: true, width: 14 }], // 15 T5 second apex
      [10, 5, 1020, { kerbL: true }], // 16 T5 exit
      [-90, 3, 940], // 17 onto the back straight (DRS detection)
      [-170, 0, 800, { width: 14 }], // 18 back straight (DRS start)
      [-220, -3, 640, { width: 14 }], // 19 back straight
      [-240, -5, 480, { width: 14 }], // 20 back straight end (DRS end) — sector 2 ends
      [-235, -5, 400, { kerbR: true }], // 21 Brook Chicane braking
      [-205, -5, 360, { width: 12, kerbR: true, kerbL: true }], // 22 T6 (right)
      [-215, -6, 320, { width: 12, kerbL: true, kerbR: true }], // 23 T7 (left)
      [-250, -6, 270, { kerbR: true }], // 24 chicane exit
      [-300, -4, 150], // 25 run to the final complex
      [-330, -2, 20], // 26
      [-335, 0, -120], // 27
      [-320, 2, -260, { kerbR: true }], // 28 T8 Kingsmere entry (fast right)
      [-280, 3, -360, { kerbR: true }], // 29 T8
      [-200, 4, -420, { kerbR: true, kerbL: true }], // 30 T8 apex
      [-110, 3, -440, { kerbL: true }], // 31 T8 exit
      [-40, 1, -420, { kerbR: true, width: 14 }], // 32 T9 Paddock (right) — DRS detection
      [-5, 0, -350, { kerbL: true, width: 15, barrierR: 13, barrierL: 26 }], // 33 T9 exit onto the pit straight
      [0, 0, -220, { width: 15, barrierR: 13, barrierL: 26 }], // 34 pit entry
    ],
    K,
    KY,
  ),
  sectorEndCps: [9, 20],
  pitLane: { entryCp: 34, exitCp: 1, side: 1 },
  drsZones: [
    { detectionCp: 32, startCp: 34, endCp: 1 },
    { detectionCp: 16, startCp: 18, endCp: 20 },
  ],
  corners: [
    { cp: 3, name: 'Abbey Bend' },
    { cp: 7, name: 'Millers Hairpin' },
    { cp: 11, name: 'The Esses' },
    { cp: 12, name: 'The Esses' },
    { cp: 14, name: 'Ravenscar' },
    { cp: 15, name: 'Ravenscar' },
    { cp: 22, name: 'Brook Chicane' },
    { cp: 23, name: 'Brook Chicane' },
    { cp: 30, name: 'Kingsmere' },
    { cp: 32, name: 'Paddock' },
  ],
  poleSide: 1,
  defaultLaps: 10,
  referenceLapTime: 87.5,
  environment: {
    theme: 'permanent',
    timeOfDay: 15.5,
    weather: 'dry',
    vibe: 'Green English parkland, classic summer Grand Prix, long shadows from oaks along the back straight, packed grandstands',
  },
  description: 'The home of British motorsport. 4.9 km of high-speed sweepers, a rising hairpin and a flat-out final complex.',
};

export const CORE_CIRCUITS: TrackDefinition[] = [KINGSMERE];
