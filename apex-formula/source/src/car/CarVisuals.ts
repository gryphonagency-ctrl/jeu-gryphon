/**
 * Car visuals — Agent 3. Implements ICarVisuals: procedural 2022+-regulation F1 cars with per-team liveries,
 * per-driver helmets and decals, articulated wheels / suspension / steering / DRS, brake glow, rain light, damage
 * states, two LOD levels and the menu showroom car.
 */
import * as THREE from 'three';
import { CAR, WHEEL_LOCAL_POSITIONS, type QualityLevel } from '../core/constants';
import type { CarState, DriverDef, ICarVisuals, TeamDef, World } from '../core/types';
import { buildCarGeometry, CarRig, type CarGeometry } from './CarModel';
import { CarMaterialLibrary } from './materials';

interface CarEntry {
  lod: THREE.LOD;
  hi: CarRig;
  lo: CarRig;
  brakeHeat: number;
  rainPhase: number;
  headLean: number;
  headPitch: number;
  flapOpen: number;
  damageSide: 1 | -1;
}

const LOD_DISTANCE: Record<QualityLevel, number> = { low: 22, medium: 32, high: 48, ultra: 80 };
const LIVERY_SIZE: Record<QualityLevel, number> = { low: 512, medium: 1024, high: 1024, ultra: 2048 };

const _e = new THREE.Euler();

const yieldFrame = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

export class CarVisuals implements ICarVisuals {
  private lib: CarMaterialLibrary | null = null;
  private geoHi: CarGeometry | null = null;
  private geoLo: CarGeometry | null = null;
  private readonly cars = new Map<number, CarEntry>();
  private showcaseRig: CarRig | null = null;
  private quality: QualityLevel = 'high';
  private time = 0;

  /* ─────────────────────────────── build ─────────────────────────────── */

  async build(world: World, parent: THREE.Object3D, onProgress: (p: number, label: string) => void): Promise<void> {
    this.disposeCars();
    onProgress(0, 'Painting liveries');
    const lib = (this.lib ??= new CarMaterialLibrary(LIVERY_SIZE[this.quality]));
    const geoHi = (this.geoHi ??= buildCarGeometry('high'));
    const geoLo = (this.geoLo ??= buildCarGeometry('low'));
    await yieldFrame();
    const n = world.cars.length;
    for (let i = 0; i < n; i++) {
      const car = world.cars[i];
      const team = world.teamById[car.teamId] ?? world.teams[0];
      const driver = world.driverById[car.driverId] ?? world.drivers[0];
      const entry = this.createEntry(geoHi, geoLo, lib, team, driver, car);
      parent.add(entry.lod);
      this.cars.set(car.id, entry);
      this.poseEntry(entry, car, 0);
      onProgress((i + 1) / n, `Building ${team.name} #${driver.number}`);
      if (i % 2 === 1) await yieldFrame();
    }
    this.applyShadowPolicy();
  }

  private createEntry(geoHi: CarGeometry, geoLo: CarGeometry, lib: CarMaterialLibrary, team: TeamDef, driver: DriverDef, car: CarState): CarEntry {
    const hi = new CarRig(geoHi, lib, team, driver, car.tyres.compound, { arms: true, driver: true });
    const lo = new CarRig(geoLo, lib, team, driver, car.tyres.compound, { arms: false, driver: false });
    lo.setShadows(false);
    const lod = new THREE.LOD();
    lod.autoUpdate = false;
    lod.addLevel(hi.root, 0);
    lod.addLevel(lo.root, LOD_DISTANCE[this.quality]);
    lod.name = `car-${car.id}`;
    return {
      lod,
      hi,
      lo,
      brakeHeat: 0,
      rainPhase: car.id * 0.37,
      headLean: 0,
      headPitch: 0,
      flapOpen: 0,
      damageSide: car.id % 2 === 0 ? 1 : -1,
    };
  }

