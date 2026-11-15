/**
 * VFXSystem — Agent 10. Particles (smoke, sparks, dust/gravel/grass, rain, spray, debris, confetti, pyro), brake glow,
 * heat haze, persistent skid marks, racing-line ribbon and screen rain. Re-created per session by main.ts.
 */
import * as THREE from 'three';
import type { QualityLevel } from '../core/constants';
import { events } from '../core/events';
import type { TrackSample } from '../core/track/TrackSpline';
import type { CameraMode, IVFXSystem, World } from '../core/types';
import { budgetFor, SKID_SEGMENTS } from './budgets';
import { CarEmitters, type EmitterEnv } from './CarEmitters';
import { Celebration } from './Celebration';
import { HeatHaze } from './HeatHaze';
import { createLighting, updateLighting, type ParticleLighting } from './lighting';
import { ParticleSystem, SIM_ENV } from './ParticleSystem';
import { RacingLineRibbon } from './RacingLineRibbon';
import { RainSystem } from './RainSystem';
import { ScreenRain } from './ScreenRain';
import { SkidMarks } from './SkidMarks';
import { createVFXTextures, type VFXTextures } from './textures';
import { groundPlaneFromSample, type GroundPlane } from './util';

export interface VFXStats {
  particles: number;
  perSystem: Record<string, number>;
  updateMs: number;
}

interface Systems {
  smoke: ParticleSystem;
  sparks: ParticleSystem;
  dust: ParticleSystem;
  stones: ParticleSystem;
  spray: ParticleSystem;
  debris: ParticleSystem;
  confetti: ParticleSystem;
  pyro: ParticleSystem;
  splash: ParticleSystem;
  glow: ParticleSystem;
  rain: RainSystem;
}

const ONBOARD_MODES: ReadonlySet<CameraMode> = new Set<CameraMode>(['tcam', 'cockpit', 'nose']);
const BROADCAST_MODES: ReadonlySet<CameraMode> = new Set<CameraMode>(['tv', 'helicopter']);

const _camPos = new THREE.Vector3();
const _sunView = new THREE.Vector3();
const _camInv = new THREE.Matrix4();

export class VFXSystem implements IVFXSystem {
  private readonly root = new THREE.Group();
  private textures: VFXTextures | null = null;
  private systems: Systems | null = null;
  private emitters: CarEmitters | null = null;
  private skids: SkidMarks | null = null;
  private haze: HeatHaze | null = null;
  private racingLine: RacingLineRibbon | null = null;
  private screenRain: ScreenRain | null = null;
  private readonly celebration = new Celebration();
  private readonly lighting: ParticleLighting = createLighting();
  private world: World | null = null;
  private quality: QualityLevel = 'high';
  private time = 0;
  private cameraMode: CameraMode = 'chase';
  private readonly unsubs: (() => void)[] = [];
  private readonly camPrev = new THREE.Vector3();
  private readonly camVel = new THREE.Vector3();
  private camInit = false;
  private camS = 0;
  private readonly camGround: GroundPlane = { c: -1e9, gx: 0, gz: 0 };
  private readonly camProjection = { s: 0, lateral: 0, distance: 0 };
  private camSample: TrackSample | null = null;
  private celebrated = false;
  private readonly env: EmitterEnv = { rain: 0, wetness: 0, time: 0, rateScale: 1 };
  readonly stats: VFXStats = { particles: 0, perSystem: {}, updateMs: 0 };

  constructor() {
    this.root.name = 'vfx-root';
  }

  /* ─────────────────────────────── lifecycle ─────────────────────────────── */

  createSession(world: World, parent: THREE.Object3D): void {
    this.disposeSessionObjects();
    this.world = world;
    this.time = 0;
    this.celebrated = false;
    this.camInit = false;
    this.camSample = null;
    this.textures ??= createVFXTextures();
    this.buildSystems(world);
    this.racingLine = new RacingLineRibbon();
    this.root.add(this.racingLine.mesh);
    this.screenRain = new ScreenRain(this.textures.noise);
    this.root.add(this.screenRain.mesh);
    parent.add(this.root);
    this.subscribe();
  }

