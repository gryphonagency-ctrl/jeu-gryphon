/**
 * THE CONTRACT. Every module talks to every other module ONLY through the types in this file,
 * the `TrackSpline` class in core/track/TrackSpline.ts, the data in core/teams.ts, and the event bus in core/events.ts.
 *
 * Owned by Lead. Module agents: read-only. If you truly need a new field, add it to YOUR module's internal
 * state, or (last resort) add an OPTIONAL field here with a comment and tell the lead in your final report.
 *
 * See core/constants.ts for world conventions (Y-up, +Z forward car frame, positive lateral = left, wheel order FL FR RL RR).
 */
import type * as THREE from 'three';
import type { TyreCompound, QualityLevel } from './constants';
import type { TrackSpline } from './track/TrackSpline';

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * Static data: teams, drivers, circuits
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export type LiveryStyle = 'solid' | 'split' | 'stripes' | 'gradient' | 'carbon' | 'chevron';

export interface TeamDef {
  id: string;
  name: string;
  /** 3-4 letter short code used in timing tower. */
  shortName: string;
  country: string;
  /** Hex colours (#rrggbb). */
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  liveryStyle: LiveryStyle;
  engineSupplier: string;
  /** 0..1 relative performance factors. 1 = best on the grid. Physics scales power / downforce by these. */
  performance: { power: number; aero: number; reliability: number; pitCrew: number };
  /** Index into the pit lane boxes (0 = first box after pit entry). */
  pitBoxIndex: number;
}

export interface DriverDef {
  id: string;
  name: string;
  /** 3-letter TLA (e.g. "VER"). */
  code: string;
  number: number;
  teamId: string;
  /** ISO-3166 alpha-2 country code. */
  country: string;
  /** Helmet colours: [base, secondary, accent]. */
  helmet: [string, string, string];
  /** 0..1 skills used by AI (and physics for tiny per-driver variance). */
  skill: { pace: number; consistency: number; aggression: number; racecraft: number; wet: number; defending: number };
  bio: string;
}

export type SurfaceType = 'asphalt' | 'kerb' | 'grass' | 'gravel' | 'runoff' | 'pit' | 'wall';
export type TrackTheme = 'permanent' | 'street' | 'desert' | 'forest' | 'coastal';
export type WeatherPreset = 'dry' | 'light-rain' | 'heavy-rain' | 'dynamic';

export interface TrackControlPoint {
  x: number;
  /** Elevation (metres). */
  y: number;
  z: number;
  /** Full asphalt width at this point (metres). Defaults to def.defaultWidth. Interpolated between points. */
  width?: number;
  /** Kerbs present on the left / right for the segment starting at this point. */
  kerbL?: boolean;
  kerbR?: boolean;
  /** Run-off surface beyond the kerb/edge for the segment starting at this point. Default from theme. */
  runoffL?: Exclude<SurfaceType, 'asphalt' | 'kerb' | 'pit' | 'wall'>;
  runoffR?: Exclude<SurfaceType, 'asphalt' | 'kerb' | 'pit' | 'wall'>;
  /** Distance from centreline to the barrier on each side (metres). Default from theme run-off width. */
  barrierL?: number;
  barrierR?: number;
}

export interface TrackCorner {
  /** Control point index where the corner apex roughly is. */
  cp: number;
  name?: string;
}

export interface DrsZoneDef {
  detectionCp: number;
  startCp: number;
  endCp: number;
}