  buildShowcase(team: TeamDef, driver: DriverDef, parent: THREE.Object3D): THREE.Object3D {
    this.disposeShowcase();
    const lib = (this.lib ??= new CarMaterialLibrary(LIVERY_SIZE[this.quality]));
    const geo = (this.geoHi ??= buildCarGeometry('high'));
    const rig = new CarRig(geo, lib, team, driver, 'soft', { arms: true, driver: true });
    rig.root.position.set(0, 0, 0);
    rig.root.quaternion.identity();
    rig.setShadows(true);
    for (const w of rig.wheels) {
      w.hub.rotation.y = 0;
      w.spin.rotation.x = 0;
    }
    rig.updateArms();
    parent.add(rig.root);
    this.showcaseRig = rig;
    return rig.root;
  }

  /* ─────────────────────────────── per frame ─────────────────────────────── */

  update(world: World, camera: THREE.PerspectiveCamera, dt: number): void {
    this.time += dt;
    const cars = world.cars;
    const wet = world.env.weather.wetness;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const entry = this.cars.get(car.id);
      if (!entry) continue;
      this.poseEntry(entry, car, dt, wet, world.race.phase === 'racing' || world.race.phase === 'green');
      entry.lod.update(camera);
    }
  }

  private poseEntry(entry: CarEntry, car: CarState, dt: number, wet = 0, racing = false): void {
    const { lod, hi, lo } = entry;
    lod.position.copy(car.position);
    lod.quaternion.copy(car.quaternion);
    const active = lod.getCurrentLevel() === 0 || dt === 0;

    // Wheels: local position from suspension travel (works live and in replay), spin, steer.
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const [wx, , wz] = WHEEL_LOCAL_POSITIONS[i];
      const y = CAR.wheelRadius + w.suspensionTravel;
      const rigs = active ? [hi, lo] : [lo];
      for (const rig of rigs) {
        const wr = rig.wheels[i];
        wr.hub.position.set(wx, y, wz);
        wr.hub.rotation.y = i < 2 ? w.steerAngle : 0;
        wr.spin.rotation.x = w.spinAngle;
      }
    }
    if (active) hi.updateArms();

    // Tyre compound & wear.
    const compound = car.tyres.compound;
    hi.setCompound(compound);
    lo.setCompound(compound);
    const wear = car.tyres.wear;
    const shade = 1 - 0.25 * wear;
    hi.tyreMat.color.setScalar(shade);
    hi.tyreMat.roughness = 0.92 - 0.25 * wear;
    lo.tyreMat.color.setScalar(shade);

    // DRS flap (smooth open / close). Damage bends the rear wing assembly.
    const target = car.drs.open ? 1 : 0;
    entry.flapOpen += (target - entry.flapOpen) * Math.min(1, dt * 14);
    hi.flapPivot.rotation.x = -0.5 * entry.flapOpen;
    lo.flapPivot.rotation.x = hi.flapPivot.rotation.x;
    const rw = car.damage.rearWing;
    hi.rwGroup.rotation.z = rw > 0.5 ? 0.12 * entry.damageSide : 0;
    hi.rwGroup.rotation.x = rw > 0.5 ? 0.08 : 0;
    lo.rwGroup.rotation.z = hi.rwGroup.rotation.z;

    // Front wing damage: lose the endplate, then the flaps, on one side; both sides when destroyed.
    const fw = car.damage.frontWing;
    const left = entry.damageSide > 0;
    const epGone = fw > 0.3;
    const flapsGone = fw > 0.6;
    const bothGone = fw > 0.85;
    for (const rig of [hi, lo]) {
      rig.fwEpL.visible = !(epGone && (left || bothGone));
      rig.fwEpR.visible = !(epGone && (!left || bothGone));
      rig.fwFlapsL.visible = !(flapsGone && (left || bothGone));
      rig.fwFlapsR.visible = !(flapsGone && (!left || bothGone));
    }

    // Brake glow: heat integrates brake work, cools with airflow.
    const brake = car.engine.brake;
    const speed = car.speedAbs;
    entry.brakeHeat += (brake * Math.min(1, speed / 60) * 2.2 - entry.brakeHeat * (0.45 + speed * 0.01)) * dt;
    entry.brakeHeat = Math.max(0, Math.min(1.4, entry.brakeHeat));
    const glow = entry.brakeHeat * entry.brakeHeat;
    hi.brakeMat.emissiveIntensity = glow * 4;
    hi.brakeMat.color.setRGB(0.29 + glow * 0.4, 0.3 + glow * 0.1, 0.31);

    // Rain light: flashing in wet running or while harvesting (ERS light), solid when held in the pit box.
    let rain = 0;
    if (wet > 0.25 && racing) {
      entry.rainPhase += dt * 4;
      rain = Math.sin(entry.rainPhase * Math.PI * 2) > 0 ? 1 : 0.05;
    } else if (car.ers.harvesting && car.speedAbs > 5) {
      entry.rainPhase += dt * 6;
      rain = Math.sin(entry.rainPhase * Math.PI * 2) > 0 ? 0.9 : 0.05;
    } else if (car.chassis.held && car.track.inPitLane) rain = 0.8;
    hi.rainMat.emissiveIntensity = rain * 3;
    lo.rainMat.emissiveIntensity = rain * 3;

    if (!active) return;

    // Steering wheel + driver head lean under g.
    hi.steering.rotation.z = -car.engine.steer * 1.45;
    const a = car.localAccel;
    const leanTarget = THREE.MathUtils.clamp(a.x * 0.012, -0.22, 0.22);
    const pitchTarget = THREE.MathUtils.clamp(-a.z * 0.008, -0.16, 0.2);
    const k = Math.min(1, dt * 8);
    entry.headLean += (leanTarget - entry.headLean) * k;
    entry.headPitch += (pitchTarget - entry.headPitch) * k;
    _e.set(entry.headPitch + 0.08, car.engine.steer * 0.06, entry.headLean);
    hi.head.quaternion.setFromEuler(_e);
    // Rumble jitter on kerbs.
    if (car.chassis.kerbRumble > 0.05) {
      const j = car.chassis.kerbRumble * 0.004;
      hi.head.position.set((Math.random() - 0.5) * j, 0.765 + (Math.random() - 0.5) * j, -0.4);
    } else hi.head.position.set(0, 0.765, -0.4);
  }

  /* ─────────────────────────────── settings ─────────────────────────────── */

  setQuality(q: QualityLevel): void {
    if (q === this.quality) return;
    this.quality = q;
    for (const e of this.cars.values()) {
      const levels = e.lod.levels;
      if (levels.length > 1) levels[1].distance = LOD_DISTANCE[q];
    }
    this.applyShadowPolicy();
  }

  /** Low: only the player casts. Medium: player + 5 nearest by id order (cheap proxy). High/ultra: everyone. */
  private applyShadowPolicy(): void {
    let i = 0;
    for (const [id, e] of this.cars) {
      const cast = this.quality === 'low' ? id === 0 : this.quality === 'medium' ? id === 0 || i < 6 : true;
      e.hi.setShadows(cast);
      i++;
    }
  }

  getCarObject(carId: number): THREE.Object3D | undefined {
    return this.cars.get(carId)?.lod;
  }

  setCockpitView(carId: number, enabled: boolean): void {
    const e = this.cars.get(carId);
    if (e) e.hi.setCockpitView(enabled);
  }

  /* ─────────────────────────────── teardown ─────────────────────────────── */

  private disposeCars(): void {
    for (const e of this.cars.values()) {
      e.hi.dispose();
      e.lo.dispose();
      e.lod.removeFromParent();
    }
    this.cars.clear();
  }

  private disposeShowcase(): void {
    if (this.showcaseRig) {
      this.showcaseRig.dispose();
      this.showcaseRig = null;
    }
  }

  dispose(): void {
    this.disposeCars();
    this.disposeShowcase();
    if (this.geoHi) for (const g of this.geoHi.all) g.dispose();
    if (this.geoLo) for (const g of this.geoLo.all) g.dispose();
    this.geoHi = null;
    this.geoLo = null;
    this.lib?.dispose();
    this.lib = null;
  }
}