  private buildSystems(world: World): void {
    const tex = this.textures;
    if (!tex) return;
    const q = this.quality;
    const carCount = Math.max(1, world.cars.length);
    const sys: Systems = {
      smoke: new ParticleSystem({
        name: 'smoke',
        capacity: budgetFor('smoke', q),
        texture: tex.smoke,
        blend: 'alpha',
        buoyancy: 0.5,
        drag: 1.4,
        wind: 0.7,
        sizeOverLife: [1, 3.2],
        fade: [0.06, 0.55],
        lit: 1,
        softNear: 2.5,
        renderOrder: 10,
      }),
      spray: new ParticleSystem({
        name: 'spray',
        capacity: budgetFor('spray', q),
        texture: tex.smoke,
        blend: 'alpha',
        gravity: 1.1,
        drag: 1.1,
        wind: 0.5,
        sizeOverLife: [1, 4.2],
        fade: [0.05, 0.55],
        lit: 0.85,
        softNear: 3,
        renderOrder: 10,
      }),
      dust: new ParticleSystem({
        name: 'dust',
        capacity: budgetFor('dust', q),
        texture: tex.dust,
        blend: 'alpha',
        gravity: 0.5,
        drag: 1.2,
        wind: 0.6,
        sizeOverLife: [1, 3.2],
        fade: [0.06, 0.5],
        lit: 1,
        softNear: 2.5,
        renderOrder: 10,
      }),
      stones: new ParticleSystem({
        name: 'stones',
        capacity: budgetFor('stones', q),
        texture: tex.chip,
        blend: 'alpha',
        gravity: 9.81,
        drag: 0.6,
        bounce: 0.3,
        friction: 0.5,
        sizeOverLife: [1, 1],
        fade: [0, 0.15],
        lit: 0.7,
        renderOrder: 9,
      }),
      debris: new ParticleSystem({
        name: 'debris',
        capacity: budgetFor('debris', q),
        texture: tex.chip,
        blend: 'alpha',
        gravity: 9.81,
        drag: 0.9,
        bounce: 0.35,
        friction: 0.55,
        sizeOverLife: [1, 1],
        fade: [0, 0.2],
        lit: 0.6,
        renderOrder: 9,
      }),
      sparks: new ParticleSystem({
        name: 'sparks',
        capacity: budgetFor('sparks', q),
        texture: tex.spark,
        blend: 'additive',
        gravity: 9.81,
        drag: 0.35,
        bounce: 0.45,
        friction: 0.7,
        stretch: 0.028,
        stretchMax: 50,
        sizeOverLife: [1, 0.6],
        fade: [0, 0.45],
        renderOrder: 11,
      }),
      pyro: new ParticleSystem({
        name: 'pyro',
        capacity: budgetFor('pyro', q),
        texture: tex.glow,
        blend: 'additive',
        gravity: 3.2,
        drag: 1.3,
        wind: 0.2,
        sizeOverLife: [1, 0.5],
        fade: [0.02, 0.6],
        renderOrder: 11,
      }),
      confetti: new ParticleSystem({
        name: 'confetti',
        capacity: budgetFor('confetti', q),
        texture: tex.confetti,
        blend: 'alpha',
        gravity: 9.81,
        drag: 2.4,
        wind: 0.8,
        bounce: 0.05,
        friction: 0.3,
        flutter: 6,
        sizeOverLife: [1, 1],
        fade: [0.02, 0.25],
        lit: 0.8,
        renderOrder: 9,
      }),
      splash: new ParticleSystem({
        name: 'splash',
        capacity: budgetFor('splash', q),
        texture: tex.ring,
        blend: 'alpha',
        ground: true,
        sizeOverLife: [1, 4.5],
        fade: [0.05, 0.6],
        renderOrder: 8,
      }),
      glow: new ParticleSystem({
        name: 'brake-glow',
        capacity: carCount * 8,
        texture: tex.glow,
        blend: 'additive',
        manual: true,
        sizeOverLife: [1, 1],
        fade: [0, 0],
        renderOrder: 11,
      }),
      rain: new RainSystem(budgetFor('rain', q), tex.rain),
    };
    for (const key of Object.keys(sys) as (keyof Systems)[]) this.root.add(sys[key].mesh);
    this.systems = sys;

    const segs = SKID_SEGMENTS[q];
    this.skids = new SkidMarks(carCount * 4, segs.dry, segs.wet, tex.noise);
    this.root.add(this.skids.mesh);
    this.haze = new HeatHaze(carCount, tex.noise);
    this.root.add(this.haze.mesh);
    this.emitters = new CarEmitters(
      {
        smoke: sys.smoke,
        sparks: sys.sparks,
        dust: sys.dust,
        stones: sys.stones,
        spray: sys.spray,
        debris: sys.debris,
        glow: sys.glow,
        haze: this.haze,
        skids: this.skids,
      },
      world.track,
      carCount,
    );
    this.env.rateScale = Math.min(1, budgetFor('smoke', q) / 4000);
  }

