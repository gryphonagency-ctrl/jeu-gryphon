import { TYRE_DATA } from '../../core/constants';
import { events } from '../../core/events';
import { formatLapTime } from '../../core/math';
import type { RenderStats, World } from '../../core/types';
import type { UIContext } from '../context';
import { div, setToggle } from '../dom';
import { Dashboard } from './Dashboard';
import { Feed } from './Feed';
import { LapPanel } from './LapPanel';
import { MFD } from './MFD';
import { Minimap } from './Minimap';
import { TimingTower } from './TimingTower';
import { TopBar } from './TopBar';
import { CAMERA_LABELS } from '../screens/SettingsPanel';

export type HudMode = 'session' | 'paused' | 'replay' | 'hidden';

export class HUD {
  readonly el: HTMLElement;
  readonly tower = new TimingTower();
  readonly top = new TopBar();
  readonly dash = new Dashboard();
  readonly minimap = new Minimap();
  readonly lap = new LapPanel();
  readonly feed = new Feed();
  readonly mfd: MFD;
  private world: World | null = null;
  private race: World['race'] | null = null;
  private readonly offs: (() => void)[] = [];
  private visible = true;
  private mode: HudMode = 'hidden';
  private finalLapShown = false;
  private drsBannerShown = false;
  private readonly onResizeBound = () => this.tower.onResize();

  constructor(private readonly ctx: UIContext) {
    this.el = div('af-hud hidden');
    this.mfd = new MFD(ctx);
    const left = div('af-hud-left');
    left.append(this.minimap.el, this.lap.el);
    this.el.append(this.tower.el, this.top.el, this.feed.rightCol, left, this.dash.el, this.feed.popupEl, this.feed.radioEl, this.mfd.el, this.feed.telemetry);
    window.addEventListener('resize', this.onResizeBound);
    this.subscribe();
  }

  private isPlayer(carId: number): boolean {
    return !!this.world && carId === this.world.playerCarId;
  }

  private nameOf(carId: number): string {
    const w = this.world;
    if (!w) return '';
    const car = w.cars[carId];
    return car ? w.driverById[car.driverId]?.name ?? '' : '';
  }

  private codeOf(carId: number): string {
    const w = this.world;
    if (!w) return '';
    const car = w.cars[carId];
    return car ? w.driverById[car.driverId]?.code ?? '???' : '???';
  }

