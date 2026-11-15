import * as THREE from 'three';
import type { World } from '../core/types';
import type { SplitViewport } from '../render/splitScreen';

export interface LiveCameraView {
  carId: number;
  camera: THREE.PerspectiveCamera;
  viewport: SplitViewport;
}

interface Nameplate {
  el: HTMLDivElement;
  position: HTMLSpanElement;
  username: HTMLSpanElement;
}

export class LiveNameplates {
  private readonly style: HTMLStyleElement;
  private readonly labels = new Map<number, Nameplate>();
  private readonly point = new THREE.Vector3();

  constructor(private readonly root: HTMLElement) {
    this.style = document.createElement('style');
    this.style.textContent = `
      .apex-live-nameplate{position:fixed;z-index:15;display:flex;align-items:center;gap:8px;transform:translate(-50%,-100%);max-width:min(420px,60vw);padding:6px 11px;border-left:4px solid #e10600;border-radius:5px;background:rgba(7,11,19,.94);box-shadow:0 3px 12px #000b;color:#fff;letter-spacing:.02em;text-shadow:0 1px 2px #000;white-space:nowrap;pointer-events:none}
      .apex-live-position{flex:none;padding:4px 7px;border-radius:4px;background:#e10600;color:#fff;font:900 clamp(18px,2.2vw,30px)/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}
      .apex-live-username{min-width:0;overflow:hidden;text-overflow:ellipsis;font:900 clamp(18px,2vw,28px)/1.1 system-ui,sans-serif}
    `;
    root.appendChild(this.style);
  }

  setNames(names: ReadonlyMap<number, string>): void {
    for (const [carId, username] of names) {
      let nameplate = this.labels.get(carId);
      if (!nameplate) {
        const el = document.createElement('div');
        el.className = 'apex-live-nameplate';
        el.setAttribute('aria-hidden', 'true');
        const position = document.createElement('span');
        position.className = 'apex-live-position';
        const name = document.createElement('span');
        name.className = 'apex-live-username';
        el.append(position, name);
        nameplate = { el, position, username: name };
        this.labels.set(carId, nameplate);
        this.root.appendChild(el);
      }
      nameplate.username.textContent = `@${username}`;
    }

    for (const [carId, nameplate] of this.labels) {
      if (names.has(carId)) continue;
      nameplate.el.remove();
      this.labels.delete(carId);
    }
  }

  update(world: World | null, views: readonly LiveCameraView[]): void {
    const viewsByCar = new Map(views.map((view) => [view.carId, view]));
    for (const [carId, nameplate] of this.labels) {
      const car = world?.cars[carId];
      const view = viewsByCar.get(carId);
      if (!car || !view) {
        nameplate.el.hidden = true;
        continue;
      }
      const position = world?.race.entryByCar[carId]?.position;
      nameplate.position.textContent = position ? `P${position}` : 'P—';
      view.camera.updateMatrixWorld();
      this.point.set(car.position.x, car.position.y + 3.2, car.position.z).project(view.camera);
      const visible = this.point.z >= -1 && this.point.z <= 1 &&
        this.point.x >= -1.1 && this.point.x <= 1.1 &&
        this.point.y >= -1.1 && this.point.y <= 1.1;
      nameplate.el.hidden = !visible;
      if (visible) {
        nameplate.el.style.left = `${view.viewport.x + (this.point.x * 0.5 + 0.5) * view.viewport.width}px`;
        nameplate.el.style.top = `${view.viewport.y + (-this.point.y * 0.5 + 0.5) * view.viewport.height}px`;
      }
    }
  }
}