  private subscribe(): void {
    this.unsubscribe();
    const u = this.unsubs;
    u.push(
      events.on('car:collision', ({ carId, impulse, point, normal }) => {
        const world = this.world;
        const em = this.emitters;
        if (!world || !em) return;
        const car = world.cars[carId];
        if (!car) return;
        const sparks = Math.min(160, Math.max(6, Math.round(impulse / 60)));
        const debris = impulse > 1500 ? Math.min(60, Math.max(6, Math.round(impulse / 250))) : 0;
        em.burstAt(car, point.x, point.y, point.z, normal.x, normal.y, normal.z, sparks, debris);
      }),
    );
    u.push(
      events.on('car:bottoming', ({ carId, intensity }) => {
        const world = this.world;
        const em = this.emitters;
        if (!world || !em || intensity < 0.5) return;
        const car = world.cars[carId];
        if (!car || car.speedAbs < 30) return;
        em.burstAt(car, car.position.x, car.position.y + 0.03, car.position.z, 0, 0.3, 0, Math.round(6 + intensity * 12), 0);
      }),
    );
    u.push(
      events.on('car:lockup', ({ carId, wheel, active }) => {
        const world = this.world;
        const em = this.emitters;
        if (!world || !em || !active) return;
        const car = world.cars[carId];
        if (!car || car.speedAbs < 8 || world.env.weather.wetness > 0.5) return;
        em.lockupPuff(car, wheel, 6);
      }),
    );
    u.push(
      events.on('race:phase', ({ phase }) => {
        if (phase === 'finished' || phase === 'complete') {
          if (!this.celebrated) this.celebrate();
        } else if (phase === 'formation' || phase === 'lights') {
          this.celebrated = false;
          this.celebration.stop();
        }
      }),
    );
    u.push(
      events.on('race:finish', ({ carId }) => {
        const world = this.world;
        if (!world || carId !== world.playerCarId) return;
        if (!this.celebrated) this.celebrate();
      }),
    );
    u.push(
      events.on('camera:mode', ({ mode }) => {
        this.cameraMode = mode;
      }),
    );
    u.push(
      events.on('quality:change', ({ quality }) => {
        this.setQuality(quality);
      }),
    );
  }

  private unsubscribe(): void {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
  }

  private celebrate(): void {
    const world = this.world;
    if (!world) return;
    this.celebrated = true;
    const leader = world.race.entries[0];
    const team = leader ? world.teamById[leader.teamId] : undefined;
    const colours = team ? [team.primaryColor, team.secondaryColor, team.accentColor] : ['#ffd21f', '#ffffff', '#ff2a22'];
    this.celebration.startCannons(world.track, colours);
    const tod = world.env.timeOfDay;
    if (tod > 20 || tod < 5) this.celebration.startFireworks(world.track, 28);
  }

