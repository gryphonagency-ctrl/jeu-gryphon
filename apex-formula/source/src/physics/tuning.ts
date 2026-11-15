/**
 * Physics tuning constants. Everything that is "feel" rather than contract lives here.
 * Units: SI (m, s, kg, N, rad) unless stated.
 */
import { CAR } from '../core/constants';
import { DEG2RAD } from '../core/math';

export const SUBSTEPS = 2;

/** Centre of mass: height above the ground plane and longitudinal offset (negative = rearward → ~46 % front weight). */
export const COM_HEIGHT = CAR.cgHeight;
export const COM_Z = -0.144;
/** Inertia of a 1.9 × 0.9 × 5.2 m box, scaled because the mass is concentrated near the centre. */
export const BODY_BOX = { w: 1.9, h: 0.9, l: 5.2 } as const;
export const INERTIA_SCALE = 0.6;

export const SUSP = {
  springF: 160_000,
  springR: 190_000,
  /** F = k·t·(1 + progressive·t²): +48 % at 40 mm. Stands in for heave springs under aero load. */
  progressive: 300,
  bump: 9_000,
  rebound: 13_000,
  arbF: 60_000,
  arbR: 35_000,
  bumpStopTravel: 0.08,
  bumpStopK: 4_000_000,
  maxDroop: 0.04,
  frontShare: 0.46,
  /** Floor clearance below which the plank scrapes (metres) and the stiffness of the skid block. */
  bottomingClearance: 0.012,
  plankK: 600_000,
  plankC: 12_000,
} as const;

export const TYRE = {
  muPeak: 1.75,
  /** Rear tyres are wider: grip bias that keeps the balance towards mild understeer. */
  muAxle: [0.97, 0.97, 1.06, 1.06] as readonly number[],
  loadRef: 3000,
  /** Friction falls ~13 % per doubling of load. */
  loadSens: 0.2,
  kappaPeak: 0.1,
  tanAlphaPeak: Math.tan(7 * DEG2RAD),
  /** Reference speed floor for slip definitions; acts as a viscous damper when crawling. */
  vLow: 2.5,
  inertiaF: 1.2,
  inertiaR: 1.5,
  heatPerJoule: 1 / 130_000,
  rollHeat: 4e-6,
  coolBase: 0.004,
  coolSpeed: 0.0002,
  wearPerJoule: 2.6e-8,
} as const;

export const AERO = {
  /** Total downforce coefficient: N per (m/s)². 16 kN at 250 km/h. */
  cl: 3.32,
  frontShare: 0.44,
  /** Drag coefficient: N per (m/s)². */
  cd: 1.0,
  /** Height above the CoM where drag acts (nose-up moment at speed). */
  dragHeight: 0.25,
  slipstreamRange: 45,
  slipstreamMax: 0.25,
  dirtyAirTime: 1.2,
  dirtyAirMax: 0.12,
  /** Team aero 0.86 → −6 %. */
  aeroPerfSlope: 0.06 / 0.14,
  bottomingDrag: 1500,
} as const;

export const BRAKES = {
  /** Per-wheel max brake torque (N·m): caps peak decel at ≈ 5 g when the aero load would allow more. */
  torqueF: 3_200,
  torqueR: 3_200 * (0.42 / 0.58),
  absTarget: -0.12,
  absRelease: -0.2,
} as const;

export const ENGINE = {
  idle: CAR.idleRpm,
  limiter: CAR.maxRpm,
  shiftTime: 0.06,
  autoUpRpm: 12_900,
  autoDownRpm: 9_500,
  kickdownRpm: 10_800,
  /** Kick-down only if the lower gear lands below this rpm, and no auto shift for `autoHold` s after any shift. */
  kickdownMaxRpm: 12_000,
  autoHold: 0.35,
  inertia: 0.08,
  drivelineEff: 0.95,
  /** Team power 0.89 → −4 %. */
  powerPerfSlope: 0.04 / 0.11,
  engineBrakeBase: 20,
  engineBrakePerRpm: 0.006,
  /** kg/s at full throttle ≈ 1.7 kg per 87 s lap. */
  fuelRate: 0.021,
  /** Viscous limited-slip differential (N·m per rad/s of wheel speed difference). */
  diffLock: 40,
  launchRevs: 5_000,
  revUpRate: 22_000,
  revDownRate: 11_000,
} as const;

export const ERS = {
  capacityJ: 4_000_000,
  deployW: 120_000,
  harvestW: 120_000,
  harvestEff: 0.85,
  mguhW: 18_000,
  deployTorqueCap: 1_300,
  balancedMinBattery: 0.15,
  overtakeMinBattery: 0.02,
  balancedMinSpeed: 110 / 3.6,
} as const;

export const STEER = {
  lockRest: 0.38,
  lockHighSpeed: 0.09,
  lockFixed: 0.3,
  /** Hand speed at the wheel (rad/s of road-wheel angle). */
  rate: 2.5,
  ackermann: 0.3,
  counterSteerGain: 0.7,
  counterSteerDeadband: 0.14,
} as const;

export const COLLISION = {
  halfLength: 2.8,
  halfWidth: 1.0,
  restitutionCar: 0.15,
  frictionCar: 0.5,
  restitutionWall: 0.1,
  frictionWall: 0.45,
  eventImpulse: 400,
  pairCooldown: 0.4,
  /** Δv (m/s) below which no damage is taken and Δv at which a part is destroyed. */
  damageMinDv: 1.5,
  damageFullDv: 22,
} as const;

export const MISC = {
  resetGhostSeconds: 2,
  bottomingEventInterval: 0.5,
  lapLineWindow: 60,
  kerbHeight: 0.018,
  kerbAmplitude: 0.012,
  kerbWavelength: 0.8,
  gravelSink: 0.035,
} as const;
