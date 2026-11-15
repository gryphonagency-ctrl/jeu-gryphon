import * as THREE from 'three';
import type { QualityLevel } from '../core/constants';
import { events } from '../core/events';
import { Rng, clamp, lerp } from '../core/math';
import type { TrackSpline } from '../core/track/TrackSpline';
import type { ITrackBuilder, TrackDefinition, World, FlagType } from '../core/types';
import { buildBarriers, flagStyle, type MarshalFlags } from './barriers';
import { buildBoards, buildBridgesAndTowers, buildGantry, type StartLights } from './gantry';
import { buildGrandstands, type CrowdResult } from './grandstands';
import { createSharedUniforms } from './materials';
import { buildPitComplex } from './pit';
import { buildScenery } from './scenery';
import { buildSurface, computeRacingLine } from './surface';
import { buildTerrain } from './terrain';
import { createTextures } from './textures';
import { PALETTES } from './themes';
import { Disposer, nightFactor, qualityIndex, yieldFrame, type BuildCtx } from './util';

const TEXTURE_SIZE: Record<QualityLevel, number> = { low: 512, medium: 1024, high: 2048, ultra: 2048 };
const CROWD_SCALE: Record<QualityLevel, number> = { low: 0.3, medium: 0.6, high: 1, ultra: 1 };
const TREE_SCALE: Record<QualityLevel, number> = { low: 0.4, medium: 0.7, high: 1, ultra: 1 };

const hashId = (id: string): number => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
};

const _col = new THREE.Color();

export class TrackBuilder implements ITrackBuilder {
  private ctx: BuildCtx | null = null;
  private root: THREE.Group | null = null;
  private lights: StartLights | null = null;
  private marshals: MarshalFlags | null = null;
  private crowd: CrowdResult | null = null;
  private quality: QualityLevel = 'high';
  private time = 0;
  private cheerBoost = 0;
  private lastLights = -1;
  private lastNight = -1;
  private readonly lastFlags: [string, string, string] = ['', '', ''];
  private readonly offEvents: (() => void)[] = [];
  private fullCounts = new Map<THREE.InstancedMesh, number>();

  async build(def: TrackDefinition, track: TrackSpline, parent: THREE.Object3D, onProgress: (p: number, label: string) => void): Promise<void> {
    this.dispose();
    const root = new THREE.Group();
    root.name = 'circuit';
    parent.add(root);
    this.root = root;
    const disposer = new Disposer();
    const palette = PALETTES[def.environment.theme];
    const uniforms = createSharedUniforms();
    const seed = hashId(def.id);
    const shadows = this.quality !== 'low';

    const stage = (from: number, to: number) => (p: number, label: string) => onProgress(from + clamp(p, 0, 1) * (to - from), label);

    let progress = stage(0, 0.06);
    progress(0, 'Painting textures');
    const tex = await createTextures(disposer, palette, TEXTURE_SIZE[this.quality], yieldFrame, seed);

    const ctx: BuildCtx = {
      def,
      track,
      theme: def.environment.theme,
      palette,
      quality: this.quality,
      rng: new Rng(seed ^ 0x51ed),
      root,
      tex,
      uniforms,
      disposer,
      shadows,
      night: [],
      crowdMeshes: [],
      treeMeshes: [],
      detailObjects: [],
      shadowCasters: [],
      animators: [],
      progress: (p, label) => progress(p, label),
    };
    this.ctx = ctx;

    progress = stage(0.06, 0.16);
    const terrain = await buildTerrain(ctx);
    progress = stage(0.16, 0.42);
    const line = computeRacingLine(ctx);
    await buildSurface(ctx, line);
    progress = stage(0.42, 0.54);
    this.marshals = await buildBarriers(ctx);
    progress = stage(0.54, 0.64);
    await buildPitComplex(ctx);
    progress = stage(0.64, 0.7);
    progress(0, 'Raising the gantry');
    this.lights = buildGantry(ctx);
    buildBoards(ctx);
    await yieldFrame();
    buildBridgesAndTowers(ctx);
    progress(1, 'Raising the gantry');
    progress = stage(0.7, 0.8);
    this.crowd = await buildGrandstands(ctx);
    progress = stage(0.8, 0.98);
    await buildScenery(ctx, terrain);
    progress = stage(0.98, 1);

    for (const m of ctx.crowdMeshes) this.fullCounts.set(m, m.count);
    for (const m of ctx.treeMeshes) this.fullCounts.set(m, m.count);
    if (this.crowd) {
      this.fullCounts.set(this.crowd.crowd, this.crowd.crowd.count);
      this.fullCounts.set(this.crowd.flags, this.crowd.flags.count);
    }
    this.applyQuality();
    this.lastLights = -1;
    this.lastNight = -1;
    this.lastFlags[0] = this.lastFlags[1] = this.lastFlags[2] = '';

    this.offEvents.push(
      events.on('race:overtake', () => {
        this.cheerBoost = Math.min(1, this.cheerBoost + 0.6);
      }),
      events.on('race:finish', () => {
        this.cheerBoost = 1.4;
      }),
    );
    progress(1, 'Circuit ready');
  }

