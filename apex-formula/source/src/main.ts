/**
 * APEX FORMULA — entry point & game loop. Owned by Lead.
 *
 * This file wires every module together. Module agents: READ THIS to see exactly how and when you are called.
 * Data flow per frame (live session):
 *   input.update → [fixed steps: player input → ai.update/getInput → physics.step → raceDirector.update] →
 *   replay.record → camera.update → track/cars/vfx.update → render.update → audio.update → ui.update → render.render
 */
import * as THREE from 'three';
import { MAX_PHYSICS_STEPS_PER_FRAME, PHYSICS_DT, GRID_SIZE, type TyreCompound } from './core/constants';
import { events } from './core/events';
import { DRIVERS, DRIVER_BY_ID, TEAMS, TEAM_BY_ID } from './core/teams';
import { CORE_CIRCUITS } from './core/circuits';
import { TrackSpline } from './core/track/TrackSpline';
import { createDefaultInput, createEnvironment } from './core/world';
import { clamp, Rng, hashString } from './core/math';
import type {
  AppPhase,
  CameraMode,
  CarEntryConfig,
  CarState,
  DriverInput,
  IAIDrivers,
  IAudioSystem,
  ICameraSystem,
  ICarVisuals,
  IInputSystem,
  IRaceDirector,
  IRenderSystem,
  IReplaySystem,
  ITrackBuilder,
  IUISystem,
  IVFXSystem,
  IVehiclePhysics,
  InputCommand,
  SessionConfig,
  SessionResults,
  SessionType,
  TrackDefinition,
  UICommand,
  World,
} from './core/types';

import { RenderSystem } from './render/RenderSystem';
import { TrackBuilder } from './track/TrackBuilder';
import { CIRCUITS as TRACK_CIRCUITS } from './track/circuits';
import { CarVisuals } from './car/CarVisuals';
import { VehiclePhysics } from './physics/VehiclePhysics';
import { AIDrivers } from './ai/AIDrivers';
import { RaceDirector } from './race/RaceDirector';
import { UISystem } from './ui/UISystem';
import { saveSettings } from './ui/storage';
import { AudioSystem } from './audio/AudioSystem';
import { InputSystem } from './input/InputSystem';
import { CameraSystem } from './camera/CameraSystem';
import { ReplaySystem } from './replay/ReplaySystem';
import { VFXSystem } from './vfx/VFXSystem';
import { MAX_LIVE_PLAYERS, TikTokLiveControl, type LiveParticipant } from './live/TikTokLiveControl';
import { LiveNameplates, type LiveCameraView } from './live/LiveNameplates';
import { LivePlayerHUD } from './live/LivePlayerHUD';
import { getSplitViewports } from './render/splitScreen';

const CIRCUITS: TrackDefinition[] = [...CORE_CIRCUITS, ...TRACK_CIRCUITS.filter((c) => !CORE_CIRCUITS.some((k) => k.id === c.id))];

class Game {
  // Long-lived systems
  private readonly canvas: HTMLCanvasElement;
  private readonly render: IRenderSystem;
  private readonly ui: IUISystem;
  private readonly audio: IAudioSystem;
  private readonly input: IInputSystem;
  private readonly cameraSys: ICameraSystem;
  private readonly liveControl: TikTokLiveControl;
  private readonly liveNameplates: LiveNameplates;
  private readonly livePlayerHUD: LivePlayerHUD;

  // Per-session systems (re-created every session)
  private track: ITrackBuilder | null = null;
  private cars: ICarVisuals | null = null;
  private physics: IVehiclePhysics | null = null;
  private ai: IAIDrivers | null = null;
  private race: IRaceDirector | null = null;
  private vfx: IVFXSystem | null = null;
  private replay: IReplaySystem | null = null;