  private subscribe(): void {
    const on = events.on.bind(events);
    this.offs.push(
      on('race:lights', ({ lightsOn }) => this.top.onLights(lightsOn)),
      on('race:message', (m) => this.feed.message(m)),
      on('race:position-change', ({ carId, from, to }) => this.tower.positionChange(carId, from, to)),
      on('race:penalty', ({ carId, type, seconds, reason }) => {
        if (!this.isPlayer(carId)) return;
        const label = type === 'time' ? `+${seconds}s TIME PENALTY` : type === 'drive-through' ? 'DRIVE-THROUGH PENALTY' : type === 'disqualification' ? 'DISQUALIFIED' : 'WARNING';
        this.feed.toast(`${label} · ${reason.toUpperCase()}`, 'penalty', 6);
        this.feed.popup(label, reason.toUpperCase(), 'penalty', 2.6);
        this.ctx.sound('penalty');
      }),
      on('race:warning', ({ carId, reason, count }) => {
        if (!this.isPlayer(carId)) return;
        this.feed.toast(`WARNING ${count}/3 · ${reason.toUpperCase()}`, 'warning', 5);
        this.ctx.sound('error');
      }),
      on('radio:message', ({ carId, from, text }) => {
        if (!this.world) return;
        if (!this.isPlayer(carId) && from !== 'race-control') return;
        this.feed.radio(from, from === 'race-control' ? 'FIA' : this.nameOf(carId), text);
      }),
      on('race:overtake', ({ carId, overtakenCarId, position }) => {
        if (this.isPlayer(carId)) this.feed.popup('OVERTAKE', `P${position} · PASSED ${this.codeOf(overtakenCarId)}`, 'good', 2.2);
        else if (this.isPlayer(overtakenCarId)) this.feed.popup('POSITION LOST', `${this.codeOf(carId)} THROUGH · P${position + 1}`, 'bad', 2.2);
      }),
      on('race:lap', ({ carId, time, personalBest, fastestOverall }) => {
        if (!this.isPlayer(carId)) return;
        if (fastestOverall) {
          this.feed.popup('FASTEST LAP', formatLapTime(time), 'purple', 2.8);
          this.ctx.sound('purple');
        } else if (personalBest) this.feed.popup('PERSONAL BEST', formatLapTime(time), 'green', 2.2);
      }),
      on('race:sector', ({ carId, sector, status }) => {
        if (!this.isPlayer(carId)) return;
        if (status === 'purple') this.feed.popup(`PURPLE SECTOR ${sector + 1}`, '', 'purple small', 1.4);
      }),
      on('race:drs-enabled', ({ enabled }) => {
        if (enabled && !this.drsBannerShown) {
          this.drsBannerShown = true;
          this.feed.popup('DRS ENABLED', 'REAR WING UNLOCKED WITHIN 1.0s', 'drs', 2.6);
        } else if (!enabled) this.drsBannerShown = false;
      }),
      on('race:finish', ({ carId, position }) => {
        if (!this.isPlayer(carId)) return;
        this.top.showBanner('finish', 'chequered', 'CHEQUERED FLAG', position === 1 ? 'YOU WIN THE RACE' : `FINISHED P${position}`, 8);
        this.ctx.sound('finish');
      }),
      on('race:retire', ({ carId, reason }) => {
        if (!this.isPlayer(carId)) return;
        this.top.showBanner('retire', 'red', 'RETIRED', reason.toUpperCase(), 8);
        this.feed.toast(`RETIRED · ${reason.toUpperCase()}`, 'warning', 6);
      }),
      on('race:pit-stop-end', ({ carId, duration, compound }) => {
        if (!this.isPlayer(carId)) return;
        this.feed.toast(`PIT STOP ${duration.toFixed(1)}s · ${TYRE_DATA[compound].label.toUpperCase()} FITTED`, 'pit', 4);
      }),
      on('race:pit-entry', ({ carId }) => {
        if (this.isPlayer(carId)) this.feed.popup('PIT LANE', 'SPEED LIMIT 80 KM/H', 'pit small', 1.6);
      }),
      on('race:weather', ({ description }) => this.feed.toast(description.toUpperCase(), 'info', 4)),
      on('camera:mode', ({ mode }) => {
        if (this.mode === 'session' || this.mode === 'replay') this.feed.toast(`CAMERA · ${CAMERA_LABELS[mode] ?? mode.toUpperCase()}`, 'info', 1.6);
      }),
    );
  }

  /** New session (new world/race objects). */
  bind(world: World): void {
    this.world = world;
    this.race = world.race;
    this.tower.bind(world);
    this.minimap.bind(world);
    this.top.reset();
    this.dash.reset();
    this.lap.reset();
    this.feed.reset(world.race.messages);
    this.mfd.hide();
    this.finalLapShown = false;
    this.drsBannerShown = world.race.drsEnabled;
  }

  setMode(mode: HudMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode !== 'session') this.mfd.hide();
    this.applyVisibility();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const m = this.mode;
    setToggle(this.el, 'hidden', m === 'hidden');
    setToggle(this.el, 'paused', m === 'paused');
    setToggle(this.el, 'replay', m === 'replay');
    // H key: hide everything except critical flags/lights.
    setToggle(this.el, 'minimal', !this.visible);
  }

  /** Bind as soon as a session world exists so events arriving before the HUD shows are attributed correctly. */
  attach(world: World): void {
    if (world !== this.world || world.race !== this.race) this.bind(world);
  }

  update(world: World, dt: number, stats: RenderStats): void {
    this.attach(world);
    const car = world.cars[world.playerCarId];
    const entry = world.race.entryByCar[world.playerCarId];
    if (this.mode === 'hidden') return;
    this.top.update(world, entry, dt);
    if (this.mode === 'replay') return;
    this.tower.update(world, dt);
    if (this.mode === 'paused') return;
    if (car) {
      this.dash.update(world, car, entry, dt);
      this.lap.update(world, car, entry, dt);
    }
    this.minimap.update(world, dt);
    this.feed.update(world, dt, stats, this.ctx.settings.showTelemetry);
    this.mfd.update(world, entry, dt);
    if (entry && world.race.sessionType === 'race' && !this.finalLapShown && world.race.totalLaps > 0 && entry.lap === world.race.totalLaps && entry.status === 'racing') {
      this.finalLapShown = true;
      this.feed.popup('FINAL LAP', 'PUSH · PUSH · PUSH', 'final', 3);
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    window.removeEventListener('resize', this.onResizeBound);
  }
}