  /* ─────────────────────────────── per frame ─────────────────────────────── */

  update(world: World, camera: THREE.PerspectiveCamera, dt: number): void {
    const t0 = performance.now();
    this.world = world;
    const sys = this.systems;
    const em = this.emitters;
    const skids = this.skids;
    const haze = this.haze;
    if (!sys || !em || !skids || !haze) return;

    camera.updateMatrixWorld();
    camera.getWorldPosition(_camPos);
    if (!this.camInit) {
      this.camPrev.copy(_camPos);
      this.camVel.set(0, 0, 0);
      this.camInit = true;
    } else if (dt > 0) {
      const jump = this.camPrev.distanceToSquared(_camPos);
      if (jump > 25 * 25) {
        this.camVel.set(0, 0, 0);
      } else {
        const k = Math.min(1, dt * 12);
        this.camVel.x += ((_camPos.x - this.camPrev.x) / dt - this.camVel.x) * k;
        this.camVel.y += ((_camPos.y - this.camPrev.y) / dt - this.camVel.y) * k;
        this.camVel.z += ((_camPos.z - this.camPrev.z) / dt - this.camVel.z) * k;
      }
      this.camPrev.copy(_camPos);
    }

    const simDt = world.paused ? 0 : dt;
    if (simDt > 0) this.time += simDt;
    const weather = world.env.weather;
    this.env.rain = weather.rain;
    this.env.wetness = weather.wetness;
    this.env.time = this.time;
    SIM_ENV.time = this.time;
    SIM_ENV.windX = Math.sin(weather.windDir) * weather.windSpeed;
    SIM_ENV.windZ = Math.cos(weather.windDir) * weather.windSpeed;

    // Lighting for lit sprites (sun direction in view space).
    updateLighting(this.lighting, world.env);
    _camInv.copy(camera.matrixWorld).invert();
    _sunView.copy(this.lighting.sunDir).transformDirection(_camInv);
    sys.smoke.setLighting(_sunView, this.lighting.sunColor, this.lighting.ambient);
    sys.spray.setLighting(_sunView, this.lighting.sunColor, this.lighting.ambient);
    sys.dust.setLighting(_sunView, this.lighting.sunColor, this.lighting.ambient);
    sys.stones.setLighting(_sunView, this.lighting.sunColor, this.lighting.ambient);
    sys.debris.setLighting(_sunView, this.lighting.sunColor, this.lighting.ambient);
    sys.confetti.setLighting(_sunView, this.lighting.sunColor, this.lighting.ambient);
    haze.setLighting(this.lighting.sunColor, this.lighting.ambient);

    // Ground plane under the camera (rain splashes, rain floor).
    world.track.project(_camPos.x, _camPos.z, this.camS, this.camProjection);
    this.camS = this.camProjection.s;
    this.camSample ??= world.track.sample(this.camS);
    groundPlaneFromSample(world.track.sample(this.camS, this.camSample), this.camGround);

    if (simDt > 0) {
      em.update(world.cars, camera, _camPos, this.env, simDt);
      this.celebration.update(simDt, sys.confetti, sys.pyro);
      sys.rain.updateRain(simDt, weather.rain, _camPos, this.camVel, SIM_ENV.windX, SIM_ENV.windZ, this.camGround.c, this.camGround.gx, this.camGround.gz, sys.splash, 12);
      haze.commit(this.time);
    }
    sys.smoke.update(simDt);
    sys.spray.update(simDt);
    sys.dust.update(simDt);
    sys.stones.update(simDt);
    sys.debris.update(simDt);
    sys.sparks.update(simDt);
    sys.pyro.update(simDt);
    sys.confetti.update(simDt);
    sys.splash.update(simDt);
    sys.glow.update(simDt);
    if (simDt <= 0) sys.rain.update(0);
    skids.commit(this.time);

    // Racing line: rebuild on assist change, hide in replay and broadcast cameras.
    const rl = this.racingLine;
    if (rl) {
      rl.sync(world.track, world.racingLine, world.config.assists.racingLine);
      rl.setVisible(world.mode !== 'replay' && !BROADCAST_MODES.has(this.cameraMode));
      rl.update(this.time, dt);
    }

    // Screen rain: onboard cameras in the rain, lens spray when close behind a car in the wet.
    const sr = this.screenRain;
    if (sr) {
      const prox = em.proximity;
      const onboard = ONBOARD_MODES.has(this.cameraMode) || prox.nearestCarDist < 2.6;
      const speed01 = Math.min(1, prox.nearestCarSpeed / 80);
      // Lens droplets dry gradually while onboard; a camera cut to an external view is a different lens.
      if (onboard) sr.update(simDt, this.time, Math.min(1, weather.rain * 1.1), prox.lensSpray, speed01, camera.aspect);
      else sr.reset();
    }

    // Stats.
    const st = this.stats;
    let total = 0;
    for (const key of Object.keys(sys) as (keyof Systems)[]) {
      const c = sys[key].count;
      st.perSystem[key] = c;
      total += c;
    }
    st.particles = total;
    st.updateMs = performance.now() - t0;
  }

