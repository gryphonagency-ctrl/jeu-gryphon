import { SESSION_LIMITS, TYRE_COMPOUNDS, TYRE_DATA } from '../../core/constants';
import type { DriverDef, GameMode, SessionConfig, TrackDefinition, WeatherPreset } from '../../core/types';
import { COUNTRY_NAMES, SKILL_KEYS, hintRow, type Screen, type UIContext } from '../context';
import { append, div, icon, span, setText } from '../dom';
import { Navigator } from '../nav';
import { GRID_ORDERS, WEATHER_PRESETS } from '../storage';
import { buildTrackMap } from '../trackMap';
import { buildAssistRows, buildButton, buildRow, cycle, sectionHeader, stepClamp, type Row } from '../widgets';
import { SettingsPanel } from './SettingsPanel';

type View = 'main' | 'drivers' | 'circuits' | 'session' | 'assists' | 'settings' | 'controls';

const MODE_INFO: Record<GameMode, { title: string; sub: string; desc: string }> = {
  'quick-race': { title: 'QUICK RACE', sub: 'Straight to the grid', desc: 'Pick a driver and a circuit, set the distance and go racing against a full field of AI.' },
  'grand-prix': { title: 'GRAND PRIX WEEKEND', sub: 'Qualifying · Race', desc: 'An 8-minute qualifying session sets the grid, then the full race distance. Earn your position.' },
  'time-trial': { title: 'TIME TRIAL', sub: 'You vs the clock', desc: 'Empty track, unlimited laps. Chase the reference lap and perfect every sector.' },
};

export const WEATHER_LABELS: Record<WeatherPreset, string> = { dry: 'DRY', 'light-rain': 'LIGHT RAIN', 'heavy-rain': 'HEAVY RAIN', dynamic: 'DYNAMIC' };
const TOD_OPTIONS: { label: string; hours: number }[] = [
  { label: 'CIRCUIT DEFAULT', hours: -1 },
  { label: 'DAY', hours: 13 },
  { label: 'SUNSET', hours: 18.5 },
  { label: 'NIGHT', hours: 21.5 },
];
const GRID_LABELS: Record<string, string> = { performance: 'PERFORMANCE', random: 'RANDOM', reverse: 'REVERSE', qualifying: 'QUALIFYING' };

export const todIcon = (hours: number): 'sun' | 'sunset' | 'moon' => (hours >= 20 || hours < 6 ? 'moon' : hours >= 17.5 ? 'sunset' : 'sun');
export const weatherIcon = (w: WeatherPreset): 'sun' | 'rain' | 'cloud' => (w === 'dry' ? 'sun' : w === 'dynamic' ? 'cloud' : 'rain');

export class MenuScreen implements Screen {
  readonly el: HTMLElement;
  private view: View = 'main';
  private mode: GameMode = 'quick-race';
  private readonly panel: HTMLElement;
  private readonly crumbs: HTMLElement;
  private readonly views: Record<View, HTMLElement>;
  private readonly navs: Record<Exclude<View, 'settings'>, Navigator>;
  private readonly settings: SettingsPanel;
  private readonly detail: { name: HTMLElement; team: HTMLElement; bio: HTMLElement; meta: HTMLElement };
  private previewTimer = 0;
  private lastPreview = '';
  private circuitDetail!: HTMLElement;
  private circuitMaps = new Map<string, SVGSVGElement>();
  private sessionRows: Row[] = [];
  private assistRows: Row[] = [];
  private sessionSummary!: HTMLElement;
  private startBtn!: HTMLElement;
  private driverCards: HTMLElement[] = [];
  private circuitRows: HTMLElement[] = [];
  private selectedDriver: DriverDef;
  private selectedCircuit: TrackDefinition;

