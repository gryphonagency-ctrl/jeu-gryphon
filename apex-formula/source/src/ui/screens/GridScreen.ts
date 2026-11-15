import { TYRE_DATA } from '../../core/constants';
import type { World } from '../../core/types';
import { hintRow, type Screen, type UIContext } from '../context';
import { div, fmtHours, icon, span } from '../dom';
import { Navigator } from '../nav';
import { buildButton } from '../widgets';
import { WEATHER_LABELS, todIcon } from './MenuScreen';

/** Pre-session grid screen: the full starting grid, session summary and the START RACE button. */
export class GridScreen implements Screen {
  readonly el: HTMLElement;
  private readonly nav: Navigator;
  private readonly escNav: Navigator;
  private readonly gridEl: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly escMenu: HTMLElement;
  private escOpen = false;
  private builtFor: World | null = null;

  constructor(private readonly ctx: UIContext) {
    this.el = div('af-screen af-grid hidden');
    this.el.appendChild(div('af-grid-shade'));
    const panel = div('af-grid-panel');
    const head = div('af-grid-head');
    head.append(div('af-grid-kicker', 'STARTING GRID'), div('af-grid-title', ''));
    this.summary = div('af-grid-summary');
    this.gridEl = div('af-grid-list');
    panel.append(head, this.summary, this.gridEl);
    this.el.appendChild(panel);
    const foot = div('af-grid-foot');
    const start = buildButton('START RACE', () => this.ctx.emit({ type: 'ready' }), 'af-btn-primary af-btn-big');
    foot.appendChild(start.el);
    foot.appendChild(hintRow([{ key: 'start', label: 'START RACE' }, { key: 'pause', label: 'MENU' }]));
    this.el.appendChild(foot);
    this.nav = new Navigator(ctx.sound);
    this.nav.setItems([start], 0);
    this.nav.onBack = () => this.toggleEsc(true);

    this.escMenu = div('af-esc hidden');
    const box = div('af-esc-box');
    box.appendChild(div('af-esc-title', 'PAUSED'));
    const resume = buildButton('BACK TO GRID', () => this.toggleEsc(false));
    const quit = buildButton('QUIT TO MENU', () => this.ctx.emit({ type: 'quit-to-menu' }), 'af-btn-danger');
    box.append(resume.el, quit.el);
    this.escMenu.appendChild(box);
    this.el.appendChild(this.escMenu);
    this.escNav = new Navigator(ctx.sound);
    this.escNav.setItems([resume, quit], 0);
    this.escNav.onBack = () => this.toggleEsc(false);
  }

  private toggleEsc(open: boolean): void {
    this.escOpen = open;
    this.escMenu.classList.toggle('hidden', !open);
    if (open) this.escNav.focus(0, true);
  }

  build(world: World): void {
    if (this.builtFor === world) return;
    this.builtFor = world;
    const def = world.trackDef;
    const title = this.el.querySelector('.af-grid-title');
    if (title) title.textContent = def.grandPrixName.toUpperCase();
    const s = this.summary;
    s.replaceChildren();
    const chip = (label: string, value: string, ic?: 'sun' | 'sunset' | 'moon' | 'rain' | 'cloud') => {
      const c = div('af-gchip');
      if (ic) c.appendChild(icon(ic, 'af-ico af-ico-inline'));
      c.append(span('af-gchip-v', value), span('af-gchip-k', label));
      s.appendChild(c);
    };
    chip('CIRCUIT', def.name.toUpperCase());
    chip('LAPS', String(world.race.totalLaps || world.config.laps));
    chip('WEATHER', WEATHER_LABELS[world.config.weather], world.env.weather.rain > 0.05 ? 'rain' : world.env.weather.cloud > 0.6 ? 'cloud' : todIcon(world.env.timeOfDay));
    chip('LOCAL TIME', fmtHours(world.env.timeOfDay), todIcon(world.env.timeOfDay));
    chip('TRACK', `${Math.round(world.env.weather.trackTempC)}°C`);

    const g = this.gridEl;
    g.replaceChildren();
    const entries = [...world.race.entries].sort((a, b) => a.gridPosition - b.gridPosition);
    entries.forEach((e) => {
      const d = world.driverById[e.driverId];
      const t = world.teamById[e.teamId];
      const row = div(`af-grow${e.carId === world.playerCarId ? ' player' : ''}`);
      row.style.setProperty('--team', t?.primaryColor ?? '#888');
      row.append(span('af-grow-pos', String(e.gridPosition)), span('af-grow-bar'), span('af-grow-code', d?.code ?? '???'), span('af-grow-name', d?.name ?? e.driverId), span('af-grow-team', t?.shortName ?? ''));
      const tyre = span('af-tyre');
      const td = TYRE_DATA[e.tyreCompound] ?? TYRE_DATA.medium;
      tyre.style.setProperty('--tyre', td.color);
      tyre.textContent = td.short;
      row.appendChild(tyre);
      g.appendChild(row);
    });
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    this.toggleEsc(false);
    this.nav.focus(0, true);
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.builtFor = null;
  }

  move(dx: number, dy: number): void {
    (this.escOpen ? this.escNav : this.nav).move(dx, dy);
  }
  confirm(): void {
    (this.escOpen ? this.escNav : this.nav).confirm();
  }
  back(): void {
    if (this.escOpen) this.escNav.back();
    else this.nav.back();
  }
}
