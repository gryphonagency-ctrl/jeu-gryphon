/**
 * Approximate scene lighting for particle shading (the renderer owns the real sun; this only needs to be plausible).
 */
import * as THREE from 'three';
import type { EnvironmentState } from '../core/types';

export interface ParticleLighting {
  sunDir: THREE.Vector3;
  sunColor: THREE.Vector3;
  ambient: THREE.Vector3;
  /** True between dusk and dawn. */
  night: boolean;
}

export const createLighting = (): ParticleLighting => ({
  sunDir: new THREE.Vector3(0, 1, 0),
  sunColor: new THREE.Vector3(1, 1, 1),
  ambient: new THREE.Vector3(0.4, 0.4, 0.4),
  night: false,
});

export const updateLighting = (out: ParticleLighting, env: EnvironmentState): void => {
  const t = env.timeOfDay;
  const dayT = (t - 6) / 12; // 0 sunrise .. 1 sunset
  const elev = Math.sin(Math.PI * Math.max(0, Math.min(1, dayT))) * 1.15; // radians, max ~66°
  const az = Math.PI * 0.25 + dayT * Math.PI; // sweep east → west
  const sunUp = t > 5.7 && t < 18.3 ? Math.sin(elev) : -0.1;
  out.night = sunUp <= 0.02;
  const cloud = env.weather.cloud;
  const rain = env.weather.rain;
  const ce = Math.cos(elev);
  out.sunDir.set(ce * Math.sin(az), Math.max(0.05, Math.sin(elev)), ce * Math.cos(az)).normalize();
  const horizon = 1 - Math.min(1, Math.max(0, sunUp) / 0.35);
  const clear = 1 - cloud * 0.85 - rain * 0.1;
  if (out.night) {
    // Floodlit night race: cool-white lights from above.
    out.sunDir.set(0.2, 1, 0.1).normalize();
    out.sunColor.set(0.7, 0.72, 0.8);
    out.ambient.set(0.16, 0.17, 0.2);
  } else {
    const strength = Math.max(0, clear) * Math.min(1, sunUp / 0.12);
    out.sunColor.set(1.0, 0.92 - horizon * 0.35, 0.82 - horizon * 0.55).multiplyScalar(strength * 1.5);
    const sky = 0.55 - cloud * 0.22 - rain * 0.08;
    out.ambient.set(sky * 0.72, sky * 0.8, sky * 0.95).multiplyScalar(0.7 + 0.3 * Math.min(1, sunUp / 0.3));
  }
};
