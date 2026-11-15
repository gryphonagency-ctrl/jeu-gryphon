import type { World } from '../../core/types';
import { div, setAttr, svg } from '../dom';
import { buildTrackMap, type TrackMap } from '../trackMap';

interface Dot {
  el: SVGCircleElement;
  ring: SVGCircleElement | null;
  lastX: number;
  lastY: number;
}

export class Minimap {
  readonly el: HTMLElement;
  private map: TrackMap | null = null;
  private dots: Dot[] = [];
  private acc = 0;
  private world: World | null = null;
  private focusCarId: number | null = null;
  private readonly p = { x: 0, y: 0 };

  constructor() {
    this.el = div('af-minimap');
  }

  bind(world: World, focusCarId = world.playerCarId): void {
    this.world = world;
    this.focusCarId = focusCarId;
    this.el.replaceChildren();
    this.map = buildTrackMap(world.track, { stroke: 3, sectors: true, drs: true, pit: true, glow: true });
    this.el.appendChild(this.map.svg);
    this.dots = [];
    // Dot radii scale with the viewBox so they stay legible whichever axis fits the panel.
    const unit = Math.max(this.map.width, this.map.height) / 1000;
    const rCar = 13 * unit;
    const rPlayer = 18 * unit;
    const rRing = 28 * unit;
    // Player dot last so it draws on top.
    const order = world.cars.map((c) => c.id).sort((a, b) => (a === focusCarId ? 1 : b === focusCarId ? -1 : 0));
    const byId: Dot[] = new Array(world.cars.length);
    for (const id of order) {
      const car = world.cars[id];
      const team = world.teamById[car.teamId];
      const player = id === focusCarId;
      let ring: SVGCircleElement | null = null;
      if (player) {
        ring = svg('circle', { r: rRing.toFixed(1), class: 'af-mm-ring' });
        this.map.cars.appendChild(ring);
      }
      const c = svg('circle', { r: (player ? rPlayer : rCar).toFixed(1), fill: team?.primaryColor ?? '#fff', class: `af-mm-dot${player ? ' player' : ''}` });
      this.map.cars.appendChild(c);
      byId[id] = { el: c, ring, lastX: NaN, lastY: NaN };
    }
    this.dots = byId;
    this.acc = 1;
  }

  update(world: World, dt: number, focusCarId = world.playerCarId): void {
    if (world !== this.world || !this.map || focusCarId !== this.focusCarId) this.bind(world, focusCarId);
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const map = this.map!;
    const cars = world.cars;
    for (let i = 0; i < cars.length; i++) {
      const d = this.dots[i];
      if (!d) continue;
      const car = cars[i];
      map.toMap(car.position.x, car.position.z, this.p);
      const x = Math.round(this.p.x);
      const y = Math.round(this.p.y);
      if (x === d.lastX && y === d.lastY) continue;
      d.lastX = x;
      d.lastY = y;
      const xs = String(x);
      const ys = String(y);
      setAttr(d.el, 'cx', xs);
      setAttr(d.el, 'cy', ys);
      if (d.ring) {
        setAttr(d.ring, 'cx', xs);
        setAttr(d.ring, 'cy', ys);
      }
      const out = car.status === 'retired' || car.status === 'dnf' || car.status === 'dsq';
      if (d.el.classList.contains('out') !== out) d.el.classList.toggle('out', out);
    }
  }
}
