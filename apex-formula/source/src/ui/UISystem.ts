/**
 * APEX FORMULA — UI system (Agent 7). Menus + F1-broadcast HUD built from plain DOM/SVG.
 * Everything the UI asks main to do goes through the `onCommand` callback; sounds go through the event bus.
 */
import { events } from '../core/events';
import { TrackSpline } from '../core/track/TrackSpline';
import type {
  AppPhase,
  DriverDef,
  GameSettings,
  IUISystem,
  InputCommand,
  RaceControlMessage,
  RenderStats,
  SessionResults,
  SessionType,
  TeamDef,
  TrackDefinition,
  UICommand,
  UISound,
  World,
} from '../core/types';
import { applyHintGlyphs, type Screen, type UIContext } from './context';
import { div, icon, span } from './dom';
import { HUD } from './hud/HUD';
import { GridScreen } from './screens/GridScreen';
import { LoadingScreen } from './screens/LoadingScreen';
import { MenuScreen } from './screens/MenuScreen';
import { PauseScreen } from './screens/PauseScreen';
import { ReplayOverlay } from './screens/ReplayOverlay';
import { ResultsScreen } from './screens/ResultsScreen';
import { TitleScreen } from './screens/TitleScreen';
import { loadLastConfig, loadSettings, saveLastConfig, saveSettings, type LastConfig } from './storage';
import { CSS } from './styles';

type ScreenName = 'title' | 'menu' | 'loading' | 'grid' | 'pause' | 'replay' | 'results';
type NavAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'mfd-next' | 'mfd-prev';

const KEY_DEDUP_MS = 120;

export class UISystem implements IUISystem {
  private readonly root: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly style: HTMLStyleElement;
  private readonly gtoasts: HTMLElement;
  private readonly gamepadBadge: HTMLElement;
  private cb: ((cmd: UICommand) => void) | null = null;
  private readonly settings: GameSettings;
  private readonly last: LastConfig;
  private readonly ctx: UIContext;
  private readonly splines = new Map<string, TrackSpline>();

  private phase: AppPhase = 'boot';
  private screen: ScreenName | null = null;
  private world: World | null = null;
  private pendingCircuitId = '';
  private hudVisible = true;
  private lastKeyNav: { type: NavAction; time: number } = { type: 'up', time: -1e9 };

  private title!: TitleScreen;
  private menu!: MenuScreen;
  private loading!: LoadingScreen;
  private grid!: GridScreen;
  private pause!: PauseScreen;
  private replay!: ReplayOverlay;
  private results!: ResultsScreen;
  private hud!: HUD;
  private screens!: Record<ScreenName, Screen>;
  private built = false;

  private readonly onKeyBound = (e: KeyboardEvent) => this.onKey(e);

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    this.last = loadLastConfig();
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.layer = div('af');
    root.appendChild(this.layer);
    this.gtoasts = div('af-gtoasts');
    this.gamepadBadge = div('af-gamepad hidden');
    this.gamepadBadge.appendChild(icon('gamepad', 'af-ico'));
    this.gamepadBadge.appendChild(span('', 'GAMEPAD'));

