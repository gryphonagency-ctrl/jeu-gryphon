import type { RaceControlMessage, RenderStats, World } from '../../core/types';
import { div, fmtHours, icon, setText, setToggle, span } from '../dom';

interface Popup {
  text: string;
  sub: string;
  cls: string;
  seconds: number;
}

/**
 * Right-column information feed (weather, race control ticker, toasts), the centre popup queue,
 * team radio subtitles and the telemetry overlay.
 */
export class Feed {
  readonly rightCol: HTMLElement;
  readonly popupEl: HTMLElement;
  readonly radioEl: HTMLElement;
  readonly telemetry: HTMLElement;
  readonly toasts: HTMLElement;
  private readonly weather: { rain: HTMLElement; wet: HTMLElement; track: HTMLElement; air: HTMLElement; clock: HTMLElement; ico: HTMLElement; box: HTMLElement };
  private readonly ticker: HTMLElement;
  private readonly tickerRows: { el: HTMLElement; time: HTMLElement; text: HTMLElement }[] = [];
  private readonly popupText: HTMLElement;
  private readonly popupSub: HTMLElement;
  private readonly radioFrom: HTMLElement;
  private readonly radioName: HTMLElement;
  private readonly radioText: HTMLElement;
  private readonly tele: { fps: HTMLElement; ms: HTMLElement; draws: HTMLElement; tris: HTMLElement; q: HTMLElement };
  private popups: Popup[] = [];
  private popupUntil = 0;
  private radioUntil = 0;
  private now = 0;
  private slow = 0;
  private lastIco = '';
  private teleAcc = 0;
  private messages: RaceControlMessage[] = [];

  constructor() {
    this.rightCol = div('af-rightcol');
    const w = div('af-weather');
    const ico = span('af-weather-ico');
    const rows = div('af-weather-rows');
    const mk = (k: string) => {
      const r = div('af-weather-row');
      const v = span('af-weather-v', '');
      r.append(span('af-weather-k', k), v);
      rows.appendChild(r);
      return v;
    };
    const clock = span('af-weather-clock', '15:30');
    const head = div('af-weather-head');
    head.append(ico, clock);
    this.weather = { box: w, ico, clock, rain: mk('RAIN'), wet: mk('TRACK WET'), track: mk('TRACK °C'), air: mk('AIR °C') };
    w.append(head, rows);

    this.ticker = div('af-ticker');
    const th = div('af-ticker-head', 'RACE CONTROL');
    this.ticker.appendChild(th);
    for (let i = 0; i < 3; i++) {
      const r = div('af-ticker-row hidden');
      const t = span('af-ticker-time', '');
      const x = span('af-ticker-text', '');
      r.append(t, x);
      this.ticker.appendChild(r);
      this.tickerRows.push({ el: r, time: t, text: x });
    }
    this.toasts = div('af-toasts');
    this.rightCol.append(w, this.ticker, this.toasts);

    this.popupEl = div('af-popup hidden');
    this.popupText = div('af-popup-text', '');
    this.popupSub = div('af-popup-sub', '');
    this.popupEl.append(this.popupText, this.popupSub);

    this.radioEl = div('af-radio hidden');
    const rico = icon('radio', 'af-ico af-radio-ico');
    const wave = span('af-wave');
    for (let i = 0; i < 9; i++) {
      const b = span('af-wave-bar');
      b.style.setProperty('--i', String(i));
      wave.appendChild(b);
    }
    const body = div('af-radio-body');
    const from = div('af-radio-from');
    this.radioFrom = span('af-radio-role', 'ENGINEER');
    this.radioName = span('af-radio-name', '');
    from.append(this.radioFrom, this.radioName);
    this.radioText = div('af-radio-text', '');
    body.append(from, this.radioText);
    this.radioEl.append(rico, wave, body);

    this.telemetry = div('af-tele hidden');
    const tk = (k: string) => {
      const c = span('af-tele-cell');
      const v = span('af-tele-v', '0');
      c.append(v, span('af-tele-k', k));
      this.telemetry.appendChild(c);
      return v;
    };
    this.tele = { fps: tk('FPS'), ms: tk('MS'), draws: tk('DRAWS'), tris: tk('TRIS'), q: tk('QUALITY') };
  }

  reset(messages: RaceControlMessage[]): void {
    this.messages = messages.slice(-3);
    this.renderTicker();
    this.popups = [];
    this.popupUntil = 0;
    this.popupEl.classList.add('hidden');
    this.radioUntil = 0;
    this.radioEl.classList.add('hidden');
    this.toasts.replaceChildren();
  }

  message(m: RaceControlMessage): void {
    this.messages.push(m);
    if (this.messages.length > 3) this.messages.shift();
    this.renderTicker();
  }

