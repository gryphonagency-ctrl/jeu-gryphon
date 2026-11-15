/**
 * APEX FORMULA audio — fully procedural Web Audio soundscape. Owned by Agent 8.
 * Safe to call before resume(): nothing touches an AudioContext until the first user gesture.
 */
import * as THREE from 'three';
import type { CameraMode, IAudioSystem, UISound, World } from '../core/types';
import type { QualityLevel } from '../core/constants';
import { events } from '../core/events';
import { AudioCore, BUS_NAMES, clampSafe, dbToGain, type BusName } from './core';
import { OneShots } from './OneShots';
import { PlayerEngine } from './PlayerEngine';
import { SpatialVoices } from './SpatialVoices';
import { CarLayers } from './CarLayers';
import { Ambience } from './Ambience';
import { Radio } from './Radio';
import { MenuMusic } from './MenuMusic';

export interface BusMeter {
  rms: number;
  peak: number;
}

export type MeterName = BusName | 'master';
export const METER_NAMES: readonly MeterName[] = [...BUS_NAMES, 'master'];

export interface AudioDebugInfo {
  state: AudioContextState | 'none';
  sampleRate: number;
  liveNodes: number;
  spatialVoices: number;
  hrtf: boolean;
  /** Per-bus levels plus 'master' measured after the limiter, volume, mute and visibility gains. */
  buses: Record<MeterName, BusMeter>;
}

const VOICES_BY_QUALITY: Record<QualityLevel, number> = { low: 3, medium: 4, high: 6, ultra: 6 };
const HRTF_BY_QUALITY: Record<QualityLevel, boolean> = { low: false, medium: false, high: true, ultra: true };

