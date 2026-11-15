/**
 * DOM-free setup shared by dev.ts (canvas) and headless runs: world + kinematic sim + fake director + AIDrivers.
 */
import { KINGSMERE } from '../core/circuits';
import { DRIVERS, DRIVER_BY_ID, TEAMS, TEAM_BY_ID } from '../core/teams';
import { TrackSpline } from '../core/track/TrackSpline';
import type { SessionConfig, World } from '../core/types';
import { copyInput, createEmptyCarState, createEnvironment } from '../core/world';
import { AIDrivers } from './AIDrivers';
import { RacingLine } from './RacingLine';
import { FakeDirector, KinematicSim, createFakeRaceState } from './devSim';

export interface HarnessOptions {
  sessionType: 'race' | 'qualifying';
  totalLaps: number;
  difficulty: number;
  nCars: number;
}

export const createHarness = (opts: HarnessOptions) => {
  const { sessionType, totalLaps, difficulty } = opts;
  const nCars = Math.min(20, Math.max(1, opts.nCars));
  const track = new TrackSpline(KINGSMERE);
  const config: SessionConfig = {
    mode: 'quick-race',
    sessionType,
    circuitId: KINGSMERE.id,
    laps: totalLaps,
    playerDriverId: DRIVERS[0].id,
    aiDifficulty: difficulty,
    aiCount: nCars - 1,
    weather: 'dry',
    timeOfDay: -1,
    assists: { tractionControl: 'off', abs: false, autoGears: true, steeringAssist: false, brakingAssist: false, racingLine: 'full', pitAssist: true, ersAssist: true, drsAssist: true },
    startingCompound: 'soft',
    gridOrder: 'performance',
    randomEvents: false,
  };
  const cars = DRIVERS.slice(0, nCars).map((d, i) => {
    const c = createEmptyCarState(i, d.id, d.teamId, i === 0, 'soft');
    c.gridPosition = i + 1;
    return c;
  });
  const env = createEnvironment(15.5);
  const worldNoRace: Omit<World, 'race'> = {
    mode: 'live',
    config,
    trackDef: KINGSMERE,
    track,
    cars,
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
  const world: World = { ...worldNoRace, race: createFakeRaceState(worldNoRace, sessionType, totalLaps) };
  const sim = new KinematicSim(world);
  const director = new FakeDirector(world, sim);
  const ai = new AIDrivers();
  const aiIds = cars.filter((c) => !c.isPlayer).map((c) => c.id);

  const tBuild = performance.now();
  world.racingLine = ai.createSession(world, aiIds);
  const buildMs = performance.now() - tBuild;
  const lineStats = new RacingLine(track);
  const paceScale = lineStats.calibrate(KINGSMERE.referenceLapTime);
  const paceScaleEasy = lineStats.calibrate(KINGSMERE.referenceLapTime * 1.15);

  if (sessionType === 'race') {
    for (const c of cars) {
      const slot = track.gridSlot(c.gridPosition - 1);
      sim.placeAt(c.id, slot.s, slot.lateral);
      c.chassis.held = true;
    }
  } else {
    const gap = track.length / nCars;
    cars.forEach((c, i) => sim.placeAt(c.id, track.wrapS(-250 - gap * (nCars - 1 - i) * 0.6), 0));
  }

  const aiStats = { sum: 0, steps: 0, avg: 0, max: 0, total: 0, totalSteps: 0 };
  const stepSim = (dt: number): void => {
    world.time += dt;
    const e0 = world.race.entryByCar[0];
    const mode = e0.pitPhase === 'in-lane' || e0.pitPhase === 'stopped' || e0.pitPhase === 'released' ? 'pit-lane' : 'race';
    const t0 = performance.now();
    copyInput(ai.computeInput(0, world, dt, mode), cars[0].input);
    ai.update(world, dt);
    for (const id of aiIds) copyInput(ai.getInput(id), cars[id].input);
    const ms = performance.now() - t0;
    aiStats.sum += ms;
    aiStats.steps++;
    aiStats.total += ms;
    aiStats.totalSteps++;
    if (ms > aiStats.max) aiStats.max = ms;
    if (aiStats.steps >= 240) {
      aiStats.avg = aiStats.sum / aiStats.steps;
      aiStats.sum = 0;
      aiStats.steps = 0;
    }
    sim.step(dt, env.weather.wetness);
    director.update(dt);
  };

  return { track, config, cars, env, world, sim, director, ai, aiIds, buildMs, lineStats, paceScale, paceScaleEasy, aiStats, stepSim };
};

export type Harness = ReturnType<typeof createHarness>;
