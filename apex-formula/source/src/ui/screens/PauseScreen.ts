import type { World } from '../../core/types';
import { hintRow, type Screen, type UIContext } from '../context';
import { div, setText } from '../dom';
import { Navigator } from '../nav';
import { buildButton } from '../widgets';
import { SettingsPanel } from './SettingsPanel';

export class PauseScreen implements Screen {
  readonly el: HTMLElement;
  private readonly nav: Navigator;
  private readonly settings: SettingsPanel;
  private readonly menuEl: HTMLElement;
  private readonly settingsEl: HTMLElement;
  private readonly sub: HTMLElement;
  private view: 'menu' | 'settings' = 'menu';

  constructor(private readonly ctx: UIContext) {
    this.el = div('af-screen af-pause hidden');
    this.el.appendChild(div('af-pause-shade'));
    const panel = div('af-pause-panel');
    this.menuEl = div('af-pause-menu');
    const head = div('af-pause-head');
    head.append(div('af-pause-title', 'PAUSED'), (this.sub = div('af-pause-sub', '')));
    this.menuEl.appendChild(head);
    const items = [
      buildButton('RESUME', () => ctx.emit({ type: 'resume' }), 'af-btn-primary'),
      buildButton('RESTART SESSION', () => ctx.emit({ type: 'restart-session' })),
      buildButton('SETTINGS', () => this.showSettings()),
      buildButton('INSTANT REPLAY', () => ctx.emit({ type: 'replay-start' })),
      buildButton('SKIP TO END', () => ctx.emit({ type: 'skip-to-end' })),
      buildButton('QUIT TO MENU', () => ctx.emit({ type: 'quit-to-menu' }), 'af-btn-danger'),
    ];
    const list = div('af-pause-list');
    for (const it of items) list.appendChild(it.el);
    this.menuEl.appendChild(list);
    this.menuEl.appendChild(hintRow([{ key: 'nav', label: 'SELECT' }, { key: 'confirm', label: 'CONFIRM' }, { key: 'pause', label: 'RESUME' }]));
    this.settingsEl = div('af-pause-settings hidden');
    this.settings = new SettingsPanel(ctx, () => this.showMenu(), true);
    this.settingsEl.appendChild(this.settings.el);
    panel.append(this.menuEl, this.settingsEl);
    this.el.appendChild(panel);
    this.nav = new Navigator(ctx.sound);
    this.nav.setItems(items, 0);
    this.nav.onBack = () => ctx.emit({ type: 'resume' });
  }

  setContext(world: World | null): void {
    if (!world) return;
    const r = world.race;
    const label = r.sessionType === 'race' ? `LAP ${Math.min(r.leaderLap, r.totalLaps)} / ${r.totalLaps}` : r.sessionType.toUpperCase();
    setText(this.sub, `${world.trackDef.grandPrixName.toUpperCase()} · ${label}`);
  }

  private showSettings(): void {
    this.view = 'settings';
    this.menuEl.classList.add('hidden');
    this.settingsEl.classList.remove('hidden');
    this.settings.open();
  }

  private showMenu(): void {
    this.view = 'menu';
    this.menuEl.classList.remove('hidden');
    this.settingsEl.classList.add('hidden');
    this.nav.focus(2, true);
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    this.view = 'menu';
    this.menuEl.classList.remove('hidden');
    this.settingsEl.classList.add('hidden');
    this.nav.focus(0, true);
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  move(dx: number, dy: number): void {
    if (this.view === 'settings') this.settings.move(dx, dy);
    else this.nav.move(dx, dy);
  }
  confirm(): void {
    if (this.view === 'settings') this.settings.confirm();
    else this.nav.confirm();
  }
  back(): void {
    if (this.view === 'settings') this.settings.back();
    else this.nav.back();
  }
}