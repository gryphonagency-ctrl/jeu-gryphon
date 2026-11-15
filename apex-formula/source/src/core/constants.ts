/**
 * Global constants shared by every module. Owned by Lead. Read-only for module agents.
 *
 * WORLD CONVENTIONS (memorise these):
 *  - Y is up. The world is built on the XZ plane. Units: metres, seconds, m/s, kg, N, radians.
 *  - Track centreline is a closed 3D spline travelled in the direction of racing (see core/track/TrackSpline.ts).
 *    `s` = arc-length distance along the centreline from the start/finish line, in [0, trackLength).
 *    `lateral` = signed offset from the centreline; POSITIVE = LEFT of the direction of travel.
 *    For a unit tangent T on the XZ plane the left vector is  L = (T.z, 0, -T.x).
 *  - Car LOCAL frame: +Z forward, +X left, +Y up. Car origin = centre of the wheelbase, on the ground contact
 *    plane at static ride height (so the chassis sits slightly above the origin, wheels centres at y = WHEEL_RADIUS).
 *    A car with identity quaternion faces +Z. yaw = Math.atan2(forward.x, forward.z).
 *  - Wheel indices: 0 = FL, 1 = FR, 2 = RL, 3 = RR.
 */

export const PHYSICS_DT = 1 / 120; // fixed physics step
export const MAX_PHYSICS_STEPS_PER_FRAME = 8;

export const GRAVITY = 9.81;

/** Fixed-size grid. 20 cars: 10 teams x 2 drivers. */
export const GRID_SIZE = 20;

/** F1 2022+ regulation-inspired car geometry (metres). */
export const CAR = {
  length: 5.6,
  width: 2.0,
  wheelbase: 3.6,
  /** Z of front/rear axle in car-local space (origin at centre of wheelbase). */
  frontAxleZ: 1.8,
  rearAxleZ: -1.8,
  /** Lateral (X) position of wheel centres. */
  frontTrackHalf: 0.83,
  rearTrackHalf: 0.78,
  wheelRadius: 0.36,
  frontTyreWidth: 0.305,
  rearTyreWidth: 0.405,
  /** Static ride height of the floor above ground. */
  rideHeight: 0.05,
  /** Height of the centre of gravity above ground. */
  cgHeight: 0.28,
  /** Mass without fuel (kg, includes driver). */
  dryMass: 798,
  maxFuel: 110,
  /** Pit lane speed limit (m/s) = 80 km/h. */
  pitSpeedLimit: 80 / 3.6,
  /** Gearbox: 8 forward gears + reverse. */
  gears: 8,
  maxRpm: 15000,
  idleRpm: 4000,
} as const;

/** Wheel local positions (x, y, z) at rest, index order FL, FR, RL, RR. */
export const WHEEL_LOCAL_POSITIONS: ReadonlyArray<readonly [number, number, number]> = [
  [CAR.frontTrackHalf, CAR.wheelRadius, CAR.frontAxleZ],
  [-CAR.frontTrackHalf, CAR.wheelRadius, CAR.frontAxleZ],
  [CAR.rearTrackHalf, CAR.wheelRadius, CAR.rearAxleZ],
  [-CAR.rearTrackHalf, CAR.wheelRadius, CAR.rearAxleZ],
];

/** Track geometry defaults (metres). Per-circuit definitions may override widths. */
export const TRACK = {
  defaultWidth: 13, // full asphalt width
  kerbWidth: 1.6,
  /** Default distance from track edge (outer edge of kerb) to barrier by theme. */
  runoffWidth: { street: 2.5, permanent: 14, desert: 18, forest: 10, coastal: 8 } as Record<string, number>,
  /** Lateral distance of the pit lane centreline from the track centreline. */
  pitLaneOffset: 16,
  pitLaneWidth: 9,
  /** Spacing between pit boxes along the pit lane. */
  pitBoxSpacing: 8.5,
  /** Grid slot spacing (longitudinal, per row of 2) and lateral offset. */
  gridRowSpacing: 8,
  gridLateralOffset: 3.2,
  /** Spline is sampled every N metres for lookups. */
  sampleSpacing: 1.0,
} as const;

/** DRS activation rules. */
export const DRS = {
  /** Gap (seconds) to the car ahead at the detection line required to enable DRS. */
  detectionGap: 1.0,
  /** DRS is enabled for everyone after this many racing laps have started. */
  enabledFromLap: 3,
  dragReductionFactor: 0.82, // multiplier on drag while open
  downforceLossFactor: 0.88, // multiplier on rear downforce while open
} as const;

export const TYRE_COMPOUNDS = ['soft', 'medium', 'hard', 'intermediate', 'wet'] as const;
export type TyreCompound = (typeof TYRE_COMPOUNDS)[number];

export const TYRE_DATA: Record<TyreCompound, { label: string; short: string; color: string; grip: number; wearRate: number; optimalTemp: number; wetGrip: number }> = {
  soft: { label: 'Soft', short: 'S', color: '#ff2a2a', grip: 1.0, wearRate: 1.0, optimalTemp: 100, wetGrip: 0.45 },
  medium: { label: 'Medium', short: 'M', color: '#ffd600', grip: 0.965, wearRate: 0.62, optimalTemp: 95, wetGrip: 0.45 },
  hard: { label: 'Hard', short: 'H', color: '#f2f2f2', grip: 0.93, wearRate: 0.4, optimalTemp: 90, wetGrip: 0.45 },
  intermediate: { label: 'Intermediate', short: 'I', color: '#3ad83a', grip: 0.86, wearRate: 0.7, optimalTemp: 70, wetGrip: 0.9 },
  wet: { label: 'Wet', short: 'W', color: '#2f7cff', grip: 0.8, wearRate: 0.55, optimalTemp: 60, wetGrip: 1.0 },
};

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export const POINTS_TABLE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] as const;
export const FASTEST_LAP_POINT = 1;

export const SESSION_LIMITS = {
  practiceMinutes: 10,
  qualifyingMinutes: 8,
  /** Race laps are configurable in the UI; these are the bounds. */
  minRaceLaps: 3,
  maxRaceLaps: 70,
  defaultRaceLaps: 10,
} as const;

/** Timing thresholds used by RaceDirector and UI. */
export const TIMING = {
  pitStopBaseSeconds: 2.3,
  pitStopVarianceSeconds: 0.9,
  trackLimitsWheelsOff: 4, // all four wheels beyond the white line = off track
  trackLimitsStrikesBeforePenalty: 3,
  timePenaltySeconds: 5,
  lightsIntervalSeconds: 1.0,
  lightsHoldMin: 0.6,
  lightsHoldMax: 2.6,
} as const;
