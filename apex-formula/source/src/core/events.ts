/**
 * Typed global event bus. Owned by Lead.
 *
 * Emitters (who fires what) are documented per event. Anyone may subscribe.
 * Subscribe in your constructor / createSession and unsubscribe in dispose().
 */
import type * as THREE from 'three';
import type { QualityLevel, TyreCompound } from './constants';
import type {
  CameraMode,
  FlagType,
  PenaltyType,
  RaceControlMessage,
  RacePhase,
  SectorStatus,
  SessionConfig,
  SessionResults,
  SurfaceType,
  UICommand,
  UISound,
  WeatherState,
} from './types';

export interface GameEvents {
  /* ── Lifecycle (main.ts) ── */
  'session:start': { config: SessionConfig };
  'session:end': { results: SessionResults };
  'session:pause': { paused: boolean };
  'player:car': { carId: number };
  'camera:mode': { mode: CameraMode };
  'quality:change': { quality: QualityLevel };

  /* ── Race director (src/race) ── */
  'race:phase': { phase: RacePhase; previous: RacePhase };
  /** lightsOn 1..5 as each red light comes on; 0 = LIGHTS OUT. */
  'race:lights': { lightsOn: number };
  'race:lap': { carId: number; lap: number; time: number; personalBest: boolean; fastestOverall: boolean; position: number };
  'race:sector': { carId: number; sector: 0 | 1 | 2; time: number; status: SectorStatus };
  'race:overtake': { carId: number; overtakenCarId: number; position: number };
  'race:position-change': { carId: number; from: number; to: number };
  'race:pit-entry': { carId: number };
  'race:pit-stop-start': { carId: number };
  'race:pit-stop-end': { carId: number; duration: number; compound: TyreCompound };
  'race:pit-exit': { carId: number };
  'race:penalty': { carId: number; type: PenaltyType; seconds: number; reason: string };
  'race:warning': { carId: number; reason: string; count: number };
  'race:flag': { flag: FlagType; sector: number | -1 };
  'race:drs-enabled': { enabled: boolean };
  'race:drs-available': { carId: number; available: boolean };
  'race:fastest-lap': { carId: number; time: number };
  'race:finish': { carId: number; position: number };
  'race:retire': { carId: number; reason: string };
  'race:message': RaceControlMessage;
  'race:weather': { weather: WeatherState; description: string };
  'race:blue-flag': { carId: number; active: boolean };
  /** Team radio line to display (UI) and beep (audio). */
  'radio:message': { carId: number; from: 'engineer' | 'driver' | 'race-control'; text: string };

  /* ── Physics (src/physics) ── */
  'car:collision': { carId: number; withCar: number; impulse: number; point: THREE.Vector3; normal: THREE.Vector3 };
  'car:offtrack': { carId: number; surface: SurfaceType; wheelsOff: number };
  'car:ontrack': { carId: number };
  'car:drs': { carId: number; open: boolean };
  'car:gear': { carId: number; gear: number; up: boolean };
  'car:lockup': { carId: number; wheel: number; active: boolean };
  'car:wheelspin': { carId: number; active: boolean };
  'car:damage': { carId: number; part: 'frontWing' | 'rearWing' | 'floor' | 'suspension' | 'engine'; amount: number };
  'car:bottoming': { carId: number; intensity: number };
  'car:reset': { carId: number };
  'car:limiter': { carId: number; active: boolean };
  'car:airborne': { carId: number; airborne: boolean };
  'car:engine-failure': { carId: number };

  /* ── UI (src/ui) ── */
  'ui:command': UICommand;
  'ui:sound': { sound: UISound };

  /* ── Input (src/input) ── */
  'input:gamepad': { connected: boolean; id: string };
}

type Handler<T> = (payload: T) => void;

class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<unknown>);
    return () => this.off(type, handler);
  }

  once<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      handler(p);
    });
    return off;
  }

  off<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): void {
    this.handlers.get(type)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set || set.size === 0) return;
    for (const h of Array.from(set)) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[events] handler for "${String(type)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const events = new EventBus();