export interface TrackDefinition {
  id: string;
  name: string;
  /** e.g. "Silverbrook Grand Prix". */
  grandPrixName: string;
  country: string;
  location: string;
  /** Closed loop in direction of travel. Control point 0 is the start/finish line. Aim for 25-60 points. */
  controlPoints: TrackControlPoint[];
  defaultWidth: number;
  /** Control point indices where sector 1 and sector 2 END. Sector 3 ends at the S/F line. */
  sectorEndCps: [number, number];
  pitLane: {
    /** Control point where pit entry begins (should be on a straight approaching the S/F line). */
    entryCp: number;
    /** Control point where pit exit rejoins (shortly after the S/F line). */
    exitCp: number;
    /** Which side of the track the pit lane is on: +1 = left of travel, -1 = right. */
    side: 1 | -1;
  };
  drsZones: DrsZoneDef[];
  corners: TrackCorner[];
  /** Pole position side: +1 = left, -1 = right. */
  poleSide: 1 | -1;
  /** Default race distance in laps. */
  defaultLaps: number;
  /** Reference lap time (seconds) a top AI driver should achieve at 100% difficulty. */
  referenceLapTime: number;
  environment: {
    theme: TrackTheme;
    /** Hours 0-24, e.g. 14 = 2pm, 19.5 = sunset, 21 = night race. */
    timeOfDay: number;
    weather: WeatherPreset;
    /** Free-form hint for the renderer/track builder (e.g. "mediterranean harbour", "high desert dusk"). */
    vibe: string;
  };
  /** Short description shown in track select. */
  description: string;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * Session configuration & results
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export type GameMode = 'quick-race' | 'grand-prix' | 'time-trial';
export type SessionType = 'practice' | 'qualifying' | 'race';
export type GridOrderRule = 'performance' | 'random' | 'reverse' | 'qualifying';
export type TractionControlLevel = 'off' | 'medium' | 'full';
export type RacingLineAssist = 'off' | 'corners' | 'full';

export interface Assists {
  tractionControl: TractionControlLevel;
  abs: boolean;
  autoGears: boolean;
  /** Speed-sensitive steering & counter-steer help. */
  steeringAssist: boolean;
  /** Auto-brake into corners (heavy). */
  brakingAssist: boolean;
  racingLine: RacingLineAssist;
  /** Pit limiter engages automatically at pit entry and the car auto-drives through the pit lane. */
  pitAssist: boolean;
  /** ERS deployment is managed automatically. */
  ersAssist: boolean;
  /** DRS opens automatically when available. */
  drsAssist: boolean;
}

export interface SessionConfig {
  mode: GameMode;
  sessionType: SessionType;
  circuitId: string;
  /** Race laps (ignored for practice/qualifying which are time-limited). */
  laps: number;
  playerDriverId: string;
  /** 0..1 (0 = rookie, 1 = alien). */
  aiDifficulty: number;
  /** Number of AI cars (0..19). 19 = full grid. */
  aiCount: number;
  weather: WeatherPreset;
  /** Hours, or -1 to use the circuit default. */
  timeOfDay: number;
  assists: Assists;
  startingCompound: TyreCompound;
  gridOrder: GridOrderRule;
  /** Explicit grid (car driverIds in P1..Pn order) — used when gridOrder === 'qualifying'. */
  gridDriverIds?: string[];
  /** Enable random mechanical failures / crashes for AI. */
  randomEvents: boolean;
}

export type EntryStatus = 'racing' | 'finished' | 'retired' | 'dnf' | 'dsq';

export interface ResultRow {
  position: number;
  carId: number;
  driverId: string;
  teamId: string;
  status: EntryStatus;
  laps: number;
  /** Total race time / best lap for qualifying (seconds). */
  time: number;
  gap: number;
  lapsBehind: number;
  bestLap: number;
  pitStops: number;
  penaltySeconds: number;
  points: number;
  fastestLap: boolean;
  /** Positions gained (+) or lost (-) vs the grid. */
  positionChange: number;
}

export interface SessionResults {
  sessionType: SessionType;
  circuitId: string;
  classification: ResultRow[];
  fastestLap: { carId: number; driverId: string; time: number } | null;
  playerCarId: number;
  /** Player finishing position (1-based). */
  playerPosition: number;
  /** Grid order for the following race (driverIds in P1..Pn order) — set after qualifying. */
  gridDriverIds: string[];
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * Live simulation state: cars (owned + mutated in place by physics), race (owned by race director)
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export type ErsMode = 'harvest' | 'balanced' | 'overtake';

/**
 * Per-step driver commands. Produced by InputSystem (player) and AIDrivers (AI), consumed by physics.
 * Booleans marked EDGE are pulses that must be true for exactly one physics step.
 */
export interface DriverInput {
  /** -1..1. POSITIVE = steer LEFT (consistent with +lateral = left and +yaw rate = turning left). */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** EDGE: shift up / down this step. Ignored when Assists.autoGears is on. */
  gearUp: boolean;
  gearDown: boolean;
  /** Hold to request DRS open (only opens when CarState.drs.available). */
  drs: boolean;
  ersMode: ErsMode;
  /** Pit limiter state (toggle handled by input system). */
  pitLimiter: boolean;
  /** Sticky flag: wants to enter the pits at the end of this lap. */
  pitRequest: boolean;
  /** Compound wanted at the next stop (AI sets this; null = let the race director's strategy pick). */
  pitCompound: TyreCompound | null;
  /** EDGE: player asks to be reset onto the track. */
  reset: boolean;
}

export interface WheelState {
  /** World position of the wheel centre (physics writes every step). */
  worldPos: THREE.Vector3;
  /** Suspension compression in metres from rest (+ = compressed). Range roughly -0.03 .. 0.08. */
  suspensionTravel: number;
  /** Accumulated rotation about the axle (radians). Visuals apply directly. */
  spinAngle: number;
  /** Angular speed (rad/s). */
  spinRate: number;
  /** Steering angle (radians, + = left) — non-zero only for wheels 0 and 1. */
  steerAngle: number;
  /** Longitudinal slip ratio (-1..1+) and lateral slip angle (radians). */
  slipRatio: number;
  slipAngle: number;
  /** Combined slip magnitude 0..1+ (1 ≈ peak grip, >1 sliding). Drive smoke / squeal from this. */
  slip: number;
  /** Vertical load (N). 0 when airborne. */
  load: number;
  contact: boolean;
  surface: SurfaceType;
  /** °C */
  temp: number;
  /** 0 = new, 1 = destroyed. */
  wear: number;
  locked: boolean;
  spinning: boolean;
}

export interface CarState {
  id: number;
  driverId: string;
  teamId: string;
  isPlayer: boolean;
  /** Pose: origin at centre of wheelbase on the ground plane; local +Z forward. */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  /** Forward speed (m/s, signed) and absolute speed. */
  speed: number;
  speedAbs: number;
  /** Acceleration in car-local frame (m/s²): x lateral (+left), y vertical, z longitudinal. For g-force UI, camera shake, audio. */
  localAccel: THREE.Vector3;
  wheels: [WheelState, WheelState, WheelState, WheelState];
  engine: {
    rpm: number;
    /** 0 = neutral, 1..8 forward, -1 reverse. */
    gear: number;
    throttle: number;
    brake: number;
    steer: number;
    /** True while bouncing off the rev limiter. */
    limiter: boolean;
    /** kW being delivered right now. */
    powerKw: number;
    /** 0..1 engine health. */
    health: number;
  };
  ers: {
    /** 0..1 battery charge. */
    battery: number;
    mode: ErsMode;
    /** True while electrical power is being deployed / harvested this step. */
    deploying: boolean;
    harvesting: boolean;
  };
  drs: {
    /** Race director grants availability (in an active zone, gap condition met, DRS enabled). */
    available: boolean;
    /** Flap is physically open. */
    open: boolean;
  };
  /** kg of fuel remaining. */
  fuel: number;
  tyres: {
    compound: TyreCompound;
    /** Laps on this set. */
    age: number;
    /** 0..1 average wear. */
    wear: number;
    /** Effective grip multiplier (temperature × wear × compound). */
    gripFactor: number;
  };
  damage: {
    /** 0 = pristine .. 1 = destroyed. */
    frontWing: number;
    rearWing: number;
    floor: number;
    suspension: [number, number, number, number];
    total: number;
  };
  track: {
    /** Arc length along the centreline [0, length). */
    s: number;
    /** Signed lateral offset (+ left). */
    lateral: number;
    /** Laps started (0 on the grid; increments each time the S/F line is crossed forward). */
    lap: number;
    /** Total progress in metres = lap * length + s (monotonic while driving forward). */
    progress: number;
    /** 0, 1 or 2. */
    sector: number;
    /** Surface under the car centre. */
    surface: SurfaceType;
    /** Number of wheels beyond the track edge (asphalt+kerb). 4 = off track. */
    wheelsOff: number;
    /** True when travelling in the pit lane corridor. */
    inPitLane: boolean;
    /** Signed speed along the track direction (m/s). Negative = going backwards. */
    forwardSpeed: number;
  };
  /** Physics flags. */
  chassis: {
    /** 0..1 floor scraping intensity this step (sparks!). */
    bottoming: number;
    airborne: boolean;
    /** Frozen in place (grid, pit stop, replay). */
    held: boolean;
    /** 0..1 kerb vibration intensity. */
    kerbRumble: number;
  };
  /** Set by physics when it detects a collision this step (cleared next step). */
  collision: { active: boolean; impulse: number; withCar: number; point: THREE.Vector3; normal: THREE.Vector3 };
  status: EntryStatus;
  gridPosition: number;
  /** Current effective input (after assists). */
  input: DriverInput;
}

export type RacePhase =
  | 'idle'
  | 'formation' // cars settling on grid, camera flyover
  | 'lights' // 5 red lights sequence
  | 'green' // lights out, first seconds
  | 'racing'
  | 'safety-car'
  | 'vsc'
  | 'red-flag'
  | 'finished' // leader took the flag; others finishing
  | 'complete'; // everyone classified

export type FlagType = 'green' | 'yellow' | 'double-yellow' | 'red' | 'blue' | 'chequered' | 'black-white' | 'sc' | 'vsc';
export type SectorStatus = 'none' | 'yellow' | 'green' | 'purple';
export type PenaltyType = 'time' | 'drive-through' | 'warning' | 'disqualification';
export type PitPhase = 'none' | 'requested' | 'entering' | 'in-lane' | 'stopped' | 'released' | 'exiting';

export interface RaceEntry {
  carId: number;
  driverId: string;
  teamId: string;
  position: number;
  gridPosition: number;
  lap: number;
  lapsCompleted: number;
  status: EntryStatus;
  /** Seconds behind the leader (or interval to car ahead). Infinity if incomparable. */
  gapToLeader: number;
  interval: number;
  lapsBehind: number;
  lastLap: number;
  bestLap: number;
  /** Current lap sector times so far (0 = not yet set). */
  currentSectors: [number, number, number];
  bestSectors: [number, number, number];
  currentSectorStatus: [SectorStatus, SectorStatus, SectorStatus];
  /** Live lap time so far. */
  currentLapTime: number;
  lapTimes: number[];
  pitStops: number;
  pitPhase: PitPhase;
  /** Seconds remaining of an in-progress stop. */
  pitStopTimer: number;
  requestedCompound: TyreCompound | null;
  tyreCompound: TyreCompound;
  tyreAge: number;
  penaltySeconds: number;
  warnings: number;
  penalties: { type: PenaltyType; seconds: number; reason: string; lap: number }[];
  drsAvailable: boolean;
  drsOpen: boolean;
  /** Track position at the DRS detection line (gap to car ahead, s). */
  drsDetectionGap: number;
  /** Total race time at finish (seconds). */
  finishTime: number;
  /** Set when the car is under blue flags (a faster car is lapping it). */
  blueFlag: boolean;
  /** Deltas for the HUD: to car ahead/behind in seconds, updated live. */
  deltaAhead: number;
  deltaBehind: number;
  retireReason: string;
}

export interface WeatherState {
  /** 0..1 intensity of falling rain. */
  rain: number;
  /** 0..1 track wetness (lags rain). */
  wetness: number;
  /** 0..1 cloud cover. */
  cloud: number;
  /** 0..1 fog/haze. */
  fog: number;
  airTempC: number;
  trackTempC: number;
  /** m/s and radians (direction wind blows toward, XZ plane, 0 = +Z). */
  windSpeed: number;
  windDir: number;
}

export interface EnvironmentState {
  /** Hours 0-24 (fractional). Advances slowly during a session. */
  timeOfDay: number;
  weather: WeatherState;
}

export interface RaceControlMessage {
  time: number;
  text: string;
  kind: 'info' | 'flag' | 'penalty' | 'drs' | 'pit' | 'radio' | 'warning';
  carId?: number;
}

export interface RaceState {
  sessionType: SessionType;
  phase: RacePhase;
  /** Seconds since session start (running clock; frozen during formation). */
  time: number;
  /** For timed sessions: seconds remaining. -1 for races. */
  timeRemaining: number;
  /** 0..5 lights currently lit during 'lights' phase. */
  lightsOn: number;
  totalLaps: number;
  leaderLap: number;
  /** Sorted by position. Stable objects (mutated in place). */
  entries: RaceEntry[];
  /** entryByCar[carId] → same objects as in entries. */
  entryByCar: RaceEntry[];
  /** Flag per sector (0..2). */
  sectorFlags: [FlagType, FlagType, FlagType];
  globalFlag: FlagType;
  /** DRS enabled race-wide (after lap DRS.enabledFromLap, dry, no SC). */
  drsEnabled: boolean;
  fastestLap: { carId: number; time: number; lap: number } | null;
  /** Newest last. UI shows the tail. */
  messages: RaceControlMessage[];
  /** Safety car / VSC delta target speed (m/s) when applicable. */
  safetyCarSpeed: number;
  results: SessionResults | null;
}

export interface RacingLinePoint {
  s: number;
  lateral: number;
  /** Target speed (m/s). */
  speed: number;
  /** True in braking zones. */
  braking: boolean;
}

export type WorldMode = 'live' | 'replay';

/** The single shared world object created by main.ts. Everything reads it. Physics/RaceDirector mutate their parts. */
export interface World {
  mode: WorldMode;
  config: SessionConfig;
  trackDef: TrackDefinition;
  track: TrackSpline;
  /** Stable array of stable objects, index === carId. During replay, main swaps this for replay frames. */
  cars: CarState[];
  race: RaceState;
  env: EnvironmentState;
  playerCarId: number;
  /** Total simulated time (s). */
  time: number;
  /** Real (wall) time elapsed (s), unaffected by pause. */
  realTime: number;
  paused: boolean;
  /** Provided by AIDrivers after session creation. Null until then. */
  racingLine: RacingLinePoint[] | null;
  teams: TeamDef[];
  drivers: DriverDef[];
  /** Lookups. */
  teamById: Record<string, TeamDef>;
  driverById: Record<string, DriverDef>;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * Module interfaces
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export interface RenderStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  quality: QualityLevel;
}

/** src/render — Agent 1 */
export interface IRenderSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  /** All per-session content (track, cars, vfx) is parented here. `clearSession()` empties & disposes it. */
  readonly sessionGroup: THREE.Group;
  /** Rebuild sky, sun, fog, lighting rig and post-processing look for a circuit. Call before building the track. */
  setEnvironment(def: TrackDefinition, env: EnvironmentState): void;
  setCamera(camera: THREE.PerspectiveCamera): void;
  setSplitCameras(cameras: readonly THREE.PerspectiveCamera[] | null): void;
  setQuality(q: QualityLevel): void;
  getQuality(): QualityLevel;
  /** Per frame before render(): sun position from env.timeOfDay, weather look, exposure, shadow follow camera, etc. */
  update(world: World | null, camera: THREE.PerspectiveCamera, dt: number): void;
  render(): void;
  resize(width: number, height: number): void;
  getStats(): RenderStats;
  clearSession(): void;
  /** Menu background: a slowly-drifting beauty look (no world). */
  setMenuMode(enabled: boolean): void;
  dispose(): void;
}

/** src/track — Agent 2 */
export interface ITrackBuilder {
  /**
   * Build all visual geometry for a circuit (asphalt, kerbs, run-off, barriers, fences, pit complex, grid, gantry,
   * grandstands, crowd, buildings, trees, sponsor boards, marshal posts, lights...) into `parent`.
   * Async: yield to the event loop between chunks and report progress 0..1 so the loading screen can update.
   */
  build(def: TrackDefinition, track: TrackSpline, parent: THREE.Object3D, onProgress: (progress: number, label: string) => void): Promise<void>;
  /** Per frame: crowd animation, flag waving, marshal flags (world.race.sectorFlags), start lights (world.race.lightsOn), DRS boards, LOD. */
  update(world: World, camera: THREE.PerspectiveCamera, dt: number): void;
  setQuality(q: QualityLevel): void;
  dispose(): void;
}

/** src/car — Agent 3 */
export interface ICarVisuals {
  /** Create a visual for every car in world.cars (liveries from world.teams, helmets from world.drivers) and add to parent. */
  build(world: World, parent: THREE.Object3D, onProgress: (progress: number, label: string) => void): Promise<void>;
  /**
   * Menu showroom: build ONE static, fully-detailed car at the origin facing +Z (wheels straight, DRS closed) and add it to
   * `parent`. Returns the root object. Synchronous. The menu camera orbits the origin at ~1 m height, 6-9 m radius.
   */
  buildShowcase(team: TeamDef, driver: DriverDef, parent: THREE.Object3D): THREE.Object3D;
  /** Per frame: pose from CarState (position/quaternion), wheels (spin/steer/suspension), DRS flap, brake glow, damage, rain light, driver head. */
  update(world: World, camera: THREE.PerspectiveCamera, dt: number): void;
  setQuality(q: QualityLevel): void;
  getCarObject(carId: number): THREE.Object3D | undefined;
  /** Hide chassis parts that would block a cockpit camera. */
  setCockpitView(carId: number, enabled: boolean): void;
  dispose(): void;
}

export interface CarEntryConfig {
  carId: number;
  driverId: string;
  teamId: string;
  isPlayer: boolean;
  compound: TyreCompound;
  gridPosition: number;
}

/** Narrow service interface the race director uses to control cars (implemented by physics). */
export interface ICarService {
  holdCar(carId: number, held: boolean): void;
  /** Pit stop service: fit tyres, repair damage, refuel not allowed in F1 (fuel ignored unless practice). */
  serviceCar(carId: number, opts: { compound?: TyreCompound; repair?: boolean }): void;
  /** Place car stationary on the centreline at `s` (defaults to nearest point ahead) facing forward. */
  resetCar(carId: number, s?: number): void;
  /** Retire a car: it will coast to a stop and be removed from contact (ghosted) after a few seconds. */
  retireCar(carId: number): void;
  /** Teleport a car to a grid slot (index 0 = pole) or pit box (team index). */
  placeOnGridSlot(carId: number, slot: number): void;
  placeInPitBox(carId: number, boxIndex: number): void;
  /** DRS availability is granted by the race director each step; physics opens the flap when input.drs && available. */
  setDrsAvailable(carId: number, available: boolean): void;
}

/** src/physics — Agent 4 */
export interface IVehiclePhysics extends ICarService {
  /** Create CarState objects for the session (stable references, index === carId). */
  createSession(world: Pick<World, 'trackDef' | 'track' | 'teams' | 'drivers' | 'teamById' | 'driverById' | 'config'>, entries: CarEntryConfig[]): CarState[];
  setInput(carId: number, input: DriverInput): void;
  setAssists(carId: number, assists: Assists): void;
  /** Advance all cars by dt (fixed PHYSICS_DT). Reads world.env.weather for grip, world.race.phase for DRS rules. */
  step(world: World, dt: number): void;
  dispose(): void;
}

/** src/ai — Agent 5 */
export interface IAIDrivers {
  /** Compute racing line & per-driver models for the session. Returns the racing line for world.racingLine. */
  createSession(world: World, aiCarIds: number[]): RacingLinePoint[];
  /** Called each physics step before physics.step(). Must fill an input for every AI car. */
  update(world: World, dt: number): void;
  getInput(carId: number): DriverInput;
  /**
   * Drive ANY car (including the player's) for one step on demand. Used for the pit-lane assist (mode 'pit-lane': follow the
   * pit lane path at the limiter speed, stop in the team's box, wait while RaceEntry.pitPhase === 'stopped', exit and rejoin)
   * and as a generic autopilot (mode 'race'). Must keep its own per-car scratch state keyed by carId.
   */
  computeInput(carId: number, world: World, dt: number, mode: 'race' | 'pit-lane'): DriverInput;
  setDifficulty(d: number): void;
  dispose(): void;
}

/** src/race — Agent 6 */
export interface IRaceDirector {
  /** Create the RaceState (stable) for a session. `cars` is the service to hold/serve/reset cars. */
  createSession(world: Omit<World, 'race'>, cars: ICarService): RaceState;
  /** Called each physics step after physics.step(). Timing, positions, gaps, flags, DRS grants, penalties, pit stops, weather progression. */
  update(world: World, dt: number): void;
  /** Player pit request. */
  requestPit(carId: number, compound: TyreCompound): void;
  cancelPit(carId: number): void;
  /** Immediately classify everyone with current standings and finish the session. */
  endSession(): void;
  /** Trigger the start procedure (formation → lights → green). Race sessions only; called by main when the player is ready. */
  startProcedure(): void;
  dispose(): void;
}

export type CameraMode = 'chase' | 'chase-far' | 'cockpit' | 'tcam' | 'nose' | 'tv' | 'helicopter';
export type CinematicKind = 'menu-orbit' | 'grid-flyover' | 'podium' | 'replay-director' | null;

/** src/camera — Agent 9 */
export interface ICameraSystem {
  readonly camera: THREE.PerspectiveCamera;
  setMode(mode: CameraMode): void;
  getMode(): CameraMode;
  setLiveChaseZoom(active: boolean): void;
  cycle(): CameraMode;
  setTarget(carId: number): void;
  getTarget(): number;
  /** Camera follows world.cars[target]; smooth, lag, speed-fov, g-force sway; TV cams from track geometry. */
  update(world: World | null, dt: number): void;
  shake(intensity: number, duration?: number): void;
  resize(aspect: number): void;
  snap(): void;
  /** Hold to look behind (mirrors). */
  setLookBack(active: boolean): void;
  setCinematic(kind: CinematicKind): void;
  getCinematic(): CinematicKind;
  dispose(): void;
}

export type InputCommand =
  | { type: 'pause' }
  | { type: 'cycle-camera' }
  | { type: 'look-back'; active: boolean }
  | { type: 'toggle-mute' }
  | { type: 'toggle-hud' }
  | { type: 'toggle-replay' }
  | { type: 'menu-up' }
  | { type: 'menu-down' }
  | { type: 'menu-left' }
  | { type: 'menu-right' }
  | { type: 'menu-confirm' }
  | { type: 'menu-back' }
  | { type: 'mfd-toggle' }
  | { type: 'mfd-next' }
  | { type: 'mfd-prev' }
  | { type: 'request-pit' }
  | { type: 'ers-cycle' }
  | { type: 'radio' }
  | { type: 'screenshot' };

/** src/input — Agent 9 */
export interface IInputSystem {
  update(dt: number): void;
  /** Player driving input for this step (call once per physics step; edge flags are pulsed correctly). */
  getDriverInput(): DriverInput;
  /** Non-driving commands since last call. */
  consumeCommands(): InputCommand[];
  setDrivingEnabled(enabled: boolean): void;
  /** Gamepad rumble 0..1 for `duration` seconds. */
  rumble(intensity: number, duration: number): void;
  isGamepadConnected(): boolean;
  /** Raw (pre-smoothing) steering for the HUD. */
  getRawSteer(): number;
  /** Set the ERS mode carried in DriverInput (the input system also cycles it on the 'ers-cycle' key). */
  setErsMode(mode: ErsMode): void;
  /** Optional: player car speed (m/s) so keyboard steering rate can be speed-sensitive. main calls this every frame. */
  setSpeedHint?(speedMs: number): void;
  dispose(): void;
}

/** src/replay — Agent 9 */
export interface IReplaySystem {
  startRecording(world: World): void;
  /** Record a frame (call once per rendered frame while live). */
  record(world: World, dt: number): void;
  stopRecording(): void;
  /** Enter replay: returns the replay car array to swap into world.cars. */
  enter(world: World): CarState[];
  exit(): void;
  isReplaying(): boolean;
  /** Advance replay playback; writes interpolated poses into the replay CarState array. */
  update(dt: number): void;
  seek(time: number): void;
  setSpeed(speed: number): void;
  getTime(): number;
  getDuration(): number;
  getSpeed(): number;
  dispose(): void;
}

/** src/vfx — Agent 10 */
export interface IVFXSystem {
  createSession(world: World, parent: THREE.Object3D): void;
  /** Per frame: tyre smoke, sparks, dust/gravel, rain & spray, skid marks, brake glow haze, exhaust, confetti, screen droplets. */
  update(world: World, camera: THREE.PerspectiveCamera, dt: number): void;
  setQuality(q: QualityLevel): void;
  endSession(): void;
  dispose(): void;
}

export type UISound = 'nav' | 'confirm' | 'back' | 'error' | 'start' | 'lights' | 'lights-out' | 'notify' | 'purple' | 'penalty' | 'finish';

export type AppPhase = 'boot' | 'title' | 'menu' | 'loading' | 'pre-session' | 'session' | 'paused' | 'results' | 'replay';

export interface GameSettings {
  quality: QualityLevel;
  masterVolume: number;
  muted: boolean;
  cameraMode: CameraMode;
  assists: Assists;
  aiDifficulty: number;
  showTelemetry: boolean;
  fov: number;
}

export type UICommand =
  | { type: 'start-session'; config: SessionConfig }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'restart-session' }
  | { type: 'quit-to-menu' }
  | { type: 'next-session' }
  | { type: 'skip-to-end' }
  | { type: 'shorten-race-to-five-laps' }
  | { type: 'ready' } // player pressed "start race" in pre-session
  | { type: 'set-quality'; quality: QualityLevel }
  | { type: 'set-camera'; mode: CameraMode }
  | { type: 'cycle-camera' }
  | { type: 'set-assists'; assists: Assists }
  | { type: 'set-audio'; muted?: boolean; volume?: number }
  | { type: 'set-fov'; fov: number }
  | { type: 'request-pit'; compound: TyreCompound }
  | { type: 'cancel-pit' }
  | { type: 'set-ers-mode'; mode: ErsMode }
  | { type: 'replay-start' }
  | { type: 'replay-stop' }
  | { type: 'replay-seek'; time: number }
  | { type: 'replay-speed'; speed: number }
  /** Menu: the highlighted driver changed → main rebuilds the showroom car. */
  | { type: 'preview-driver'; driverId: string }
  | { type: 'set-menu-cinematic'; enabled: boolean };