  constructor(private readonly ctx: UIContext) {
    this.el = div('af-screen af-menu hidden');
    this.el.appendChild(div('af-menu-shade'));
    this.panel = div('af-menu-panel');
    this.el.appendChild(this.panel);

    const head = div('af-menu-head');
    const brand = div('af-brand');
    brand.append(span('af-brand-a', 'APEX'), span('af-brand-b', 'FORMULA'));
    this.crumbs = div('af-crumbs');
    head.append(brand, this.crumbs);
    this.panel.appendChild(head);

    const mk = (cls: string) => {
      const v = div(`af-view ${cls} hidden`);
      this.panel.appendChild(v);
      return v;
    };
    this.views = {
      main: mk('af-v-main'),
      drivers: mk('af-v-drivers'),
      circuits: mk('af-v-circuits'),
      session: mk('af-v-session'),
      assists: mk('af-v-assists'),
      settings: mk('af-v-settings'),
      controls: mk('af-v-controls'),
    };
    this.navs = {
      main: new Navigator(ctx.sound),
      drivers: new Navigator(ctx.sound),
      circuits: new Navigator(ctx.sound),
      session: new Navigator(ctx.sound),
      assists: new Navigator(ctx.sound),
      controls: new Navigator(ctx.sound),
    };
    this.selectedDriver = ctx.driverById[ctx.last.playerDriverId] ?? ctx.drivers[0];
    this.selectedCircuit = ctx.circuits.find((c) => c.id === ctx.last.circuitId) ?? ctx.circuits[0];
    this.mode = ctx.last.mode;

    this.settings = new SettingsPanel(ctx, () => this.go('main'));
    this.views.settings.appendChild(this.settings.el);

    this.detail = { name: div('af-ddetail-name'), team: div('af-ddetail-team'), bio: div('af-ddetail-bio'), meta: div('af-ddetail-meta') };
    this.buildMain();
    this.buildDrivers();
    this.buildCircuits();
    this.buildSession();
    this.buildAssists();
    this.buildControls();
  }

  /* ───────────── main ───────────── */

  private buildMain(): void {
    const v = this.views.main;
    const list = div('af-mainlist');
    const info = div('af-maininfo');
    const infoTitle = div('af-maininfo-title', '');
    const infoDesc = div('af-maininfo-desc', '');
    info.append(infoTitle, infoDesc);
    const entries: { label: string; sub: string; desc: string; act: () => void; cls?: string }[] = [
      { label: 'QUICK RACE', sub: MODE_INFO['quick-race'].sub, desc: MODE_INFO['quick-race'].desc, act: () => this.startFlow('quick-race') },
      { label: 'GRAND PRIX WEEKEND', sub: MODE_INFO['grand-prix'].sub, desc: MODE_INFO['grand-prix'].desc, act: () => this.startFlow('grand-prix') },
      { label: 'TIME TRIAL', sub: MODE_INFO['time-trial'].sub, desc: MODE_INFO['time-trial'].desc, act: () => this.startFlow('time-trial') },
      { label: 'SETTINGS', sub: 'Graphics · Audio · Camera · Assists', desc: 'Tune quality, volume, camera and driving assists. Saved between sessions.', act: () => this.go('settings'), cls: 'af-mainitem-minor' },
      { label: 'CONTROLS', sub: 'Keyboard & gamepad bindings', desc: 'Every key and button, from throttle to team radio.', act: () => this.go('controls'), cls: 'af-mainitem-minor' },
    ];
    const items = entries.map((en, i) => {
      const e = div(`af-mainitem ${en.cls ?? ''}`.trim());
      e.appendChild(span('af-mainitem-idx', `0${i + 1}`));
      const t = div('af-mainitem-text');
      t.append(div('af-mainitem-label', en.label), div('af-mainitem-sub', en.sub));
      e.appendChild(t);
      e.appendChild(span('af-mainitem-chev', '›'));
      list.appendChild(e);
      return {
        el: e,
        onConfirm: en.act,
        onFocus: () => {
          setText(infoTitle, en.label);
          setText(infoDesc, en.desc);
        },
      };
    });
    v.append(list, info);
    v.appendChild(hintRow([{ key: 'nav', label: 'NAVIGATE' }, { key: 'confirm', label: 'SELECT' }]));
    this.navs.main.setItems(items, 0);
    this.navs.main.onBack = null;
  }

