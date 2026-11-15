import { TYRE_COMPOUNDS, TYRE_DATA, type TyreCompound } from '../../core/constants';
import { formatLapTime } from '../../core/math';
import type { ErsMode, RaceEntry, World } from '../../core/types';
import { hintRow, type UIContext } from '../context';
import { div, fmtDelta, setText, setToggle, span } from '../dom';
import { Navigator, type NavItem } from '../nav';
import { CAMERA_MODES } from '../storage';
import { CAMERA_LABELS } from '../screens/SettingsPanel';
import { buildAssistRows, type Row } from '../widgets';

export type MfdPage = 'tyres' | 'ers' | 'assists' | 'camera' | 'info';
const PAGES: MfdPage[] = ['tyres', 'ers', 'assists', 'camera', 'info'];
const PAGE_LABEL: Record<MfdPage, string> = { tyres: 'TYRES', ers: 'ERS', assists: 'ASSISTS', camera: 'CAMERA', info: 'INFO' };
const ERS_MODES: ErsMode[] = ['harvest', 'balanced', 'overtake'];
const ERS_DESC: Record<ErsMode, string> = { harvest: 'Recharge under braking · less deployment', balanced: 'Even deploy / harvest per lap', overtake: 'Full deployment · drains the battery' };

/** Multi-function display: in-race pit / ERS / assists / camera / info panel. */
export class MFD {
  readonly el: HTMLElement;
  open = false;
  private page: MfdPage = 'tyres';
  private readonly tabs: HTMLElement[] = [];
  private readonly pages: Record<MfdPage, HTMLElement>;
  private readonly navs: Record<MfdPage, Navigator>;
  private readonly pitStatus: HTMLElement;
  private readonly tyreRows: HTMLElement[] = [];
  private readonly ersRows: HTMLElement[] = [];
  private readonly camRows: HTMLElement[] = [];
  private readonly info: { ahead: HTMLElement; behind: HTMLElement; weather: HTMLElement; fuel: HTMLElement; laps: HTMLElement; best: HTMLElement };
  private assistRows: Row[] = [];
  private acc = 0;

