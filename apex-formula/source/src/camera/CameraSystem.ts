import * as THREE from 'three';
import { events } from '../core/events';
import { clamp, damp } from '../core/math';
import type { TrackProjection, TrackSpline } from '../core/track/TrackSpline';
import type { CameraMode, CarState, CinematicKind, ICameraSystem, World } from '../core/types';
import { CamPose } from './CamPose';
import { CameraShake } from './CameraShake';
import { ChaseCamera } from './ChaseCamera';
import { GridFlyover, MenuOrbit, PodiumOrbit, ReplayDirector } from './Cinematics';
import { HelicopterCamera } from './HelicopterCamera';
import { CockpitCamera, NoseCamera, TCamCamera } from './OnboardCameras';
import { TVCameraMode, TVCameras } from './TVCameras';

const CYCLE: readonly CameraMode[] = ['chase', 'chase-far', 'tcam', 'cockpit', 'nose', 'tv', 'helicopter'];
const BLEND_SECONDS = 0.35;
const GROUND_CLEARANCE = 0.35;
const DEFAULT_FOV = 70;

export class CameraSystem implements ICameraSystem {
  readonly camera: THREE.PerspectiveCamera;

  private mode: CameraMode = 'chase';
  private cinematic: CinematicKind = null;
  private target = 0;
  private baseFov = DEFAULT_FOV;
  private lastAppliedFov = DEFAULT_FOV;
  private lookBackActive = false;
  private lookBack = 0;
  private pendingSnap = true;

  private readonly desired = new CamPose();
  private readonly blendFrom = new CamPose();
  private readonly smoothed = new CamPose();
  private readonly final = new CamPose();
  private blendT = 1;
  private hasOutput = false;

  private readonly chase = new ChaseCamera(false);
  private readonly chaseFar = new ChaseCamera(true);
  private readonly tcam = new TCamCamera();
  private readonly cockpit = new CockpitCamera();
  private readonly nose = new NoseCamera();
  private readonly tvMode = new TVCameraMode();
  private readonly heli = new HelicopterCamera();
  private readonly tv = new TVCameras();
  private readonly menuOrbit = new MenuOrbit();
  private readonly gridFlyover = new GridFlyover();
  private readonly podium = new PodiumOrbit();
  private readonly director = new ReplayDirector();
  private readonly shakeFx = new CameraShake();