  private startFlow(mode: GameMode): void {
    this.mode = mode;
    this.ctx.last.mode = mode;
    this.go('drivers');
  }

  /* ───────────── drivers ───────────── */

  private buildDrivers(): void {
    const v = this.views.drivers;
    v.appendChild(sectionHeader('01', 'CHOOSE YOUR DRIVER', 'Take their seat. Team, car and number are yours.'));
    const grid = div('af-dgrid');
    const items = this.ctx.drivers.map((d) => {
      const team = this.ctx.teamById[d.teamId];
      const card = div('af-dcard');
      card.style.setProperty('--team', team.primaryColor);
      card.style.setProperty('--team2', team.secondaryColor);
      const top = div('af-dcard-top');
      top.append(span('af-dcard-num', String(d.number)), span('af-dcard-code', d.code));
      const name = div('af-dcard-name');
      const parts = d.name.split(' ');
      name.append(span('af-dcard-first', parts.slice(0, -1).join(' ')), span('af-dcard-last', parts[parts.length - 1]));
      const meta = div('af-dcard-meta');
      const helm = span('af-helmet');
      d.helmet.forEach((c) => {
        const s = span('af-helmet-c');
        s.style.background = c;
        helm.appendChild(s);
      });
      meta.append(span('af-dcard-nat', d.country), span('af-dcard-team', team.shortName), helm);
      const skills = div('af-skills');
      for (const k of ['pace', 'consistency', 'racecraft'] as const) {
        const s = div('af-skill');
        const f = div('af-skill-fill');
        f.style.transform = `scaleX(${d.skill[k].toFixed(2)})`;
        s.appendChild(f);
        skills.appendChild(s);
      }
      card.append(top, name, meta, skills);
      grid.appendChild(card);
      this.driverCards.push(card);
      return {
        el: card,
        onConfirm: () => {
          this.selectedDriver = d;
          this.ctx.last.playerDriverId = d.id;
          this.go('circuits');
        },
        onFocus: () => this.focusDriver(d),
      };
    });
    v.appendChild(grid);
    const detail = div('af-ddetail');
    detail.append(this.detail.name, this.detail.team, this.detail.meta, this.detail.bio);
    v.appendChild(detail);
    v.appendChild(hintRow([{ key: 'nav', label: 'BROWSE' }, { key: 'confirm', label: 'SELECT DRIVER' }, { key: 'back', label: 'BACK' }]));
    const idx = Math.max(0, this.ctx.drivers.indexOf(this.selectedDriver));
    this.navs.drivers.setItems(items, idx, 4);
    this.navs.drivers.onBack = () => this.go('main');
    this.focusDriver(this.selectedDriver, true);
  }

  private focusDriver(d: DriverDef, immediate = false): void {
    const team = this.ctx.teamById[d.teamId];
    setText(this.detail.name, d.name.toUpperCase());
    setText(this.detail.team, `${team.name.toUpperCase()} · ${team.engineSupplier.toUpperCase()}`);
    setText(this.detail.bio, d.bio);
    this.detail.meta.replaceChildren();
    for (const k of SKILL_KEYS) {
      const m = div('af-ddetail-skill');
      const bar = div('af-ddetail-bar');
      const f = div('af-ddetail-fill');
      f.style.transform = `scaleX(${d.skill[k].toFixed(2)})`;
      bar.appendChild(f);
      m.append(span('af-ddetail-k', k.toUpperCase()), bar, span('af-ddetail-v', String(Math.round(d.skill[k] * 100))));
      this.detail.meta.appendChild(m);
    }
    const nat = span('af-ddetail-nat', `${d.country} · ${COUNTRY_NAMES[d.country] ?? d.country}`);
    this.detail.meta.appendChild(nat);
    this.detail.name.style.setProperty('--team', team.primaryColor);
    clearTimeout(this.previewTimer);
    const fire = () => {
      if (this.lastPreview === d.id) return;
      this.lastPreview = d.id;
      this.ctx.emit({ type: 'preview-driver', driverId: d.id });
    };
    if (immediate) fire();
    else this.previewTimer = window.setTimeout(fire, 120);
  }

