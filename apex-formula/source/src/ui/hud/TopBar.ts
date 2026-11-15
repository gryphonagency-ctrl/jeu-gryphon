import type { FlagType, RaceEntry, World } from '../../core/types';
import { div, fmtClock, setText, setToggle, span } from '../dom';

interface Banner {
  key: string;
  cls: string;
  text: string;
  sub?: string;
}

/** Lap counter / session clock, flag banner strip and the start-light gantry. */
export class TopBar {
  readonly el: HTMLElement;
  readonly lights: HTMLElement;
  readonly banner: HTMLElement;
  private readonly lapBox: HTMLElement;
  private readonly lapV: HTMLElement;
  private readonly lapK: HTMLElement;
  private readonly bannerText: HTMLElement;
  private readonly bannerSub: HTMLElement;
  private readonly lightEls: HTMLElement[] = [];
  private lastLap = '';
  private lastLapK = '';
  private lastBanner = '';
  private lastLit = -1;
  private greenUntil = 0;
  private now = 0;
  private lightsVisible = false;
  private override: Banner | null = null;
  private overrideUntil = 0;

  constructor() {
    this.el = div('af-top');
    this.lapBox = div('af-lapbox');
    this.lapK = span('af-lapbox-k', 'LAP');
    this.lapV = span('af-lapbox-v', '1 / 10');
    this.lapBox.append(this.lapK, this.lapV);
    this.banner = div('af-banner hidden');
    this.bannerText = span('af-banner-text', '');
    this.bannerSub = span('af-banner-sub', '');
    this.banner.append(this.bannerText, this.bannerSub);
    this.lights = div('af-lights hidden');
    for (let c = 0; c < 5; c++) {
      const col = div('af-light-col');
      for (let r = 0; r < 2; r++) {
        const l = div('af-light');
        col.appendChild(l);
      }
      this.lightEls.push(col);
      this.lights.appendChild(col);
    }
    this.el.append(this.lapBox, this.lights, this.banner);
  }

  reset(): void {
    this.lastLap = '';
    this.lastBanner = '';
    this.lastLit = -1;
    this.greenUntil = 0;
    this.override = null;
    this.setLights(false);
  }

  /** race:lights payload. */
  onLights(lightsOn: number): void {
    if (lightsOn === 0) {
      this.greenUntil = this.now + 2.2;
      this.lights.classList.add('go');
    } else {
      this.lights.classList.remove('go');
    }
  }

  /** Temporary full-width banner (e.g. chequered flag with position). */
  showBanner(key: string, cls: string, text: string, sub: string, seconds: number): void {
    this.override = { key, cls, text, sub };
    this.overrideUntil = this.now + seconds;
    this.lastBanner = '';
  }

  private setLights(visible: boolean): void {
    if (visible === this.lightsVisible) return;
    this.lightsVisible = visible;
    setToggle(this.lights, 'hidden', !visible);
    if (!visible) this.lights.classList.remove('go');
  }

  update(world: World, entry: RaceEntry | undefined, dt: number): void {
    this.now += dt;
    const race = world.race;

    // Lap counter / clock
    let k: string;
    let v: string;
    if (race.sessionType === 'race') {
      k = 'LAP';
      const lap = Math.max(1, Math.min(race.totalLaps, entry?.lap ?? race.leaderLap));
      v = `${lap} / ${race.totalLaps}`;
    } else if (race.timeRemaining < 0) {
      k = 'TIME';
      v = fmtClock(race.time);
    } else {
      k = 'REMAINING';
      v = fmtClock(race.timeRemaining);
    }
    if (v !== this.lastLap) {
      this.lastLap = v;
      setText(this.lapV, v);
    }
    if (k !== this.lastLapK) {
      this.lastLapK = k;
      setText(this.lapK, k);
    }

    // Start lights
    const phase = race.phase;
    const showLights = phase === 'formation' || phase === 'lights' || (phase === 'green' && this.now < this.greenUntil) || (this.greenUntil > this.now && phase === 'racing');
    this.setLights(showLights);
    if (showLights) {
      const lit = phase === 'lights' ? race.lightsOn : 0;
      if (lit !== this.lastLit) {
        this.lastLit = lit;
        for (let i = 0; i < 5; i++) setToggle(this.lightEls[i], 'on', i < lit);
      }
      if (phase === 'green' || phase === 'racing') this.lights.classList.add('go');
    } else this.lastLit = -1;

    // Flag banner
    let b: Banner | null = null;
    if (this.override && this.now < this.overrideUntil) b = this.override;
    else {
      this.override = null;
      b = this.flagBanner(race.globalFlag, race.sectorFlags, phase, entry);
    }
    const key = b ? b.key : '';
    if (key !== this.lastBanner) {
      this.lastBanner = key;
      if (!b) this.banner.classList.add('hidden');
      else {
        this.banner.className = `af-banner ${b.cls}`;
        setText(this.bannerText, b.text);
        setText(this.bannerSub, b.sub ?? '');
        void this.banner.offsetWidth;
        this.banner.classList.add('in');
      }
    }
  }

  private flagBanner(global: FlagType, sectors: [FlagType, FlagType, FlagType], phase: string, entry: RaceEntry | undefined): Banner | null {
    if (phase === 'red-flag' || global === 'red') return { key: 'red', cls: 'red', text: 'RED FLAG', sub: 'SESSION SUSPENDED' };
    if (phase === 'safety-car' || global === 'sc') return { key: 'sc', cls: 'sc', text: 'SAFETY CAR', sub: 'NO OVERTAKING · CLOSE UP' };
    if (phase === 'vsc' || global === 'vsc') return { key: 'vsc', cls: 'sc', text: 'VIRTUAL SAFETY CAR', sub: 'HOLD DELTA · NO OVERTAKING' };
    if (global === 'chequered' && entry && entry.status === 'racing') return { key: 'cheq', cls: 'chequered', text: 'CHEQUERED FLAG', sub: 'LEADER HAS FINISHED · COMPLETE THE LAP' };
    if (entry?.blueFlag) return { key: 'blue', cls: 'blue', text: 'BLUE FLAG', sub: 'FASTER CAR BEHIND · LET IT THROUGH' };
    if (global === 'double-yellow') return { key: 'dy', cls: 'yellow', text: 'DOUBLE YELLOW', sub: 'SLOW DOWN · BE PREPARED TO STOP' };
    if (global === 'yellow') return { key: 'y', cls: 'yellow', text: 'YELLOW FLAG', sub: 'NO OVERTAKING' };
    for (let i = 0; i < 3; i++) {
      const f = sectors[i];
      if (f === 'double-yellow') return { key: `dy${i}`, cls: 'yellow', text: 'DOUBLE YELLOW', sub: `SECTOR ${i + 1} · SLOW DOWN` };
      if (f === 'yellow') return { key: `y${i}`, cls: 'yellow', text: 'YELLOW FLAG', sub: `SECTOR ${i + 1} · NO OVERTAKING` };
    }
    if (global === 'black-white') return { key: 'bw', cls: 'bw', text: 'BLACK & WHITE FLAG', sub: 'UNSPORTSMANLIKE DRIVING WARNING' };
    return null;
  }
}
