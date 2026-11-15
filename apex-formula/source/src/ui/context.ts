import type { TrackSpline } from '../core/track/TrackSpline';
import type { DriverDef, GameSettings, RaceControlMessage, TeamDef, TrackDefinition, UICommand, UISound } from '../core/types';
import type { LastConfig } from './storage';

/** Shared services every screen/widget gets. Owned by UISystem. */
export interface UIContext {
  emit(cmd: UICommand): void;
  sound(s: UISound): void;
  notify(text: string, kind?: RaceControlMessage['kind'], seconds?: number): void;
  settings: GameSettings;
  last: LastConfig;
  saveSettings(): void;
  saveLast(): void;
  teams: TeamDef[];
  drivers: DriverDef[];
  circuits: TrackDefinition[];
  teamById: Record<string, TeamDef>;
  driverById: Record<string, DriverDef>;
  spline(def: TrackDefinition): TrackSpline;
  gamepad: boolean;
}

export interface Screen {
  readonly el: HTMLElement;
  show(): void;
  hide(): void;
  /** Directional nav from keyboard/gamepad. */
  move(dx: number, dy: number): void;
  confirm(): void;
  back(): void;
}

export const SKILL_KEYS: (keyof DriverDef['skill'])[] = ['pace', 'consistency', 'racecraft', 'aggression', 'wet', 'defending'];

/** Renders a hint row: [glyph] LABEL pairs. Glyphs swap for gamepad via `data-g`. */
export function hintRow(items: { key: 'confirm' | 'back' | 'nav' | 'side' | 'start' | 'pause' | 'mfd'; label: string }[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'af-hints';
  for (const it of items) {
    const h = document.createElement('span');
    h.className = 'af-hint';
    const g = document.createElement('span');
    g.className = 'af-key';
    g.dataset.g = it.key;
    g.textContent = HINT_GLYPHS.keyboard[it.key];
    h.appendChild(g);
    h.appendChild(document.createTextNode(it.label));
    row.appendChild(h);
  }
  return row;
}

export const HINT_GLYPHS = {
  keyboard: { confirm: 'ENTER', back: 'ESC', nav: '↑↓', side: '←→', start: 'ENTER', pause: 'ESC', mfd: 'TAB' },
  gamepad: { confirm: 'A', back: 'B', nav: '⇅', side: '⇆', start: 'A', pause: 'START', mfd: 'D-PAD' },
} as const;

export function applyHintGlyphs(root: HTMLElement, gamepad: boolean): void {
  const set = gamepad ? HINT_GLYPHS.gamepad : HINT_GLYPHS.keyboard;
  root.querySelectorAll<HTMLElement>('.af-key[data-g]').forEach((k) => {
    const g = k.dataset.g as keyof typeof set;
    if (set[g]) k.textContent = set[g];
  });
}

export const COUNTRY_NAMES: Record<string, string> = {
  GB: 'United Kingdom',
  NL: 'Netherlands',
  MX: 'Mexico',
  BR: 'Brazil',
  IT: 'Italy',
  ES: 'Spain',
  JP: 'Japan',
  DE: 'Germany',
  IE: 'Ireland',
  FR: 'France',
  AR: 'Argentina',
  US: 'United States',
  SE: 'Sweden',
  CN: 'China',
  AT: 'Austria',
  CH: 'Switzerland',
  AU: 'Australia',
  MC: 'Monaco',
  AE: 'UAE',
  SG: 'Singapore',
  BH: 'Bahrain',
  CA: 'Canada',
  BE: 'Belgium',
  PT: 'Portugal',
  SA: 'Saudi Arabia',
  QA: 'Qatar',
  HU: 'Hungary',
  AZ: 'Azerbaijan',
};