  /* ───────────── circuits ───────────── */

  private buildCircuits(): void {
    const v = this.views.circuits;
    v.appendChild(sectionHeader('02', 'CHOOSE THE CIRCUIT', `${this.ctx.circuits.length} circuits · sectors · DRS zones · pit lane`));
    const wrap = div('af-cwrap');
    const list = div('af-clist');
    this.circuitDetail = div('af-cdetail');
    wrap.append(list, this.circuitDetail);
    v.appendChild(wrap);
    const items = this.ctx.circuits.map((c, i) => {
      const row = div('af-crow');
      row.append(span('af-crow-idx', `${i + 1 < 10 ? '0' : ''}${i + 1}`), div('af-crow-text'));
      const t = row.lastElementChild as HTMLElement;
      t.append(div('af-crow-name', c.name.toUpperCase()), div('af-crow-sub', `${c.location} · ${c.country}`));
      const ic = icon(todIcon(c.environment.timeOfDay), 'af-ico af-crow-ico');
      row.appendChild(ic);
      list.appendChild(row);
      this.circuitRows.push(row);
      return {
        el: row,
        onConfirm: () => {
          this.selectedCircuit = c;
          this.ctx.last.circuitId = c.id;
          this.go('session');
        },
        onFocus: () => this.showCircuit(c),
      };
    });
    v.appendChild(hintRow([{ key: 'nav', label: 'BROWSE' }, { key: 'confirm', label: 'SELECT CIRCUIT' }, { key: 'back', label: 'BACK' }]));
    const idx = Math.max(0, this.ctx.circuits.indexOf(this.selectedCircuit));
    this.navs.circuits.setItems(items, idx);
    this.navs.circuits.onBack = () => this.go('drivers');
    this.showCircuit(this.ctx.circuits[idx] ?? this.ctx.circuits[0]);
  }

  private mapFor(c: TrackDefinition): SVGSVGElement {
    let m = this.circuitMaps.get(c.id);
    if (!m) {
      m = buildTrackMap(this.ctx.spline(c), { stroke: 4, sectors: true, drs: true, pit: true, corners: true, glow: true }).svg;
      this.circuitMaps.set(c.id, m);
    }
    return m;
  }

  private showCircuit(c: TrackDefinition): void {
    const d = this.circuitDetail;
    d.replaceChildren();
    const spline = this.ctx.spline(c);
    const head = div('af-cdetail-head');
    head.append(div('af-cdetail-gp', c.grandPrixName.toUpperCase()), div('af-cdetail-name', c.name), div('af-cdetail-loc', `${c.location}, ${COUNTRY_NAMES[c.country] ?? c.country}`));
    const mapWrap = div('af-cdetail-map');
    mapWrap.appendChild(this.mapFor(c));
    const legend = div('af-cdetail-legend');
    legend.append(span('af-leg af-leg-s1', 'S1'), span('af-leg af-leg-s2', 'S2'), span('af-leg af-leg-s3', 'S3'), span('af-leg af-leg-drs', 'DRS'), span('af-leg af-leg-pit', 'PIT'));
    mapWrap.appendChild(legend);
    const stats = div('af-cstats');
    const stat = (k: string, val: string, extra?: HTMLElement) => {
      const s = div('af-cstat');
      const vv = div('af-cstat-v', val);
      if (extra) vv.prepend(extra);
      s.append(vv, div('af-cstat-k', k));
      stats.appendChild(s);
    };
    stat('LENGTH', `${(spline.length / 1000).toFixed(3)} km`);
    stat('CORNERS', String(c.corners.length));
    stat('LAPS', String(c.defaultLaps));
    stat('DRS ZONES', String(c.drsZones.length));
    const m = Math.floor(c.referenceLapTime / 60);
    stat('REFERENCE', `${m}:${(c.referenceLapTime - m * 60).toFixed(1).padStart(4, '0')}`);
    stat('CONDITIONS', `${Math.floor(c.environment.timeOfDay)}:${String(Math.round((c.environment.timeOfDay % 1) * 60)).padStart(2, '0')} · ${WEATHER_LABELS[c.environment.weather]}`, icon(todIcon(c.environment.timeOfDay), 'af-ico af-ico-inline'));
    const desc = div('af-cdetail-desc', c.description);
    const vibe = div('af-cdetail-vibe', c.environment.vibe);
    append(d, head, mapWrap, stats, desc, vibe);
  }