  private world: World | null = null;
  private liveCars: CarState[] = [];
  private aiCarIds: number[] = [];
  private phase: AppPhase = 'boot';
  private phaseBeforeReplay: AppPhase = 'paused';
  private accumulator = 0;
  private lastFrame = performance.now();
  private sessionToken = 0;
  private lastConfig: SessionConfig | null = null;
  private pendingResults: SessionResults | null = null;
  private showcase: THREE.Object3D | null = null;
  private showcaseCars: ICarVisuals | null = null;
  private hudVisible = true;
  private cockpitView = false;
  private previewDriverId: string = DRIVERS[0].id;
  private readonly playerInput: DriverInput = createDefaultInput();
  private readonly liveCarByUser = new Map<string, number>();
  private readonly liveNameByCar = new Map<number, string>();
  private readonly liveSpeedLimits = new Map<number, number>();
  private readonly liveCameraSystems: CameraSystem[] = [];
  private livePreviousCameraMode: CameraMode | null = null;
  private liveSession = false;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const uiRoot = document.getElementById('ui-root') as HTMLElement;

    this.render = new RenderSystem(this.canvas);
    this.cameraSys = new CameraSystem(window.innerWidth / window.innerHeight);
    this.render.setCamera(this.cameraSys.camera);
    this.input = new InputSystem();
    this.audio = new AudioSystem();
    this.ui = new UISystem(uiRoot);
    this.ui.setData(TEAMS, DRIVERS, CIRCUITS);
    this.ui.onCommand((cmd) => this.handleUICommand(cmd));
    const settings = this.ui.getSettings();
    this.liveNameplates = new LiveNameplates(uiRoot);
    this.livePlayerHUD = new LivePlayerHUD(uiRoot);
    this.liveControl = new TikTokLiveControl(
      uiRoot,
      (participants) => this.startLiveRace(participants),
      (userId, username, coinCount) => this.applyLiveGift(userId, username, coinCount),
      settings.masterVolume,
      (delta) => {
        settings.masterVolume = clamp(settings.masterVolume + delta, 0, 1);
        this.audio.setMasterVolume(settings.masterVolume);
        saveSettings(settings);
        return settings.masterVolume;
      },
    );

    this.render.setQuality(settings.quality);
    this.audio.setMasterVolume(settings.masterVolume);
    this.audio.setMuted(settings.muted);
    this.cameraSys.setMode(settings.cameraMode);

    window.addEventListener('resize', () => this.onResize());
    this.onResize();

