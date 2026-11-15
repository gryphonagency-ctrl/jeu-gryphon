import type { TrackSpline, PitLaneSample } from '../core/track/TrackSpline';
import * as THREE from 'three';
import { svg } from './dom';

export interface TrackMapOptions {
  /** Stroke width in CSS px (non-scaling). */
  stroke?: number;
  sectors?: boolean;
  drs?: boolean;
  pit?: boolean;
  corners?: boolean;
  /** Subtle glow/outline under the track. */
  glow?: boolean;
  /** Animate the track path drawing itself once (loading screen). */
  draw?: boolean;
}

export interface TrackMap {
  svg: SVGSVGElement;
  /** Layer for car dots (added last, above everything). */
  cars: SVGGElement;
  /** World XZ → map coordinates. */
  toMap(x: number, z: number, out: { x: number; y: number }): void;
  width: number;
  height: number;
}

export const SECTOR_COLOURS = ['#ff4b4b', '#4aa8ff', '#f7d117'];

const _pit: PitLaneSample = { position: new THREE.Vector3(), tangent: new THREE.Vector3(), lateral: 0, d: 0, inTransition: false, speedLimited: false };

/** Draws a broadcast-style circuit map from `spline.samples`. */
export function buildTrackMap(spline: TrackSpline, opts: TrackMapOptions = {}): TrackMap {
  const { stroke = 3, sectors = true, drs = true, pit = true, corners = false, glow = true, draw = false } = opts;
  const samples = spline.samples;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of samples) {
    const p = s.position;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  // Pit lane sits ~16 m outside the track; pad generously so it and corner labels fit.
  const pad = Math.max(maxX - minX, maxZ - minZ) * 0.09 + 25;
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;
  const W = 1000;
  const scale = W / (maxX - minX);
  const H = Math.round((maxZ - minZ) * scale);
  // Tall circuits fit by height, so size markers against the longer axis to stay legible.
  const unit = Math.max(W, H) / 1000;

  const toMap = (x: number, z: number, out: { x: number; y: number }): void => {
    out.x = (x - minX) * scale;
    out.y = (z - minZ) * scale;
  };

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'af-trackmap', preserveAspectRatio: 'xMidYMid meet' });
  const gTrack = svg('g');
  const gDrs = svg('g');
  const gPit = svg('g');
  const gMarks = svg('g');
  const gCars = svg('g', { class: 'af-trackmap-cars' });
  root.append(gPit, gTrack, gDrs, gMarks, gCars);

  const step = Math.max(1, Math.floor(samples.length / 900));
  const p = { x: 0, y: 0 };

  const pathFor = (from: number, to: number): string => {
    // Path through samples in index range [from, to] (wrapping allowed when to < from).
    const n = samples.length;
    let d = '';
    let count = to >= from ? to - from : n - from + to;
    let i = from;
    let first = true;
    while (count >= 0) {
      const sm = samples[i % n];
      toMap(sm.position.x, sm.position.z, p);
      d += `${first ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      first = false;
      i += step;
      count -= step;
    }
    const last = samples[to % n];
    toMap(last.position.x, last.position.z, p);
    d += `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    return d;
  };

  const idxOfS = (s: number): number => Math.round(spline.wrapS(s) / spline.spacing) % samples.length;

  // Full outline (glow + base).
  const full = pathFor(0, samples.length - 1) + 'Z';
  if (glow) {
    const g1 = svg('path', { d: full, class: 'af-tm-glow', fill: 'none', 'stroke-width': stroke * 3.2, 'vector-effect': 'non-scaling-stroke' });
    gTrack.appendChild(g1);
  }
  const base = svg('path', { d: full, class: 'af-tm-base', fill: 'none', 'stroke-width': stroke * 1.9, 'vector-effect': 'non-scaling-stroke' });
  gTrack.appendChild(base);

  if (sectors) {
    const s1 = idxOfS(spline.sectorS[0]);
    const s2 = idxOfS(spline.sectorS[1]);
    const ranges: [number, number][] = [
      [0, s1],
      [s1, s2],
      [s2, samples.length - 1],
    ];
    toMap(samples[0].position.x, samples[0].position.z, p);
    const closeToStart = `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    ranges.forEach(([a, b], i) => {
      const d = pathFor(a, b) + (i === 2 ? closeToStart : '');
      const path = svg('path', { d, class: `af-tm-sector af-tm-s${i}`, fill: 'none', stroke: SECTOR_COLOURS[i], 'stroke-width': stroke, 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1000 });
      if (draw) path.classList.add('af-tm-draw');
      gTrack.appendChild(path);
    });
  } else {
    const path = svg('path', { d: full, class: 'af-tm-line', fill: 'none', 'stroke-width': stroke, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round', pathLength: 1000 });
    if (draw) path.classList.add('af-tm-draw');
    gTrack.appendChild(path);
  }

  if (drs) {
    for (const z of spline.drsZones) {
      const d = pathFor(idxOfS(z.startS), idxOfS(z.endS));
      gDrs.appendChild(svg('path', { d, class: 'af-tm-drs', fill: 'none', 'stroke-width': stroke * 2.6, 'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round' }));
      toMap(spline.sampleAt(z.detectionS).position.x, spline.sampleAt(z.detectionS).position.z, p);
      gDrs.appendChild(svg('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: (9 * unit).toFixed(1), class: 'af-tm-drsdet' }));
    }
  }

  if (pit) {
    const pl = spline.pitLane;
    let d = '';
    const stepM = 6;
    for (let dist = 0; dist <= pl.length; dist += stepM) {
      spline.pitLaneSample(spline.wrapS(pl.entryS + dist), _pit);
      toMap(_pit.position.x, _pit.position.z, p);
      d += `${dist === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }
    gPit.appendChild(svg('path', { d, class: 'af-tm-pit', fill: 'none', 'stroke-width': Math.max(1, stroke * 0.55), 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': '4 3' }));
  }

  // Start/finish line: perpendicular tick.
  {
    const sm = samples[0];
    const hw = (sm.width / 2 + 3) * Math.max(1, unit * 1.4);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    toMap(sm.position.x + sm.left.x * hw, sm.position.z + sm.left.z * hw, a);
    toMap(sm.position.x - sm.left.x * hw, sm.position.z - sm.left.z * hw, b);
    gMarks.appendChild(svg('line', { x1: a.x.toFixed(1), y1: a.y.toFixed(1), x2: b.x.toFixed(1), y2: b.y.toFixed(1), class: 'af-tm-sf', 'stroke-width': stroke * 1.4, 'vector-effect': 'non-scaling-stroke' }));
  }

  if (corners) {
    for (const c of spline.cornersWithS()) {
      const sm = spline.sampleAt(c.s);
      // Label on the outside of the corner: left turns (curvature > 0) → outside is the right.
      const side = sm.curvature > 0 ? -1 : 1;
      const off = sm.width / 2 + 22;
      toMap(sm.position.x + sm.left.x * off * side, sm.position.z + sm.left.z * off * side, p);
      const t = svg('text', { x: p.x.toFixed(1), y: p.y.toFixed(1), class: 'af-tm-corner', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': (30 * unit).toFixed(0) });
      t.textContent = String(c.number);
      gMarks.appendChild(t);
    }
  }

  return { svg: root, cars: gCars, toMap, width: W, height: H };
}