  /* ───────────── session setup ───────────── */

  private buildSession(): void {
    const v = this.views.session;
    v.appendChild(sectionHeader('03', 'SESSION SETUP', 'Distance, opponents, conditions and rules'));
    const cols = div('af-scols');
    const list = div('af-rows af-session-rows');
    this.sessionSummary = div('af-ssummary');
    cols.append(list, this.sessionSummary);
    v.appendChild(cols);
    const L = this.ctx.last;
    const isTT = () => this.mode === 'time-trial';
    const save = () => {
      this.ctx.saveLast();
      this.refreshSummary();
    };
    const rows: Row[] = [];
    rows.push(
      buildRow(
        {
          label: 'RACE LAPS',
          kind: 'slider',
          value: () => String(this.laps()),
          fill: () => (this.laps() - SESSION_LIMITS.minRaceLaps) / (SESSION_LIMITS.maxRaceLaps - SESSION_LIMITS.minRaceLaps),
          adjust: (d) => (L.laps = stepClamp(this.laps(), d, 1, SESSION_LIMITS.minRaceLaps, SESSION_LIMITS.maxRaceLaps)),
          disabled: isTT,
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'AI DIFFICULTY',
          kind: 'slider',
          value: () => `${Math.round(L.aiDifficulty * 100)}%`,
          fill: () => L.aiDifficulty,
          adjust: (d) => (L.aiDifficulty = stepClamp(L.aiDifficulty, d, 0.05, 0, 1)),
          disabled: isTT,
          hint: '0% rookie pace · 100% alien pace',
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'AI OPPONENTS',
          kind: 'slider',
          value: () => (isTT() ? '0' : String(L.aiCount)),
          fill: () => (isTT() ? 0 : L.aiCount / 19),
          adjust: (d) => (L.aiCount = stepClamp(L.aiCount, d, 1, 0, 19)),
          disabled: isTT,
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'WEATHER',
          kind: 'select',
          value: () => WEATHER_LABELS[L.weather],
          adjust: (d) => (L.weather = cycle(WEATHER_PRESETS, L.weather, d)),
          hint: 'Dynamic lets the forecast evolve during the session.',
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'TIME OF DAY',
          kind: 'select',
          value: () => TOD_OPTIONS.find((o) => o.hours === L.timeOfDay)?.label ?? 'CIRCUIT DEFAULT',
          adjust: (d) => {
            const i = TOD_OPTIONS.findIndex((o) => o.hours === L.timeOfDay);
            const n = TOD_OPTIONS.length;
            L.timeOfDay = TOD_OPTIONS[(((i < 0 ? 0 : i) + d) % n + n) % n].hours;
          },
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'GRID ORDER',
          kind: 'select',
          value: () => (this.mode === 'grand-prix' ? 'QUALIFYING' : GRID_LABELS[L.gridOrder] ?? L.gridOrder.toUpperCase()),
          adjust: (d) => (L.gridOrder = cycle(GRID_ORDERS, GRID_ORDERS.includes(L.gridOrder) ? L.gridOrder : 'performance', d)),
          disabled: () => isTT() || this.mode === 'grand-prix',
          hint: 'Grand Prix weekends set the grid from qualifying.',
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'STARTING TYRE',
          kind: 'select',
          value: () => TYRE_DATA[L.startingCompound].label.toUpperCase(),
          swatch: () => TYRE_DATA[L.startingCompound].color,
          adjust: (d) => (L.startingCompound = cycle(TYRE_COMPOUNDS, L.startingCompound, d)),
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'RANDOM EVENTS',
          kind: 'toggle',
          value: () => (L.randomEvents ? 'ON' : 'OFF'),
          adjust: () => (L.randomEvents = !L.randomEvents),
          disabled: isTT,
          hint: 'Mechanical failures and incidents for AI cars.',
        },
        save,
      ),
    );
    rows.push(buildRow({ label: 'DRIVING ASSISTS', kind: 'link', value: () => '', confirm: () => this.go('assists') }));
    for (const r of rows) list.appendChild(r.el);
    const start = buildButton('START SESSION', () => this.launch(), 'af-btn-primary af-btn-start');
    this.startBtn = start.el;
    const foot = div('af-session-foot');
    foot.appendChild(start.el);
    v.appendChild(foot);
    v.appendChild(hintRow([{ key: 'nav', label: 'SELECT' }, { key: 'side', label: 'CHANGE' }, { key: 'confirm', label: 'CONFIRM' }, { key: 'back', label: 'BACK' }]));
    this.sessionRows = rows;
    this.navs.session.setItems([...rows.map((r) => r.item), start], rows.length);
    this.navs.session.onBack = () => this.go('circuits');
  }

