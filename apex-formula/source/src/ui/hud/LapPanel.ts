import { formatLapTime } from '../../core/math';
import type { CarState, RaceEntry, SectorStatus, World } from '../../core/types';
import { div, fmtDelta, setText, setToggle, span } from '../dom';

/** Live lap / last / best, sector boxes with purple-green-yellow status, delta to best, position badge. */
export class LapPanel {
  readonly el: HTMLElement;
  private readonly pos: HTMLElement;
  private readonly posChange: HTMLElement;
  private readonly cur: HTMLElement;
  private readonly last: HTMLElement;
  private readonly best: HTMLElement;
  private readonly sectors: { box: HTMLElement; time: HTMLElement }[] = [];
  private readonly deltaText: HTMLElement;
  private readonly deltaFill: HTMLElement;
  private readonly deltaWrap: HTMLElement;
  private lastPos = -1;
  private lastChange = -999;
  private lastLast = -1;
  private lastBest = -1;
  private lastCurCs = -1;
  private lastStatus: string[] = ['', '', ''];
  private lastSectorTimes: number[] = [-1, -1, -1];
  private slow = 0;
  private lastDeltaMs = NaN;

  constructor() {
    this.el = div('af-lap');
    const top = div('af-lap-top');
    const posBox = div('af-posbadge');
    this.pos = span('af-pos-v', 'P1');
    this.posChange = span('af-pos-change', '');
    posBox.append(this.pos, this.posChange);
    const times = div('af-lap-times');
    const row = (k: string, cls: string) => {
      const r = div('af-lap-row');
      const v = span(`af-lap-v ${cls}`, '--:--.---');
      r.append(span('af-lap-k', k), v);
      times.appendChild(r);
      return v;
    };
    this.cur = row('CURRENT', 'cur');
    this.last = row('LAST', 'last');
    this.best = row('BEST', 'best');
    top.append(posBox, times);

    const secs = div('af-sectors');
    for (let i = 0; i < 3; i++) {
      const box = div('af-sector');
      const t = span('af-sector-t', '--.---');
      box.append(span('af-sector-k', `S${i + 1}`), t);
      secs.appendChild(box);
      this.sectors.push({ box, time: t });
    }
    this.deltaWrap = div('af-delta');
    const track = div('af-delta-track');
    this.deltaFill = div('af-delta-fill');
    track.append(div('af-delta-centre'), this.deltaFill);
    this.deltaText = span('af-delta-v', '+0.000');
    this.deltaWrap.append(track, this.deltaText);
    this.el.append(top, secs, this.deltaWrap);
  }

  reset(): void {
    this.lastPos = -1;
    this.lastChange = -999;
    this.lastLast = -1;
    this.lastBest = -1;
    this.lastCurCs = -1;
    this.lastStatus = ['', '', ''];
    this.lastSectorTimes = [-1, -1, -1];
    this.lastDeltaMs = NaN;
  }

  update(world: World, car: CarState, e: RaceEntry | undefined, dt: number): void {
    if (!e) return;
    // Live lap (every frame; only when the hundredth changes)
    const cs = Math.floor(e.currentLapTime * 100);
    if (cs !== this.lastCurCs) {
      this.lastCurCs = cs;
      setText(this.cur, e.currentLapTime > 0 ? formatLapTime(e.currentLapTime) : '--:--.---');
    }
    // Delta vs best lap: completed sectors exactly, the live sector by distance fraction.
    if (e.bestLap > 0 && e.bestSectors[0] > 0) {
      const sec = Math.max(0, Math.min(2, car.track.sector));
      let delta = 0;
      let elapsedSectors = 0;
      let valid = true;
      for (let i = 0; i < sec; i++) {
        if (e.currentSectors[i] <= 0 || e.bestSectors[i] <= 0) valid = false;
        delta += e.currentSectors[i] - e.bestSectors[i];
        elapsedSectors += e.currentSectors[i];
      }
      const startS = sec === 0 ? 0 : world.track.sectorS[sec - 1];
      const endS = sec === 2 ? world.track.length : world.track.sectorS[sec];
      const frac = Math.max(0, Math.min(1, (car.track.s - startS) / Math.max(1, endS - startS)));
      const inSector = e.currentLapTime - elapsedSectors;
      delta += inSector - frac * e.bestSectors[sec];
      if (valid && e.currentLapTime > 0.5) {
        const ms = Math.round(delta * 100);
        if (ms !== this.lastDeltaMs) {
          this.lastDeltaMs = ms;
          setText(this.deltaText, fmtDelta(delta, 2));
          const f = Math.max(-1, Math.min(1, delta / 2));
          this.deltaFill.style.transform = `translateX(${(f * 50).toFixed(1)}%) scaleX(${Math.abs(f).toFixed(3)})`;
          setToggle(this.deltaWrap, 'ahead', delta < 0);
          setToggle(this.deltaWrap, 'behind', delta > 0);
        }
        setToggle(this.deltaWrap, 'off', false);
      } else setToggle(this.deltaWrap, 'off', true);
    } else setToggle(this.deltaWrap, 'off', true);

    this.slow += dt;
    if (this.slow < 0.1) return;
    this.slow = 0;
    if (e.position !== this.lastPos) {
      this.lastPos = e.position;
      setText(this.pos, `P${e.position}`);
    }
    const change = (e.gridPosition || e.position) - e.position;
    if (change !== this.lastChange) {
      this.lastChange = change;
      setText(this.posChange, change > 0 ? `▲${change}` : change < 0 ? `▼${-change}` : '');
      this.posChange.className = `af-pos-change ${change > 0 ? 'up' : change < 0 ? 'down' : ''}`.trim();
    }
    if (e.lastLap !== this.lastLast) {
      this.lastLast = e.lastLap;
      setText(this.last, formatLapTime(e.lastLap));
    }
    if (e.bestLap !== this.lastBest) {
      this.lastBest = e.bestLap;
      setText(this.best, formatLapTime(e.bestLap));
    }
    for (let i = 0; i < 3; i++) {
      const s = this.sectors[i];
      const t = e.currentSectors[i];
      const live = car.track.sector === i;
      if (t !== this.lastSectorTimes[i]) {
        this.lastSectorTimes[i] = t;
        setText(s.time, t > 0 ? t.toFixed(3) : live ? '' : '--.---');
      }
      const st: SectorStatus | 'live' = t > 0 ? e.currentSectorStatus[i] : live ? 'live' : 'none';
      if (st !== this.lastStatus[i]) {
        this.lastStatus[i] = st;
        s.box.className = `af-sector ${st}`;
      }
    }
  }
}
