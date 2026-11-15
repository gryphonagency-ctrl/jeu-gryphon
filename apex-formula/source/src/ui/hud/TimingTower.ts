import { TYRE_DATA } from '../../core/constants';
import { formatGap } from '../../core/math';
import type { RaceEntry, World } from '../../core/types';
import { div, setText, setToggle, span } from '../dom';

interface TowerRow {
  el: HTMLElement;
  pos: HTMLElement;
  bar: HTMLElement;
  code: HTMLElement;
  gap: HTMLElement;
  tyre: HTMLElement;
  age: HTMLElement;
  tag: HTMLElement;
  arrow: HTMLElement;
  fl: HTMLElement;
  displayIndex: number;
  lastTyre: string;
  arrowUntil: number;
}

const ROW_LIMIT_FRACTION = 0.64;

/** F1-TV style timing tower: one absolutely positioned row per car, animated to its position. */
export class TimingTower {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly modeBtn: HTMLElement;
  private readonly divider: HTMLElement;
  private readonly sessionLabel: HTMLElement;
  private rows: TowerRow[] = [];
  private mode: 'interval' | 'gap' = 'interval';
  private acc = 0;
  private maxRows = 20;
  private lastTotal = -1;
  private now = 0;
  private world: World | null = null;

  constructor() {
    this.el = div('af-tower');
    const head = div('af-tower-head');
    this.sessionLabel = span('af-tower-session', 'RACE');
    this.modeBtn = span('af-tower-mode', 'INTERVAL');
    head.append(this.sessionLabel, this.modeBtn);
    this.el.appendChild(head);
    this.list = div('af-tower-list');
    this.el.appendChild(this.list);
    this.divider = div('af-tower-divider hidden');
    this.list.appendChild(this.divider);
    this.modeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.mode = this.mode === 'interval' ? 'gap' : 'interval';
      setText(this.modeBtn, this.mode === 'interval' ? 'INTERVAL' : 'GAP');
      this.acc = 1;
    });
    this.onResize();
  }

  onResize(): void {
    const h = window.innerHeight;
    const rowPx = Math.min(34, Math.max(18, h * 0.026));
    this.maxRows = Math.max(6, Math.floor((h * ROW_LIMIT_FRACTION - 40) / rowPx));
  }

  bind(world: World): void {
    this.world = world;
    for (const r of this.rows) r.el.remove();
    this.rows = [];
    setText(this.sessionLabel, world.race.sessionType === 'race' ? 'RACE' : world.race.sessionType === 'qualifying' ? (world.config.mode === 'time-trial' ? 'TIME TRIAL' : 'QUALIFYING') : 'PRACTICE');
    const n = world.cars.length;
    for (let i = 0; i < n; i++) {
      const car = world.cars[i];
      const team = world.teamById[car.teamId];
      const driver = world.driverById[car.driverId];
      const el = div(`af-trow${car.isPlayer ? ' player' : ''}`);
      el.style.setProperty('--team', team?.primaryColor ?? '#888');
      const pos = span('af-tpos', String(i + 1));
      const bar = span('af-tbar');
      const code = span('af-tcode', driver?.code ?? '???');
      const gap = span('af-tgap', '');
      const tyre = span('af-ttyre', 'M');
      const age = span('af-tage', '');
      const tag = span('af-ttag', '');
      const fl = span('af-tfl');
      const arrow = span('af-tarrow', '');
      el.append(pos, bar, code, gap, fl, tyre, age, tag, arrow);
      this.list.appendChild(el);
      this.rows.push({ el, pos, bar, code, gap, tyre, age, tag, arrow, fl, displayIndex: -1, lastTyre: '', arrowUntil: 0 });
    }
    this.acc = 1;
    this.now = 0;
    this.lastTotal = -1;
  }

  /** ▲/▼ flash on a row for 3 s. */
  positionChange(carId: number, from: number, to: number): void {
    const r = this.rows[carId];
    if (!r || from === to) return;
    const up = to < from;
    setText(r.arrow, up ? '▲' : '▼');
    r.arrow.classList.remove('up', 'down');
    r.arrow.classList.add(up ? 'up' : 'down');
    r.el.classList.remove('flash-up', 'flash-down');
    void r.el.offsetWidth;
    r.el.classList.add(up ? 'flash-up' : 'flash-down');
    r.arrowUntil = this.now + 3;
  }

  update(world: World, dt: number): void {
    if (world !== this.world) this.bind(world);
    this.now += dt;
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const race = world.race;
    const entries = race.entries;
    const n = entries.length;
    const playerEntry = race.entryByCar[world.playerCarId];
    const playerPos = playerEntry?.position ?? 1;
    const compact = n > this.maxRows;

    // Which positions are visible in compact mode: top 3 + a window around the player.
    let winLo = 0;
    let winHi = 0;
    if (compact) {
      const around = Math.max(1, Math.floor((this.maxRows - 4) / 2));
      winLo = Math.max(4, playerPos - around);
      winHi = Math.min(n, winLo + around * 2);
      winLo = Math.max(4, winHi - around * 2);
    }
    let dividerIdx = -1;

    for (let i = 0; i < n; i++) {
      const e = entries[i];
      const r = this.rows[e.carId];
      if (!r) continue;
      let idx: number;
      let visible = true;
      if (!compact) idx = i;
      else if (e.position <= 3) idx = e.position - 1;
      else if (e.position >= winLo && e.position <= winHi) {
        idx = 3 + (winLo > 4 ? 1 : 0) + (e.position - winLo);
        if (winLo > 4) dividerIdx = 3;
      } else {
        idx = 0;
        visible = false;
      }
      setToggle(r.el, 'hidden', !visible);
      if (visible && idx !== r.displayIndex) {
        r.displayIndex = idx;
        r.el.style.transform = `translateY(calc(var(--row) * ${idx}))`;
      }
      if (!visible) continue;
      this.updateRow(r, e, race.fastestLap?.carId === e.carId, i === 0);
    }
    setToggle(this.divider, 'hidden', dividerIdx < 0);
    if (dividerIdx >= 0) this.divider.style.transform = `translateY(calc(var(--row) * ${dividerIdx}))`;
    const total = compact ? Math.min(n, this.maxRows) + (dividerIdx >= 0 ? 1 : 0) : n;
    if (total !== this.lastTotal) {
      this.lastTotal = total;
      this.list.style.height = `calc(var(--row) * ${total})`;
    }
  }

  private updateRow(r: TowerRow, e: RaceEntry, fastest: boolean, leader: boolean): void {
    setText(r.pos, String(e.position));
    const out = e.status === 'retired' || e.status === 'dnf' || e.status === 'dsq';
    let gap: string;
    if (out) gap = e.status === 'dsq' ? 'DSQ' : e.status === 'dnf' ? 'DNF' : 'RET';
    else if (leader) gap = this.world?.race.sessionType === 'race' ? 'LEADER' : e.bestLap > 0 ? fmtBest(e.bestLap) : 'LEADER';
    else if (this.world?.race.sessionType !== 'race') gap = e.bestLap > 0 ? formatGapTo(e, this.world!.race.entries[0]) : 'NO TIME';
    else if (e.lapsBehind > 0 && this.mode === 'gap') gap = formatGap(e.gapToLeader, e.lapsBehind);
    else gap = formatGap(this.mode === 'interval' ? e.interval : e.gapToLeader, this.mode === 'gap' ? e.lapsBehind : 0);
    setText(r.gap, gap);
    setToggle(r.el, 'out', out);
    setToggle(r.el, 'finished', e.status === 'finished');
    setToggle(r.el, 'blue', e.blueFlag);

    const td = TYRE_DATA[e.tyreCompound];
    if (r.lastTyre !== e.tyreCompound) {
      r.lastTyre = e.tyreCompound;
      setText(r.tyre, td.short);
      r.tyre.style.setProperty('--tyre', td.color);
    }
    setText(r.age, String(e.tyreAge));

    let tag = '';
    let tagCls = '';
    if (out) {
      tag = '';
    } else if (e.pitPhase === 'in-lane' || e.pitPhase === 'stopped' || e.pitPhase === 'released') {
      tag = 'IN PIT';
      tagCls = 'pit';
    } else if (e.pitPhase === 'exiting') {
      tag = 'OUT';
      tagCls = 'pit';
    } else if (e.pitPhase === 'requested' || e.pitPhase === 'entering') {
      tag = 'PIT';
      tagCls = 'pit-req';
    } else if (e.drsOpen) {
      tag = 'DRS';
      tagCls = 'drs-open';
    } else if (e.drsAvailable) {
      tag = 'DRS';
      tagCls = 'drs';
    } else if (e.penaltySeconds > 0) {
      tag = `+${e.penaltySeconds}s`;
      tagCls = 'pen';
    }
    setText(r.tag, tag);
    if (r.tag.dataset.cls !== tagCls) {
      r.tag.dataset.cls = tagCls;
      r.tag.className = `af-ttag ${tagCls}`.trim();
    }
    setToggle(r.fl, 'on', fastest);
    if (r.arrowUntil > 0 && this.now > r.arrowUntil) {
      r.arrowUntil = 0;
      setText(r.arrow, '');
      r.arrow.classList.remove('up', 'down');
    }
  }
}

const fmtBest = (t: number): string => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

const formatGapTo = (e: RaceEntry, leader: RaceEntry): string => {
  if (!leader || leader.bestLap <= 0 || e.bestLap <= 0) return '--';
  return formatGap(e.bestLap - leader.bestLap);
};
