import type * as THREE from 'three';
import { CAR, DRS, SESSION_LIMITS, TIMING, TYRE_DATA, type TyreCompound } from '../core/constants';
import { events } from '../core/events';
import { Rng, formatLapTime, hashString } from '../core/math';
import type { PitLaneSample, TrackSpline } from '../core/track/TrackSpline';
import type { CarState, FlagType, ICarService, IRaceDirector, RaceControlMessage, RaceEntry, RacePhase, RaceState, SectorStatus, SurfaceType, World } from '../core/types';
import { GapTables } from './GapTables';
import { CLASSIFY_EVERY, MAX_MESSAGES, createRecord, surname, type CarRecord } from './internal';
import { DRIVER_LINES, TeamRadio, VOICE_BY_TEAM, type DriverLineKind, type RadioCategory } from './Radio';
import { buildResults } from './Results';
import { chooseCompound, suggestedStopLap } from './Strategy';
import { WeatherSim, type WeatherEvent } from './Weather';

const FORMATION_SECONDS = 2.0;
const GREEN_SECONDS = 3.0;
const YELLOW_CLEAR_SECONDS = 8;
const RETIREMENT_YELLOW_SECONDS = 14;
const VSC_SECONDS = 40;
const VSC_SPEED = 40;
const RACE_FINISH_GRACE = 60;
const TIMED_FINISH_GRACE = 100;
const SLOW_SPEED = 8;
const HEAVY_COLLISION = 2500;
const FAULT_COLLISION = 3000;
const VSC_COLLISION = 4000;
const OVERTAKE_DEBOUNCE = 0.5;
const POSITION_HYSTERESIS_M = 3;
const SECTOR_DISPLAY_HOLD = 3;
const PIT_REREQUEST_COOLDOWN = 10;
const FAILURE_BASE_CHANCE = 0.003;
const FAILURE_REASONS = ['Engine failure', 'Hydraulics failure', 'Gearbox failure', 'Power unit failure', 'Suspension failure'];
const WHEEL_NAMES = ['front left', 'front right', 'rear left', 'rear right'];

export class RaceDirector implements IRaceDirector {
  private state: RaceState | null = null;
  private sw: Omit<World, 'race'> | null = null;
  private cars: ICarService | null = null;
  private track: TrackSpline | null = null;
  private records: CarRecord[] = [];
  private rng = new Rng(1);
  private gaps: GapTables | null = null;
  private radio: TeamRadio | null = null;
  private weather: WeatherSim | null = null;
  private readonly weatherEvents: WeatherEvent[] = [];
  private readonly unsubs: (() => void)[] = [];
  private stepCount = 0;
  private isRace = false;
  private isTimeTrial = false;
  private playerCarId = 0;

  private startTimer = 0;

  private readonly yellowTimer = [0, 0, 0];
  private readonly yellowDouble = [false, false, false];
  private vscTimer = 0;
  private vscWarned = false;

  private finishedAt = -1;
  private finishCount = 0;
  private readonly sessionBestSectors = [Infinity, Infinity, Infinity];
  private pitBoxByTeam: Record<string, THREE.Vector3> = {};
  private readonly overtakeAt = new Map<number, number>();
  private readonly collisionAt = new Map<number, number>();
  private readonly collisionLog: { t: number; a: number; b: number }[] = [];
  private pitScratch: PitLaneSample | null = null;
  private otherRadioAt = -Infinity;
  private strategySaidLap = -1;
  private boxSuggested = false;

  /* ────────────────────────────────────────── lifecycle ────────────────────────────────────────── */

  createSession(world: Omit<World, 'race'>, cars: ICarService): RaceState {
    this.teardown();
    const cfg = world.config;
    this.sw = world;
    this.cars = cars;
    this.track = world.track;
    this.playerCarId = world.playerCarId;
    this.isRace = cfg.sessionType === 'race';
    this.isTimeTrial = cfg.mode === 'time-trial';
    this.rng = new Rng((hashString(cfg.circuitId + ':' + cfg.playerDriverId) ^ (Date.now() & 0x7fffffff)) >>> 0);
    this.gaps = new GapTables(world.track.length);
    this.stepCount = 0;
    this.finishedAt = -1;
    this.finishCount = 0;
    this.startTimer = 0;
    this.vscTimer = 0;
    this.otherRadioAt = -Infinity;
    this.strategySaidLap = -1;
    this.boxSuggested = false;
    for (let i = 0; i < 3; i++) {
      this.sessionBestSectors[i] = Infinity;
      this.yellowTimer[i] = 0;
      this.yellowDouble[i] = false;
    }

    const entries: RaceEntry[] = world.cars.map((c, i) => ({
      carId: c.id,
      driverId: c.driverId,
      teamId: c.teamId,
      position: this.isRace ? c.gridPosition : i + 1,
      gridPosition: c.gridPosition,
      lap: this.isRace ? 1 : 0,
      lapsCompleted: 0,
      status: 'racing',
      gapToLeader: 0,
      interval: 0,
      lapsBehind: 0,
      lastLap: 0,
      bestLap: 0,
      currentSectors: [0, 0, 0],
      bestSectors: [0, 0, 0],
      currentSectorStatus: ['none', 'none', 'none'],
      currentLapTime: 0,
      lapTimes: [],
      pitStops: 0,
      pitPhase: 'none',
      pitStopTimer: 0,
      requestedCompound: null,
      tyreCompound: c.tyres.compound,
      tyreAge: c.tyres.age,
      penaltySeconds: 0,
      warnings: 0,
      penalties: [],
      drsAvailable: false,
      drsOpen: false,
      drsDetectionGap: Infinity,
      finishTime: 0,
      blueFlag: false,
      deltaAhead: 0,
      deltaBehind: 0,
      retireReason: '',
    }));
    const entryByCar = entries.slice();
    entries.sort((a, b) => a.position - b.position);
    entries.forEach((e, i) => (e.position = i + 1));

    this.records = entryByCar.map((e) => {
      const team = world.teamById[e.teamId];
      const rec = createRecord(e, team ? team.pitBoxIndex : 0);
      this.gaps!.init(rec);
      return rec;
    });
    this.pitBoxByTeam = {};
    for (const t of world.teams) this.pitBoxByTeam[t.id] = world.track.pitBox(t.pitBoxIndex).position;
    this.pitScratch = world.track.pitLaneSample(world.track.pitLane.entryS);

    let timeRemaining = -1;
    if (!this.isRace && !this.isTimeTrial) {
      timeRemaining = (cfg.sessionType === 'qualifying' ? SESSION_LIMITS.qualifyingMinutes : SESSION_LIMITS.practiceMinutes) * 60;
    }

    this.state = {
      sessionType: cfg.sessionType,
      phase: this.isRace ? 'idle' : 'racing',
      time: 0,
      timeRemaining,
      lightsOn: 0,
      totalLaps: this.isRace ? Math.max(1, cfg.laps) : 0,
      leaderLap: this.isRace ? 1 : 0,
      entries,
      entryByCar,
      sectorFlags: ['green', 'green', 'green'],
      globalFlag: 'green',
      drsEnabled: false,
      fastestLap: null,
      messages: [],
      safetyCarSpeed: 0,
      results: null,
    };

    this.weather = new WeatherSim(world.env, cfg.weather === 'dynamic', hashString(cfg.circuitId + 'wx') ^ (Date.now() & 0xffff));
    const playerCar = world.cars[this.playerCarId];
    const voice = playerCar ? VOICE_BY_TEAM[playerCar.teamId] ?? 'warm' : 'warm';
    this.radio = new TeamRadio(this.playerCarId, voice, this.rng);

    this.unsubs.push(
      events.on('car:collision', (p) => this.onCollision(p.carId, p.withCar, p.impulse)),
      events.on('car:offtrack', (p) => this.onOfftrackEvent(p.carId, p.surface, p.wheelsOff)),
      events.on('car:ontrack', (p) => {
        const rec = this.records[p.carId];
        if (rec) rec.wasOff4 = false;
      }),
      events.on('car:engine-failure', (p) => this.onEngineFailure(p.carId)),
    );

    const gpName = world.trackDef.grandPrixName.toUpperCase();
    if (this.isRace) this.rc(`${gpName} — ${this.state.totalLaps} LAPS`, 'info');
    else if (this.isTimeTrial) this.rc(`TIME TRIAL — ${world.trackDef.name.toUpperCase()}`, 'info');
    else if (cfg.sessionType === 'qualifying') this.rc(`QUALIFYING — ${SESSION_LIMITS.qualifyingMinutes} MINUTES — SESSION STARTED`, 'info');
    else this.rc(`PRACTICE — ${SESSION_LIMITS.practiceMinutes} MINUTES — SESSION STARTED`, 'info');
    return this.state;
  }