  /* ─────────────────────────────── quality / teardown ─────────────────────────────── */

  setQuality(q: QualityLevel): void {
    if (q === this.quality) return;
    this.quality = q;
    const sys = this.systems;
    const world = this.world;
    if (!sys || !world || !this.textures) return;
    sys.smoke.setCapacity(budgetFor('smoke', q));
    sys.sparks.setCapacity(budgetFor('sparks', q));
    sys.rain.setCapacity(budgetFor('rain', q));
    sys.spray.setCapacity(budgetFor('spray', q));
    sys.dust.setCapacity(budgetFor('dust', q));
    sys.stones.setCapacity(budgetFor('stones', q));
    sys.debris.setCapacity(budgetFor('debris', q));
    sys.confetti.setCapacity(budgetFor('confetti', q));
    sys.pyro.setCapacity(budgetFor('pyro', q));
    sys.splash.setCapacity(budgetFor('splash', q));
    this.env.rateScale = Math.min(1, budgetFor('smoke', q) / 4000);
    // Skid ring length changes with quality: rebuild the decal buffer (marks reset).
    if (this.skids && this.emitters && this.haze) {
      const segs = SKID_SEGMENTS[q];
      this.skids.dispose();
      this.skids = new SkidMarks(Math.max(1, world.cars.length) * 4, segs.dry, segs.wet, this.textures.noise);
      this.root.add(this.skids.mesh);
      this.emitters = new CarEmitters(
        {
          smoke: sys.smoke,
          sparks: sys.sparks,
          dust: sys.dust,
          stones: sys.stones,
          spray: sys.spray,
          debris: sys.debris,
          glow: sys.glow,
          haze: this.haze,
          skids: this.skids,
        },
        world.track,
        Math.max(1, world.cars.length),
      );
    }
  }

  endSession(): void {
    const sys = this.systems;
    if (sys) for (const key of Object.keys(sys) as (keyof Systems)[]) sys[key].clear();
    this.skids?.clear();
    this.emitters?.reset();
    this.celebration.stop();
    this.screenRain?.reset();
    this.haze?.begin();
    this.haze?.commit(this.time);
    this.celebrated = false;
  }

  private disposeSessionObjects(): void {
    this.unsubscribe();
    const sys = this.systems;
    if (sys) for (const key of Object.keys(sys) as (keyof Systems)[]) sys[key].dispose();
    this.systems = null;
    this.skids?.dispose();
    this.skids = null;
    this.haze?.dispose();
    this.haze = null;
    this.racingLine?.dispose();
    this.racingLine = null;
    this.screenRain?.dispose();
    this.screenRain = null;
    this.emitters = null;
    this.celebration.stop();
  }

  dispose(): void {
    this.disposeSessionObjects();
    this.textures?.dispose();
    this.textures = null;
    this.root.removeFromParent();
    this.world = null;
  }
}
