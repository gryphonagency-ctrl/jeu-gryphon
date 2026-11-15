import { formatGap, formatLapTime } from '../../core/math';
import type { ResultRow, SessionResults, SessionType, World } from '../../core/types';
import { hintRow, type Screen, type UIContext } from '../context';
import { div, span } from '../dom';
import { Navigator, type NavItem } from '../nav';
import { buildButton } from '../widgets';

const STATUS_LABEL: Record<string, string> = { retired: 'RET', dnf: 'DNF', dsq: 'DSQ' };

export class ResultsScreen implements Screen {
  readonly el: HTMLElement;
  private readonly nav: Navigator;
  private readonly headline: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly podium: HTMLElement;
  private readonly table: HTMLElement;
  private readonly flCallout: HTMLElement;
  private readonly buttons: HTMLElement;

  constructor(private readonly ctx: UIContext) {
    this.el = div('af-screen af-results hidden');
    this.el.appendChild(div('af-results-shade'));
    const panel = div('af-results-panel');
    const head = div('af-results-head');
    this.kicker = div('af-results-kicker', '');
    this.headline = div('af-results-headline', '');
    head.append(this.kicker, this.headline);
    this.podium = div('af-podium');
    this.flCallout = div('af-fl');
    this.table = div('af-rtable');
    this.buttons = div('af-results-buttons');
    panel.append(head, this.podium, this.flCallout, this.table, this.buttons);
    panel.appendChild(hintRow([{ key: 'nav', label: 'SELECT' }, { key: 'confirm', label: 'CONFIRM' }]));
    this.el.appendChild(panel);
    this.nav = new Navigator(ctx.sound);
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
  }
  hide(): void {
    this.el.classList.add('hidden');
  }

  populate(results: SessionResults, world: World, next: SessionType | null): void {
    const isRace = results.sessionType === 'race';
    const rows = results.classification;
    const player = rows.find((r) => r.carId === results.playerCarId);
    const p = results.playerPosition;
    const sessionLabel = results.sessionType === 'race' ? 'RACE CLASSIFICATION' : results.sessionType === 'qualifying' ? 'QUALIFYING CLASSIFICATION' : 'PRACTICE CLASSIFICATION';
    this.kicker.textContent = `${world.trackDef.grandPrixName.toUpperCase()} · ${sessionLabel}`;
    let headline: string;
    let cls = '';
    if (player && player.status !== 'racing' && player.status !== 'finished') {
      headline = `${STATUS_LABEL[player.status] ?? 'OUT'} — ${player.status === 'dsq' ? 'DISQUALIFIED' : 'RETIRED'}`;
      cls = 'bad';
    } else if (p === 1) {
      headline = isRace ? 'P1 — VICTORY!' : 'P1 — POLE POSITION!';
      cls = 'gold';
    } else if (p <= 3) {
      headline = `P${p} — ${isRace ? 'PODIUM' : 'FRONT ROW'}`;
      cls = 'silver';
    } else if (isRace && p <= 10) {
      headline = `P${p} — POINTS FINISH`;
      cls = 'points';
    } else {
      headline = `P${p}`;
    }
    this.headline.textContent = headline;
    this.headline.className = `af-results-headline ${cls}`.trim();

    // Podium
    this.podium.replaceChildren();
    const order = [1, 0, 2];
    for (const idx of order) {
      const r = rows[idx];
      const block = div(`af-podium-block af-podium-${idx + 1}`);
      if (r) {
        const d = world.driverById[r.driverId];
        const t = world.teamById[r.teamId];
        block.style.setProperty('--team', t?.primaryColor ?? '#666');
        block.style.setProperty('--team2', t?.secondaryColor ?? '#999');
        const top = div('af-podium-top');
        top.append(span('af-podium-pos', String(idx + 1)), span('af-podium-num', String(d?.number ?? '')));
        const name = div('af-podium-name');
        const parts = (d?.name ?? r.driverId).split(' ');
        name.append(span('af-podium-first', parts.slice(0, -1).join(' ')), span('af-podium-last', parts[parts.length - 1].toUpperCase()));
        const team = div('af-podium-team', t?.name.toUpperCase() ?? '');
        const time = div('af-podium-time', idx === 0 ? formatLapTime(r.time) : isRace ? formatGap(r.gap, r.lapsBehind) : formatLapTime(r.time));
        block.append(top, name, team, time);
        if (r.carId === results.playerCarId) block.classList.add('player');
      }
      this.podium.appendChild(block);
    }

    // Fastest lap callout
    this.flCallout.replaceChildren();
    if (results.fastestLap) {
      const d = world.driverById[results.fastestLap.driverId];
      const t = d ? world.teamById[d.teamId] : undefined;
      this.flCallout.style.setProperty('--team', t?.primaryColor ?? '#a020f0');
      this.flCallout.append(span('af-fl-tag', 'FASTEST LAP'), span('af-fl-name', d?.name.toUpperCase() ?? ''), span('af-fl-time', formatLapTime(results.fastestLap.time)));
      this.flCallout.classList.remove('hidden');
    } else this.flCallout.classList.add('hidden');

    // Table
    this.table.replaceChildren();
    const header = div('af-rrow af-rhead');
    const cols = isRace ? ['POS', '', 'DRIVER', 'TEAM', 'TIME / GAP', 'BEST LAP', 'STOPS', 'PEN', 'PTS', '+/-'] : ['POS', '', 'DRIVER', 'TEAM', 'BEST LAP', 'GAP', 'LAPS', '', '', ''];
    for (const c of cols) header.appendChild(span('', c));
    this.table.appendChild(header);
    const leader = rows[0];
    for (const r of rows) {
      this.table.appendChild(this.row(r, world, results, isRace, leader));
    }

    // Buttons
    this.buttons.replaceChildren();
    const items: NavItem[] = [];
    if (next) items.push(buildButton(next === 'race' ? 'CONTINUE TO RACE' : 'CONTINUE', () => this.ctx.emit({ type: 'next-session' }), 'af-btn-primary'));
    items.push(buildButton('WATCH REPLAY', () => this.ctx.emit({ type: 'replay-start' })));
    items.push(buildButton('RESTART', () => this.ctx.emit({ type: 'restart-session' })));
    items.push(buildButton('BACK TO MENU', () => this.ctx.emit({ type: 'quit-to-menu' }), 'af-btn-ghost'));
    for (const it of items) this.buttons.appendChild(it.el);
    this.nav.setItems(items, 0, items.length);
    this.nav.onBack = null;
    this.ctx.sound('finish');
  }