  startProcedure(): void {
    const race = this.state;
    if (!race || !this.isRace || race.phase !== 'idle') return;
    this.setPhase('formation');
    this.startTimer = FORMATION_SECONDS;
    this.rc('GRID FORMED — STARTING PROCEDURE UNDERWAY', 'info');
  }

  requestPit(carId: number, compound: TyreCompound): void {
    const rec = this.records[carId];
    if (!rec || !this.state) return;
    const e = rec.entry;
    if (e.status !== 'racing') return;
    e.requestedCompound = compound;
    if (e.pitPhase === 'none') e.pitPhase = 'requested';
    if (carId === this.playerCarId) this.radio?.say('ack', this.state.time, { compound: TYRE_DATA[compound].label }, true);
  }

  cancelPit(carId: number): void {
    const rec = this.records[carId];
    if (!rec || !this.state) return;
    const e = rec.entry;
    if (e.pitPhase === 'requested' || e.pitPhase === 'entering') {
      e.pitPhase = 'none';
      e.requestedCompound = null;
      if (carId === this.playerCarId) this.radio?.say('cancel', this.state.time, {}, true);
    }
  }

  endSession(): void {
    const race = this.state;
    const sw = this.sw;
    if (!race || !sw || race.phase === 'complete') return;
    const now = race.time;
    const cars = sw.cars;
    if (race.phase === 'idle') {
      race.phase = 'racing';
    }
    this.classify(cars, now);
    if (race.phase !== 'finished') {
      this.setPhase('finished');
      this.finishedAt = now;
      this.rc('SESSION ENDED BY RACE CONTROL', 'flag');
    }
    // Project every running car onto the line using its current gap.
    for (let i = 0; i < race.entries.length; i++) {
      const e = race.entries[i];
      if (e.status !== 'racing') continue;
      const rec = this.records[e.carId];
      if (this.isRace) {
        const gap = isFinite(e.gapToLeader) ? e.gapToLeader : e.lapsBehind * 90;
        e.status = 'finished';
        e.finishTime = now + gap + e.penaltySeconds;
        rec.finishOrder = ++this.finishCount;
        this.setDrs(rec, false);
        events.emit('race:finish', { carId: e.carId, position: e.position });
      } else {
        this.finishCar(rec, now);
      }
    }
    this.complete(cars, now);
  }

  dispose(): void {
    this.teardown();
  }

  private teardown(): void {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    this.state = null;
    this.sw = null;
    this.cars = null;
    this.track = null;
    this.records = [];
    this.gaps = null;
    this.radio = null;
    this.weather = null;
    this.pitBoxByTeam = {};
    this.overtakeAt.clear();
    this.collisionAt.clear();
    this.collisionLog.length = 0;
    this.pitScratch = null;
  }

  /* ────────────────────────────────────────── per step ────────────────────────────────────────── */

  update(world: World, dt: number): void {
    const race = this.state;
    if (!race || !this.sw || !this.track || !this.gaps || world.mode !== 'live') return;
    const cars = world.cars;
    this.stepCount++;
    if (race.phase === 'idle') return;

    this.updatePhaseMachine(dt);
    const clockRunning = race.phase !== 'formation' && race.phase !== 'lights';
    if (clockRunning) race.time += dt;
    const now = race.time;

    if (!this.isRace && !this.isTimeTrial && race.phase === 'racing') {
      race.timeRemaining = Math.max(0, race.timeRemaining - dt);
      if (race.timeRemaining === 0) this.onTimeExpired(cars, now);
    }

    this.updateWeather(dt, now);

    if (race.phase === 'complete') {
      this.radio?.update(now, race);
      return;
    }

    const heavy = this.stepCount % CLASSIFY_EVERY === 0;
    const dt4 = dt * CLASSIFY_EVERY;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const rec = this.records[car.id];
      if (!rec) continue;
      const e = rec.entry;
      e.drsOpen = car.drs.open;
      e.tyreCompound = car.tyres.compound;
      if (rec.prevS < 0) {
        rec.prevS = car.track.s;
        rec.lastLap = car.track.lap;
        rec.lastSector = car.track.sector;
      }
      this.gaps.record(rec, car.track.progress, now, dt);
      if (e.status === 'racing') {
        this.updateTiming(rec, car, now, clockRunning);
        this.updateDrs(rec, car, now, cars);
        if (heavy) this.checkSlowCar(rec, car, dt4, now);
      } else if (rec.drsLastSet) {
        this.setDrs(rec, false);
      }
      // Finished cars may still be in the pit lane (a stop in progress at the flag): let the protocol run to completion.
      if (e.status === 'racing' || (e.status === 'finished' && e.pitPhase !== 'none')) this.updatePit(rec, car, dt, now);
      rec.prevS = car.track.s;
    }