  private renderTicker(): void {
    for (let i = 0; i < 3; i++) {
      const row = this.tickerRows[i];
      const m = this.messages[this.messages.length - 1 - i];
      setToggle(row.el, 'hidden', !m);
      if (!m) continue;
      setText(row.time, fmtRaceTime(m.time));
      setText(row.text, m.text);
      row.el.dataset.kind = m.kind;
      if (i === 0) {
        row.el.classList.remove('in');
        void row.el.offsetWidth;
        row.el.classList.add('in');
      }
    }
  }

  toast(text: string, kind: RaceControlMessage['kind'] = 'info', seconds = 4): void {
    const t = div(`af-toast af-toast-${kind}`);
    if (kind === 'penalty' || kind === 'warning') t.appendChild(icon('warning', 'af-ico af-toast-ico'));
    else if (kind === 'flag') t.appendChild(icon('flag', 'af-ico af-toast-ico'));
    t.appendChild(span('af-toast-text', text));
    this.toasts.prepend(t);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild?.remove();
    window.setTimeout(() => {
      t.classList.add('out');
      window.setTimeout(() => t.remove(), 320);
    }, seconds * 1000);
  }

  popup(text: string, sub = '', cls = '', seconds = 2.4): void {
    this.popups.push({ text, sub, cls, seconds });
    if (this.popups.length > 4) this.popups.shift();
  }

  radio(from: 'engineer' | 'driver' | 'race-control', name: string, text: string): void {
    setText(this.radioFrom, from === 'engineer' ? 'ENGINEER' : from === 'driver' ? 'DRIVER' : 'RACE CONTROL');
    setText(this.radioName, name.toUpperCase());
    setText(this.radioText, text);
    this.radioEl.classList.remove('hidden', 'out');
    void this.radioEl.offsetWidth;
    this.radioEl.classList.add('in');
    this.radioUntil = this.now + 5;
  }

  update(world: World, dt: number, stats: RenderStats, showTelemetry: boolean): void {
    this.now += dt;
    // Popup queue
    if (this.popupUntil > 0 && this.now >= this.popupUntil) {
      this.popupUntil = 0;
      this.popupEl.classList.add('out');
      window.setTimeout(() => {
        if (this.popupUntil === 0) this.popupEl.classList.add('hidden');
      }, 260);
    }
    if (this.popupUntil === 0 && this.popups.length) {
      const p = this.popups.shift()!;
      this.popupEl.className = `af-popup ${p.cls}`.trim();
      setText(this.popupText, p.text);
      setText(this.popupSub, p.sub);
      void this.popupEl.offsetWidth;
      this.popupEl.classList.add('in');
      this.popupUntil = this.now + p.seconds;
    }
    // Radio
    if (this.radioUntil > 0 && this.now > this.radioUntil) {
      this.radioUntil = 0;
      this.radioEl.classList.add('out');
      window.setTimeout(() => {
        if (this.radioUntil === 0) this.radioEl.classList.add('hidden');
      }, 300);
    }
    // Telemetry (5 Hz)
    setToggle(this.telemetry, 'hidden', !showTelemetry);
    if (showTelemetry) {
      this.teleAcc += dt;
      if (this.teleAcc > 0.2) {
        this.teleAcc = 0;
        setText(this.tele.fps, String(Math.round(stats.fps)));
        setText(this.tele.ms, stats.frameMs.toFixed(1));
        setText(this.tele.draws, String(stats.drawCalls));
        setText(this.tele.tris, stats.triangles > 1e6 ? `${(stats.triangles / 1e6).toFixed(2)}M` : stats.triangles > 1e3 ? `${(stats.triangles / 1e3).toFixed(0)}k` : String(stats.triangles));
        setText(this.tele.q, stats.quality.toUpperCase());
      }
    }
    // Weather (2 Hz)
    this.slow += dt;
    if (this.slow < 0.5) return;
    this.slow = 0;
    const w = world.env.weather;
    setText(this.weather.rain, `${Math.round(w.rain * 100)}%`);
    setText(this.weather.wet, `${Math.round(w.wetness * 100)}%`);
    setText(this.weather.track, `${Math.round(w.trackTempC)}°`);
    setText(this.weather.air, `${Math.round(w.airTempC)}°`);
    setText(this.weather.clock, fmtHours(world.env.timeOfDay));
    const h = world.env.timeOfDay;
    const ico = w.rain > 0.08 ? 'rain' : w.cloud > 0.65 ? 'cloud' : h >= 20 || h < 6 ? 'moon' : h >= 17.5 ? 'sunset' : 'sun';
    if (ico !== this.lastIco) {
      this.lastIco = ico;
      this.weather.ico.replaceChildren(icon(ico, 'af-ico'));
    }
    setToggle(this.weather.box, 'wet', w.wetness > 0.3);
  }
}

const fmtRaceTime = (t: number): string => {
  if (!isFinite(t) || t < 0) return '';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};