  private laps(): number {
    const L = this.ctx.last;
    if (L.laps < SESSION_LIMITS.minRaceLaps || L.laps > SESSION_LIMITS.maxRaceLaps) return Math.min(SESSION_LIMITS.maxRaceLaps, Math.max(SESSION_LIMITS.minRaceLaps, this.selectedCircuit.defaultLaps));
    return L.laps;
  }

  private refreshSummary(): void {
    const s = this.sessionSummary;
    const L = this.ctx.last;
    const c = this.selectedCircuit;
    const d = this.selectedDriver;
    const team = this.ctx.teamById[d.teamId];
    s.replaceChildren();
    const info = MODE_INFO[this.mode];
    s.appendChild(div('af-ssum-mode', info.title));
    const drv = div('af-ssum-driver');
    drv.style.setProperty('--team', team.primaryColor);
    drv.append(span('af-ssum-num', String(d.number)), div('af-ssum-dtext'));
    (drv.lastElementChild as HTMLElement).append(div('af-ssum-dname', d.name.toUpperCase()), div('af-ssum-dteam', team.name.toUpperCase()));
    s.appendChild(drv);
    const mapWrap = div('af-ssum-map');
    mapWrap.appendChild(this.mapFor(c).cloneNode(true) as SVGSVGElement);
    s.appendChild(mapWrap);
    s.appendChild(div('af-ssum-circuit', c.name.toUpperCase()));
    s.appendChild(div('af-ssum-gp', c.grandPrixName));
    const tags = div('af-ssum-tags');
    const tod = L.timeOfDay >= 0 ? L.timeOfDay : c.environment.timeOfDay;
    const tag = (txt: string, ic?: 'sun' | 'sunset' | 'moon' | 'rain' | 'cloud', colour?: string) => {
      const t = span('af-tag');
      if (ic) t.appendChild(icon(ic, 'af-ico af-ico-inline'));
      if (colour) {
        const sw = span('af-swatch');
        sw.style.background = colour;
        t.appendChild(sw);
      }
      t.appendChild(document.createTextNode(txt));
      tags.appendChild(t);
    };
    if (this.mode === 'time-trial') tag('UNLIMITED LAPS');
    else tag(`${this.laps()} LAPS`);
    if (this.mode !== 'time-trial') tag(`${L.aiCount} AI · ${Math.round(L.aiDifficulty * 100)}%`);
    tag(WEATHER_LABELS[L.weather], weatherIcon(L.weather));
    tag(TOD_OPTIONS.find((o) => o.hours === L.timeOfDay)?.label ?? 'CIRCUIT', todIcon(tod));
    tag(TYRE_DATA[L.startingCompound].label.toUpperCase(), undefined, TYRE_DATA[L.startingCompound].color);
    s.appendChild(tags);
    if (this.mode === 'grand-prix') s.appendChild(div('af-ssum-note', `QUALIFYING ${SESSION_LIMITS.qualifyingMinutes} MIN → RACE ${this.laps()} LAPS`));
  }

