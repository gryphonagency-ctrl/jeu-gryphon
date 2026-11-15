import type { Assists } from '../core/types';
import { div, setText, setToggle, span } from './dom';
import type { NavItem } from './nav';

export interface RowSpec {
  label: string;
  /** Current display value. */
  value: () => string;
  /** Slider fill 0..1 (renders a bar). */
  fill?: () => number;
  adjust?: (dir: -1 | 1) => void;
  confirm?: () => void;
  hint?: string;
  kind?: 'select' | 'slider' | 'toggle' | 'button' | 'link';
  /** Swatch colour shown next to the value (tyre compounds). */
  swatch?: () => string | null;
  disabled?: () => boolean;
}

export interface Row {
  el: HTMLElement;
  spec: RowSpec;
  refresh(): void;
  item: NavItem;
}

/** A settings-style row: LABEL ........ ◂ VALUE ▸ with optional slider bar. */
export function buildRow(spec: RowSpec, onChange?: () => void): Row {
  const kind = spec.kind ?? (spec.adjust ? (spec.fill ? 'slider' : 'select') : 'button');
  const e = div(`af-row af-row-${kind}`);
  const label = div('af-row-label', spec.label);
  e.appendChild(label);
  let valueEl: HTMLElement | null = null;
  let fillEl: HTMLElement | null = null;
  let swatchEl: HTMLElement | null = null;
  if (kind !== 'button' && kind !== 'link') {
    const right = div('af-row-right');
    if (spec.fill) {
      const bar = div('af-bar');
      fillEl = div('af-bar-fill');
      bar.appendChild(fillEl);
      right.appendChild(bar);
    }
    const val = div('af-row-value');
    const l = span('af-arrow af-arrow-l', '◂');
    const r = span('af-arrow af-arrow-r', '▸');
    if (spec.swatch) {
      swatchEl = span('af-swatch');
      val.appendChild(swatchEl);
    }
    valueEl = span('af-row-val', spec.value());
    val.append(l, valueEl, r);
    right.appendChild(val);
    e.appendChild(right);
    l.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (spec.adjust && !spec.disabled?.()) {
        spec.adjust(-1);
        refresh();
        onChange?.();
      }
    });
    r.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (spec.adjust && !spec.disabled?.()) {
        spec.adjust(1);
        refresh();
        onChange?.();
      }
    });
  } else if (kind === 'link') {
    e.appendChild(span('af-row-chev', '›'));
  }
  // Always present so rows keep a uniform height whether or not they carry a hint.
  e.appendChild(div('af-row-hint', spec.hint ?? ''));

  const refresh = (): void => {
    if (valueEl) setText(valueEl, spec.value());
    if (fillEl && spec.fill) {
      const f = Math.max(0, Math.min(1, spec.fill()));
      fillEl.style.transform = `scaleX(${f.toFixed(3)})`;
    }
    if (swatchEl && spec.swatch) {
      const c = spec.swatch();
      swatchEl.style.background = c ?? 'transparent';
      swatchEl.style.display = c ? '' : 'none';
    }
    const dis = !!spec.disabled?.();
    setToggle(e, 'disabled', dis);
    item.disabled = dis;
  };

  const item: NavItem = {
    el: e,
    onConfirm: spec.confirm
      ? () => {
          spec.confirm?.();
          refresh();
          onChange?.();
        }
      : spec.adjust && kind === 'toggle'
        ? () => {
            spec.adjust?.(1);
            refresh();
            onChange?.();
          }
        : undefined,
    onAdjust: spec.adjust
      ? (dir) => {
          spec.adjust?.(dir);
          refresh();
          onChange?.();
        }
      : undefined,
  };
  refresh();
  return { el: e, spec, refresh, item };
}

export function buildButton(label: string, onConfirm: () => void, cls = ''): NavItem {
  const e = div(`af-btn ${cls}`.trim());
  e.appendChild(span('af-btn-label', label));
  return { el: e, onConfirm };
}

