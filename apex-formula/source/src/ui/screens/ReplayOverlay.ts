import { hintRow, type Screen, type UIContext } from '../context';
import { div, fmtClock, setText, setToggle, span } from '../dom';
import { Navigator, type NavItem } from '../nav';
import { buildButton } from '../widgets';

const SPEEDS = [0.25, 0.5, 1, 2];

/**
 * Replay controls. The scrubber follows the replay clock main pushes through `sync`; until the first sync it
 * falls back to a local estimate (starts at 0, advances at the chosen speed, jumps on every seek we emit).
 */
export class ReplayOverlay implements Screen {
  readonly el: HTMLElement;
  private readonly nav: Navigator;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly head: HTMLElement;
  private readonly tCur: HTMLElement;
  private readonly tEnd: HTMLElement;
  private readonly speedBtns: HTMLElement[] = [];
  private time = 0;
  private duration = 90;
  private speed = 1;
  private lastPct = -1;
  private lastSec = -1;
  private dragging = false;
  private synced = false;

  constructor(private readonly ctx: UIContext) {
    this.el = div('af-screen af-replay hidden');
    const tag = div('af-replay-tag');
    tag.appendChild(span('af-replay-tagtext', 'REPLAY'));
    const bars = span('af-replay-bars');
    for (let i = 0; i < 5; i++) bars.appendChild(span('af-replay-bar'));
    tag.appendChild(bars);
    this.el.appendChild(tag);
    this.el.appendChild(div('af-replay-cam', 'C  ·  CYCLE CAMERA        DIRECTOR CAM AUTO-CUTS BETWEEN TV CAMERAS'));

    const panel = div('af-replay-panel');
    const timeline = div('af-replay-timeline');
    this.tCur = span('af-replay-time', '0:00');
    this.tEnd = span('af-replay-time af-replay-end', '1:30');
    this.bar = div('af-replay-track');
    this.fill = div('af-replay-fill');
    this.head = div('af-replay-head');
    this.bar.append(this.fill, this.head);
    timeline.append(this.tCur, this.bar, this.tEnd);
    const controls = div('af-replay-controls');
    const speeds = div('af-replay-speeds');
    const items: NavItem[] = [];
    const timelineItem: NavItem = {
      el: timeline,
      onAdjust: (d) => this.seek(this.time + d * 5),
      onConfirm: () => this.setSpeed(this.speed === 0 ? 1 : this.speed),
    };
    items.push(timelineItem);
    for (const s of SPEEDS) {
      const b = buildButton(`${s}×`, () => this.setSpeed(s), 'af-btn-chip');
      this.speedBtns.push(b.el);
      speeds.appendChild(b.el);
      items.push(b);
    }
    const exit = buildButton('EXIT REPLAY', () => ctx.emit({ type: 'replay-stop' }), 'af-btn-chip af-btn-exit');
    items.push(exit);
    controls.append(speeds, exit.el);
    panel.append(timeline, controls);
    panel.appendChild(hintRow([{ key: 'side', label: 'SCRUB ±5s' }, { key: 'nav', label: 'SELECT' }, { key: 'back', label: 'EXIT' }]));
    this.el.appendChild(panel);

    this.nav = new Navigator(ctx.sound);
    this.nav.setItems(items, 0);
    this.nav.onBack = () => ctx.emit({ type: 'replay-stop' });

    const seekFromEvent = (ev: PointerEvent) => {
      const r = this.bar.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width)));
      this.seek(f * this.duration);
    };
    this.bar.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      this.dragging = true;
      this.bar.setPointerCapture(ev.pointerId);
      seekFromEvent(ev);
    });
    this.bar.addEventListener('pointermove', (ev) => {
      if (this.dragging) seekFromEvent(ev);
    });
    const end = () => (this.dragging = false);
    this.bar.addEventListener('pointerup', end);
    this.bar.addEventListener('pointercancel', end);
  }

  /** Called when the replay phase begins. `recorded` = seconds of footage we believe exist. */
  enter(recorded: number): void {
    this.duration = Math.max(1, Math.min(90, recorded));
    this.time = 0;
    this.speed = 1;
    this.synced = false;
    this.lastPct = -1;
    this.lastSec = -1;
    setText(this.tEnd, fmtClock(this.duration));
    this.refreshSpeed();
    this.render();
  }

  private seek(t: number): void {
    this.time = Math.max(0, Math.min(this.duration, t));
    this.ctx.emit({ type: 'replay-seek', time: this.time });
    this.render();
  }

  private setSpeed(s: number): void {
    this.speed = s;
    this.ctx.emit({ type: 'replay-speed', speed: s });
    this.refreshSpeed();
  }

  private refreshSpeed(): void {
    SPEEDS.forEach((s, i) => setToggle(this.speedBtns[i], 'on', s === this.speed));
  }

  /** Authoritative clock from the replay system (when main provides it); disables the local estimate. */
  sync(time: number, duration: number, speed: number): void {
    this.synced = true;
    const d = Math.max(1, duration);
    if (d !== this.duration) {
      this.duration = d;
      setText(this.tEnd, fmtClock(d));
    }
    if (speed !== this.speed) {
      this.speed = speed;
      this.refreshSpeed();
    }
    if (!this.dragging) {
      this.time = Math.max(0, Math.min(this.duration, time));
      this.render();
    }
  }

  update(dt: number): void {
    if (this.dragging || this.synced) return;
    this.time = Math.min(this.duration, this.time + dt * this.speed);
    this.render();
  }

  private render(): void {
    const f = this.duration > 0 ? this.time / this.duration : 0;
    const p = Math.round(f * 1000);
    if (p !== this.lastPct) {
      this.lastPct = p;
      this.fill.style.transform = `scaleX(${(p / 1000).toFixed(3)})`;
      this.head.style.left = `${(p / 10).toFixed(1)}%`;
    }
    const sec = Math.floor(this.time);
    if (sec !== this.lastSec) {
      this.lastSec = sec;
      setText(this.tCur, fmtClock(this.time));
    }
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    this.nav.focus(0, true);
  }
  hide(): void {
    this.el.classList.add('hidden');
    this.dragging = false;
  }
  move(dx: number, dy: number): void {
    this.nav.move(dx, dy);
  }
  confirm(): void {
    this.nav.confirm();
  }
  back(): void {
    this.nav.back();
  }
}