  constructor(private readonly ctx: UIContext) {
    this.el = div('af-mfd hidden');
    const head = div('af-mfd-head');
    head.appendChild(span('af-mfd-title', 'MFD'));
    const tabs = div('af-mfd-tabs');
    for (const p of PAGES) {
      const t = span('af-mfd-tab', PAGE_LABEL[p]);
      t.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.setPage(p);
      });
      this.tabs.push(t);
      tabs.appendChild(t);
    }
    head.appendChild(tabs);
    this.el.appendChild(head);
    const body = div('af-mfd-body');
    this.el.appendChild(body);
    const mk = () => {
      const p = div('af-mfd-page hidden');
      body.appendChild(p);
      return p;
    };
    this.pages = { tyres: mk(), ers: mk(), assists: mk(), camera: mk(), info: mk() };
    this.navs = { tyres: new Navigator(ctx.sound), ers: new Navigator(ctx.sound), assists: new Navigator(ctx.sound), camera: new Navigator(ctx.sound), info: new Navigator(ctx.sound) };
    this.el.appendChild(hintRow([{ key: 'mfd', label: 'PAGE' }, { key: 'nav', label: 'SELECT' }, { key: 'confirm', label: 'CONFIRM' }]));

    // TYRES
    const t = this.pages.tyres;
    this.pitStatus = div('af-mfd-status', 'NO PIT STOP REQUESTED');
    t.appendChild(this.pitStatus);
    const tyreItems: NavItem[] = [];
    for (const c of TYRE_COMPOUNDS) {
      const d = TYRE_DATA[c];
      const r = div('af-mfd-row af-mfd-tyre');
      r.style.setProperty('--tyre', d.color);
      r.append(span('af-mfd-swatch', d.short), span('af-mfd-label', d.label.toUpperCase()), span('af-mfd-action', 'REQUEST PIT'));
      t.appendChild(r);
      this.tyreRows.push(r);
      tyreItems.push({ el: r, onConfirm: () => this.requestPit(c) });
    }
    const cancel = div('af-mfd-row af-mfd-cancel');
    cancel.append(span('af-mfd-label', 'CANCEL PIT REQUEST'));
    t.appendChild(cancel);
    tyreItems.push({
      el: cancel,
      onConfirm: () => {
        this.ctx.emit({ type: 'cancel-pit' });
        this.ctx.notify('PIT REQUEST CANCELLED', 'pit', 2.5);
      },
    });
    this.navs.tyres.setItems(tyreItems, 1);

    // ERS
    const e = this.pages.ers;
    const ersItems: NavItem[] = [];
    for (const m of ERS_MODES) {
      const r = div('af-mfd-row af-mfd-ers');
      r.dataset.mode = m;
      r.append(span('af-mfd-label', m.toUpperCase()), span('af-mfd-desc', ERS_DESC[m]));
      e.appendChild(r);
      this.ersRows.push(r);
      ersItems.push({ el: r, onConfirm: () => this.ctx.emit({ type: 'set-ers-mode', mode: m }) });
    }
    this.navs.ers.setItems(ersItems, 1);

    // ASSISTS
    this.assistRows = buildAssistRows(this.ctx.settings.assists, () => {
      this.ctx.saveSettings();
      this.ctx.emit({ type: 'set-assists', assists: { ...this.ctx.settings.assists } });
    });
    for (const r of this.assistRows) this.pages.assists.appendChild(r.el);
    this.navs.assists.setItems(
      this.assistRows.map((r) => r.item),
      0,
    );

    // CAMERA
    const camItems: NavItem[] = [];
    for (const m of CAMERA_MODES) {
      const r = div('af-mfd-row af-mfd-cam');
      r.dataset.mode = m;
      r.append(span('af-mfd-label', CAMERA_LABELS[m] ?? m));
      this.pages.camera.appendChild(r);
      this.camRows.push(r);
      camItems.push({
        el: r,
        onConfirm: () => {
          this.ctx.settings.cameraMode = m;
          this.ctx.saveSettings();
          this.ctx.emit({ type: 'set-camera', mode: m });
          this.refreshCamera();
        },
      });
    }
    this.navs.camera.setItems(camItems, 0);

    // INFO
    const i = this.pages.info;
    const line = (k: string) => {
      const r = div('af-mfd-info');
      const v = span('af-mfd-info-v', '');
      r.append(span('af-mfd-info-k', k), v);
      i.appendChild(r);
      return v;
    };
    this.info = { ahead: line('CAR AHEAD'), behind: line('CAR BEHIND'), best: line('BEST LAP'), laps: line('LAPS LEFT'), fuel: line('FUEL'), weather: line('FORECAST') };
    this.navs.info.setItems([], 0);
    this.setPage('tyres');
  }

  private requestPit(c: TyreCompound): void {
    this.ctx.emit({ type: 'request-pit', compound: c });
    this.ctx.notify(`BOX THIS LAP · ${TYRE_DATA[c].label.toUpperCase()}`, 'pit', 3);
  }

  setPage(p: MfdPage): void {
    this.page = p;
    for (const k of PAGES) {
      setToggle(this.pages[k], 'hidden', k !== p);
      setToggle(this.tabs[PAGES.indexOf(k)], 'on', k === p);
    }
    if (p === 'assists') for (const r of this.assistRows) r.refresh();
    if (p === 'camera') this.refreshCamera();
    this.acc = 1;
  }

  private refreshCamera(): void {
    CAMERA_MODES.forEach((m, i) => setToggle(this.camRows[i], 'current', this.ctx.settings.cameraMode === m));
  }

  show(page?: MfdPage): void {
    this.open = true;
    this.el.classList.remove('hidden', 'out');
    void this.el.offsetWidth;
    this.el.classList.add('in');
    if (page) this.setPage(page);
    this.ctx.sound('confirm');
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    this.ctx.sound('back');
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  cyclePage(dir: number): void {
    if (!this.open) {
      this.show();
      return;
    }
    const i = PAGES.indexOf(this.page);
    this.setPage(PAGES[(i + dir + PAGES.length) % PAGES.length]);
    this.ctx.sound('nav');
  }

  move(dx: number, dy: number): void {
    if (dx !== 0 && this.page !== 'assists') {
      this.cyclePage(dx);
      return;
    }
    this.navs[this.page].move(dx, dy);
  }

  confirm(): void {
    this.navs[this.page].confirm();
  }

  update(world: World, entry: RaceEntry | undefined, dt: number): void {
    if (!this.open) return;
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const car = world.cars[world.playerCarId];
    if (this.page === 'tyres' && entry) {
      let s: string;
      switch (entry.pitPhase) {
        case 'none':
          s = `NO PIT STOP REQUESTED · ON ${TYRE_DATA[entry.tyreCompound].label.toUpperCase()} (${entry.tyreAge} LAPS)`;
          break;
        case 'requested':
          s = `BOX THIS LAP · FITTING ${entry.requestedCompound ? TYRE_DATA[entry.requestedCompound].label.toUpperCase() : 'STRATEGY'}`;
          break;
        case 'entering':
          s = 'PIT ENTRY · LIMITER ON';
          break;
        case 'in-lane':
          s = 'IN PIT LANE · 80 KM/H';
          break;
        case 'stopped':
          s = `STOPPED · ${entry.pitStopTimer.toFixed(1)}s`;
          break;
        case 'released':
          s = 'RELEASED · GO GO GO';
          break;
        case 'exiting':
          s = 'PIT EXIT · REJOINING';
          break;
      }
      setText(this.pitStatus, s);
      setToggle(this.pitStatus, 'active', entry.pitPhase !== 'none');
      TYRE_COMPOUNDS.forEach((c, i) => {
        setToggle(this.tyreRows[i], 'current', c === entry.tyreCompound);
        setToggle(this.tyreRows[i], 'requested', c === entry.requestedCompound && entry.pitPhase !== 'none');
      });
    } else if (this.page === 'ers') {
      ERS_MODES.forEach((m, i) => setToggle(this.ersRows[i], 'current', car.ers.mode === m));
    } else if (this.page === 'info' && entry) {
      const race = world.race;
      const ahead = race.entries[entry.position - 2];
      const behind = race.entries[entry.position];
      setText(this.info.ahead, ahead ? `${world.driverById[ahead.driverId]?.code ?? '???'}  ${fmtDelta(-Math.abs(isFinite(entry.deltaAhead) ? entry.deltaAhead : entry.interval))}` : 'LEADER');
      setText(this.info.behind, behind ? `${world.driverById[behind.driverId]?.code ?? '???'}  ${fmtDelta(Math.abs(isFinite(entry.deltaBehind) ? entry.deltaBehind : behind.interval))}` : 'LAST');
      setText(this.info.best, formatLapTime(entry.bestLap));
      setText(this.info.laps, race.sessionType === 'race' ? String(Math.max(0, race.totalLaps - Math.max(0, entry.lap - 1))) : race.timeRemaining >= 0 ? `${Math.ceil(race.timeRemaining / 60)} MIN` : '∞');
      setText(this.info.fuel, `${car.fuel.toFixed(1)} kg`);
      const w = world.env.weather;
      setText(this.info.weather, w.rain > 0.6 ? 'HEAVY RAIN' : w.rain > 0.1 ? 'LIGHT RAIN' : w.cloud > 0.7 ? 'OVERCAST · RAIN RISK' : 'DRY · CLEAR');
    }
  }
}