    if (heavy) {
      this.classify(cars, now);
      this.updateFlags(dt4, now);
      this.updateDrsEnabled(now);
      this.playerPeriodicRadio(now, cars);
    }
    this.checkSessionEnd(cars, now);
    this.radio?.update(now, race);
  }

  private updatePhaseMachine(dt: number): void {
    const race = this.state!;
    switch (race.phase) {
      case 'formation':
        this.startTimer -= dt;
        if (this.startTimer <= 0) {
          this.setPhase('lights');
          race.lightsOn = 1;
          events.emit('race:lights', { lightsOn: 1 });
          this.startTimer = TIMING.lightsIntervalSeconds;
        }
        break;
      case 'lights':
        this.startTimer -= dt;
        if (this.startTimer <= 0) {
          if (race.lightsOn < 5) {
            race.lightsOn++;
            events.emit('race:lights', { lightsOn: race.lightsOn });
            this.startTimer = race.lightsOn === 5 ? this.rng.range(TIMING.lightsHoldMin, TIMING.lightsHoldMax) : TIMING.lightsIntervalSeconds;
          } else {
            this.lightsOut();
          }
        }
        break;
      case 'green':
        this.startTimer -= dt;
        if (this.startTimer <= 0) this.setPhase('racing');
        break;
      case 'vsc':
        this.vscTimer -= dt;
        if (!this.vscWarned && this.vscTimer < 6) {
          this.vscWarned = true;
          this.rc('VIRTUAL SAFETY CAR ENDING', 'flag');
          this.radio?.say('vscEnd', race.time, {}, true);
        }
        if (this.vscTimer <= 0) {
          race.safetyCarSpeed = 0;
          this.setPhase('racing');
          this.rc('GREEN FLAG — RACING RESUMES', 'flag');
        }
        break;
      default:
        break;
    }
  }

  private lightsOut(): void {
    const race = this.state!;
    const sw = this.sw!;
    race.lightsOn = 0;
    events.emit('race:lights', { lightsOn: 0 });
    race.time = 0;
    this.setPhase('green');
    this.startTimer = GREEN_SECONDS;
    for (const car of sw.cars) this.cars?.holdCar(car.id, false);
    for (const rec of this.records) {
      rec.lapStartTime = 0;
      rec.sectorStartTime = 0;
      rec.sectorsDone = 0;
      rec.lapInvalid = false;
      rec.lapTouchedPit = false;
    }
    this.rc('LIGHTS OUT AND AWAY WE GO', 'info');
    this.radio?.say('start', 0, {}, true);
  }

  private setPhase(phase: RacePhase): void {
    const race = this.state!;
    if (race.phase === phase) return;
    const previous = race.phase;
    race.phase = phase;
    events.emit('race:phase', { phase, previous });
  }

  /* ────────────────────────────────────────── timing ────────────────────────────────────────── */

  private updateTiming(rec: CarRecord, car: CarState, now: number, clockRunning: boolean): void {
    const race = this.state!;
    const e = rec.entry;
    const lap = car.track.lap;
    if (lap > rec.lastLap) {
      if (clockRunning) this.onLineCrossing(rec, car, now);
      rec.lastLap = lap;
      rec.lastSector = 0;
    } else if (lap < rec.lastLap) {
      rec.backwards = true;
      rec.lapInvalid = true;
      rec.lastLap = lap;
    }
    const sector = car.track.sector;
    if (sector !== rec.lastSector) {
      if (clockRunning) this.onSectorChange(rec, sector, now);
      rec.lastSector = sector;
    }
    e.currentLapTime = rec.lapStartTime >= 0 && clockRunning ? now - rec.lapStartTime : 0;
    if (rec.sectorHoldUntil >= 0 && now >= rec.sectorHoldUntil) {
      rec.sectorHoldUntil = -1;
      for (let i = 0; i < 3; i++) {
        e.currentSectors[i] = 0;
        e.currentSectorStatus[i] = 'none';
      }
    }
    if (car.track.inPitLane) rec.lapTouchedPit = true;
    const off4 = car.track.wheelsOff >= TIMING.trackLimitsWheelsOff && !car.track.inPitLane;
    if (off4 && !rec.wasOff4) this.onTrackLimits(rec, car, car.track.surface, now);
    rec.wasOff4 = off4;
    e.lap = this.isRace ? Math.min(race.totalLaps, Math.max(1, lap)) : Math.max(0, lap);
  }

  private onLineCrossing(rec: CarRecord, car: CarState, now: number): void {
    const race = this.state!;
    const e = rec.entry;
    if (rec.backwards) {
      rec.backwards = false;
      return;
    }
    if (rec.crossings === 0) {
      rec.crossings = 1;
      if (!this.isRace) {
        rec.lapStartTime = now;
        rec.sectorStartTime = now;
        rec.sectorsDone = 0;
        rec.lapInvalid = false;
        rec.lapTouchedPit = car.track.inPitLane;
      }
      return;
    }
    if (rec.lapStartTime < 0) return;

    const lapTime = now - rec.lapStartTime;
    if (!(rec.sectorsDone & 4)) this.completeSector(rec, 2, now - rec.sectorStartTime, now);
    const valid = this.isRace ? true : !(rec.lapTouchedPit || rec.lapInvalid);
    e.lapsCompleted++;
    e.lastLap = lapTime;
    e.lapTimes.push(lapTime);
    e.tyreAge++;
    rec.crossings++;

    let personalBest = false;
    let fastestOverall = false;
    if (valid) {
      if (e.bestLap <= 0 || lapTime < e.bestLap) {
        e.bestLap = lapTime;
        personalBest = true;
      }
      if (!race.fastestLap || lapTime < race.fastestLap.time) {
        race.fastestLap = { carId: e.carId, time: lapTime, lap: e.lapsCompleted };
        fastestOverall = true;
        events.emit('race:fastest-lap', { carId: e.carId, time: lapTime });
        this.rc(`FASTEST LAP — ${this.code(e)} ${formatLapTime(lapTime)}`, 'info', e.carId);
        if (e.carId === this.playerCarId) this.radio?.say('fastest', now, { lapTime: formatLapTime(lapTime) });
        else this.flavour('fastest', e.carId, now);
      }
    } else if (this.isRace === false && rec.lapInvalid && !rec.lapTouchedPit) {
      this.rc(`${this.code(e)} — LAP TIME DELETED (TRACK LIMITS)`, 'warning', e.carId);
    }
    events.emit('race:lap', { carId: e.carId, lap: e.lapsCompleted, time: lapTime, personalBest, fastestOverall, position: e.position });

    rec.lapStartTime = now;
    rec.sectorStartTime = now;
    rec.sectorsDone = 0;
    rec.lapInvalid = false;
    rec.lapTouchedPit = car.track.inPitLane;
    rec.sectorHoldUntil = now + SECTOR_DISPLAY_HOLD;

    if (e.carId === this.playerCarId) this.playerLapRadio(rec, now);
    this.afterLap(rec, car, now);
  }

  private onSectorChange(rec: CarRecord, sector: number, now: number): void {
    if (rec.crossings === 0 || rec.lapStartTime < 0) return;
    const prev = rec.lastSector;
    if (sector === 1 && prev === 0 && !(rec.sectorsDone & 1)) {
      this.completeSector(rec, 0, now - rec.sectorStartTime, now);
      rec.sectorStartTime = now;
    } else if (sector === 2 && prev === 1 && !(rec.sectorsDone & 2)) {
      this.completeSector(rec, 1, now - rec.sectorStartTime, now);
      rec.sectorStartTime = now;
    }
  }

  private completeSector(rec: CarRecord, index: 0 | 1 | 2, time: number, now: number): void {
    const e = rec.entry;
    if (rec.sectorHoldUntil >= 0) {
      rec.sectorHoldUntil = -1;
      for (let i = 0; i < 3; i++) {
        e.currentSectors[i] = 0;
        e.currentSectorStatus[i] = 'none';
      }
    }
    e.currentSectors[index] = time;
    const valid = this.isRace ? true : !(rec.lapTouchedPit || rec.lapInvalid);
    let status: SectorStatus = 'yellow';
    if (valid) {
      const pb = e.bestSectors[index];
      if (time < this.sessionBestSectors[index]) {
        status = 'purple';
        this.sessionBestSectors[index] = time;
      } else if (pb <= 0 || time < pb) {
        status = 'green';
      }
      if (pb <= 0 || time < pb) e.bestSectors[index] = time;
    }
    e.currentSectorStatus[index] = status;
    rec.sectorsDone |= 1 << index;
    events.emit('race:sector', { carId: e.carId, sector: index, time, status });
    if (status === 'purple' && e.carId === this.playerCarId && rec.crossings > 1) this.radio?.say('purple', now);
  }

  private afterLap(rec: CarRecord, car: CarState, now: number): void {
    const race = this.state!;
    const e = rec.entry;
    if (this.isRace) {
      const running = race.phase === 'racing' || race.phase === 'vsc' || race.phase === 'safety-car';
      if (running && e.lapsCompleted >= race.totalLaps) {
        this.chequered(now);
        this.finishCar(rec, now);
      } else if (race.phase === 'finished') {
        this.finishCar(rec, now);
      } else if (running && e.lapsCompleted === race.totalLaps - 1) {
        if (e.position === 1) this.rc('FINAL LAP', 'info');
        if (e.carId === this.playerCarId) this.radio?.say('finalLap', now, { name: this.driverSurname(e) }, true);
      }
      if (e.status === 'racing') this.maybeRandomFailure(rec, car, now);
    } else if (race.phase === 'finished') {
      this.finishCar(rec, now);
    }
  }

  /* ────────────────────────────────────────── classification ────────────────────────────────────────── */

  private group(e: RaceEntry): number {
    return e.status === 'finished' ? 0 : e.status === 'racing' ? 1 : 2;
  }

  private compare(a: RaceEntry, b: RaceEntry, cars: CarState[]): number {
    if (!this.isRace) {
      const ta = a.bestLap > 0 ? a.bestLap : Infinity;
      const tb = b.bestLap > 0 ? b.bestLap : Infinity;
      if (ta !== tb) return ta - tb;
      if (ta === Infinity) return a.gridPosition - b.gridPosition;
      return a.carId - b.carId;
    }
    const ga = this.group(a);
    const gb = this.group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) {
      const dl = b.lapsCompleted - a.lapsCompleted;
      if (dl !== 0) return dl;
      const dt = a.finishTime - b.finishTime;
      if (dt !== 0) return dt;
      return this.records[a.carId].finishOrder - this.records[b.carId].finishOrder;
    }
    if (ga === 1) return cars[b.carId].track.progress - cars[a.carId].track.progress;
    const dl = b.lapsCompleted - a.lapsCompleted;
    if (dl !== 0) return dl;
    return cars[b.carId].track.progress - cars[a.carId].track.progress;
  }

  private classify(cars: CarState[], now: number): void {
    const race = this.state!;
    const entries = race.entries;
    const n = entries.length;
    for (let i = 0; i < n; i++) this.records[entries[i].carId].prevPosition = entries[i].position;

    for (let i = 1; i < n; i++) {
      const e = entries[i];
      let j = i - 1;
      while (j >= 0 && this.compare(entries[j], e, cars) > 0) {
        entries[j + 1] = entries[j];
        j--;
      }
      entries[j + 1] = e;
    }

    if (this.isRace) {
      // Hysteresis: side-by-side cars keep their previous order until one is clearly ahead.
      for (let i = 0; i < n - 1; i++) {
        const a = entries[i];
        const b = entries[i + 1];
        if (a.status !== 'racing' || b.status !== 'racing') continue;
        if (this.records[a.carId].prevPosition > this.records[b.carId].prevPosition) {
          const dp = cars[a.carId].track.progress - cars[b.carId].track.progress;
          if (dp >= 0 && dp < POSITION_HYSTERESIS_M) {
            entries[i] = b;
            entries[i + 1] = a;
          }
        }
      }
    }

    for (let i = 0; i < n; i++) {
      const e = entries[i];
      const pos = i + 1;
      if (e.position !== pos) {
        const from = e.position;
        e.position = pos;
        if (e.carId === this.playerCarId) events.emit('race:position-change', { carId: e.carId, from, to: pos });
      }
    }

    if (this.isRace && race.phase === 'racing') {
      for (let i = 0; i < n - 1; i++) {
        const a = entries[i];
        const b = entries[i + 1];
        const ra = this.records[a.carId];
        const rb = this.records[b.carId];
        if (ra.prevPosition <= rb.prevPosition) continue;
        if (a.status !== 'racing' || b.status !== 'racing') continue;
        if (cars[a.carId].track.inPitLane || cars[b.carId].track.inPitLane) continue;
        const key = Math.min(a.carId, b.carId) * 64 + Math.max(a.carId, b.carId);
        const last = this.overtakeAt.get(key);
        if (last !== undefined && now - last < OVERTAKE_DEBOUNCE) continue;
        this.overtakeAt.set(key, now);
        events.emit('race:overtake', { carId: a.carId, overtakenCarId: b.carId, position: i + 1 });
        this.onOvertake(a, b, i + 1, now);
      }
    }

    const leader = entries[0];
    race.leaderLap = this.isRace ? leader.lap : this.maxLap(entries);
    this.updateGaps(cars, now);
    if (this.isRace && (race.phase === 'racing' || race.phase === 'vsc')) this.updateBlueFlags(cars, now);
  }

  private maxLap(entries: RaceEntry[]): number {
    let m = 0;
    for (let i = 0; i < entries.length; i++) if (entries[i].lap > m) m = entries[i].lap;
    return m;
  }

  private updateGaps(cars: CarState[], now: number): void {
    const race = this.state!;
    const entries = race.entries;
    const n = entries.length;
    const gaps = this.gaps!;
    const L = this.track!.length;
    const leader = entries[0];
    const lr = this.records[leader.carId];
    const lc = cars[leader.carId];
    let prev: RaceEntry | null = null;
    for (let i = 0; i < n; i++) {
      const e = entries[i];
      if (i === 0) {
        e.gapToLeader = 0;
        e.interval = 0;
        e.lapsBehind = 0;
      } else if (!this.isRace) {
        e.gapToLeader = e.bestLap > 0 && leader.bestLap > 0 ? e.bestLap - leader.bestLap : Infinity;
        e.interval = prev && prev.bestLap > 0 && e.bestLap > 0 ? e.bestLap - prev.bestLap : Infinity;
        e.lapsBehind = 0;
      } else if (e.status === 'finished') {
        e.lapsBehind = Math.max(0, leader.lapsCompleted - e.lapsCompleted);
        e.gapToLeader = Math.max(0, e.finishTime - leader.finishTime);
        e.interval = prev && prev.status === 'finished' ? Math.max(0, e.finishTime - prev.finishTime) : e.gapToLeader;
      } else if (e.status === 'racing') {
        const c = cars[e.carId];
        if (leader.status === 'racing') {
          e.lapsBehind = Math.max(0, Math.floor((lc.track.progress - c.track.progress) / L));
        } else {
          e.lapsBehind = Math.max(0, leader.lapsCompleted - e.lapsCompleted - 1);
        }
        e.gapToLeader = gaps.gap(lr, lc.track.progress, lc.speedAbs, c.track.progress, c.speedAbs, now);
        if (prev && prev.status === 'racing') {
          const pc = cars[prev.carId];
          e.interval = gaps.gap(this.records[prev.carId], pc.track.progress, pc.speedAbs, c.track.progress, c.speedAbs, now);
        } else {
          e.interval = e.gapToLeader;
        }
      } else {
        e.gapToLeader = Infinity;
        e.interval = Infinity;
        e.lapsBehind = Math.max(0, leader.lapsCompleted - e.lapsCompleted);
      }
      e.deltaAhead = e.interval;
      e.deltaBehind = 0;
      if (prev) prev.deltaBehind = e.interval;
      prev = e;
    }
  }

  private updateBlueFlags(cars: CarState[], now: number): void {
    const race = this.state!;
    const entries = race.entries;
    const n = entries.length;
    const L = this.track!.length;
    const track = this.track!;
    for (let i = 0; i < n; i++) {
      const e = entries[i];
      let blue = false;
      let leaderId = -1;
      if (e.status === 'racing') {
        const x = cars[e.carId];
        if (!x.track.inPitLane) {
          const rx = this.records[e.carId];
          for (let j = 0; j < n; j++) {
            if (j === i) continue;
            const o = entries[j];
            if (o.status !== 'racing') continue;
            const y = cars[o.carId];
            if (y.track.inPitLane || y.track.progress - x.track.progress < 0.6 * L) continue;
            const d = track.distanceForward(y.track.s, x.track.s);
            if (d > 250) continue;
            const t = this.gaps!.gap(rx, x.track.progress, x.speedAbs, x.track.progress - d, y.speedAbs, now);
            if (t < 2) {
              blue = true;
              leaderId = o.carId;
              break;
            }
          }
        }
      }
      if (blue !== e.blueFlag) {
        e.blueFlag = blue;
        events.emit('race:blue-flag', { carId: e.carId, active: blue });
        if (blue && e.carId === this.playerCarId && leaderId >= 0) {
          this.radio?.say('blue', now, { name: this.driverSurname(e), leader: this.driverSurname(race.entryByCar[leaderId]) });
        }
      }
    }
  }

  private onOvertake(a: RaceEntry, b: RaceEntry, position: number, now: number): void {
    if (position === 1) this.rc(`${this.code(a)} TAKES THE LEAD FROM ${this.code(b)}`, 'info', a.carId);
    if (a.carId === this.playerCarId) this.radio?.say('overtake', now, { pos: position, other: this.driverSurname(b) });
    else if (b.carId === this.playerCarId) this.radio?.say('overtaken', now, { pos: position + 1, other: this.driverSurname(a) });
    else if (position <= 3) this.flavour('overtake', a.carId, now);
  }

  /* ────────────────────────────────────────── DRS ────────────────────────────────────────── */

  private updateDrs(rec: CarRecord, car: CarState, now: number, cars: CarState[]): void {
    const race = this.state!;
    const track = this.track!;
    const e = rec.entry;
    const zone = track.drsZoneAt(car.track.s);
    if (zone) rec.inZone = zone.index;
    else if (rec.inZone >= 0) {
      rec.inZone = -1;
      rec.drsZone = -1;
    }
    let avail = false;
    if (race.drsEnabled && !car.track.inPitLane && car.track.lap >= 1) {
      if (this.isRace) {
        const moved = track.distanceForward(rec.prevS, car.track.s);
        if (moved > 0 && moved < 200) {
          const zones = track.drsZones;
          for (let k = 0; k < zones.length; k++) {
            const z = zones[k];
            if (track.distanceForward(rec.prevS, z.detectionS) < moved) {
              rec.drsZone = z.index;
              e.drsDetectionGap = this.gapToCarAheadOnTrack(car, cars, now);
            }
          }
        }
        avail = zone !== null && rec.drsZone === zone.index && e.drsDetectionGap < DRS.detectionGap;
      } else {
        avail = zone !== null;
      }
    }
    if (avail !== rec.drsLastSet) {
      this.setDrs(rec, avail);
      if (avail && this.isRace && e.carId === this.playerCarId) this.radio?.say('drs', now);
    }
  }

  private gapToCarAheadOnTrack(car: CarState, cars: CarState[], now: number): number {
    const race = this.state!;
    const track = this.track!;
    let best = Infinity;
    let ahead: CarState | null = null;
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (o === car) continue;
      const oe = race.entryByCar[o.id];
      if (!oe || oe.status !== 'racing' || o.track.inPitLane) continue;
      const d = track.distanceForward(car.track.s, o.track.s);
      if (d > 0.5 && d < best) {
        best = d;
        ahead = o;
      }
    }
    if (!ahead) return Infinity;
    return this.gaps!.gap(this.records[ahead.id], ahead.track.progress, ahead.speedAbs, ahead.track.progress - best, car.speedAbs, now);
  }

  private setDrs(rec: CarRecord, available: boolean): void {
    rec.drsLastSet = available;
    rec.entry.drsAvailable = available;
    this.cars?.setDrsAvailable(rec.carId, available);
    events.emit('race:drs-available', { carId: rec.carId, available });
  }

  private updateDrsEnabled(now: number): void {
    const race = this.state!;
    const wet = this.sw!.env.weather.wetness;
    const enabled = race.phase === 'racing' && wet < 0.3 && (!this.isRace || race.leaderLap >= DRS.enabledFromLap);
    if (enabled === race.drsEnabled) return;
    race.drsEnabled = enabled;
    if (!enabled) for (const rec of this.records) if (rec.drsLastSet) this.setDrs(rec, false);
    events.emit('race:drs-enabled', { enabled });
    this.rc(enabled ? 'DRS ENABLED' : 'DRS DISABLED', 'drs');
    if (enabled && this.isRace) this.radio?.say('drsEnabled', now, {}, true);
  }

  /* ────────────────────────────────────────── pit stops ────────────────────────────────────────── */

  private updatePit(rec: CarRecord, car: CarState, dt: number, now: number): void {
    const race = this.state!;
    const track = this.track!;
    const e = rec.entry;
    const inLane = car.track.inPitLane;
    const s = car.track.s;
    if (rec.pitCooldown > 0) rec.pitCooldown -= dt;
    switch (e.pitPhase) {
      case 'none': {
        if (inLane) {
          this.enterLane(rec, car, now);
          break;
        }
        if (!car.isPlayer && car.input.pitRequest && rec.pitCooldown <= 0 && race.phase !== 'finished') {
          e.requestedCompound = car.input.pitCompound ?? this.defaultCompound(rec, car);
          e.pitPhase = 'requested';
        }
        break;
      }
      case 'requested': {
        if (inLane) {
          this.enterLane(rec, car, now);
          break;
        }
        if (!car.isPlayer && !car.input.pitRequest) {
          e.pitPhase = 'none';
          e.requestedCompound = null;
          break;
        }
        const d = track.pitD(s);
        if (d >= 0 && d <= track.pitLane.transition) e.pitPhase = 'entering';
        break;
      }
      case 'entering': {
        if (inLane) {
          this.enterLane(rec, car, now);
          break;
        }
        const d = track.pitD(s);
        if (d < 0 || d > track.pitLane.transition) e.pitPhase = 'requested';
        break;
      }
      case 'in-lane': {
        this.checkPitSpeed(rec, car, now);
        if (!inLane) {
          const d = track.pitD(s);
          if (d < 0 || d > track.pitLane.length - track.pitLane.transition) this.exitLane(rec, now, false);
          break;
        }
        const box = this.pitBoxByTeam[e.teamId];
        if (box) {
          const dx = car.position.x - box.x;
          const dz = car.position.z - box.z;
          const dist2 = dx * dx + dz * dz;
          const slow = car.speedAbs < 0.5;
          rec.pitStationary = slow ? rec.pitStationary + dt : 0;
          if ((slow && dist2 < 4) || (dist2 < 36 && rec.pitStationary > 2.5)) this.beginStop(rec, now);
        }
        break;
      }
      case 'stopped': {
        e.pitStopTimer -= dt;
        if (e.pitStopTimer <= 0) this.endStop(rec, car, now);
        break;
      }
      case 'released': {
        if (!inLane) {
          this.exitLane(rec, now, true);
          break;
        }
        if (car.speedAbs > 1.0) e.pitPhase = 'exiting';
        break;
      }
      case 'exiting': {
        this.checkPitSpeed(rec, car, now);
        if (!inLane) this.exitLane(rec, now, true);
        break;
      }
      default:
        break;
    }
  }

  private defaultCompound(rec: CarRecord, car: CarState): TyreCompound {
    const race = this.state!;
    const lapsRemaining = this.isRace ? Math.max(0, race.totalLaps - rec.entry.lapsCompleted) : 10;
    return chooseCompound(car.tyres.compound, lapsRemaining, this.isRace ? race.totalLaps : 20, this.sw!.env.weather.wetness, this.weather?.rainTrend() ?? 0);
  }

  private enterLane(rec: CarRecord, car: CarState, now: number): void {
    const e = rec.entry;
    e.pitPhase = 'in-lane';
    rec.pitSpeeding = false;
    rec.pitStationary = 0;
    if (e.requestedCompound === null) e.requestedCompound = this.defaultCompound(rec, car);
    events.emit('race:pit-entry', { carId: e.carId });
    this.rc(`${this.code(e)} ENTERS THE PIT LANE`, 'pit', e.carId);
    if (e.carId === this.playerCarId) this.radio?.say('pitEntry', now, {}, true);
  }

  private beginStop(rec: CarRecord, now: number): void {
    const e = rec.entry;
    const team = this.sw!.teamById[e.teamId];
    const crew = team ? team.performance.pitCrew : 0.9;
    let duration = TIMING.pitStopBaseSeconds + this.rng.range(0, TIMING.pitStopVarianceSeconds) / crew;
    let slow = false;
    if (this.rng.next() < 0.07) {
      duration = this.rng.range(4, 6);
      slow = true;
    }
    e.pitPhase = 'stopped';
    e.pitStopTimer = duration;
    rec.pitStopDuration = duration;
    this.cars?.holdCar(e.carId, true);
    events.emit('race:pit-stop-start', { carId: e.carId });
    if (slow && e.carId === this.playerCarId) this.radio?.say('slowStop', now, { wheel: this.rng.pick(WHEEL_NAMES) }, true);
  }

  private endStop(rec: CarRecord, car: CarState, now: number): void {
    const e = rec.entry;
    const compound = e.requestedCompound ?? this.defaultCompound(rec, car);
    this.cars?.serviceCar(e.carId, { compound, repair: true });
    this.cars?.holdCar(e.carId, false);
    e.pitPhase = 'released';
    e.tyreCompound = compound;
    e.tyreAge = 0;
    e.pitStops++;
    e.requestedCompound = null;
    e.pitStopTimer = 0;
    const duration = rec.pitStopDuration;
    events.emit('race:pit-stop-end', { carId: e.carId, duration, compound });
    this.rc(`PIT STOP — ${this.code(e)} ${duration.toFixed(1)}s → ${TYRE_DATA[compound].label.toUpperCase()}`, 'pit', e.carId);
    if (e.carId !== this.playerCarId) this.flavour('pitExit', e.carId, now);
  }

  private exitLane(rec: CarRecord, now: number, stopped: boolean): void {
    const e = rec.entry;
    e.pitPhase = 'none';
    rec.pitCooldown = PIT_REREQUEST_COOLDOWN;
    rec.pitSpeeding = false;
    rec.pitStationary = 0;
    events.emit('race:pit-exit', { carId: e.carId });
    if (e.carId === this.playerCarId && stopped) this.radio?.say('pitExit', now, { duration: rec.pitStopDuration.toFixed(1), pos: e.position }, true);
  }

  private checkPitSpeed(rec: CarRecord, car: CarState, now: number): void {
    if (rec.pitSpeeding || !this.pitScratch) return;
    const ps = this.track!.pitLaneSample(car.track.s, this.pitScratch);
    if (ps.speedLimited && car.speedAbs > CAR.pitSpeedLimit + 1) {
      rec.pitSpeeding = true;
      if (this.isRace) this.addPenalty(rec, TIMING.timePenaltySeconds, 'Speeding in the pit lane', now);
      else this.addWarning(rec, 'Speeding in the pit lane', now);
    }
  }

  /* ────────────────────────────────────────── incidents, flags, penalties ────────────────────────────────────────── */

  private onOfftrackEvent(carId: number, surface: SurfaceType, wheelsOff: number): void {
    const rec = this.records[carId];
    const sw = this.sw;
    if (!rec || !sw || !this.state || wheelsOff < TIMING.trackLimitsWheelsOff) return;
    const car = sw.cars[carId];
    if (!car) return;
    this.onTrackLimits(rec, car, surface, this.state.time);
  }

  private onTrackLimits(rec: CarRecord, car: CarState, surface: SurfaceType, now: number): void {
    const race = this.state!;
    const e = rec.entry;
    if (e.status !== 'racing' || car.track.inPitLane) return;
    if (this.isRace) {
      if (race.phase !== 'racing' && race.phase !== 'vsc') return;
      const gaining = (surface === 'runoff' || surface === 'asphalt' || surface === 'kerb') && car.speedAbs > 20 && car.input.brake < 0.6;
      if (!gaining || now - rec.lastLimitsWarning < 3) return;
      rec.lastLimitsWarning = now;
      this.addWarning(rec, 'Track limits', now);
      if (e.warnings >= TIMING.trackLimitsStrikesBeforePenalty) {
        e.warnings = 0;
        this.addPenalty(rec, TIMING.timePenaltySeconds, 'Track limits (three strikes)', now);
      }
    } else if (rec.lapStartTime >= 0 && rec.crossings > 0 && !rec.lapInvalid) {
      rec.lapInvalid = true;
      if (e.carId === this.playerCarId && rec.invalidMessageLap !== rec.crossings) {
        rec.invalidMessageLap = rec.crossings;
        this.rc(`${this.code(e)} — LAP INVALIDATED (TRACK LIMITS)`, 'warning', e.carId);
        this.radio?.say('invalid', now);
      }
    }
  }

  private onCollision(carId: number, withCar: number, impulse: number): void {
    const race = this.state;
    const sw = this.sw;
    if (!race || !sw) return;
    if (race.phase === 'idle' || race.phase === 'formation' || race.phase === 'lights' || race.phase === 'complete') return;
    const rec = this.records[carId];
    const car = sw.cars[carId];
    if (!rec || !car) return;
    const now = race.time;
    if (impulse > HEAVY_COLLISION && !car.track.inPitLane) this.raiseYellow(car.track.sector, false, YELLOW_CLEAR_SECONDS);
    if (withCar < 0) return;
    const other = sw.cars[withCar];
    const orec = this.records[withCar];
    if (!other || !orec) return;
    const a = Math.min(carId, withCar);
    const b = Math.max(carId, withCar);
    const key = a * 64 + b;
    const last = this.collisionAt.get(key);
    if (last !== undefined && now - last < 0.5) return;
    this.collisionAt.set(key, now);

    if (this.isRace && impulse > VSC_COLLISION) {
      this.collisionLog.push({ t: now, a, b });
      while (this.collisionLog.length && now - this.collisionLog[0].t > 3) this.collisionLog.shift();
      let involved = 0;
      for (let i = 0; i < this.collisionLog.length; i++) {
        const c = this.collisionLog[i];
        involved |= (1 << c.a) | (1 << c.b);
      }
      let count = 0;
      for (let bit = involved; bit; bit &= bit - 1) count++;
      if (count >= 3) this.startVsc('MULTI-CAR INCIDENT', now);
    }

    if (impulse <= FAULT_COLLISION) return;
    if (rec.entry.status !== 'racing' || orec.entry.status !== 'racing') return;
    if (car.track.inPitLane || other.track.inPitLane) return;
    if (race.phase !== 'racing' && race.phase !== 'vsc') return;
    const culprit = car.track.progress < other.track.progress ? rec : orec;
    if (now - culprit.lastCollision < 5) return;
    culprit.lastCollision = now;
    culprit.collisionWarnings++;
    if (culprit.collisionWarnings === 1) {
      this.addWarning(culprit, 'Causing a collision', now);
    } else {
      culprit.collisionWarnings = 0;
      this.addPenalty(culprit, TIMING.timePenaltySeconds, 'Causing a collision', now);
    }
  }

  private onEngineFailure(carId: number): void {
    const rec = this.records[carId];
    const sw = this.sw;
    if (!rec || !sw || !this.state || rec.entry.status !== 'racing') return;
    this.retire(rec, sw.cars[carId], 'Engine failure', this.state.time);
  }

  private maybeRandomFailure(rec: CarRecord, car: CarState, now: number): void {
    const race = this.state!;
    const sw = this.sw!;
    if (!sw.config.randomEvents || car.isPlayer || race.phase !== 'racing') return;
    const e = rec.entry;
    if (e.lapsCompleted < 1 || race.totalLaps - e.lapsCompleted < 1) return;
    const team = sw.teamById[e.teamId];
    const reliability = team ? team.performance.reliability : 0.9;
    const p = FAILURE_BASE_CHANCE * (1 + (1 - reliability) * 6);
    if (this.rng.next() < p) this.retire(rec, car, this.rng.pick(FAILURE_REASONS), now);
  }

  private retire(rec: CarRecord, car: CarState, reason: string, now: number): void {
    const race = this.state!;
    const e = rec.entry;
    if (e.status !== 'racing') return;
    if (e.pitPhase === 'stopped') this.cars?.holdCar(e.carId, false);
    e.status = 'retired';
    e.retireReason = reason;
    e.pitPhase = 'none';
    e.blueFlag = false;
    rec.retiredAt = now;
    this.setDrs(rec, false);
    this.cars?.retireCar(e.carId);
    events.emit('race:retire', { carId: e.carId, reason });
    this.rc(`${this.code(e)} HAS RETIRED — ${reason.toUpperCase()}`, 'info', e.carId);
    const onTrack = !car.track.inPitLane;
    if (onTrack) this.raiseYellow(car.track.sector, car.speedAbs < 5, RETIREMENT_YELLOW_SECONDS);
    if (e.carId === this.playerCarId) {
      this.radio?.say('retired', now, { reason: reason.toLowerCase(), Reason: reason }, true);
    } else {
      this.radio?.say('incident', now, { other: this.driverSurname(e), sector: car.track.sector + 1 });
      this.flavour('retired', e.carId, now, 0.8);
    }
    if (this.isRace && onTrack && race.phase === 'racing' && race.totalLaps - race.entries[0].lapsCompleted > 1) this.startVsc('CAR STOPPED ON TRACK', now);
  }

  private startVsc(reason: string, now: number): void {
    const race = this.state!;
    if (!this.isRace || race.phase !== 'racing') return;
    this.setPhase('vsc');
    race.safetyCarSpeed = VSC_SPEED;
    this.vscTimer = VSC_SECONDS;
    this.vscWarned = false;
    this.rc(`VIRTUAL SAFETY CAR DEPLOYED — ${reason}`, 'flag');
    this.radio?.say('vsc', now, {}, true);
  }

  private raiseYellow(sector: number, double: boolean, seconds: number): void {
    if (sector < 0 || sector > 2) return;
    this.yellowTimer[sector] = Math.max(this.yellowTimer[sector], seconds);
    if (double) this.yellowDouble[sector] = true;
  }

  private checkSlowCar(rec: CarRecord, car: CarState, dt4: number, now: number): void {
    const race = this.state!;
    if (now < 5 || car.track.inPitLane || car.chassis.held) return;
    if (race.phase !== 'racing' && race.phase !== 'vsc') return;
    const spun = car.track.forwardSpeed < -1;
    const slow = car.speedAbs < SLOW_SPEED;
    rec.slowTime = slow ? rec.slowTime + dt4 : 0;
    if (spun || rec.slowTime > 1.0) this.raiseYellow(car.track.sector, car.speedAbs < 2, YELLOW_CLEAR_SECONDS);
  }

  private updateFlags(dt4: number, now: number): void {
    const race = this.state!;
    let anyYellow = false;
    let anyDouble = false;
    for (let s = 0; s < 3; s++) {
      if (this.yellowTimer[s] > 0) {
        this.yellowTimer[s] -= dt4;
        if (this.yellowTimer[s] <= 0) {
          this.yellowTimer[s] = 0;
          this.yellowDouble[s] = false;
        }
      }
      const f: FlagType = this.yellowTimer[s] > 0 ? (this.yellowDouble[s] ? 'double-yellow' : 'yellow') : 'green';
      if (f !== 'green') anyYellow = true;
      if (f === 'double-yellow') anyDouble = true;
      if (f !== race.sectorFlags[s]) {
        const wasGreen = race.sectorFlags[s] === 'green';
        race.sectorFlags[s] = f;
        events.emit('race:flag', { flag: f, sector: s });
        if (f === 'green') this.rc(`GREEN FLAG — SECTOR ${s + 1} CLEAR`, 'flag');
        else if (wasGreen) {
          const kind = f === 'double-yellow' ? 'Double yellow' : 'Yellow';
          this.rc(`${kind.toUpperCase()} FLAG — SECTOR ${s + 1}`, 'flag');
          this.radio?.say('flag', now, { sector: s + 1, Kind: kind });
        }
      }
    }
    const p = race.phase;
    const g: FlagType =
      p === 'finished' || p === 'complete' ? 'chequered' : p === 'vsc' ? 'vsc' : p === 'safety-car' ? 'sc' : p === 'red-flag' ? 'red' : anyDouble ? 'double-yellow' : anyYellow ? 'yellow' : 'green';
    if (g !== race.globalFlag) {
      race.globalFlag = g;
      events.emit('race:flag', { flag: g, sector: -1 });
    }
  }

  private addWarning(rec: CarRecord, reason: string, now: number): void {
    const e = rec.entry;
    e.warnings++;
    e.penalties.push({ type: 'warning', seconds: 0, reason, lap: e.lap });
    events.emit('race:warning', { carId: e.carId, reason, count: e.warnings });
    this.rc(`${this.code(e)} — WARNING: ${reason.toUpperCase()}`, 'warning', e.carId);
    if (e.carId === this.playerCarId) this.radio?.say('warning', now, { reason: reason.toLowerCase(), Reason: reason, count: e.warnings }, true);
  }

  private addPenalty(rec: CarRecord, seconds: number, reason: string, now: number): void {
    const e = rec.entry;
    e.penaltySeconds += seconds;
    if (e.status === 'finished') e.finishTime += seconds;
    e.penalties.push({ type: 'time', seconds, reason, lap: e.lap });
    events.emit('race:penalty', { carId: e.carId, type: 'time', seconds, reason });
    this.rc(`${this.code(e)} — ${seconds}S TIME PENALTY: ${reason.toUpperCase()}`, 'penalty', e.carId);
    if (e.carId === this.playerCarId) this.radio?.say('penalty', now, { seconds, reason: reason.toLowerCase(), Reason: reason }, true);
    else this.flavour('penalty', e.carId, now, 0.6);
  }

  /* ────────────────────────────────────────── session end ────────────────────────────────────────── */

  private chequered(now: number): void {
    const race = this.state!;
    if (race.phase === 'finished') return;
    this.setPhase('finished');
    this.finishedAt = now;
    race.safetyCarSpeed = 0;
    race.globalFlag = 'chequered';
    events.emit('race:flag', { flag: 'chequered', sector: -1 });
    this.rc('CHEQUERED FLAG', 'flag');
  }

  private finishCar(rec: CarRecord, now: number): void {
    const e = rec.entry;
    if (e.status !== 'racing') return;
    e.status = 'finished';
    e.finishTime = now + e.penaltySeconds;
    rec.finishOrder = ++this.finishCount;
    this.setDrs(rec, false);
    e.blueFlag = false;
    if (e.pitPhase === 'requested' || e.pitPhase === 'entering') e.pitPhase = 'none';
    events.emit('race:finish', { carId: e.carId, position: e.position });
    if (this.isRace) {
      if (rec.finishOrder === 1) this.rc(`${this.driverSurname(e).toUpperCase()} WINS THE ${this.sw!.trackDef.grandPrixName.toUpperCase()}`, 'info', e.carId);
      else if (rec.finishOrder <= 3) this.rc(`${this.code(e)} FINISHES P${rec.finishOrder}`, 'info', e.carId);
      if (e.carId === this.playerCarId) this.radio?.say('post', now, { postText: this.postRaceText(e) }, true);
      else if (rec.finishOrder <= 3) this.flavour('finish', e.carId, now, 0.7, { pos: rec.finishOrder });
    }
  }

  private onTimeExpired(cars: CarState[], now: number): void {
    const race = this.state!;
    if (race.phase !== 'racing') return;
    this.chequered(now);
    this.rc('SESSION TIME EXPIRED — CARS ON A FLYING LAP MAY COMPLETE IT', 'info');
    for (const rec of this.records) {
      const e = rec.entry;
      if (e.status !== 'racing') continue;
      const car = cars[e.carId];
      rec.mayFinishLap = rec.crossings > 0 && rec.lapStartTime >= 0 && !car.track.inPitLane && !rec.lapTouchedPit && !rec.lapInvalid;
      if (!rec.mayFinishLap) this.finishCar(rec, now);
    }
  }

  private checkSessionEnd(cars: CarState[], now: number): void {
    const race = this.state!;
    if (race.phase !== 'finished' || this.finishedAt < 0) return;
    let anyRacing = false;
    for (let i = 0; i < race.entries.length; i++) if (race.entries[i].status === 'racing') anyRacing = true;
    const grace = this.isRace ? RACE_FINISH_GRACE : TIMED_FINISH_GRACE;
    if (anyRacing && now - this.finishedAt < grace) return;
    for (let i = 0; i < race.entries.length; i++) {
      const e = race.entries[i];
      if (e.status === 'racing') this.finishCar(this.records[e.carId], now);
    }
    this.complete(cars, now);
  }

  private complete(cars: CarState[], now: number): void {
    const race = this.state!;
    if (race.phase === 'complete') return;
    this.classify(cars, now);
    race.results = buildResults(race, this.sw!);
    race.globalFlag = 'chequered';
    this.setPhase('complete');
    this.rc(this.isRace ? 'RACE COMPLETE — FINAL CLASSIFICATION' : 'SESSION COMPLETE — FINAL CLASSIFICATION', 'info');
    const player = race.entryByCar[this.playerCarId];
    if (player && !this.isRace) this.radio?.say('post', now, { postText: this.postRaceText(player) }, true);
  }

  private postRaceText(e: RaceEntry): string {
    const pos = e.position;
    const name = this.driverSurname(e);
    if (this.isRace) {
      if (e.status !== 'finished') return `That's the end of our race. ${e.retireReason || 'Not classified'}. We'll be back, ${name}.`;
      if (pos === 1) return `YES! You've won it, ${name}! What a drive! Fantastic job everyone!`;
      if (pos <= 3) return `P${pos}! That's a podium, brilliant drive ${name}.`;
      if (pos <= 10) return `P${pos}, points on the board. Good job, ${name}.`;
      return `P${pos}. Not our day, we'll come back stronger.`;
    }
    if (this.state!.sessionType === 'qualifying') {
      if (e.bestLap <= 0) return `No time set, we start from the back. We'll race hard tomorrow, ${name}.`;
      if (pos === 1) return `POLE POSITION! ${formatLapTime(e.bestLap)}, fantastic lap ${name}!`;
      if (pos <= 3) return `P${pos} on the grid, ${formatLapTime(e.bestLap)}. Great lap.`;
      return `P${pos} for the race, ${formatLapTime(e.bestLap)}. We'll race from there.`;
    }
    return e.bestLap > 0 ? `Session over. Best lap ${formatLapTime(e.bestLap)}, P${pos}. Good work.` : 'Session over. Good work today.';
  }

  /* ────────────────────────────────────────── weather ────────────────────────────────────────── */

  private updateWeather(dt: number, now: number): void {
    const sw = this.sw!;
    const wx = this.weather;
    if (!wx) return;
    this.weatherEvents.length = 0;
    wx.update(sw.env, dt, this.weatherEvents);
    for (let i = 0; i < this.weatherEvents.length; i++) {
      const ev = this.weatherEvents[i];
      this.rc(ev.description, 'info');
      events.emit('race:weather', { weather: sw.env.weather, description: ev.description });
      if (ev.radio) this.radio?.say('weather', now, { text: ev.radio }, true);
    }
  }

  /* ────────────────────────────────────────── messages & radio ────────────────────────────────────────── */

  private rc(text: string, kind: RaceControlMessage['kind'], carId?: number): void {
    const race = this.state;
    if (!race) return;
    const m: RaceControlMessage = carId === undefined ? { time: race.time, text, kind } : { time: race.time, text, kind, carId };
    race.messages.push(m);
    if (race.messages.length > MAX_MESSAGES) race.messages.splice(0, race.messages.length - MAX_MESSAGES);
    events.emit('race:message', m);
  }

  private code(e: RaceEntry): string {
    const d = this.sw?.driverById[e.driverId];
    return d ? d.code : e.driverId.slice(0, 3).toUpperCase();
  }

  private driverSurname(e: RaceEntry): string {
    const d = this.sw?.driverById[e.driverId];
    return d ? surname(d.name) : e.driverId;
  }

  /** Occasional team-radio cut-ins from other drivers. */
  private flavour(kind: DriverLineKind, carId: number, now: number, probability = 0.35, vars: Record<string, string | number> = {}): void {
    const race = this.state;
    if (!race || carId === this.playerCarId) return;
    if (now - this.otherRadioAt < 75 || this.rng.next() > probability) return;
    this.otherRadioAt = now;
    const pool = DRIVER_LINES[kind];
    const text = this.rng.pick(pool).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ''));
    events.emit('radio:message', { carId, from: 'driver', text });
    this.rc(text, 'radio', carId);
  }

  private playerLapRadio(rec: CarRecord, now: number): void {
    const race = this.state!;
    const e = rec.entry;
    if (!this.radio || e.status !== 'racing') return;
    const pos = e.position;
    let ahead: RaceEntry | null = null;
    let behind: RaceEntry | null = null;
    for (let i = pos - 2; i >= 0; i--) {
      if (race.entries[i].status === 'racing') {
        ahead = race.entries[i];
        break;
      }
    }
    for (let i = pos; i < race.entries.length; i++) {
      if (race.entries[i].status === 'racing') {
        behind = race.entries[i];
        break;
      }
    }
    const vars: Record<string, string | number> = {
      pos,
      lapTime: formatLapTime(e.lastLap),
      ahead: ahead ? this.driverSurname(ahead) : '',
      gap: ahead && isFinite(e.gapToLeader) && isFinite(ahead.gapToLeader) ? Math.max(0, e.gapToLeader - ahead.gapToLeader).toFixed(1) : '',
      behind: behind ? this.driverSurname(behind) : '',
      gapBehind: behind && isFinite(behind.gapToLeader) && isFinite(e.gapToLeader) ? Math.max(0, behind.gapToLeader - e.gapToLeader).toFixed(1) : '',
    };
    const cat: RadioCategory = pos === 1 || !ahead ? 'lapLead' : 'lap';
    this.radio.say(cat, now, vars);
  }

  private playerPeriodicRadio(now: number, cars: CarState[]): void {
    const race = this.state!;
    const radio = this.radio;
    const rec = this.records[this.playerCarId];
    if (!radio || !rec) return;
    const e = rec.entry;
    const car = cars[this.playerCarId];
    if (!car || e.status !== 'racing' || race.phase !== 'racing') return;
    if (e.tyreAge >= 8 && now - rec.lastTyreRadio > 110) {
      rec.lastTyreRadio = now;
      radio.say('tyres', now, { age: e.tyreAge });
    }
    if (this.isRace && e.pitStops === 0 && e.pitPhase === 'none' && race.totalLaps >= 6) {
      const target = suggestedStopLap(e.tyreCompound, race.totalLaps);
      const compound = TYRE_DATA[this.defaultCompound(rec, car)].label;
      if (e.lap === target - 2 && this.strategySaidLap !== e.lap) {
        this.strategySaidLap = e.lap;
        radio.say('strategy', now, { lap: target, compound });
      } else if (e.lap === target && !this.boxSuggested && race.totalLaps - e.lapsCompleted > 2) {
        this.boxSuggested = true;
        radio.say('box', now, { compound, name: this.driverSurname(e) });
      }
    }
  }
}
