/**
 * AI drivers — Agent 5. Racing line + speed profile for the session, one CarBrain per AI car (and lazily for any
 * car driven through `computeInput`, e.g. the player's pit-lane assist).
 */
import { clamp } from '../core/math';
import type { DriverInput, IAIDrivers, RacingLinePoint, World } from '../core/types';
import { createDefaultInput } from '../core/world';
import { CarBrain, type AIContext } from './CarBrain';
import { RacingLine } from './RacingLine';

export class AIDrivers implements IAIDrivers {
  private ctx: AIContext | null = null;
  private brains: (CarBrain | undefined)[] = [];
  private aiIds: number[] = [];
  private difficulty = 0.8;
  private readonly fallback: DriverInput = createDefaultInput();
  private profileWetness = 0;
  private profileTimer = 0;

  createSession(world: World, aiCarIds: number[]): RacingLinePoint[] {
    const line = new RacingLine(world.track);
    this.difficulty = clamp(world.config.aiDifficulty, 0, 1);
    const ref = world.trackDef.referenceLapTime;
    const paceScale = line.calibrate(ref);
    const paceScaleEasy = Math.min(paceScale - 0.03, line.calibrate(ref * 1.15));
    this.ctx = { line, difficulty: this.difficulty, paceScale, paceScaleEasy };
    this.brains = new Array(Math.max(world.cars.length, 1));
    this.aiIds = aiCarIds.slice();
    for (const id of this.aiIds) this.brains[id] = new CarBrain(id, world, this.ctx);
    this.profileWetness = world.env.weather.wetness;
    this.profileTimer = 0;
    if (this.profileWetness > 0.05) line.computeProfile(1 - 0.45 * this.profileWetness);
    return line.points;
  }

  update(world: World, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // Keep the HUD racing-line speeds honest when the track wetness drifts (per-car targets rescale by grip anyway).
    this.profileTimer += dt;
    if (this.profileTimer > 3) {
      this.profileTimer = 0;
      const wet = world.env.weather.wetness;
      if (Math.abs(wet - this.profileWetness) > 0.1) {
        this.profileWetness = wet;
        ctx.line.computeProfile(1 - 0.45 * wet);
      }
    }
    for (let i = 0; i < this.aiIds.length; i++) {
      const brain = this.brains[this.aiIds[i]];
      if (brain) brain.drive(world, dt, false);
    }
  }

  getInput(carId: number): DriverInput {
    const brain = this.brains[carId];
    return brain ? brain.input : this.fallback;
  }

  computeInput(carId: number, world: World, dt: number, mode: 'race' | 'pit-lane'): DriverInput {
    if (!this.ctx) return this.fallback;
    let brain = this.brains[carId];
    if (!brain) {
      brain = new CarBrain(carId, world, this.ctx);
      this.brains[carId] = brain;
    }
    brain.drive(world, dt, mode === 'pit-lane');
    return brain.input;
  }

  setDifficulty(d: number): void {
    this.difficulty = clamp(d, 0, 1);
    if (this.ctx) this.ctx.difficulty = this.difficulty;
  }

  dispose(): void {
    this.brains = [];
    this.aiIds = [];
    this.ctx = null;
  }
}