  private trackRef: TrackSpline | null = null;
  private targetS = 0;
  private groundHint = 0;
  private readonly proj: TrackProjection = { s: 0, lateral: 0, distance: 0 };
  private readonly offs: (() => void)[] = [];

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, aspect, 0.15, 6000);
    this.camera.position.set(0, 1.3, -7);
    this.camera.lookAt(0, 0.55, 0);
    this.offs.push(
      events.on('car:collision', ({ carId, impulse }) => {
        if (carId !== this.target) return;
        this.shake(clamp(impulse / 8000, 0.12, 1), 0.5);
      }),
      events.on('car:bottoming', ({ carId, intensity }) => {
        if (carId !== this.target) return;
        this.shake(Math.min(0.15, intensity * 0.12), 0.12);
      }),
    );
  }

  /* ───────────────────────────── ICameraSystem ───────────────────────────── */

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.snapMode(mode);
    if (this.cinematic === null) this.requestBlend();
  }

  getMode(): CameraMode {
    return this.mode;
  }

  cycle(): CameraMode {
    const i = CYCLE.indexOf(this.mode);
    this.setMode(CYCLE[(i + 1) % CYCLE.length]);
    return this.mode;
  }

  setTarget(carId: number): void {
    if (carId === this.target) return;
    this.target = carId;
    this.snapAllModes();
    this.requestBlend();
  }

  getTarget(): number {
    return this.target;
  }

  shake(intensity: number, duration = 0.4): void {
    this.shakeFx.add(intensity, duration);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  snap(): void {
    this.pendingSnap = true;
    this.blendT = 1;
    this.shakeFx.reset();
  }

  setLookBack(active: boolean): void {
    this.lookBackActive = active;
  }

  setCinematic(kind: CinematicKind): void {
    if (kind === this.cinematic) return;
    this.cinematic = kind;
    switch (kind) {
      case 'menu-orbit':
        this.menuOrbit.reset();
        break;
      case 'grid-flyover':
        this.gridFlyover.reset();
        break;
      case 'podium':
        this.podium.reset();
        break;
      case 'replay-director':
        this.director.reset();
        break;
      case null:
        this.snapMode(this.mode);
        break;
    }
    this.requestBlend();
  }

  getCinematic(): CinematicKind {
    return this.cinematic;
  }

  /** Trackside TV camera positions (for debugging / editors). */
  getTVCameras(): readonly { s: number; position: THREE.Vector3; low: boolean }[] {
    return this.tv.cams;
  }

  update(world: World | null, dt: number): void {
    dt = clamp(dt, 0, 0.1);

    // Someone (UI `set-fov`) wrote camera.fov directly: adopt it as the new base.
    if (this.camera.fov !== this.lastAppliedFov) this.baseFov = this.camera.fov;

    if (this.pendingSnap) {
      this.pendingSnap = false;
      this.snapAllModes();
      this.blendT = 1;
      this.lookBack = this.lookBackActive ? 1 : 0;
    }
    this.lookBack = damp(this.lookBack, this.lookBackActive ? 1 : 0, 14, dt);

    const pose = this.desired;
    let attached = false;
    let hardCut = false;
    let track: TrackSpline | null = null;

    if (!world) {
      this.trackRef = null;
      this.menuOrbit.update(dt, pose);
      attached = true;
    } else {
      track = world.track;
      if (this.trackRef !== track) {
        this.trackRef = track;
        this.tv.build(track);
        this.snapAllModes();
        this.blendT = 1;
      }
      const car = this.resolveTarget(world);
      if (!car) {
        this.menuOrbit.update(dt, pose);
        attached = true;
      } else {
        track.project(car.position.x, car.position.z, this.targetS, this.proj);
        this.targetS = this.proj.s;
        if (this.cinematic !== null) {
          switch (this.cinematic) {
            case 'menu-orbit':
              this.menuOrbit.update(dt, pose);
              attached = true;
              break;
            case 'grid-flyover': {
              const player = world.cars[world.playerCarId] ?? car;
              if (this.gridFlyover.update(world, player, dt, pose)) this.requestBlend();
              break;
            }
            case 'podium': {
              const winnerId = world.race.entries.length > 0 ? world.race.entries[0].carId : car.id;
              this.podium.update(world.cars[winnerId] ?? car, dt, pose);
              break;
            }
            case 'replay-director':
              hardCut = this.director.update(this.tv, car, this.targetS, dt, this.baseFov, pose);
              break;
          }
        } else {
          switch (this.mode) {
            case 'chase':
              this.chase.update(car, dt, this.baseFov, this.lookBack, pose);
              break;
            case 'chase-far':
              this.chaseFar.update(car, dt, this.baseFov, this.lookBack, pose);
              break;
            case 'tcam':
              this.tcam.update(car, dt, this.baseFov, this.lookBack, pose);
              attached = true;
              break;
            case 'cockpit':
              this.cockpit.update(car, dt, this.baseFov, this.lookBack, pose);
              attached = true;
              break;
            case 'nose':
              this.nose.update(car, this.baseFov, pose);
              attached = true;
              break;
            case 'tv':
              if (!this.tvMode.update(this.tv, car, this.targetS, dt, pose)) this.chase.update(car, dt, this.baseFov, this.lookBack, pose);
              break;
            case 'helicopter':
              this.heli.update(car, dt, pose);
              attached = true;
              break;
          }
        }
      }
    }

    if (!attached && track) this.groundClamp(track, pose);

    // Mode / cinematic blend.
    if (hardCut) this.blendT = 1;
    if (this.blendT < 1 && this.hasOutput) {
      this.blendT = Math.min(1, this.blendT + dt / BLEND_SECONDS);
      const k = this.blendT * this.blendT * (3 - 2 * this.blendT);
      this.smoothed.lerpPoses(this.blendFrom, pose, k);
    } else {
      this.smoothed.copy(pose);
    }
    this.hasOutput = true;

    this.final.copy(this.smoothed);
    this.shakeFx.apply(this.final, dt, attached ? 0.35 : 1);
    if (!attached && track) this.groundClamp(track, this.final);

    const cam = this.camera;
    cam.position.copy(this.final.position);
    cam.quaternion.copy(this.final.quaternion);
    const fov = clamp(this.final.fov, 10, 120);
    if (fov !== cam.fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.lastAppliedFov = fov;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.trackRef = null;
    this.tv.cams = [];
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  private resolveTarget(world: World): CarState | null {
    const cars = world.cars;
    if (cars.length === 0) return null;
    return cars[this.target] ?? cars[world.playerCarId] ?? cars[0] ?? null;
  }

  private groundClamp(track: TrackSpline, pose: CamPose): void {
    const p = pose.position;
    track.project(p.x, p.z, this.groundHint, this.proj);
    this.groundHint = this.proj.s;
    // Far from the circuit (helicopter, wide cinematics) the track height is meaningless; only clamp near it.
    if (this.proj.distance > 80) return;
    const minY = track.heightAt(this.proj.s) + GROUND_CLEARANCE;
    if (p.y < minY) p.y = minY;
  }

  private requestBlend(): void {
    if (!this.hasOutput) return;
    this.blendFrom.copy(this.smoothed);
    this.blendT = 0;
  }

  private snapMode(mode: CameraMode): void {
    switch (mode) {
      case 'chase':
        this.chase.snap();
        break;
      case 'chase-far':
        this.chaseFar.snap();
        break;
      case 'tcam':
        this.tcam.snap();
        break;
      case 'cockpit':
        this.cockpit.snap();
        break;
      case 'tv':
        this.tvMode.snap();
        break;
      case 'helicopter':
        this.heli.snap();
        break;
      case 'nose':
        break;
    }
  }

  private snapAllModes(): void {
    this.chase.snap();
    this.chaseFar.snap();
    this.tcam.snap();
    this.cockpit.snap();
    this.tvMode.snap();
    this.heli.snap();
    this.director.reset();
  }
}