export const cycle = <T>(list: readonly T[], cur: T, dir: number): T => {
  const i = list.indexOf(cur);
  const n = list.length;
  return list[(((i < 0 ? 0 : i) + dir) % n + n) % n];
};

export const stepClamp = (v: number, dir: number, step: number, lo: number, hi: number): number => {
  const nv = Math.round((v + dir * step) / step) * step;
  return Math.min(hi, Math.max(lo, +nv.toFixed(6)));
};

const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');

export const ASSIST_LABELS: Record<keyof Assists, string> = {
  tractionControl: 'TRACTION CONTROL',
  abs: 'ANTI-LOCK BRAKES',
  autoGears: 'AUTOMATIC GEARBOX',
  steeringAssist: 'STEERING ASSIST',
  brakingAssist: 'BRAKING ASSIST',
  racingLine: 'RACING LINE',
  pitAssist: 'PIT ASSIST',
  ersAssist: 'ERS ASSIST',
  drsAssist: 'DRS ASSIST',
};

const ASSIST_HINTS: Record<keyof Assists, string> = {
  tractionControl: 'Limits wheelspin on throttle. Full is safest, off is fastest.',
  abs: 'Prevents brake lock-ups under heavy braking.',
  autoGears: 'Gearbox shifts for you. Off = manual with E / Q.',
  steeringAssist: 'Speed-sensitive steering with counter-steer help.',
  brakingAssist: 'Brakes for you into corners. Heavy assist.',
  racingLine: 'Ribbon showing the ideal line and braking zones.',
  pitAssist: 'Auto pit-limiter and auto-drive through the pit lane.',
  ersAssist: 'Energy deployment managed automatically.',
  drsAssist: 'Rear wing opens automatically when DRS is available.',
};

/** Rows editing an Assists object in place. */
export function buildAssistRows(a: Assists, onChange: () => void): Row[] {
  const rows: Row[] = [];
  const upd = () => onChange();
  rows.push(
    buildRow(
      {
        label: ASSIST_LABELS.tractionControl,
        kind: 'select',
        value: () => a.tractionControl.toUpperCase(),
        adjust: (d) => (a.tractionControl = cycle(['off', 'medium', 'full'] as const, a.tractionControl, d)),
        hint: ASSIST_HINTS.tractionControl,
      },
      upd,
    ),
  );
  const toggles: (keyof Assists)[] = ['abs', 'autoGears', 'steeringAssist', 'brakingAssist'];
  for (const k of toggles) {
    rows.push(
      buildRow(
        {
          label: ASSIST_LABELS[k],
          kind: 'toggle',
          value: () => onOff(a[k] as boolean),
          adjust: () => ((a as unknown as Record<string, boolean>)[k] = !(a as unknown as Record<string, boolean>)[k]),
          hint: ASSIST_HINTS[k],
        },
        upd,
      ),
    );
  }
  rows.push(
    buildRow(
      {
        label: ASSIST_LABELS.racingLine,
        kind: 'select',
        value: () => a.racingLine.toUpperCase(),
        adjust: (d) => (a.racingLine = cycle(['off', 'corners', 'full'] as const, a.racingLine, d)),
        hint: ASSIST_HINTS.racingLine,
      },
      upd,
    ),
  );
  const toggles2: (keyof Assists)[] = ['pitAssist', 'ersAssist', 'drsAssist'];
  for (const k of toggles2) {
    rows.push(
      buildRow(
        {
          label: ASSIST_LABELS[k],
          kind: 'toggle',
          value: () => onOff(a[k] as boolean),
          adjust: () => ((a as unknown as Record<string, boolean>)[k] = !(a as unknown as Record<string, boolean>)[k]),
          hint: ASSIST_HINTS[k],
        },
        upd,
      ),
    );
  }
  return rows;
}

/** Skewed section header: "01 / DRIVER". */
export function sectionHeader(index: string, title: string, sub?: string): HTMLElement {
  const h = div('af-sec');
  h.appendChild(span('af-sec-idx', index));
  h.appendChild(span('af-sec-title', title));
  if (sub) h.appendChild(span('af-sec-sub', sub));
  return h;
}