    const unlock = () => {
      void this.audio.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    events.on('input:gamepad', ({ connected }) => this.ui.setGamepadConnected(connected));

    this.enterMenu('title');
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ─────────────────────────────── app phases ─────────────────────────────── */

  private setPhase(phase: AppPhase): void {
    this.phase = phase;
    this.ui.setPhase(phase);
  }

  private enterMenu(phase: 'title' | 'menu'): void {
    this.setPhase(phase);
    this.render.setMenuMode(true);
    this.cameraSys.setCinematic('menu-orbit');
    this.audio.setMenuMusic(true);
    this.input.setDrivingEnabled(false);
    this.buildShowcase(this.previewDriverId);
  }

  private buildShowcase(driverId: string): void {
    if (this.showcase) {
      this.render.sessionGroup.remove(this.showcase);
      this.showcaseCars?.dispose();
      this.showcase = null;
      this.showcaseCars = null;
    }
    const driver = DRIVER_BY_ID[driverId] ?? DRIVERS[0];
    const team = TEAM_BY_ID[driver.teamId];
    this.showcaseCars = new CarVisuals();
    this.showcase = this.showcaseCars.buildShowcase(team, driver, this.render.sessionGroup);
  }

  private clearShowcase(): void {
    if (this.showcase) {
      this.render.sessionGroup.remove(this.showcase);
      this.showcaseCars?.dispose();
      this.showcase = null;
      this.showcaseCars = null;
    }
  }

  /* ─────────────────────────────── session lifecycle ─────────────────────────────── */

  private async startSession(config: SessionConfig, liveParticipants: readonly LiveParticipant[] = []): Promise<void> {
    const token = ++this.sessionToken;
    this.lastConfig = config;
    this.pendingResults = null;
    this.teardownSession();
    this.liveCarByUser.clear();
    this.liveNameByCar.clear();
    this.liveSpeedLimits.clear();
    this.liveNameplates.setNames(this.liveNameByCar);
    this.liveSession = liveParticipants.length > 0;
    this.clearShowcase();
    this.render.setMenuMode(false);
    this.audio.setMenuMusic(false);
    this.setPhase('loading');
    this.ui.setLoading(0, 'Preparing circuit');

    const trackDef = CIRCUITS.find((c) => c.id === config.circuitId) ?? CIRCUITS[0];
    const spline = new TrackSpline(trackDef);
    const env = createEnvironment(config.timeOfDay >= 0 ? config.timeOfDay : trackDef.environment.timeOfDay);
    const weather = config.weather === 'dynamic' ? trackDef.environment.weather : config.weather;
    if (weather === 'light-rain') {
      env.weather.rain = 0.35;
      env.weather.wetness = 0.5;
      env.weather.cloud = 0.85;
    } else if (weather === 'heavy-rain') {
      env.weather.rain = 0.9;
      env.weather.wetness = 0.95;
      env.weather.cloud = 1;
      env.weather.fog = 0.25;
    }
    this.render.setEnvironment(trackDef, env);

    // ── Entries: the player replaces their chosen driver; AI fills the rest of the grid.
    const player = DRIVER_BY_ID[config.playerDriverId] ?? DRIVERS[0];
    const isTimeTrial = config.mode === 'time-trial';
    const safeLiveParticipants = liveParticipants.slice(0, Math.min(MAX_LIVE_PLAYERS, GRID_SIZE - 1));
    const aiCount = isTimeTrial ? 0 : this.liveSession
      ? GRID_SIZE - safeLiveParticipants.length
      : Math.max(0, Math.min(GRID_SIZE - 1, config.aiCount));
    const participantDrivers = DRIVERS.slice(0, safeLiveParticipants.length);
    const participantDriverIds = new Set(participantDrivers.map((d) => d.id));
    const others = this.liveSession
      ? DRIVERS.filter((d) => !participantDriverIds.has(d.id)).slice(0, aiCount)
      : DRIVERS.filter((d) => d.id !== player.id).slice(0, aiCount);
    const lineup = this.liveSession ? [...participantDrivers, ...others] : [player, ...others];

    // Grid order.
    const rng = new Rng(hashString(config.circuitId + config.playerDriverId) ^ Date.now());
    const perf = (d: (typeof DRIVERS)[number]) => {
      const t = TEAM_BY_ID[d.teamId];
      return (t.performance.power + t.performance.aero) * 0.5 * 0.7 + d.skill.pace * 0.3 + rng.range(-0.015, 0.015);
    };
    let ordered = [...lineup];
    if (config.gridOrder === 'qualifying' && config.gridDriverIds?.length) {
      const byId = new Map(lineup.map((d) => [d.id, d]));
      ordered = config.gridDriverIds.map((id) => byId.get(id)).filter((d): d is (typeof DRIVERS)[number] => !!d);
      for (const d of lineup) if (!ordered.includes(d)) ordered.push(d);
    } else if (config.gridOrder === 'random') {
      ordered.sort(() => rng.next() - 0.5);
    } else if (config.gridOrder === 'reverse') {
      ordered.sort((a, b) => perf(a) - perf(b));
    } else {
      ordered.sort((a, b) => perf(b) - perf(a));
    }
    const gridPosOf = new Map(ordered.map((d, i) => [d.id, i + 1]));

    // Nobody starts a wet session on slicks: the menu compound only applies on a dry track.
    const wet = env.weather.wetness;
    const isSlick = (c: TyreCompound) => c === 'soft' || c === 'medium' || c === 'hard';
    const startCompound: TyreCompound = wet > 0.6 ? 'wet' : wet > 0.25 ? (config.startingCompound === 'wet' ? 'wet' : 'intermediate') : isSlick(config.startingCompound) ? config.startingCompound : 'medium';
    const entries: CarEntryConfig[] = lineup.map((d, i) => ({
      carId: i,
      driverId: d.id,
      teamId: d.teamId,
      isPlayer: i === 0,
      compound: startCompound,
      gridPosition: gridPosOf.get(d.id) ?? i + 1,
    }));
    safeLiveParticipants.forEach((participant, index) => {
      this.liveCarByUser.set(participant.id, index);
      this.liveNameByCar.set(index, participant.username);
      this.liveSpeedLimits.set(index, Math.min(300, 50 + (participant.giftCoins ?? 0)));
    });
    this.aiCarIds = entries.filter((e) => !e.isPlayer).map((e) => e.carId);

    // ── Systems
    this.physics = new VehiclePhysics();
    this.ai = new AIDrivers();
    this.race = new RaceDirector();
    this.track = new TrackBuilder();
    this.cars = new CarVisuals();
    this.vfx = new VFXSystem();
    this.replay = new ReplaySystem();

    const partial = {
      trackDef,
      track: spline,
      teams: TEAMS,
      drivers: DRIVERS,
      teamById: TEAM_BY_ID,
      driverById: DRIVER_BY_ID,
      config,
    };
    this.liveCars = this.physics.createSession(partial, entries);
    for (const c of this.liveCars) this.physics.setAssists(c.id, c.isPlayer ? config.assists : { ...config.assists, tractionControl: 'off', abs: false, autoGears: true, steeringAssist: false, brakingAssist: false, racingLine: 'off', pitAssist: true, ersAssist: true, drsAssist: true });

    const worldNoRace: Omit<World, 'race'> = {
      mode: 'live',
      config,
      trackDef,
      track: spline,
      cars: this.liveCars,
      env,
      playerCarId: 0,
      time: 0,
      realTime: 0,
      paused: false,
      racingLine: null,
      teams: TEAMS,
      drivers: DRIVERS,
      teamById: TEAM_BY_ID,
      driverById: DRIVER_BY_ID,
    };
    const raceState = this.race.createSession(worldNoRace, this.physics);
    const world: World = { ...worldNoRace, race: raceState };
    this.world = world;
    world.racingLine = this.ai.createSession(world, this.aiCarIds);

    // ── Build visuals (async, with progress)
    const progress = (from: number, to: number) => (p: number, label: string) => {
      if (token !== this.sessionToken) return;
      this.ui.setLoading(from + (to - from) * Math.max(0, Math.min(1, p)), label);
    };
    await this.track.build(trackDef, spline, this.render.sessionGroup, progress(0.05, 0.72));
    if (token !== this.sessionToken) return;
    await this.cars.build(world, this.render.sessionGroup, progress(0.72, 0.95));
    if (token !== this.sessionToken) return;
    this.vfx.createSession(world, this.render.sessionGroup);
    this.audio.createSession(world);
    this.ui.setLoading(1, 'Ready');

    // ── Place cars
    if (config.sessionType === 'race') {
      for (const c of this.liveCars) {
        this.physics.placeOnGridSlot(c.id, c.gridPosition - 1);
        this.physics.holdCar(c.id, true);
      }
    } else {
      // Flying start: spread cars around the lap, player last so the track ahead is clear.
      const n = this.liveCars.length;
      const gap = spline.length / Math.max(1, n);
      this.liveCars.forEach((c, i) => {
        const s = spline.wrapS(-250 - gap * (n - 1 - i) * 0.6);
        this.physics!.resetCar(c.id, s);
      });
    }

    this.cameraSys.setTarget(0);
    this.cameraSys.snap();
    this.liveNameplates.setNames(this.liveNameByCar);
    this.replay.startRecording(world);
    events.emit('session:start', { config });
    events.emit('player:car', { carId: 0 });
    this.accumulator = 0;

    if (config.sessionType === 'race') {
      if (this.liveSession) {
        this.beginDriving();
        this.configureLiveCameras(safeLiveParticipants.length);
        this.race.startProcedure();
      } else {
        this.setPhase('pre-session');
        this.cameraSys.setCinematic('grid-flyover');
        this.input.setDrivingEnabled(true);
      }
    } else {
      this.beginDriving();
    }
  }

  private beginDriving(): void {
    this.setPhase('session');
    this.cameraSys.setCinematic(null);
    this.cameraSys.snap();
    this.input.setDrivingEnabled(true);
    if (this.world) this.world.paused = false;
  }

  private teardownSession(): void {
    this.clearLiveCameras();
    this.replay?.dispose();
    this.vfx?.dispose();
    this.audio.endSession();
    this.cars?.dispose();
    this.track?.dispose();
    this.race?.dispose();
    this.ai?.dispose();
    this.physics?.dispose();
    this.replay = null;
    this.vfx = null;
    this.cars = null;
    this.track = null;
    this.race = null;
    this.ai = null;
    this.physics = null;
    this.render.clearSession();
    this.world = null;
    this.liveCars = [];
    this.aiCarIds = [];
  }

  private finishSession(results: SessionResults): void {
    if (!this.world) return;
    this.pendingResults = results;
    this.replay?.stopRecording();
    this.input.setDrivingEnabled(false);
    events.emit('session:end', { results });
    const next: SessionType | null = this.lastConfig?.mode === 'grand-prix' && this.lastConfig.sessionType === 'qualifying' ? 'race' : null;
    this.setPhase('results');
    if (this.liveSession) {
      this.liveSession = false;
      this.clearLiveCameras();
      this.liveCarByUser.clear();
      this.liveNameByCar.clear();
      this.liveSpeedLimits.clear();
      this.liveNameplates.setNames(this.liveNameByCar);
      this.liveControl.resetForNextRace();
    }
    this.cameraSys.setCinematic('podium');
    this.ui.showResults(results, this.world, next);
  }

  private quitToMenu(): void {
    this.teardownSession();
    this.enterMenu('menu');
  }

  private pause(paused: boolean): void {
    if (!this.world) return;
    if (paused && this.phase === 'session') {
      this.setPhase('paused');
      this.world.paused = true;
      this.input.setDrivingEnabled(false);
      events.emit('session:pause', { paused: true });
    } else if (!paused && this.phase === 'paused') {
      this.setPhase('session');
      this.world.paused = false;
      this.input.setDrivingEnabled(true);
      this.accumulator = 0;
      events.emit('session:pause', { paused: false });
    }
  }

  private toggleReplay(): void {
    if (!this.world || !this.replay) return;
    if (this.phase === 'replay') {
      this.replay.exit();
      this.world.cars = this.liveCars;
      this.world.mode = 'live';
      this.cameraSys.setCinematic(null);
      this.cameraSys.snap();
      this.setPhase(this.phaseBeforeReplay === 'session' ? 'paused' : this.phaseBeforeReplay);
      if (this.phaseBeforeReplay === 'results') this.cameraSys.setCinematic('podium');
    } else if (this.phase === 'session' || this.phase === 'paused' || this.phase === 'results') {
      if (this.replay.getDuration() < 1) return;
      this.phaseBeforeReplay = this.phase;
      if (this.phase === 'session') {
        this.world.paused = true;
        this.input.setDrivingEnabled(false);
      }
      this.world.cars = this.replay.enter(this.world);
      this.world.mode = 'replay';
      this.cameraSys.setCinematic('replay-director');
      this.setPhase('replay');
    }
  }

  /* ─────────────────────────────── commands ─────────────────────────────── */

  private handleUICommand(cmd: UICommand): void {
    events.emit('ui:command', cmd);
    switch (cmd.type) {
      case 'start-session':
        void this.startSession(cmd.config);
        break;
      case 'ready':
        if (this.phase === 'pre-session' && this.race) {
          this.beginDriving();
          this.race.startProcedure();
        }
        break;
      case 'pause':
        this.pause(true);
        break;
      case 'resume':
        this.pause(false);
        break;
      case 'restart-session':
        if (this.lastConfig) void this.startSession(this.lastConfig);
        break;
      case 'quit-to-menu':
        this.quitToMenu();
        break;
      case 'next-session':
        if (this.lastConfig && this.pendingResults) {
          void this.startSession({
            ...this.lastConfig,
            sessionType: 'race',
            gridOrder: 'qualifying',
            gridDriverIds: this.pendingResults.gridDriverIds,
          });
        }
        break;
      case 'skip-to-end':
        this.race?.endSession();
        break;
      case 'set-quality':
        this.render.setQuality(cmd.quality);
        this.track?.setQuality(cmd.quality);
        this.cars?.setQuality(cmd.quality);
        this.vfx?.setQuality(cmd.quality);
        events.emit('quality:change', { quality: cmd.quality });
        break;
      case 'set-camera':
        this.setCameraMode(cmd.mode);
        events.emit('camera:mode', { mode: cmd.mode });
        break;
      case 'cycle-camera':
        events.emit('camera:mode', { mode: this.cycleCameraMode() });
        break;
      case 'set-assists':
        if (this.physics && this.world) this.physics.setAssists(this.world.playerCarId, cmd.assists);
        if (this.world) this.world.config.assists = cmd.assists;
        break;
      case 'set-audio':
        if (cmd.muted !== undefined) this.audio.setMuted(cmd.muted);
        if (cmd.volume !== undefined) this.audio.setMasterVolume(cmd.volume);
        break;
      case 'set-fov':
        for (const camera of this.allCameraSystems()) {
          camera.camera.fov = cmd.fov;
          camera.camera.updateProjectionMatrix();
        }
        break;
      case 'request-pit':
        if (this.world) this.race?.requestPit(this.world.playerCarId, cmd.compound);
        break;
      case 'cancel-pit':
        if (this.world) this.race?.cancelPit(this.world.playerCarId);
        break;
      case 'set-ers-mode':
        this.input.setErsMode(cmd.mode);
        break;
      case 'replay-start':
        if (this.phase !== 'replay') this.toggleReplay();
        break;
      case 'replay-stop':
        if (this.phase === 'replay') this.toggleReplay();
        break;
      case 'replay-seek':
        this.replay?.seek(cmd.time);
        break;
      case 'replay-speed':
        this.replay?.setSpeed(cmd.speed);
        break;
      case 'preview-driver':
        this.previewDriverId = cmd.driverId;
        if (this.phase === 'menu' || this.phase === 'title') this.buildShowcase(cmd.driverId);
        break;
      case 'set-menu-cinematic':
        break;
    }
  }

  private startLiveRace(participants: LiveParticipant[]): void {
    if (this.phase === 'loading' || this.phase === 'pre-session' || this.phase === 'session' || this.phase === 'paused') {
      this.liveControl.setRaceStatus('Une autre course est déjà en cours.');
      this.liveControl.resetForNextRace();
      return;
    }
    const trackDef = CIRCUITS[0];
    const config: SessionConfig = {
      mode: 'quick-race',
      sessionType: 'race',
      circuitId: trackDef.id,
      laps: trackDef.defaultLaps,
      playerDriverId: DRIVERS[0].id,
      aiDifficulty: 0.6,
      aiCount: GRID_SIZE - participants.length,
      weather: 'dry',
      timeOfDay: -1,
      assists: { ...this.ui.getSettings().assists },
      startingCompound: 'medium',
      gridOrder: 'performance',
      randomEvents: false,
    };
    void this.startSession(config, participants);
  }

  private applyLiveGift(userId: string, username: string, coinCount: number): string {
    const carId = this.liveCarByUser.get(userId);
    if (carId === undefined || !this.liveSession) {
      return `@${username} : écris « go » pour inscrire ta voiture avant la course.`;
    }
    const previousLimit = this.liveSpeedLimits.get(carId) ?? 50;
    const nextLimit = Math.min(300, previousLimit + coinCount);
    this.liveSpeedLimits.set(carId, nextLimit);
    return `Merci @${username} · vitesse maximale ${nextLimit} km/h${nextLimit === 300 ? ' (plafond atteint)' : ''}.`;
  }

  private limitParticipantSpeed(carId: number, input: DriverInput): void {
    const speedLimit = this.liveSpeedLimits.get(carId);
    const car = this.world?.cars[carId];
    if (speedLimit === undefined || !car) return;
    const limitMps = speedLimit / 3.6;
    if (car.speedAbs >= limitMps - 0.02) {
      input.throttle = 0;
      if (car.speedAbs >= limitMps) input.brake = Math.max(input.brake, 0.25);
    }
  }

  private handleInputCommand(cmd: InputCommand): void {
    switch (cmd.type) {
      case 'pause':
        if (this.phase === 'session') this.pause(true);
        else if (this.phase === 'paused') this.pause(false);
        else if (this.phase === 'replay') this.toggleReplay();
        else this.ui.handleCommand(cmd);
        break;
      case 'cycle-camera':
        if (this.world) events.emit('camera:mode', { mode: this.cycleCameraMode() });
        break;
      case 'look-back':
        for (const camera of this.allCameraSystems()) camera.setLookBack(cmd.active);
        break;
      case 'toggle-mute': {
        const s = this.ui.getSettings();
        this.audio.setMuted(!s.muted);
        this.ui.handleCommand(cmd);
        break;
      }
      case 'toggle-hud':
        this.hudVisible = !this.hudVisible;
        this.ui.setHudVisible(this.hudVisible);
        break;
      case 'toggle-replay':
        this.toggleReplay();
        break;
      case 'screenshot':
        this.render.render();
        this.canvas.toBlob((blob) => {
          if (!blob) return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `apex-formula-${Date.now()}.png`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        });
        break;
      default:
        this.ui.handleCommand(cmd);
    }
  }

  /* ─────────────────────────────── loop ─────────────────────────────── */

  private stepSim(dt: number): void {
    const world = this.world;
    if (!world || !this.physics || !this.ai || !this.race) return;
    world.time += dt;

    // Live participants use the same AI driver as the field, with a gift-raised speed cap.
    const raw = this.input.getDriverInput();
    const entry = world.race.entryByCar[world.playerCarId];
    const playerCar = world.cars[world.playerCarId];
    const autoPit = world.config.assists.pitAssist && entry && (entry.pitPhase === 'in-lane' || entry.pitPhase === 'stopped' || entry.pitPhase === 'released' || (entry.pitPhase === 'entering' && playerCar.track.inPitLane));
    if (this.liveSpeedLimits.has(world.playerCarId)) {
      Object.assign(this.playerInput, this.ai.computeInput(world.playerCarId, world, dt, 'race'));
    } else if (autoPit) {
      const a = this.ai.computeInput(world.playerCarId, world, dt, 'pit-lane');
      Object.assign(this.playerInput, a);
      this.playerInput.ersMode = raw.ersMode;
    } else {
      Object.assign(this.playerInput, raw);
    }
    this.playerInput.pitRequest = !!entry && entry.pitPhase !== 'none';
    this.limitParticipantSpeed(world.playerCarId, this.playerInput);
    this.physics.setInput(world.playerCarId, this.playerInput);

    // AI
    this.ai.update(world, dt);
    for (const id of this.aiCarIds) {
      const input = this.ai.getInput(id);
      this.limitParticipantSpeed(id, input);
      this.physics.setInput(id, input);
    }

    this.physics.step(world, dt);
    this.race.update(world, dt);

    if (world.race.phase === 'complete' && world.race.results && !this.pendingResults) {
      this.finishSession(world.race.results);
    }
  }

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const rawDt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    const world = this.world;
    if (world) {
      world.realTime += rawDt;
      this.input.setSpeedHint?.(world.cars[world.playerCarId]?.speedAbs ?? 0);
    }
    this.input.update(rawDt);
    for (const cmd of this.input.consumeCommands()) this.handleInputCommand(cmd);

    if (world && (this.phase === 'session' || this.phase === 'pre-session' || this.phase === 'results') && !world.paused) {
      // pre-session: cars are held on the grid but physics still runs (engines idle, revving).
      // results: the sim keeps running so the remaining cars finish while the podium cinematic plays.
      this.accumulator += rawDt;
      let steps = 0;
      while (this.accumulator >= PHYSICS_DT && steps < MAX_PHYSICS_STEPS_PER_FRAME) {
        this.stepSim(PHYSICS_DT);
        this.accumulator -= PHYSICS_DT;
        steps++;
      }
      if (steps === MAX_PHYSICS_STEPS_PER_FRAME) this.accumulator = 0;
      this.replay?.record(world, rawDt);
    } else if (world && this.phase === 'replay' && this.replay) {
      this.replay.update(rawDt);
      this.ui.setReplayTime?.(this.replay.getTime(), this.replay.getDuration(), this.replay.getSpeed());
    }

    const camera = this.cameraSys.camera;
    this.cameraSys.update(world, rawDt);
    for (const cameraSystem of this.liveCameraSystems) cameraSystem.update(world, rawDt);
    if (world) {
      const cockpit = this.cameraSys.getCinematic() === null && this.cameraSys.getMode() === 'cockpit';
      if (cockpit !== this.cockpitView) {
        this.cockpitView = cockpit;
        this.cars?.setCockpitView(world.playerCarId, cockpit);
      }
      this.track?.update(world, camera, rawDt);
      this.cars?.update(world, camera, rawDt);
      this.vfx?.update(world, camera, rawDt);
    }
    const liveCameraViews = this.getLiveCameraViews();
    this.livePlayerHUD.update(world, liveCameraViews, this.liveNameByCar, rawDt);
    this.liveNameplates.update(world, liveCameraViews);
    this.render.update(world, camera, rawDt);
    this.audio.update(world, camera, rawDt);
    this.ui.update(world, rawDt, this.render.getStats());
    this.render.render();
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.render.resize(w, h);
    this.cameraSys.resize(w / h);
  }