/** src/ui — Agent 7 */
export interface IUISystem {
  setPhase(phase: AppPhase): void;
  setLoading(progress: number, label: string): void;
  /** Results screen. `nextSession` non-null in Grand Prix mode (qualifying → race). */
  showResults(results: SessionResults, world: World, nextSession: SessionType | null): void;
  /** Per frame: HUD (timing tower, speed/gear/rpm/ers/drs, minimap, deltas, sector colours, flags, race control, radio), menus. */
  update(world: World | null, dt: number, stats: RenderStats): void;
  /** Gamepad/keyboard navigation forwarded from the input system. */
  handleCommand(cmd: InputCommand): void;
  onCommand(cb: (cmd: UICommand) => void): void;
  setHudVisible(visible: boolean): void;
  /** Toast-style notification. */
  notify(text: string, kind?: RaceControlMessage['kind'], durationSeconds?: number): void;
  getSettings(): GameSettings;
  /** Provide static data for menus. Call once at boot. */
  setData(teams: TeamDef[], drivers: DriverDef[], circuits: TrackDefinition[]): void;
  setGamepadConnected(connected: boolean): void;
  /** Optional: real replay clock (seconds) for the scrubber; main calls this every frame while in replay. */
  setReplayTime?(time: number, duration: number, speed: number): void;
  dispose(): void;
}

/** src/audio — Agent 8 */
export interface IAudioSystem {
  /** Call after a user gesture; idempotent. */
  resume(): Promise<void>;
  createSession(world: World): void;
  endSession(): void;
  /** Per frame: engines (player + spatialised AI cars via camera position), tyres, wind, kerbs, surfaces, crowd, rain, radio. */
  update(world: World | null, camera: THREE.PerspectiveCamera, dt: number): void;
  setMuted(muted: boolean): void;
  setMasterVolume(v: number): void;
  playUI(sound: UISound): void;
  /** Procedural menu music / ambience. */
  setMenuMusic(enabled: boolean): void;
  dispose(): void;
}