  update(world: World, _camera: THREE.PerspectiveCamera, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.time += dt;
    const u = ctx.uniforms;
    u.uTime.value = this.time;
    u.uWet.value = world.env.weather.wetness;
    const night = nightFactor(world.env.timeOfDay);
    u.uNight.value = night;
    this.cheerBoost = Math.max(0, this.cheerBoost - dt * 0.35);
    u.uCheer.value = 0.25 + this.cheerBoost;
    u.uWind.value = 0.8 + world.env.weather.wetness * 0.6;

    if (Math.abs(night - this.lastNight) > 0.01) {
      this.lastNight = night;
      for (const item of ctx.night) item.material.emissiveIntensity = lerp(item.dayIntensity, item.nightIntensity, night);
    }

    const lit = world.race.phase === 'lights' ? world.race.lightsOn : 0;
    if (lit !== this.lastLights && this.lights) {
      this.lastLights = lit;
      this.lights.set(lit);
    }

    const m = this.marshals;
    if (m) {
      const f = world.race.sectorFlags;
      if (f[0] !== this.lastFlags[0] || f[1] !== this.lastFlags[1] || f[2] !== this.lastFlags[2]) {
        this.lastFlags[0] = f[0];
        this.lastFlags[1] = f[1];
        this.lastFlags[2] = f[2];
        this.applyMarshalFlags(m, f);
      }
    }

    for (const a of ctx.animators) a.update(this.time, dt, night);
  }

  private applyMarshalFlags(m: MarshalFlags, f: [FlagType, FlagType, FlagType]): void {
    const attr = m.mesh.geometry.getAttribute('aFlag') as THREE.InstancedBufferAttribute | undefined;
    const n = m.sectors.length;
    for (let i = 0; i < n; i++) {
      const [hex, pattern] = flagStyle(f[m.sectors[i]] ?? 'green');
      _col.set(hex);
      m.mesh.setColorAt(i, _col);
      if (attr) attr.setY(i, pattern);
    }
    if (m.mesh.instanceColor) m.mesh.instanceColor.needsUpdate = true;
    if (attr) attr.needsUpdate = true;
  }

  setQuality(q: QualityLevel): void {
    this.quality = q;
    if (this.ctx) this.applyQuality();
  }

  private applyQuality(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const q = this.quality;
    const qi = qualityIndex(q);
    ctx.quality = q;
    ctx.shadows = qi >= 1;
    for (const o of ctx.shadowCasters) {
      o.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) c.castShadow = qi >= 1;
      });
      if ((o as THREE.Mesh).isMesh) o.castShadow = qi >= 1;
    }
    for (const o of ctx.detailObjects) o.visible = qi >= 1;
    for (const m of ctx.crowdMeshes) m.count = Math.round((this.fullCounts.get(m) ?? m.count) * CROWD_SCALE[q]);
    if (this.crowd) {
      this.crowd.crowd.count = Math.round((this.fullCounts.get(this.crowd.crowd) ?? 0) * CROWD_SCALE[q]);
      this.crowd.flags.count = Math.round((this.fullCounts.get(this.crowd.flags) ?? 0) * CROWD_SCALE[q]);
    }
    for (const m of ctx.treeMeshes) {
      m.count = Math.round((this.fullCounts.get(m) ?? m.count) * TREE_SCALE[q]);
      m.castShadow = qi >= 2;
    }
  }

  dispose(): void {
    for (const off of this.offEvents) off();
    this.offEvents.length = 0;
    if (this.root) {
      this.root.parent?.remove(this.root);
      this.root.clear();
    }
    this.ctx?.disposer.dispose();
    this.ctx = null;
    this.root = null;
    this.lights = null;
    this.marshals = null;
    this.crowd = null;
    this.fullCounts = new Map();
    this.cheerBoost = 0;
    this.time = 0;
  }
}
