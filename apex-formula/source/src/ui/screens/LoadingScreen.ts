import type { TrackDefinition } from '../../core/types';
import type { Screen, UIContext } from '../context';
import { div, setText, span } from '../dom';
import { buildTrackMap } from '../trackMap';

const GENERIC_TIPS = [
  'DRS is only available after lap 3, within one second of the car ahead, and only in the dry.',
  'Tyre temperature matters: cold tyres slide, overheated tyres wear. Aim for the green window.',
  'ERS OVERTAKE (hold R) dumps battery for a burst of power — HARVEST recharges it under braking.',
  'Three track-limits warnings earn a 5-second time penalty. Keep two wheels inside the white line.',
  'Blue flags mean a faster car is lapping you — let it through or expect a penalty.',
  'The pit-lane speed limit is 80 km/h. The limiter (L) engages it for you.',
  'A purple sector is the fastest anyone has driven it this session. Green is your personal best.',
  'Soft tyres grip hardest but wear fastest; hards go the distance. Inters and wets for the rain.',
  'Open the MFD with TAB to plan a pit stop, switch ERS modes or toggle assists mid-race.',
  'Press I at any time for an instant replay of the last 90 seconds.',
  'Slipstream: tuck in behind a rival on the straight to gain top speed, then pull out to pass.',
];

export class LoadingScreen implements Screen {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly gp: HTMLElement;
  private readonly loc: HTMLElement;
  private readonly mapWrap: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly label: HTMLElement;
  private readonly percent: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly facts: HTMLElement;
  private tips: string[] = GENERIC_TIPS;
  private tipIndex = 0;
  private tipTimer = 0;
  private lastPct = -1;
  private circuitId = '';

  constructor(private readonly ctx: UIContext) {
    this.el = div('af-screen af-loading hidden');
    this.el.appendChild(div('af-loading-bg'));
    const inner = div('af-loading-inner');
    const left = div('af-loading-left');
    const kicker = div('af-loading-kicker', 'LOADING CIRCUIT');
    this.title = div('af-loading-title', '');
    this.gp = div('af-loading-gp', '');
    this.loc = div('af-loading-loc', '');
    this.facts = div('af-loading-facts');
    const barWrap = div('af-loading-bar');
    this.barFill = div('af-loading-fill');
    barWrap.appendChild(this.barFill);
    const meta = div('af-loading-meta');
    this.label = span('af-loading-label', 'Preparing');
    this.percent = span('af-loading-pct', '0%');
    meta.append(this.label, this.percent);
    this.tip = div('af-loading-tip', '');
    left.append(kicker, this.title, this.gp, this.loc, this.facts, barWrap, meta, this.tip);
    this.mapWrap = div('af-loading-map');
    inner.append(left, this.mapWrap);
    this.el.appendChild(inner);
    this.el.appendChild(div('af-loading-foot', 'APEX FORMULA · EVERYTHING YOU SEE IS GENERATED IN REAL TIME'));
  }

  setCircuit(def: TrackDefinition | null): void {
    if (!def) return;
    if (def.id === this.circuitId) return;
    this.circuitId = def.id;
    const spline = this.ctx.spline(def);
    setText(this.title, def.name.toUpperCase());
    setText(this.gp, def.grandPrixName.toUpperCase());
    setText(this.loc, `${def.location} · ${def.country}`);
    this.mapWrap.replaceChildren(buildTrackMap(spline, { stroke: 5, sectors: true, drs: true, pit: true, corners: true, glow: true, draw: true }).svg);
    this.facts.replaceChildren();
    const fact = (k: string, v: string) => {
      const f = div('af-lfact');
      f.append(div('af-lfact-v', v), div('af-lfact-k', k));
      this.facts.appendChild(f);
    };
    fact('LENGTH', `${(spline.length / 1000).toFixed(3)} km`);
    fact('CORNERS', String(def.corners.length));
    fact('DRS ZONES', String(def.drsZones.length));
    const m = Math.floor(def.referenceLapTime / 60);
    fact('REFERENCE LAP', `${m}:${(def.referenceLapTime - m * 60).toFixed(1).padStart(4, '0')}`);
    const named = def.corners.filter((c) => c.name).map((c) => c.name as string);
    const uniq = [...new Set(named)];
    this.tips = [
      def.description,
      ...(uniq.length ? [`Corners to learn: ${uniq.join(', ')}.`] : []),
      `${def.environment.vibe.charAt(0).toUpperCase()}${def.environment.vibe.slice(1)}.`,
      ...GENERIC_TIPS,
    ];
    this.tipIndex = 0;
  }

  setProgress(p: number, label: string): void {
    const pctV = Math.round(Math.max(0, Math.min(1, p)) * 100);
    if (pctV !== this.lastPct) {
      this.lastPct = pctV;
      this.barFill.style.transform = `scaleX(${(pctV / 100).toFixed(3)})`;
      setText(this.percent, `${pctV}%`);
    }
    setText(this.label, label.toUpperCase());
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    this.lastPct = -1;
    this.setProgress(0, 'Preparing circuit');
    this.rotateTip();
    clearInterval(this.tipTimer);
    this.tipTimer = window.setInterval(() => this.rotateTip(), 4200);
  }

  private rotateTip(): void {
    const t = this.tips[this.tipIndex % this.tips.length] ?? '';
    this.tipIndex++;
    this.tip.classList.remove('in');
    void this.tip.offsetWidth;
    setText(this.tip, t);
    this.tip.classList.add('in');
  }

  hide(): void {
    this.el.classList.add('hidden');
    clearInterval(this.tipTimer);
  }

  move(): void {}
  confirm(): void {}
  back(): void {}
}
