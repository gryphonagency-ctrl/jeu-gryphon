import { QUALITY_LEVELS } from '../../core/constants';
import type { UIContext } from '../context';
import { hintRow } from '../context';
import { div } from '../dom';
import { Navigator } from '../nav';
import { CAMERA_MODES } from '../storage';
import { buildAssistRows, buildButton, buildRow, cycle, sectionHeader, stepClamp, type Row } from '../widgets';

export const CAMERA_LABELS: Record<string, string> = {
  chase: 'CHASE',
  'chase-far': 'CHASE FAR',
  tcam: 'T-CAM',
  cockpit: 'COCKPIT',
  nose: 'NOSE',
  tv: 'TV',
  helicopter: 'HELICOPTER',
};

/**
 * Graphics / audio / camera / assists settings. Shared by the main menu and the pause menu.
 * Every change is applied immediately (UICommand) and persisted.
 */
export class SettingsPanel {
  readonly el: HTMLElement;
  readonly nav: Navigator;
  private readonly mainEl: HTMLElement;
  private readonly assistsEl: HTMLElement;
  private view: 'main' | 'assists' = 'main';
  private rows: Row[] = [];
  private assistRows: Row[] = [];
  private onExit: () => void;

  constructor(
    private readonly ctx: UIContext,
    onExit: () => void,
    private readonly inRace = false,
  ) {
    this.onExit = onExit;
    this.nav = new Navigator(ctx.sound);
    this.el = div('af-settings');
    this.mainEl = div('af-settings-main');
    this.assistsEl = div('af-settings-assists hidden');
    this.el.append(this.mainEl, this.assistsEl);
    this.buildMain();
    this.buildAssists();
  }

  private buildMain(): void {
    const s = this.ctx.settings;
    const save = () => this.ctx.saveSettings();
    const m = this.mainEl;
    m.appendChild(sectionHeader('SETTINGS', 'OPTIONS', 'Applied instantly · saved automatically'));
    const list = div('af-rows');
    const rows: Row[] = [];
    rows.push(
      buildRow(
        {
          label: 'GRAPHICS QUALITY',
          kind: 'select',
          value: () => s.quality.toUpperCase(),
          adjust: (d) => {
            s.quality = cycle(QUALITY_LEVELS, s.quality, d);
            this.ctx.emit({ type: 'set-quality', quality: s.quality });
          },
          hint: 'Resolution scale, shadows, post-processing and particle budget.',
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'MASTER VOLUME',
          kind: 'slider',
          value: () => `${Math.round(s.masterVolume * 100)}`,
          fill: () => s.masterVolume,
          adjust: (d) => {
            s.masterVolume = stepClamp(s.masterVolume, d, 0.05, 0, 1);
            this.ctx.emit({ type: 'set-audio', volume: s.masterVolume });
          },
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'MUTE',
          kind: 'toggle',
          value: () => (s.muted ? 'ON' : 'OFF'),
          adjust: () => {
            s.muted = !s.muted;
            this.ctx.emit({ type: 'set-audio', muted: s.muted });
          },
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'CAMERA',
          kind: 'select',
          value: () => CAMERA_LABELS[s.cameraMode] ?? s.cameraMode.toUpperCase(),
          adjust: (d) => {
            s.cameraMode = cycle(CAMERA_MODES, s.cameraMode, d);
            this.ctx.emit({ type: 'set-camera', mode: s.cameraMode });
          },
          hint: 'Default driving camera. Cycle in-race with C / RB.',
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'FIELD OF VIEW',
          kind: 'slider',
          value: () => `${Math.round(s.fov)}°`,
          fill: () => (s.fov - 40) / 70,
          adjust: (d) => {
            s.fov = stepClamp(s.fov, d, 2, 40, 110);
            this.ctx.emit({ type: 'set-fov', fov: s.fov });
          },
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'DEFAULT AI DIFFICULTY',
          kind: 'slider',
          value: () => `${Math.round(s.aiDifficulty * 100)}%`,
          fill: () => s.aiDifficulty,
          adjust: (d) => (s.aiDifficulty = stepClamp(s.aiDifficulty, d, 0.05, 0, 1)),
          hint: 'Pre-fills the difficulty slider in race setup.',
        },
        save,
      ),
    );
    rows.push(
      buildRow(
        {
          label: 'TELEMETRY OVERLAY',
          kind: 'toggle',
          value: () => (s.showTelemetry ? 'ON' : 'OFF'),
          adjust: () => (s.showTelemetry = !s.showTelemetry),
          hint: 'FPS, frame time, draw calls and triangles.',
        },
        save,
      ),
    );
    rows.push(
      buildRow({
        label: 'DRIVING ASSISTS',
        kind: 'link',
        value: () => '',
        confirm: () => this.showAssists(),
      }),
    );
    for (const r of rows) list.appendChild(r.el);
    m.appendChild(list);
    const back = buildButton('BACK', () => this.exit(), 'af-btn-ghost');
    const foot = div('af-settings-foot');
    foot.appendChild(back.el);
    m.appendChild(foot);
    m.appendChild(hintRow([{ key: 'nav', label: 'SELECT' }, { key: 'side', label: 'CHANGE' }, { key: 'back', label: 'BACK' }]));
    this.rows = rows;
    this.rows.push({ el: back.el, spec: { label: 'BACK', value: () => '' }, refresh: () => {}, item: back });
  }

  private buildAssists(): void {
    const a = this.assistsEl;
    a.appendChild(sectionHeader('ASSISTS', 'DRIVING ASSISTS', this.inRace ? 'Applied to your car immediately' : 'Used for every session'));
    const list = div('af-rows');
    this.assistRows = buildAssistRows(this.ctx.settings.assists, () => {
      this.ctx.saveSettings();
      this.ctx.emit({ type: 'set-assists', assists: { ...this.ctx.settings.assists } });
    });
    for (const r of this.assistRows) list.appendChild(r.el);
    a.appendChild(list);
    const back = buildButton('BACK', () => this.showMain(), 'af-btn-ghost');
    const foot = div('af-settings-foot');
    foot.appendChild(back.el);
    a.appendChild(foot);
    this.assistRows.push({ el: back.el, spec: { label: 'BACK', value: () => '' }, refresh: () => {}, item: back });
  }

  open(): void {
    this.showMain();
  }

  private showMain(): void {
    this.view = 'main';
    this.mainEl.classList.remove('hidden');
    this.assistsEl.classList.add('hidden');
    for (const r of this.rows) r.refresh();
    this.nav.setItems(
      this.rows.map((r) => r.item),
      0,
    );
    this.nav.onBack = () => this.exit();
  }

  private showAssists(): void {
    this.view = 'assists';
    this.mainEl.classList.add('hidden');
    this.assistsEl.classList.remove('hidden');
    for (const r of this.assistRows) r.refresh();
    this.nav.setItems(
      this.assistRows.map((r) => r.item),
      0,
    );
    this.nav.onBack = () => this.showMain();
  }

  private exit(): void {
    this.onExit();
  }

  move(dx: number, dy: number): void {
    this.nav.move(dx, dy);
  }
  confirm(): void {
    this.nav.confirm();
  }
  back(): void {
    if (this.view === 'assists') {
      this.ctx.sound('back');
      this.showMain();
    } else {
      this.ctx.sound('back');
      this.exit();
    }
  }
}
