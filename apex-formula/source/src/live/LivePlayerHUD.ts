import { kmh } from '../core/math';
import type { World } from '../core/types';
import { Minimap } from '../ui/hud/Minimap';
import { div, setText } from '../ui/dom';
import type { LiveCameraView } from './LiveNameplates';

interface PlayerPanel {
  el: HTMLDivElement;
  name: HTMLDivElement;
  speed: HTMLDivElement;
  mapTitle: HTMLDivElement;
  minimap: Minimap;
}

export class LivePlayerHUD {
  private readonly style: HTMLStyleElement;
  private readonly panels = new Map<number, PlayerPanel>();

  constructor(private readonly root: HTMLElement) {
    this.style = document.createElement('style');
    this.style.textContent = `
      #ui-root.apex-live-multi .af-hud{visibility:hidden!important}
      .apex-live-player-hud{position:fixed;z-index:14;pointer-events:none}
      .apex-live-player-map{position:absolute!important;top:8px;left:8px;width:clamp(76px,25%,150px);height:clamp(58px,16vh,100px)!important;box-sizing:border-box;padding:15px 4px 4px!important;border:1px solid #ffffff36;background:rgba(6,10,17,.76)!important;box-shadow:0 3px 12px #0008}
      .apex-live-player-map .af-trackmap{inset:15px 4px 4px;width:calc(100% - 8px);height:calc(100% - 19px)}
      .apex-live-player-map-title{position:absolute;top:3px;left:7px;color:#c5d1e4;font:800 9px/1 system-ui,sans-serif;letter-spacing:.12em}
      .apex-live-player-speed{position:absolute;top:8px;right:8px;min-width:clamp(80px,22%,140px);box-sizing:border-box;padding:5px 9px 6px;border-left:3px solid #e10600;background:rgba(6,10,17,.78);box-shadow:0 3px 12px #0008;color:#fff;text-align:right}
      .apex-live-player-name{overflow:hidden;color:#c5d1e4;font:700 clamp(9px,1vw,12px)/1.2 system-ui,sans-serif;text-overflow:ellipsis;white-space:nowrap}
      .apex-live-player-speed-value{font:900 italic clamp(24px,3.2vw,42px)/.95 system-ui,sans-serif;font-variant-numeric:tabular-nums}
      .apex-live-player-speed-unit{margin-top:3px;color:#c5d1e4;font:800 9px/1 system-ui,sans-serif;letter-spacing:.16em}
      @media(max-width:600px){.apex-live-player-map{top:5px;left:5px}.apex-live-player-speed{top:5px;right:5px}}
    `;
    root.appendChild(this.style);
  }

  update(world: World | null, views: readonly LiveCameraView[], names: ReadonlyMap<number, string>, dt: number): void {
    const multiPlayer = !!world && views.length > 1;
    this.root.classList.toggle('apex-live-multi', multiPlayer);
    if (!multiPlayer || !world) {
      for (const panel of this.panels.values()) panel.el.hidden = true;
      return;
    }

    const activeCarIds = new Set<number>();
    for (const view of views) {
      const car = world.cars[view.carId];
      if (!car) continue;
      activeCarIds.add(view.carId);
      let panel = this.panels.get(view.carId);
      if (!panel) {
        panel = this.createPanel();
        this.panels.set(view.carId, panel);
      }
      panel.el.hidden = false;
      panel.el.style.left = `${view.viewport.x}px`;
      panel.el.style.top = `${view.viewport.y}px`;
      panel.el.style.width = `${view.viewport.width}px`;
      panel.el.style.height = `${view.viewport.height}px`;
      setText(panel.name, `@${names.get(view.carId) ?? car.driverId}`);
      setText(panel.speed, String(Math.round(kmh(car.speedAbs))));
      panel.minimap.update(world, dt, view.carId);
      if (panel.mapTitle.parentElement !== panel.minimap.el) panel.minimap.el.appendChild(panel.mapTitle);
    }

    for (const [carId, panel] of this.panels) {
      if (!activeCarIds.has(carId)) panel.el.hidden = true;
    }
  }

  private createPanel(): PlayerPanel {
    const panel = div('apex-live-player-hud');
    const minimap = new Minimap();
    minimap.el.classList.add('apex-live-player-map');
    const mapTitle = div('apex-live-player-map-title', 'CIRCUIT');
    const speedBox = div('apex-live-player-speed');
    const name = div('apex-live-player-name');
    const speed = div('apex-live-player-speed-value', '0');
    speedBox.append(name, speed, div('apex-live-player-speed-unit', 'KM/H'));
    panel.append(minimap.el, speedBox);
    this.root.appendChild(panel);
    return { el: panel, name, speed, mapTitle, minimap };
  }
}