    const self = this;
    this.ctx = {
      emit: (cmd) => this.emit(cmd),
      sound: (s) => this.sound(s),
      notify: (t, k, d) => this.notify(t, k, d),
      settings: this.settings,
      last: this.last,
      saveSettings: () => saveSettings(this.settings),
      saveLast: () => saveLastConfig(this.last),
      teams: [],
      drivers: [],
      circuits: [],
      teamById: {},
      driverById: {},
      spline: (def) => this.splineFor(def),
      get gamepad() {
        return self.gamepadConnected;
      },
    };
    window.addEventListener('keydown', this.onKeyBound);
  }

  private gamepadConnected = false;

  /* ───────────────────────────── construction ───────────────────────────── */

  private build(): void {
    if (this.built) return;
    this.built = true;
    this.title = new TitleScreen(this.ctx);
    this.menu = new MenuScreen(this.ctx);
    this.loading = new LoadingScreen(this.ctx);
    this.grid = new GridScreen(this.ctx);
    this.pause = new PauseScreen(this.ctx);
    this.replay = new ReplayOverlay(this.ctx);
    this.results = new ResultsScreen(this.ctx);
    this.hud = new HUD(this.ctx);
    this.screens = { title: this.title, menu: this.menu, loading: this.loading, grid: this.grid, pause: this.pause, replay: this.replay, results: this.results };
    this.title.onStart = () => {
      this.menu.showRoot();
      this.showScreen('menu');
    };
    this.layer.append(this.hud.el, this.title.el, this.menu.el, this.loading.el, this.grid.el, this.pause.el, this.replay.el, this.results.el, this.gtoasts, this.gamepadBadge);
    applyHintGlyphs(this.layer, this.gamepadConnected);
  }

  private splineFor(def: TrackDefinition): TrackSpline {
    let s = this.splines.get(def.id);
    if (!s) {
      s = new TrackSpline(def);
      this.splines.set(def.id, s);
    }
    return s;
  }

  /* ───────────────────────────── IUISystem ───────────────────────────── */

  setData(teams: TeamDef[], drivers: DriverDef[], circuits: TrackDefinition[]): void {
    this.ctx.teams = teams;
    this.ctx.drivers = drivers;
    this.ctx.circuits = circuits;
    this.ctx.teamById = Object.fromEntries(teams.map((t) => [t.id, t]));
    this.ctx.driverById = Object.fromEntries(drivers.map((d) => [d.id, d]));
    if (!circuits.some((c) => c.id === this.last.circuitId)) this.last.circuitId = circuits[0]?.id ?? '';
    if (!drivers.some((d) => d.id === this.last.playerDriverId)) this.last.playerDriverId = drivers[0]?.id ?? '';
    this.build();
  }

  onCommand(cb: (cmd: UICommand) => void): void {
    this.cb = cb;
  }

  getSettings(): GameSettings {
    return this.settings;
  }

  setPhase(phase: AppPhase): void {
    this.ensureBuilt();
    this.phase = phase;
    switch (phase) {
      case 'boot':
        break;
      case 'title':
        this.hud.setMode('hidden');
        this.showScreen('title');
        break;
      case 'menu':
        this.hud.setMode('hidden');
        this.menu.showRoot();
        this.showScreen('menu');
        break;
      case 'loading':
        this.hud.setMode('hidden');
        this.loading.setCircuit(
          this.ctx.circuits.find((c) => c.id === this.pendingCircuitId) ??
            this.world?.trackDef ??
            this.ctx.circuits.find((c) => c.id === this.last.circuitId) ??
            this.ctx.circuits[0] ??
            null,
        );
        this.showScreen('loading');
        break;
      case 'pre-session':
        this.hud.setMode('hidden');
        if (this.world) this.grid.build(this.world);
        this.showScreen('grid');
        break;
      case 'session':
        this.showScreen(null);
        this.hud.setMode('session');
        this.hud.setVisible(this.hudVisible);
        break;
      case 'paused':
        this.pause.setContext(this.world);
        this.showScreen('pause');
        this.hud.setMode('paused');
        break;
      case 'replay':
        this.replay.enter(this.world ? Math.min(90, this.world.time) : 90);
        this.showScreen('replay');
        this.hud.setMode('replay');
        break;
      case 'results':
        this.hud.setMode('hidden');
        this.showScreen('results');
        break;
    }
  }

  setLoading(progress: number, label: string): void {
    this.ensureBuilt();
    this.loading.setProgress(progress, label);
  }

  showResults(results: SessionResults, world: World, next: SessionType | null): void {
    this.ensureBuilt();
    this.world = world;
    this.results.populate(results, world, next);
    this.hud.setMode('hidden');
    this.showScreen('results');
  }

  update(world: World | null, dt: number, stats: RenderStats): void {
    if (!this.built) return;
    this.world = world;
    if (world) {
      this.hud.attach(world);
      if (this.phase === 'session' || this.phase === 'paused' || this.phase === 'replay') this.hud.update(world, dt, stats);
      else if (this.phase === 'pre-session') this.grid.build(world);
    }
    if (this.phase === 'replay') this.replay.update(dt);
  }

  setReplayTime(time: number, duration: number, speed: number): void {
    if (this.built && this.phase === 'replay') this.replay.sync(time, duration, speed);
  }

  handleCommand(cmd: InputCommand): void {
    if (!this.built) return;
    switch (cmd.type) {
      case 'menu-up':
        this.navFromCommand('up');
        break;
      case 'menu-down':
        this.navFromCommand('down');
        break;
      case 'menu-left':
        this.navFromCommand('left');
        break;
      case 'menu-right':
        this.navFromCommand('right');
        break;
      case 'menu-confirm':
        this.navFromCommand('confirm');
        break;
      case 'menu-back':
      case 'pause':
        this.navFromCommand('back');
        break;
      case 'mfd-toggle':
        if (this.phase === 'session') this.hud.mfd.toggle();
        break;
      case 'mfd-next':
        if (this.phase === 'session') this.navFromCommand('mfd-next');
        break;
      case 'mfd-prev':
        if (this.phase === 'session') this.navFromCommand('mfd-prev');
        break;
      case 'request-pit':
        if (this.phase === 'session') this.hud.mfd.show('tyres');
        break;
      case 'ers-cycle':
        if (this.phase === 'session') this.sound('nav');
        break;
      case 'radio':
        if (this.phase === 'session') this.hud.feed.popup('TEAM RADIO', 'CHANNEL OPEN', 'radio small', 1.2);
        break;
      case 'toggle-mute':
        this.settings.muted = !this.settings.muted;
        saveSettings(this.settings);
        this.notify(this.settings.muted ? 'AUDIO MUTED' : 'AUDIO ON', 'info', 1.5);
        break;
      default:
        break;
    }
  }

  setHudVisible(visible: boolean): void {
    this.hudVisible = visible;
    if (this.built) this.hud.setVisible(visible);
  }

  notify(text: string, kind: RaceControlMessage['kind'] = 'info', durationSeconds = 4): void {
    if (!this.built) return;
    if (this.phase === 'session' || this.phase === 'paused') {
      this.hud.feed.toast(text, kind, durationSeconds);
    } else {
      const t = div(`af-toast af-toast-${kind}`);
      t.appendChild(span('af-toast-text', text));
      this.gtoasts.prepend(t);
      while (this.gtoasts.children.length > 4) this.gtoasts.lastElementChild?.remove();
      window.setTimeout(() => {
        t.classList.add('out');
        window.setTimeout(() => t.remove(), 320);
      }, durationSeconds * 1000);
    }
    if (kind === 'penalty') this.sound('penalty');
    else if (kind !== 'info') this.sound('notify');
  }

  setGamepadConnected(connected: boolean): void {
    this.gamepadConnected = connected;
    if (!this.built) return;
    this.gamepadBadge.classList.toggle('hidden', !connected);
    applyHintGlyphs(this.layer, connected);
    this.title.refreshGlyph();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyBound);
    this.hud?.dispose();
    this.layer.remove();
    this.style.remove();
    this.cb = null;
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  private ensureBuilt(): void {
    if (!this.built) this.build();
  }

  private emit(cmd: UICommand): void {
    if (cmd.type === 'start-session') this.pendingCircuitId = cmd.config.circuitId;
    this.cb?.(cmd);
  }

  private sound(s: UISound): void {
    events.emit('ui:sound', { sound: s });
  }

  private showScreen(name: ScreenName | null): void {
    if (this.screen === name) {
      if (name) this.screens[name].show();
      return;
    }
    if (this.screen) this.screens[this.screen].hide();
    this.screen = name;
    if (name) this.screens[name].show();
  }

  /** Where directional input goes right now. */
  private navTarget(): Screen | 'mfd' | null {
    if (this.phase === 'session') return this.hud.mfd.open ? 'mfd' : null;
    if (this.screen) return this.screens[this.screen];
    return null;
  }

  private doNav(action: NavAction): void {
    const target = this.navTarget();
    if (!target) return;
    if (target === 'mfd') {
      const mfd = this.hud.mfd;
      switch (action) {
        case 'up':
          mfd.move(0, -1);
          break;
        case 'down':
          mfd.move(0, 1);
          break;
        case 'left':
          mfd.move(-1, 0);
          break;
        case 'right':
          mfd.move(1, 0);
          break;
        case 'confirm':
          mfd.confirm();
          break;
        case 'back':
          mfd.hide();
          break;
        case 'mfd-next':
          mfd.cyclePage(1);
          break;
        case 'mfd-prev':
          mfd.cyclePage(-1);
          break;
      }
      return;
    }
    switch (action) {
      case 'up':
        target.move(0, -1);
        break;
      case 'down':
        target.move(0, 1);
        break;
      case 'left':
        target.move(-1, 0);
        break;
      case 'right':
        target.move(1, 0);
        break;
      case 'confirm':
        target.confirm();
        break;
      case 'back':
        target.back();
        break;
      default:
        break;
    }
  }

  /** Commands forwarded by the input system; skip ones we already handled from the raw keydown. */
  private navFromCommand(action: NavAction): void {
    const k = this.lastKeyNav;
    if (k.type === action && performance.now() - k.time < KEY_DEDUP_MS) return;
    if (action === 'mfd-next' || action === 'mfd-prev') {
      if (this.phase === 'session') this.hud.mfd.cyclePage(action === 'mfd-next' ? 1 : -1);
      return;
    }
    this.doNav(action);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.built || e.defaultPrevented) return;
    const target = this.navTarget();
    if (!target) return;
    const inMenu = target !== 'mfd';
    let action: NavAction | null = null;
    switch (e.key) {
      case 'ArrowUp':
        action = 'up';
        break;
      case 'ArrowDown':
        action = 'down';
        break;
      case 'ArrowLeft':
        action = 'left';
        break;
      case 'ArrowRight':
        action = 'right';
        break;
      case 'w':
      case 'W':
        if (inMenu) action = 'up';
        break;
      case 's':
      case 'S':
        if (inMenu) action = 'down';
        break;
      case 'a':
      case 'A':
        if (inMenu) action = 'left';
        break;
      case 'd':
      case 'D':
        if (inMenu) action = 'right';
        break;
      case 'Enter':
        action = 'confirm';
        break;
      case ' ':
        if (inMenu) action = 'confirm';
        break;
      case 'Escape':
        // Main owns Esc while paused / in replay (resume / exit replay); we handle it everywhere else.
        if (inMenu && this.phase !== 'paused' && this.phase !== 'replay') action = 'back';
        break;
      case ',':
        if (!inMenu) action = 'mfd-prev';
        break;
      case '.':
        if (!inMenu) action = 'mfd-next';
        break;
      default:
        break;
    }
    if (!action) return;
    if (inMenu && (e.key === ' ' || e.key.startsWith('Arrow'))) e.preventDefault();
    if (e.repeat && (action === 'confirm' || action === 'back')) return;
    this.lastKeyNav = { type: action, time: performance.now() };
    this.doNav(action);
  }
}