  private row(r: ResultRow, world: World, results: SessionResults, isRace: boolean, leader: ResultRow | undefined): HTMLElement {
    const d = world.driverById[r.driverId];
    const t = world.teamById[r.teamId];
    const e = div(`af-rrow${r.carId === results.playerCarId ? ' player' : ''}${r.status !== 'finished' && r.status !== 'racing' ? ' out' : ''}`);
    e.style.setProperty('--team', t?.primaryColor ?? '#666');
    e.appendChild(span('af-rpos', String(r.position)));
    e.appendChild(span('af-rbar'));
    const drv = span('af-rdriver');
    drv.append(span('af-rcode', d?.code ?? '???'), span('af-rname', d?.name ?? r.driverId));
    e.appendChild(drv);
    e.appendChild(span('af-rteam', t?.name ?? ''));
    const out = r.status !== 'finished' && r.status !== 'racing';
    if (isRace) {
      const timeStr = out ? STATUS_LABEL[r.status] ?? 'OUT' : r.position === 1 ? formatLapTime(r.time) : formatGap(r.gap, r.lapsBehind);
      e.appendChild(span('af-rtime', timeStr));
      const bl = span(`af-rbest${r.fastestLap ? ' purple' : ''}`, formatLapTime(r.bestLap));
      e.appendChild(bl);
      e.appendChild(span('af-rstops', String(r.pitStops)));
      e.appendChild(span(`af-rpen${r.penaltySeconds > 0 ? ' pen' : ''}`, r.penaltySeconds > 0 ? `+${r.penaltySeconds}s` : '—'));
      e.appendChild(span(`af-rpts${r.points > 0 ? ' scored' : ''}`, r.points > 0 ? String(r.points) : '—'));
      const pc = r.positionChange;
      e.appendChild(span(`af-rchange ${pc > 0 ? 'up' : pc < 0 ? 'down' : ''}`.trim(), pc > 0 ? `▲${pc}` : pc < 0 ? `▼${-pc}` : '–'));
    } else {
      e.appendChild(span(`af-rbest${r.fastestLap ? ' purple' : ''}`, out ? STATUS_LABEL[r.status] ?? 'OUT' : formatLapTime(r.bestLap || r.time)));
      const gap = leader && r.position > 1 && isFinite(r.bestLap) && r.bestLap > 0 && leader.bestLap > 0 ? formatGap(r.bestLap - leader.bestLap) : r.position === 1 ? '' : '--';
      e.appendChild(span('af-rtime', gap));
      e.appendChild(span('af-rstops', String(r.laps)));
      e.appendChild(span(''));
      e.appendChild(span(''));
      e.appendChild(span(''));
    }
    return e;
  }

  move(dx: number, dy: number): void {
    this.nav.move(dx || dy, 0);
  }
  confirm(): void {
    this.nav.confirm();
  }
  back(): void {
    /* results: no back */
  }
}