const _camPos = new THREE.Vector3();
const _prevCamPos = new THREE.Vector3();
const _camVel = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class AudioSystem implements IAudioSystem {
  private core: AudioCore | null = null;
  private oneShots: OneShots | null = null;
  private radio: Radio | null = null;
  private music: MenuMusic | null = null;

  // Session voices
  private engine: PlayerEngine | null = null;
  private layers: CarLayers | null = null;
  private spatial: SpatialVoices | null = null;
  private ambience: Ambience | null = null;

  private world: World | null = null;
  private sessionBuilt = false;

  // Persistent settings (applied whenever the context becomes available)
  private muted = false;
  private masterVolume = 1;
  private menuMusicWanted = false;
  private cameraMode: CameraMode = 'chase';
  private quality: QualityLevel = 'high';
  private paused = false;
  private hidden = false;
  private resuming: Promise<void> | null = null;
  private disposed = false;
  private hasPrevCam = false;

  private lastDustTime = -10;
  // De-dup guards: the race director's events and the UI's ui:sound may both describe the same moment.
  private lastLightsAt = -1e9;
  private lastFinishAt = -1e9;
  private readonly unsubs: (() => void)[] = [];
  private meters: Record<MeterName, AnalyserNode> | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;

  private readonly onVisibility = (): void => {
    this.hidden = typeof document !== 'undefined' && document.hidden;
    this.applyMute();
  };

  constructor() {
    this.subscribe();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
      this.hidden = document.hidden;
    }
  }

  /* ─────────────────────────────── lifecycle ─────────────────────────────── */

  async resume(): Promise<void> {
    if (this.disposed) return;
    if (this.resuming) return this.resuming;
    this.resuming = (async () => {
      try {
        if (!this.core) {
          if (typeof AudioContext === 'undefined') return;
          this.core = new AudioCore();
          this.oneShots = new OneShots(this.core);
          this.oneShots.onUiSound = () => this.music?.duckNow();
          this.radio = new Radio(this.core, this.oneShots);
          this.applySettings();
        }
        if (this.core.ctx.state !== 'running') await this.core.ctx.resume();
        this.onContextReady();
      } catch (err) {
        console.warn('[audio] resume failed', err);
      } finally {
        this.resuming = null;
      }
    })();
    return this.resuming;
  }

  /** Deferred work that needs a running context: menu music, pending session. */
  private onContextReady(): void {
    const core = this.core;
    if (!core || !core.running || this.disposed) return;
    if (this.menuMusicWanted && !this.music) this.music = new MenuMusic(core);
    if (this.world && !this.sessionBuilt) this.buildSession();
  }

  createSession(world: World): void {
    if (this.disposed) return;
    if (this.sessionBuilt) this.teardownSession();
    this.world = world;
    this.sessionBuilt = false;
    this.lastDustTime = -10;
    if (this.core?.running) this.buildSession();
  }

  private buildSession(): void {
    const core = this.core;
    if (!core || !this.oneShots || !this.world || this.sessionBuilt) return;
    const hrtf = HRTF_BY_QUALITY[this.quality];
    this.engine = new PlayerEngine(core, this.oneShots, core.buses.engine);
    this.layers = new CarLayers(core, this.oneShots, core.buses.sfx);
    this.spatial = new SpatialVoices(core, core.buses.engine, hrtf, VOICES_BY_QUALITY[this.quality]);
    this.ambience = new Ambience(core, core.buses.ambience);
    this.engine.setCameraMode(this.cameraMode, true);
    this.layers.setCameraMode(this.cameraMode);
    this.ambience.setCameraMode(this.cameraMode);
    this.sessionBuilt = true;
    this.setPaused(!!this.world.paused, true);
  }

  private teardownSession(): void {
    this.engine?.dispose();
    this.layers?.dispose();
    this.spatial?.dispose();
    this.ambience?.dispose();
    this.engine = null;
    this.layers = null;
    this.spatial = null;
    this.ambience = null;
    this.sessionBuilt = false;
  }

  endSession(): void {
    this.radio?.stop();
    this.teardownSession();
    this.world = null;
    this.setPaused(false, true);
  }

  update(world: World | null, camera: THREE.PerspectiveCamera, dt: number): void {
    const core = this.core;
    if (!core || this.disposed) return;
    if (!core.running) return;
    if ((this.menuMusicWanted && !this.music) || (this.world && !this.sessionBuilt)) this.onContextReady();
    if (!world || world !== this.world || !this.sessionBuilt) return;
    const step = clampSafe(dt, 0, 0.1, 1 / 60);
    _camPos.setFromMatrixPosition(camera.matrixWorld);

    if (!!world.paused !== this.paused) this.setPaused(!!world.paused);

    const player = world.cars[world.playerCarId];
    if (player) {
      if (this.engine) {
        if (this.cameraMode === 'tv' || this.cameraMode === 'helicopter') {
          // Detached cameras: the player's own car attenuates with distance and Dopplers as it passes.
          _dir.subVectors(_camPos, player.position);
          const dist = _dir.length();
          let ratio = 1;
          let gain = 1;
          if (dist > 1) {
            _dir.divideScalar(dist);
            if (this.hasPrevCam && step > 0.0005) {
              _camVel.subVectors(_camPos, _prevCamPos).divideScalar(step);
              if (_camVel.lengthSq() > 150 * 150) _camVel.set(0, 0, 0);
            } else _camVel.set(0, 0, 0);
            const vSrc = clampSafe(player.velocity.dot(_dir), -300, 300);
            const vLis = clampSafe(_camVel.dot(_dir), -300, 300);
            const denom = 343 - vSrc;
            ratio = (343 - vLis) / (denom < 20 ? 20 : denom);
            const ref = this.cameraMode === 'helicopter' ? 60 : 18;
            gain = Math.pow(clampSafe(ref / (dist < ref ? ref : dist), 0.15, 1, 1), 0.7);
          }
          this.engine.setExternalPerspective(gain, ratio);
          this.layers?.setDistanceGain(gain);
        } else {
          this.engine.setExternalPerspective(1, 1);
          this.layers?.setDistanceGain(1);
        }
        this.engine.update(player, step);
      }
      if (this.layers) {
        this.layers.setWetness(world.env.weather.wetness);
        this.layers.update(player, step);
      }
    }
    this.spatial?.update(world, camera, step);
    this.ambience?.update(world, step);
    _prevCamPos.copy(_camPos);
    this.hasPrevCam = true;
  }

  /* ─────────────────────────────── settings ─────────────────────────────── */

  setMuted(muted: boolean): void {
    this.muted = !!muted;
    this.radio?.setMuted(this.muted);
    this.applyMute();
  }

  private applyMute(): void {
    const core = this.core;
    if (!core) return;
    core.gainTo(core.muteGain.gain, this.muted || this.hidden ? 0 : 1, 0.06);
  }

  setMasterVolume(v: number): void {
    this.masterVolume = clampSafe(v, 0, 1, 1);
    this.radio?.setVolume(this.masterVolume);
    const core = this.core;
    if (!core) return;
    // Perceptual curve: roughly 40 dB of range with a comfortable mid position.
    const g = this.masterVolume <= 0 ? 0 : Math.pow(this.masterVolume, 2.2);
    core.gainTo(core.masterVolume.gain, g, 0.05);
  }

  private applySettings(): void {
    this.setMuted(this.muted);
    this.setMasterVolume(this.masterVolume);
  }

  private setPaused(paused: boolean, immediate = false): void {
    this.paused = paused;
    const core = this.core;
    if (!core) return;
    const tc = immediate ? 0.005 : 0.12;
    core.gainTo(core.pauseDuck.gain, paused ? dbToGain(-18) : 1, tc);
    core.freqTo(core.pauseFilterEngine.frequency, paused ? 700 : core.maxFreq, tc);
    core.freqTo(core.pauseFilterSfx.frequency, paused ? 700 : core.maxFreq, tc);
  }

  private setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.engine?.setCameraMode(mode);
    this.layers?.setCameraMode(mode);
    this.ambience?.setCameraMode(mode);
  }

  private setQuality(q: QualityLevel): void {
    this.quality = q;
    this.spatial?.setQuality(HRTF_BY_QUALITY[q], VOICES_BY_QUALITY[q]);
  }

  playUI(sound: UISound): void {
    if (!this.core?.running || !this.oneShots) return;
    const now = performance.now();
    if ((sound === 'lights' || sound === 'lights-out') && now - this.lastLightsAt < 250) return;
    if (sound === 'finish' && now - this.lastFinishAt < 600) return;
    this.oneShots.ui(sound);
  }

  setMenuMusic(enabled: boolean): void {
    this.menuMusicWanted = !!enabled;
    if (!enabled) {
      if (this.music) {
        this.music.stop(1.5);
        this.music = null;
      }
      return;
    }
    if (this.core?.running && !this.music) this.music = new MenuMusic(this.core);
  }

  /* ─────────────────────────────── events ─────────────────────────────── */

  private isPlayer(carId: number): boolean {
    return !!this.world && carId === this.world.playerCarId;
  }

  private subscribe(): void {
    const u = this.unsubs;
    u.push(
      events.on('car:gear', ({ carId, up }) => {
        if (!this.isPlayer(carId) || !this.engine || !this.world) return;
        this.engine.onGearShift(up, this.world.cars[carId]?.engine.rpm ?? 0);
      }),
      events.on('car:drs', ({ carId, open }) => {
        if (this.isPlayer(carId) && this.sessionBuilt) this.oneShots?.drs(open);
      }),
      events.on('car:collision', ({ carId, withCar, impulse, point }) => {
        if (!this.sessionBuilt || !this.oneShots || !this.world) return;
        const involvesPlayer = this.isPlayer(carId) || this.isPlayer(withCar);
        let scale = 1;
        if (!involvesPlayer) {
          // Other cars' shunts: audible only when close to the listener.
          const d = point ? point.distanceTo(_camPos) : Infinity;
          scale = clampSafe(1 - (d - 15) / 90, 0, 0.6, 0);
        }
        const k = this.oneShots.collision(impulse, scale);
        if (involvesPlayer && k > 0.3) this.ambience?.gaspSwell(k);
      }),
      events.on('car:offtrack', ({ carId, surface }) => {
        if (!this.isPlayer(carId) || !this.sessionBuilt || !this.world) return;
        if (surface !== 'grass' && surface !== 'gravel' && surface !== 'runoff') return;
        const now = this.world.realTime;
        if (now - this.lastDustTime < 1.5) return;
        this.lastDustTime = now;
        this.oneShots?.dustPuff();
      }),
      events.on('car:reset', ({ carId }) => {
        if (this.isPlayer(carId) && this.sessionBuilt) this.oneShots?.resetWhoosh();
      }),
      events.on('car:engine-failure', ({ carId }) => {
        if (this.isPlayer(carId) && this.sessionBuilt) this.oneShots?.engineFailure();
      }),
      events.on('race:lights', ({ lightsOn }) => {
        if (!this.sessionBuilt || !this.oneShots) return;
        this.lastLightsAt = performance.now();
        if (lightsOn > 0) this.oneShots.lightOn(lightsOn);
        else {
          this.oneShots.lightsOut();
          this.ambience?.cheerSwell(0.7);
        }
      }),
      events.on('race:overtake', ({ carId, overtakenCarId }) => {
        if (this.isPlayer(carId) || this.isPlayer(overtakenCarId)) this.ambience?.cheerSwell(0.5);
      }),
      events.on('race:fastest-lap', ({ carId }) => {
        this.ambience?.cheerSwell(this.isPlayer(carId) ? 0.55 : 0.3);
      }),
      events.on('race:finish', ({ carId }) => {
        if (!this.sessionBuilt) return;
        if (this.isPlayer(carId)) {
          this.lastFinishAt = performance.now();
          this.oneShots?.fanfare();
          this.ambience?.cheerSwell(1);
        } else {
          this.ambience?.cheerSwell(0.3);
        }
      }),
      events.on('race:retire', ({ carId }) => {
        if (this.isPlayer(carId)) this.ambience?.gaspSwell(0.5);
      }),
      events.on('radio:message', ({ carId, from, text }) => {
        if (!this.isPlayer(carId) || !this.sessionBuilt) return;
        this.radio?.message(text, from === 'race-control');
      }),
      events.on('ui:sound', ({ sound }) => this.playUI(sound)),
      events.on('camera:mode', ({ mode }) => this.setCameraMode(mode)),
      events.on('session:pause', ({ paused }) => this.setPaused(paused)),
      events.on('quality:change', ({ quality }) => this.setQuality(quality)),
      events.on('session:start', () => {
        if (this.music) {
          this.music.stop(1.5);
          this.music = null;
        }
        this.menuMusicWanted = false;
      }),
    );
  }

  /* ─────────────────────────────── debug / metering (dev harness) ─────────────────────────────── */

  /** Attach analysers to every bus and the master output. Dev-only; adds 7 nodes. */
  enableMetering(): void {
    const core = this.core;
    if (!core || this.meters) return;
    const m = {} as Record<MeterName, AnalyserNode>;
    for (const name of METER_NAMES) {
      const a = core.analyser();
      (name === 'master' ? core.muteGain : core.buses[name]).connect(a);
      m[name] = a;
    }
    this.meters = m;
    this.meterBuf = new Float32Array(1024);
  }

  getDebugInfo(): AudioDebugInfo {
    const buses = {} as Record<MeterName, BusMeter>;
    for (const name of METER_NAMES) buses[name] = { rms: 0, peak: 0 };
    const core = this.core;
    if (this.meters && this.meterBuf && core) {
      for (const name of METER_NAMES) {
        const a = this.meters[name];
        a.getFloatTimeDomainData(this.meterBuf);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < this.meterBuf.length; i++) {
          const v = this.meterBuf[i];
          sum += v * v;
          const av = v < 0 ? -v : v;
          if (av > peak) peak = av;
        }
        buses[name] = { rms: Math.sqrt(sum / this.meterBuf.length), peak };
      }
    }
    return {
      state: core ? core.ctx.state : 'none',
      sampleRate: core ? core.ctx.sampleRate : 0,
      liveNodes: core ? core.liveNodes : 0,
      spatialVoices: VOICES_BY_QUALITY[this.quality],
      hrtf: HRTF_BY_QUALITY[this.quality],
      buses,
    };
  }

  /** Dev harness helper: which camera the layers think they are on. */
  getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  /* ─────────────────────────────── teardown ─────────────────────────────── */

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.teardownSession();
    this.world = null;
    this.music?.dispose();
    this.music = null;
    this.radio?.dispose();
    this.radio = null;
    if (this.meters && this.core) {
      for (const name of METER_NAMES) this.core.release(this.meters[name]);
      this.meters = null;
    }
    const core = this.core;
    this.core = null;
    this.oneShots = null;
    if (core) {
      // Let the release ramps finish before closing.
      setTimeout(() => {
        void core.ctx.close().catch(() => undefined);
      }, 250);
    }
  }
}