  private launch(): void {
    const L = this.ctx.last;
    L.laps = this.laps();
    L.circuitId = this.selectedCircuit.id;
    L.playerDriverId = this.selectedDriver.id;
    this.ctx.saveLast();
    const tt = this.mode === 'time-trial';
    const config: SessionConfig = {
      mode: this.mode,
      sessionType: this.mode === 'quick-race' ? 'race' : 'qualifying',
      circuitId: L.circuitId,
      laps: L.laps,
      playerDriverId: L.playerDriverId,
      aiDifficulty: L.aiDifficulty,
      aiCount: tt ? 0 : L.aiCount,
      weather: L.weather,
      timeOfDay: L.timeOfDay,
      assists: { ...this.ctx.settings.assists },
      startingCompound: L.startingCompound,
      gridOrder: this.mode === 'grand-prix' ? 'qualifying' : GRID_ORDERS.includes(L.gridOrder) ? L.gridOrder : 'performance',
      randomEvents: tt ? false : L.randomEvents,
    };
    this.ctx.sound('start');
    this.ctx.emit({ type: 'start-session', config });
  }

  /* ───────────── assists (session sub-view) ───────────── */

  private buildAssists(): void {
    const v = this.views.assists;
    v.appendChild(sectionHeader('03', 'DRIVING ASSISTS', 'Applied to your car for this session and saved as default'));
    const list = div('af-rows');
    this.assistRows = buildAssistRows(this.ctx.settings.assists, () => this.ctx.saveSettings());
    for (const r of this.assistRows) list.appendChild(r.el);
    v.appendChild(list);
    const back = buildButton('DONE', () => this.go('session'), 'af-btn-ghost');
    const foot = div('af-settings-foot');
    foot.appendChild(back.el);
    v.appendChild(foot);
    v.appendChild(hintRow([{ key: 'nav', label: 'SELECT' }, { key: 'side', label: 'CHANGE' }, { key: 'back', label: 'DONE' }]));
    this.navs.assists.setItems([...this.assistRows.map((r) => r.item), back], 0);
    this.navs.assists.onBack = () => this.go('session');
  }

  /* ───────────── controls ───────────── */

  private buildControls(): void {
    const v = this.views.controls;
    v.appendChild(sectionHeader('CONTROLS', 'BINDINGS', 'Keyboard and standard gamepad'));
    const cols = div('af-ctrlcols');
    const table = (title: string, rows: [string, string][]) => {
      const t = div('af-ctrltable');
      t.appendChild(div('af-ctrltable-title', title));
      for (const [k, a] of rows) {
        const r = div('af-ctrlrow');
        const keys = span('af-ctrlkeys');
        k.split(' / ').forEach((kk) => keys.appendChild(span('af-key', kk)));
        r.append(keys, span('af-ctrlact', a));
        t.appendChild(r);
      }
      return t;
    };
    cols.appendChild(
      table('KEYBOARD', [
        ['W / ↑', 'Throttle'],
        ['S / ↓', 'Brake'],
        ['A / ←', 'Steer left'],
        ['D / →', 'Steer right'],
        ['E / SHIFT', 'Shift up'],
        ['Q / CTRL', 'Shift down'],
        ['SPACE', 'DRS (hold)'],
        ['R', 'ERS overtake (hold)'],
        ['V', 'Cycle ERS mode'],
        ['L', 'Pit limiter'],
        ['P', 'Request pit stop'],
        ['TAB', 'MFD toggle'],
        [', / .', 'MFD page'],
        ['C', 'Cycle camera'],
        ['B', 'Look back (hold)'],
        ['BACKSPACE', 'Reset car'],
        ['I', 'Instant replay'],
        ['H', 'Toggle HUD'],
        ['M', 'Mute'],
        ['T', 'Team radio'],
        ['F8', 'Screenshot'],
        ['ESC', 'Pause'],
      ]),
    );
    cols.appendChild(
      table('GAMEPAD', [
        ['LEFT STICK', 'Steer'],
        ['RT', 'Throttle'],
        ['LT', 'Brake'],
        ['A', 'Shift up · Confirm'],
        ['B', 'Shift down · Back'],
        ['X', 'DRS'],
        ['Y', 'ERS overtake'],
        ['LB', 'Look back'],
        ['RB', 'Cycle camera'],
        ['D-PAD', 'MFD / menu navigation'],
        ['START', 'Pause'],
        ['BACK', 'Instant replay'],
        ['R-STICK CLICK', 'Reset car'],
      ]),
    );
    v.appendChild(cols);
    const back = buildButton('BACK', () => this.go('main'), 'af-btn-ghost');
    const foot = div('af-settings-foot');
    foot.appendChild(back.el);
    v.appendChild(foot);
    v.appendChild(hintRow([{ key: 'back', label: 'BACK' }]));
    this.navs.controls.setItems([back], 0);
    this.navs.controls.onBack = () => this.go('main');
  }

