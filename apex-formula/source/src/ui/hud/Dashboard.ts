import { CAR, TYRE_DATA } from '../../core/constants';
import { clamp01, kmh } from '../../core/math';
import type { CarState, RaceEntry, World } from '../../core/types';
import { div, setText, setToggle, span, svg } from '../dom';

const LED_COUNT = 16;
const ERS_LABEL: Record<string, string> = { harvest: 'HARVEST', balanced: 'BALANCED', overtake: 'OVERTAKE' };

/** Tyre temperature → colour (cold blue → optimal green → hot red). */
function tempColour(t: number, optimal: number): string {
  const d = t - optimal;
  if (d < -25) return '#3a8dff';
  if (d < -8) return mix('#3a8dff', '#25c65a', (d + 25) / 17);
  if (d <= 10) return '#25c65a';
  if (d <= 25) return mix('#25c65a', '#f7d117', (d - 10) / 15);
  if (d <= 45) return mix('#f7d117', '#e10600', (d - 25) / 20);
  return '#e10600';
}

function mix(a: string, b: string, t: number): string {
  t = clamp01(t);
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r},${g},${bl})`;
}

export class Dashboard {
  readonly el: HTMLElement;
  private readonly leds: HTMLElement[] = [];
  private readonly speed: HTMLElement;
  private readonly gear: HTMLElement;
  private readonly thr: HTMLElement;
  private readonly brk: HTMLElement;
  private readonly ersFill: HTMLElement;
  private readonly ersMode: HTMLElement;
  private readonly ersPct: HTMLElement;
  private readonly ersBox: HTMLElement;
  private readonly drs: HTMLElement;
  private readonly limiter: HTMLElement;
  private readonly fuel: HTMLElement;
  private readonly fuelLaps: HTMLElement;
  private readonly tyreRects: { el: HTMLElement; wear: HTMLElement; temp: HTMLElement }[] = [];
  private readonly compound: HTMLElement;
  private readonly tyreAge: HTMLElement;
  private readonly dmg: { fw: SVGElement; rw: SVGElement; floor: SVGElement; sus: SVGElement[] };
  private readonly steerTick: HTMLElement;
  private readonly gforce: HTMLElement;
  private readonly rpmStrip: HTMLElement;
  private lastSpeed = -1;
  private lastGear = -99;
  private lastLit = -1;
  private lastLimiter = false;
  private lastDrs = '';
  private lastErs = '';
  private slowAcc = 0;
  private lastCompound = '';
  private fuelStartLap = -1;
  private fuelAtLapStart = 0;
  private fuelPerLap = 0;

  constructor() {
    this.el = div('af-dash');

    // Row 1: ERS + DRS + limiter
    const top = div('af-dash-top');
    this.ersBox = div('af-ers');
    const ersHead = div('af-ers-head');
    ersHead.append(span('af-ers-k', 'ERS'), (this.ersMode = span('af-ers-mode', 'BALANCED')), (this.ersPct = span('af-ers-pct', '100%')));
    const ersBar = div('af-ers-bar');
    this.ersFill = div('af-ers-fill');
    ersBar.appendChild(this.ersFill);
    this.ersBox.append(ersHead, ersBar);
    this.drs = div('af-drs', 'DRS');
    this.limiter = div('af-limiter', 'PIT LIMITER');
    top.append(this.ersBox, this.drs, this.limiter);

    // Row 2: RPM LEDs
    this.rpmStrip = div('af-rpm');
    for (let i = 0; i < LED_COUNT; i++) {
      const l = span('af-led');
      l.style.setProperty('--i', String(i));
      this.leds.push(l);
      this.rpmStrip.appendChild(l);
    }

    // Row 3: pedals + gear + speed
    const mid = div('af-dash-mid');
    const pedals = div('af-pedals');
    const thrBar = div('af-vbar af-thr');
    this.thr = div('af-vbar-fill');
    thrBar.appendChild(this.thr);
    const brkBar = div('af-vbar af-brk');
    this.brk = div('af-vbar-fill');
    brkBar.appendChild(this.brk);
    pedals.append(thrBar, brkBar);
    const gearBox = div('af-gearbox');
    this.gear = div('af-gear', 'N');
    gearBox.append(this.gear, div('af-gear-k', 'GEAR'));
    const speedBox = div('af-speedbox');
    this.speed = div('af-speed', '0');
    speedBox.append(this.speed, div('af-speed-k', 'KM/H'));
    mid.append(pedals, gearBox, speedBox);

    // Row 4: tyres + damage + fuel + steering
    const bot = div('af-dash-bot');
    const tyres = div('af-tyres');
    const grid = div('af-tyre-grid');
    for (let i = 0; i < 4; i++) {
      const t = div('af-tyre-rect');
      const wear = div('af-tyre-wear');
      const temp = span('af-tyre-temp', '80');
      t.append(wear, temp);
      grid.appendChild(t);
      this.tyreRects.push({ el: t, wear, temp });
    }
    this.compound = div('af-tyre-compound', 'M');
    this.tyreAge = div('af-tyre-age', 'L0');
    const centre = div('af-tyre-centre');
    centre.append(this.compound, this.tyreAge);
    grid.appendChild(centre);
    tyres.append(grid, div('af-mini-k', 'TYRES · WEAR / °C'));

    const damage = div('af-damage');
    const s = svg('svg', { viewBox: '0 0 60 120', class: 'af-damage-svg' });
    const fw = svg('rect', { x: 6, y: 6, width: 48, height: 8, rx: 1, class: 'af-dmg-part' });
    const nose = svg('path', { d: 'M27 14 L33 14 L36 46 L24 46 Z', class: 'af-dmg-static' });
    const floor = svg('path', { d: 'M18 46 L42 46 L46 92 L14 92 Z', class: 'af-dmg-part' });
    const rw = svg('rect', { x: 10, y: 104, width: 40, height: 8, rx: 1, class: 'af-dmg-part' });
    const sus: SVGElement[] = [];
    const wheelPos = [
      [4, 22],
      [46, 22],
      [2, 84],
      [44, 84],
    ];
    for (const [x, y] of wheelPos) {
      const w = svg('rect', { x, y, width: 10, height: 20, rx: 2, class: 'af-dmg-part af-dmg-wheel' });
      sus.push(w);
    }
    s.append(fw, nose, floor, rw, ...sus);
    damage.append(s, div('af-mini-k', 'DAMAGE'));
    this.dmg = { fw, rw, floor, sus };

    const right = div('af-dash-right');
    const fuelBox = div('af-fuel');
    this.fuel = span('af-fuel-v', '110.0');
    this.fuelLaps = span('af-fuel-laps', '');
    fuelBox.append(span('af-mini-k', 'FUEL kg'), this.fuel, this.fuelLaps);
    const steer = div('af-steer');
    const track = div('af-steer-track');
    this.steerTick = div('af-steer-tick');
    track.append(div('af-steer-centre'), this.steerTick);
    steer.append(track, div('af-mini-k', 'STEERING'));
    const gf = div('af-gforce');
    this.gforce = span('af-gforce-v', '0.0');
    gf.append(span('af-mini-k', 'LAT g'), this.gforce);
    right.append(fuelBox, gf, steer);
    bot.append(tyres, damage, right);

    this.el.append(top, this.rpmStrip, mid, bot);
  }

  reset(): void {
    this.fuelStartLap = -1;
    this.fuelPerLap = 0;
    this.lastSpeed = -1;
    this.lastGear = -99;
    this.lastLit = -1;
    this.lastDrs = '';
    this.lastErs = '';
    this.lastCompound = '';
  }

  update(world: World, car: CarState, entry: RaceEntry | undefined, dt: number): void {
    // Speed & gear
    const sp = Math.round(kmh(car.speedAbs));
    if (sp !== this.lastSpeed) {
      this.lastSpeed = sp;
      setText(this.speed, String(sp));
    }
    const g = car.engine.gear;
    if (g !== this.lastGear) {
      this.lastGear = g;
      setText(this.gear, g === 0 ? 'N' : g < 0 ? 'R' : String(g));
    }
    // RPM LEDs
    const frac = clamp01((car.engine.rpm - CAR.idleRpm * 0.9) / (CAR.maxRpm - CAR.idleRpm * 0.9));
    const lit = car.engine.limiter ? LED_COUNT : Math.round(frac * LED_COUNT);
    if (lit !== this.lastLit) {
      for (let i = 0; i < LED_COUNT; i++) setToggle(this.leds[i], 'lit', i < lit);
      this.lastLit = lit;
    }
    if (car.engine.limiter !== this.lastLimiter) {
      this.lastLimiter = car.engine.limiter;
      setToggle(this.rpmStrip, 'limiter', car.engine.limiter);
    }
    // Pedals (transforms only)
    this.thr.style.transform = `scaleY(${car.engine.throttle.toFixed(3)})`;
    this.brk.style.transform = `scaleY(${car.engine.brake.toFixed(3)})`;
    // Steering
    const steer = car.engine.steer || car.input.steer;
    this.steerTick.style.transform = `translateX(${(-steer * 100).toFixed(1)}%)`;
    // ERS
    this.ersFill.style.transform = `scaleX(${car.ers.battery.toFixed(3)})`;
    const ersKey = `${car.ers.mode}|${car.ers.deploying ? 1 : 0}|${car.ers.harvesting ? 1 : 0}`;
    if (ersKey !== this.lastErs) {
      this.lastErs = ersKey;
      setText(this.ersMode, ERS_LABEL[car.ers.mode] ?? car.ers.mode.toUpperCase());
      this.ersBox.dataset.mode = car.ers.mode;
      setToggle(this.ersBox, 'deploying', car.ers.deploying);
      setToggle(this.ersBox, 'harvesting', car.ers.harvesting);
    }
    // DRS
    const drsState = car.drs.open ? 'open' : car.drs.available ? 'avail' : world.race.drsEnabled ? 'off' : 'disabled';
    if (drsState !== this.lastDrs) {
      this.lastDrs = drsState;
      this.drs.dataset.state = drsState;
    }
    setToggle(this.limiter, 'on', car.input.pitLimiter || (car.track.inPitLane && car.speedAbs > 1));

    this.slowAcc += dt;
    if (this.slowAcc < 0.1) return;
    this.slowAcc = 0;
    setText(this.ersPct, `${Math.round(car.ers.battery * 100)}%`);
    setText(this.gforce, Math.abs(car.localAccel.x / 9.81).toFixed(1));

    // Tyres
    const td = TYRE_DATA[car.tyres.compound];
    if (this.lastCompound !== car.tyres.compound) {
      this.lastCompound = car.tyres.compound;
      setText(this.compound, td.short);
      this.compound.style.setProperty('--tyre', td.color);
    }
    setText(this.tyreAge, `L${entry?.tyreAge ?? car.tyres.age}`);
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const r = this.tyreRects[i];
      r.el.style.setProperty('--tc', tempColour(w.temp, td.optimalTemp));
      r.wear.style.transform = `scaleY(${clamp01(w.wear).toFixed(3)})`;
      setText(r.temp, String(Math.round(w.temp)));
    }
    // Damage
    const dmgFill = (p: SVGElement, v: number) => {
      const lvl = v > 0.66 ? 3 : v > 0.33 ? 2 : v > 0.05 ? 1 : 0;
      if (p.getAttribute('data-l') !== String(lvl)) p.setAttribute('data-l', String(lvl));
    };
    dmgFill(this.dmg.fw, car.damage.frontWing);
    dmgFill(this.dmg.rw, car.damage.rearWing);
    dmgFill(this.dmg.floor, car.damage.floor);
    for (let i = 0; i < 4; i++) dmgFill(this.dmg.sus[i], car.damage.suspension[i]);
    // Fuel + laps estimate
    setText(this.fuel, car.fuel.toFixed(1));
    const lap = car.track.lap;
    if (lap !== this.fuelStartLap) {
      if (this.fuelStartLap >= 0 && lap > this.fuelStartLap) {
        const used = this.fuelAtLapStart - car.fuel;
        if (used > 0.05) this.fuelPerLap = this.fuelPerLap > 0 ? this.fuelPerLap * 0.5 + used * 0.5 : used;
      }
      this.fuelStartLap = lap;
      this.fuelAtLapStart = car.fuel;
    }
    setText(this.fuelLaps, this.fuelPerLap > 0 ? `${(car.fuel / this.fuelPerLap).toFixed(1)} LAPS` : '');
  }
}