  private configureLiveCameras(playerCount: number): void {
    this.clearLiveCameras();
    this.livePreviousCameraMode = this.cameraSys.getMode();
    this.cameraSys.setMode('chase');
    this.cameraSys.setTarget(0);
    this.cameraSys.setCinematic(null);
    this.cameraSys.snap();

    for (let carId = 1; carId < playerCount; carId++) {
      const cameraSystem = new CameraSystem(window.innerWidth / window.innerHeight);
      cameraSystem.setTarget(carId);
      cameraSystem.snap();
      this.liveCameraSystems.push(cameraSystem);
    }

    this.render.setSplitCameras(playerCount > 1 ? this.allCameraSystems().map((system) => system.camera) : null);
  }

  private clearLiveCameras(): void {
    this.render.setSplitCameras(null);
    for (const cameraSystem of this.liveCameraSystems) cameraSystem.dispose();
    this.liveCameraSystems.length = 0;
    if (this.livePreviousCameraMode !== null) {
      this.cameraSys.setMode(this.livePreviousCameraMode);
      this.cameraSys.setTarget(0);
      this.cameraSys.snap();
      this.livePreviousCameraMode = null;
    }
    this.cameraSys.resize(window.innerWidth / window.innerHeight);
  }

  private allCameraSystems(): ICameraSystem[] {
    return [this.cameraSys, ...this.liveCameraSystems];
  }

  private setCameraMode(mode: CameraMode): void {
    for (const cameraSystem of this.allCameraSystems()) cameraSystem.setMode(mode);
  }

  private cycleCameraMode(): CameraMode {
    const mode = this.cameraSys.cycle();
    for (const cameraSystem of this.liveCameraSystems) cameraSystem.setMode(mode);
    return mode;
  }

  private getLiveCameraViews(): LiveCameraView[] {
    if (this.liveNameByCar.size === 0) return [];
    const cameras = this.allCameraSystems().map((system) => system.camera);
    const viewports = getSplitViewports(window.innerWidth, window.innerHeight, cameras.length);
    return [...this.liveNameByCar.keys()].flatMap((carId) => {
      const camera = cameras[carId];
      const viewport = viewports[carId];
      if (!camera || !viewport) return [];
      camera.aspect = viewport.width / viewport.height;
      camera.updateProjectionMatrix();
      return [{ carId, camera, viewport }];
    });
  }
}

new Game();
