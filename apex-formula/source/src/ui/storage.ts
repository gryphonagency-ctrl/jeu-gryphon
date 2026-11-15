import { QUALITY_LEVELS, TYRE_COMPOUNDS, type TyreCompound } from '../core/constants';
import type { Assists, CameraMode, GameMode, GameSettings, GridOrderRule, WeatherPreset } from '../core/types';

export const SETTINGS_KEY = 'apex-formula.settings';
export const LAST_CONFIG_KEY = 'apex-formula.lastConfig';

/** Everything the session-setup screens remember between runs. */
export interface LastConfig {
  mode: GameMode;
  circuitId: string;
  playerDriverId: string;
  laps: number;
  aiDifficulty: number;
  aiCount: number;
  weather: WeatherPreset;
  timeOfDay: number;
  gridOrder: GridOrderRule;
  startingCompound: TyreCompound;
  randomEvents: boolean;
}

export const CAMERA_MODES: CameraMode[] = ['chase', 'chase-far', 'tcam', 'cockpit', 'nose', 'tv', 'helicopter'];
export const WEATHER_PRESETS: WeatherPreset[] = ['dry', 'light-rain', 'heavy-rain', 'dynamic'];
export const GRID_ORDERS: GridOrderRule[] = ['performance', 'random', 'reverse'];

export const defaultAssists = (): Assists => ({
  tractionControl: 'medium',
  abs: true,
  autoGears: true,
  steeringAssist: true,
  brakingAssist: false,
  racingLine: 'corners',
  pitAssist: true,
  ersAssist: true,
  drsAssist: true,
});

export const defaultSettings = (): GameSettings => ({
  quality: 'high',
  masterVolume: 0.8,
  muted: false,
  cameraMode: 'chase',
  assists: defaultAssists(),
  aiDifficulty: 0.6,
  showTelemetry: false,
  fov: 70,
});

export const defaultLastConfig = (): LastConfig => ({
  mode: 'quick-race',
  circuitId: '',
  playerDriverId: '',
  laps: 0,
  aiDifficulty: 0.6,
  aiCount: 19,
  weather: 'dry',
  timeOfDay: -1,
  gridOrder: 'performance',
  startingCompound: 'medium',
  randomEvents: true,
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — settings just don't persist */
  }
}

export function sanitizeAssists(v: unknown, base: Assists = defaultAssists()): Assists {
  if (!isRecord(v)) return base;
  return {
    tractionControl: oneOf(v.tractionControl, ['off', 'medium', 'full'] as const, base.tractionControl),
    abs: bool(v.abs, base.abs),
    autoGears: bool(v.autoGears, base.autoGears),
    steeringAssist: bool(v.steeringAssist, base.steeringAssist),
    brakingAssist: bool(v.brakingAssist, base.brakingAssist),
    racingLine: oneOf(v.racingLine, ['off', 'corners', 'full'] as const, base.racingLine),
    pitAssist: bool(v.pitAssist, base.pitAssist),
    ersAssist: bool(v.ersAssist, base.ersAssist),
    drsAssist: bool(v.drsAssist, base.drsAssist),
  };
}

export function loadSettings(): GameSettings {
  const d = defaultSettings();
  const v = read(SETTINGS_KEY);
  if (!isRecord(v)) return d;
  return {
    quality: oneOf(v.quality, QUALITY_LEVELS, d.quality),
    masterVolume: num(v.masterVolume, 0, 1, d.masterVolume),
    muted: bool(v.muted, d.muted),
    cameraMode: oneOf(v.cameraMode, CAMERA_MODES, d.cameraMode),
    assists: sanitizeAssists(v.assists, d.assists),
    aiDifficulty: num(v.aiDifficulty, 0, 1, d.aiDifficulty),
    showTelemetry: bool(v.showTelemetry, d.showTelemetry),
    fov: num(v.fov, 40, 110, d.fov),
  };
}

export function saveSettings(s: GameSettings): void {
  write(SETTINGS_KEY, s);
}

export function loadLastConfig(): LastConfig {
  const d = defaultLastConfig();
  const v = read(LAST_CONFIG_KEY);
  if (!isRecord(v)) return d;
  return {
    mode: oneOf(v.mode, ['quick-race', 'grand-prix', 'time-trial'] as const, d.mode),
    circuitId: typeof v.circuitId === 'string' ? v.circuitId : d.circuitId,
    playerDriverId: typeof v.playerDriverId === 'string' ? v.playerDriverId : d.playerDriverId,
    laps: num(v.laps, 0, 200, d.laps),
    aiDifficulty: num(v.aiDifficulty, 0, 1, d.aiDifficulty),
    aiCount: Math.round(num(v.aiCount, 0, 19, d.aiCount)),
    weather: oneOf(v.weather, WEATHER_PRESETS, d.weather),
    timeOfDay: num(v.timeOfDay, -1, 24, d.timeOfDay),
    gridOrder: oneOf(v.gridOrder, [...GRID_ORDERS, 'qualifying'] as const, d.gridOrder),
    startingCompound: oneOf(v.startingCompound, TYRE_COMPOUNDS, d.startingCompound),
    randomEvents: bool(v.randomEvents, d.randomEvents),
  };
}

export function saveLastConfig(c: LastConfig): void {
  write(LAST_CONFIG_KEY, c);
}