  /* ───────────── view switching ───────────── */

  private go(view: View): void {
    const prev = this.view;
    this.view = view;
    for (const k in this.views) this.views[k as View].classList.toggle('hidden', k !== view);
    const cur = this.views[view];
    cur.classList.remove('in');
    void cur.offsetWidth;
    cur.classList.add('in');
    this.updateCrumbs();
    if (view === 'settings') this.settings.open();
    if (view === 'drivers') {
      const idx = Math.max(0, this.ctx.drivers.indexOf(this.selectedDriver));
      this.navs.drivers.focus(idx, true);
      this.focusDriver(this.selectedDriver, true);
    }
    if (view === 'circuits') {
      const idx = Math.max(0, this.ctx.circuits.indexOf(this.selectedCircuit));
      this.navs.circuits.focus(idx, true);
      this.showCircuit(this.selectedCircuit);
    }
    if (view === 'session') {
      for (const r of this.sessionRows) r.refresh();
      this.refreshSummary();
      if (prev !== 'assists') this.navs.session.focus(this.sessionRows.length, true);
    }
    if (view === 'assists') for (const r of this.assistRows) r.refresh();
    if (view === 'main') this.ctx.emit({ type: 'set-menu-cinematic', enabled: true });
  }

  private updateCrumbs(): void {
    const c = this.crumbs;
    c.replaceChildren();
    const add = (t: string, on: boolean) => c.appendChild(span(`af-crumb${on ? ' on' : ''}`, t));
    if (this.view === 'main') {
      add('MAIN MENU', true);
      return;
    }
    if (this.view === 'settings') {
      add('MAIN MENU', false);
      add('SETTINGS', true);
      return;
    }
    if (this.view === 'controls') {
      add('MAIN MENU', false);
      add('CONTROLS', true);
      return;
    }
    add(MODE_INFO[this.mode].title, false);
    add('DRIVER', this.view === 'drivers');
    add('CIRCUIT', this.view === 'circuits');
    add('SETUP', this.view === 'session' || this.view === 'assists');
  }

  /** Reset to the root menu (main calls setPhase('menu') after quitting a session). */
  showRoot(): void {
    this.go('main');
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    // Main's showcase defaults to the first driver; make it match the remembered selection.
    this.lastPreview = this.selectedDriver.id;
    this.ctx.emit({ type: 'preview-driver', driverId: this.selectedDriver.id });
  }

  hide(): void {
    this.el.classList.add('hidden');
    clearTimeout(this.previewTimer);
  }

  private nav(): { move(dx: number, dy: number): void; confirm(): void; back(): void } {
    if (this.view === 'settings') return this.settings;
    return this.navs[this.view];
  }

  move(dx: number, dy: number): void {
    this.nav().move(dx, dy);
  }
  confirm(): void {
    this.nav().confirm();
  }
  back(): void {
    this.nav().back();
  }
}
