import * as THREE from 'three';
import type { World } from '../core/types';
import type { SplitViewport } from '../render/splitScreen';

export interface LiveCameraView {
  carId: number;
  camera: THREE.PerspectiveCamera;
  viewport: SplitViewport;
}

export class LiveNameplates {
  private readonly style: HTMLStyleElement;
  private readonly labels = new Map<number, HTMLDivElement>();
  private readonly point = new THREE.Vector3();

  constructor(private readonly root: HTMLElement) {
    this.style = document.createElement('style');
    this.style.textContent = `
      .apex-live-nameplate{position:fixed;z-index:15;transform:translate(-50%,-100%);padding:4px 9px;border-left:3px solid #e10600;border-radius:3px;background:rgba(7,11,19,.9);box-shadow:0 2px 8px #0009;color:#fff;font:700 12px/1.2 system-ui,sans-serif;letter-spacing:.03em;text-shadow:0 1px 2px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(240px,45vw);pointer-events:none}
    `;
    root.appendChild(this.style);
  }

  setNames(names: ReadonlyMap<number, string>): void {
    for (const [carId, username] of names) {
      let label = this.labels.get(carId);
      if (!label) {
        label = document.createElement('div');
        label.className = 'apex-live-nameplate';
        label.setAttribute('aria-hidden', 'true');
        this.labels.set(carId, label);
        this.root.appendChild(label);
      }
      label.textContent = `@${username}`;
    }

    for (const [carId, label] of this.labels) {
      if (names.has(carId)) continue;
      label.remove();
      this.labels.delete(carId);
    }
  }

  update(world: World | null, views: readonly LiveCameraView[]): void {
    const viewsByCar = new Map(views.map((view) => [view.carId, view]));
    for (const [carId, label] of this.labels) {
      const car = world?.cars[carId];
      const view = viewsByCar.get(carId);
      if (!car || !view) {
        label.hidden = true;
        continue;
      }
      view.camera.updateMatrixWorld();
      this.point.set(car.position.x, car.position.y + 3.2, car.position.z).project(view.camera);
      const visible = this.point.z >= -1 && this.point.z <= 1 &&
        this.point.x >= -1.1 && this.point.x <= 1.1 &&
        this.point.y >= -1.1 && this.point.y <= 1.1;
      label.hidden = !visible;
      if (visible) {
        label.style.left = `${view.viewport.x + (this.point.x * 0.5 + 0.5) * view.viewport.width}px`;
        label.style.top = `${view.viewport.y + (-this.point.y * 0.5 + 0.5) * view.viewport.height}px`;
      }
    }
  }
}
