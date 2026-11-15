/**
 * TrackSpline — the single source of truth for circuit geometry. Owned by Lead.
 *
 * Built from a TrackDefinition (closed centripetal Catmull-Rom through 3D control points, control point 0 = start/finish).
 * Everything (physics, AI, track meshes, minimap, cameras) derives from this class so they always agree.
 *
 * Conventions: s = arc length from S/F in [0, length). lateral: + = LEFT of travel. left = (T.z, 0, -T.x) normalised.
 */
import * as THREE from 'three';
import { GRID_SIZE, TRACK } from '../constants';
import { angleDelta, clamp, lerp, loopDelta, smoothstep, wrap } from '../math';
import type { DrsZoneDef, SurfaceType, TrackControlPoint, TrackDefinition, TrackTheme } from '../types';

export interface TrackSample {
  s: number;
  /** Centreline point (world). */
  position: THREE.Vector3;
  /** Unit tangent (3D — includes slope). */
  tangent: THREE.Vector3;
  /** Unit horizontal left vector. */
  left: THREE.Vector3;
  /** Unit surface normal (≈ up, tilted by grade). */
  normal: THREE.Vector3;
  /** Full asphalt width (m). */
  width: number;
  /** Signed horizontal curvature (1/m). Positive = turning left. */
  curvature: number;
  /** dy/ds */
  grade: number;
  /** Heading on XZ: atan2(T.x, T.z). */
  heading: number;
  kerbL: boolean;
  kerbR: boolean;
  runoffL: SurfaceType;
  runoffR: SurfaceType;
  /** Distance from centreline to barrier on each side (positive). */
  barrierL: number;
  barrierR: number;
  sector: number;
  /** Index of the control-point segment containing this sample. */
  cpIndex: number;
}

export interface TrackProjection {
  s: number;
  lateral: number;
  /** Absolute horizontal distance to the centreline. */
  distance: number;
}

export interface Corridor {
  kind: 'track' | 'pit' | 'merged';
  /** Lateral bounds (walls) of the corridor at this s. minLateral < maxLateral. */
  minLateral: number;
  maxLateral: number;
}

export interface PitLaneSample {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  lateral: number;
  /** Forward distance from pit entry (m). */
  d: number;
  inTransition: boolean;
  /** True where the 80 km/h limit applies. */
  speedLimited: boolean;
}

export interface PitLaneInfo {
  side: 1 | -1;
  entryS: number;
  exitS: number;
  /** Forward distance from entry to exit. */
  length: number;
  /** Signed lateral of the pit lane centreline in its straight section. */
  offset: number;
  width: number;
  /** Length of the entry/exit blend zones. */
  transition: number;
  /** s of pit box 0 (boxes advance by TRACK.pitBoxSpacing). */
  boxStartS: number;
  /** Where the speed limit begins/ends (forward distance from entry). */
  limitStartD: number;
  limitEndD: number;
}

export interface DrsZone {
  index: number;
  detectionS: number;
  startS: number;
  endS: number;
}

export interface GridSlot {
  position: THREE.Vector3;
  /** Yaw such that a car with rotation.y = yaw faces along the track. */
  yaw: number;
  quaternion: THREE.Quaternion;
  s: number;
  lateral: number;
}

const PIT_TEAMS = GRID_SIZE / 2;
const SURFACE_RUNOFF_BY_THEME: Record<TrackTheme, SurfaceType> = {
  permanent: 'gravel',
  street: 'runoff',
  desert: 'runoff',
  forest: 'grass',
  coastal: 'runoff',
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class TrackSpline {
  readonly def: TrackDefinition;
  readonly length: number;
  readonly spacing: number;
  readonly samples: TrackSample[];
  /** s of each control point. */
  readonly cpS: number[];
  readonly sectorS: [number, number];
  readonly pitLane: PitLaneInfo;
  readonly drsZones: DrsZone[];
  readonly bounds: THREE.Box3;
  readonly curve: THREE.CatmullRomCurve3;
  readonly kerbWidth = TRACK.kerbWidth;

  private cellSize = 10;
  private grid = new Map<string, number[]>();

  constructor(def: TrackDefinition) {
    this.def = def;
    const cps = def.controlPoints;
    if (cps.length < 4) throw new Error(`Track ${def.id} needs at least 4 control points`);
    const pts = cps.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);

    // Fine sampling with `perSeg` subdivisions per control point segment so cp i lands exactly on index i*perSeg.
    const n = cps.length;
    const perSeg = 120;
    const fineCount = n * perSeg;
    const finePts: THREE.Vector3[] = new Array(fineCount + 1);
    const cum: number[] = new Array(fineCount + 1);
    cum[0] = 0;
    finePts[0] = this.curve.getPoint(0);
    for (let i = 1; i <= fineCount; i++) {
      finePts[i] = this.curve.getPoint(i / fineCount);
      cum[i] = cum[i - 1] + finePts[i].distanceTo(finePts[i - 1]);
    }
    this.length = cum[fineCount];
    this.cpS = new Array(n);
    for (let i = 0; i < n; i++) this.cpS[i] = cum[i * perSeg];

    // Resample uniformly.
    const count = Math.max(64, Math.round(this.length / TRACK.sampleSpacing));
    this.spacing = this.length / count;
    const positions: THREE.Vector3[] = new Array(count);
    let fi = 0;
    for (let k = 0; k < count; k++) {
      const s = k * this.spacing;
      while (fi < fineCount - 1 && cum[fi + 1] < s) fi++;
      const segLen = cum[fi + 1] - cum[fi];
      const u = segLen > 1e-9 ? (s - cum[fi]) / segLen : 0;
      positions[k] = new THREE.Vector3().lerpVectors(finePts[fi], finePts[fi + 1], u);
    }

    // Build samples with tangents / curvature from central differences.
    const headings: number[] = new Array(count);
    const tangents: THREE.Vector3[] = new Array(count);
    for (let k = 0; k < count; k++) {
      const prev = positions[(k - 1 + count) % count];
      const next = positions[(k + 1) % count];
      const t = new THREE.Vector3().subVectors(next, prev).normalize();
      tangents[k] = t;
      headings[k] = Math.atan2(t.x, t.z);
    }
    const rawCurv: number[] = new Array(count);
    for (let k = 0; k < count; k++) {
      const hp = headings[(k - 1 + count) % count];
      const hn = headings[(k + 1) % count];
      rawCurv[k] = angleDelta(hp, hn) / (2 * this.spacing);
    }
    const curv: number[] = new Array(count);
    const win = 4;
    for (let k = 0; k < count; k++) {
      let acc = 0;
      for (let j = -win; j <= win; j++) acc += rawCurv[(k + j + count) % count];
      curv[k] = acc / (2 * win + 1);
    }

    const theme = def.environment.theme;
    const defaultRunoff = SURFACE_RUNOFF_BY_THEME[theme];
    const runoffWidth = TRACK.runoffWidth[theme] ?? 12;
    const cpAttr = (i: number) => cps[((i % n) + n) % n];
    const widthOf = (cp: TrackControlPoint) => cp.width ?? def.defaultWidth;
    const barrierOf = (cp: TrackControlPoint, side: 'L' | 'R') => {
      const explicit = side === 'L' ? cp.barrierL : cp.barrierR;
      return explicit ?? widthOf(cp) / 2 + TRACK.kerbWidth + runoffWidth;
    };

    this.sectorS = [this.cpS[clamp(def.sectorEndCps[0], 0, n - 1)], this.cpS[clamp(def.sectorEndCps[1], 0, n - 1)]];

    this.samples = new Array(count);
    let cpIdx = 0;
    const box = new THREE.Box3();
    for (let k = 0; k < count; k++) {
      const s = k * this.spacing;
      while (cpIdx < n - 1 && this.cpS[cpIdx + 1] <= s) cpIdx++;
      const cpA = cpAttr(cpIdx);
      const cpB = cpAttr(cpIdx + 1);
      const sA = this.cpS[cpIdx];
      const sB = cpIdx + 1 < n ? this.cpS[cpIdx + 1] : this.length;
      const f = smoothstep(0, 1, sB > sA ? (s - sA) / (sB - sA) : 0);
      const t = tangents[k];
      const left = new THREE.Vector3(t.z, 0, -t.x).normalize();
      const normal = new THREE.Vector3().crossVectors(t, left).normalize();
      const sample: TrackSample = {
        s,
        position: positions[k],
        tangent: t,
        left,
        normal,
        width: lerp(widthOf(cpA), widthOf(cpB), f),
        curvature: curv[k],
        grade: t.y / Math.max(1e-6, Math.hypot(t.x, t.z)),
        heading: headings[k],
        kerbL: !!cpA.kerbL,
        kerbR: !!cpA.kerbR,
        runoffL: cpA.runoffL ?? defaultRunoff,
        runoffR: cpA.runoffR ?? defaultRunoff,
        barrierL: lerp(barrierOf(cpA, 'L'), barrierOf(cpB, 'L'), f),
        barrierR: lerp(barrierOf(cpA, 'R'), barrierOf(cpB, 'R'), f),
        sector: s < this.sectorS[0] ? 0 : s < this.sectorS[1] ? 1 : 2,
        cpIndex: cpIdx,
      };
      this.samples[k] = sample;
      box.expandByPoint(sample.position);
    }
    this.bounds = box.expandByScalar(60);

    // Spatial hash.
    for (let k = 0; k < count; k++) {
      const p = positions[k];
      const key = this.cellKey(p.x, p.z);
      const arr = this.grid.get(key);
      if (arr) arr.push(k);
      else this.grid.set(key, [k]);
    }

    // Pit lane.
    const side = def.pitLane.side;
    const entryS = this.cpS[clamp(def.pitLane.entryCp, 0, n - 1)];
    const exitS = this.cpS[clamp(def.pitLane.exitCp, 0, n - 1)];
    const pitLength = this.distanceForward(entryS, exitS);
    const transition = Math.min(130, pitLength * 0.28);
    const boxStartS = wrap(entryS + pitLength / 2 - ((PIT_TEAMS - 1) * TRACK.pitBoxSpacing) / 2, this.length);
    this.pitLane = {
      side,
      entryS,
      exitS,
      length: pitLength,
      offset: side * TRACK.pitLaneOffset,
      width: TRACK.pitLaneWidth,
      transition,
      boxStartS,
      limitStartD: transition * 0.75,
      limitEndD: pitLength - transition * 0.75,
    };

    // DRS zones.
    this.drsZones = def.drsZones.map((z: DrsZoneDef, i) => ({
      index: i,
      detectionS: this.cpS[clamp(z.detectionCp, 0, n - 1)],
      startS: this.cpS[clamp(z.startCp, 0, n - 1)],
      endS: this.cpS[clamp(z.endCp, 0, n - 1)],
    }));
  }

  /* ───────────────────────────── sampling ───────────────────────────── */

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  wrapS(s: number): number {
    return wrap(s, this.length);
  }

  /** Forward distance travelling from `fromS` to `toS` (0 ≤ d < length). */
  distanceForward(fromS: number, toS: number): number {
    return wrap(toS - fromS, this.length);
  }

  /** Signed shortest distance from a to b along the loop. */
  deltaS(a: number, b: number): number {
    return loopDelta(a, b, this.length);
  }

  /** Nearest stored sample (no interpolation). Fast. */
  sampleAt(s: number): TrackSample {
    const k = Math.round(this.wrapS(s) / this.spacing) % this.samples.length;
    return this.samples[k];
  }

  /** Interpolated sample at s. Allocates unless `out` is provided (out vectors are reused). */
  sample(s: number, out?: TrackSample): TrackSample {
    s = this.wrapS(s);
    const count = this.samples.length;
    const kf = s / this.spacing;
    const k0 = Math.floor(kf) % count;
    const k1 = (k0 + 1) % count;
    const u = kf - Math.floor(kf);
    const a = this.samples[k0];
    const b = this.samples[k1];
    const o: TrackSample =
      out ??
      ({
        s: 0,
        position: new THREE.Vector3(),
        tangent: new THREE.Vector3(),
        left: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        width: 0,
        curvature: 0,
        grade: 0,
        heading: 0,
        kerbL: false,
        kerbR: false,
        runoffL: 'grass',
        runoffR: 'grass',
        barrierL: 0,
        barrierR: 0,
        sector: 0,
        cpIndex: 0,
      } as TrackSample);
    o.s = s;
    o.position.lerpVectors(a.position, b.position, u);
    o.tangent.lerpVectors(a.tangent, b.tangent, u).normalize();
    o.left.set(o.tangent.z, 0, -o.tangent.x).normalize();
    o.normal.crossVectors(o.tangent, o.left).normalize();
    o.width = lerp(a.width, b.width, u);
    o.curvature = lerp(a.curvature, b.curvature, u);
    o.grade = lerp(a.grade, b.grade, u);
    o.heading = Math.atan2(o.tangent.x, o.tangent.z);
    o.kerbL = u < 0.5 ? a.kerbL : b.kerbL;
    o.kerbR = u < 0.5 ? a.kerbR : b.kerbR;
    o.runoffL = u < 0.5 ? a.runoffL : b.runoffL;
    o.runoffR = u < 0.5 ? a.runoffR : b.runoffR;
    o.barrierL = lerp(a.barrierL, b.barrierL, u);
    o.barrierR = lerp(a.barrierR, b.barrierR, u);
    o.sector = a.sector;
    o.cpIndex = a.cpIndex;
    return o;
  }

  /** World position for (s, lateral). */
  trackToWorld(s: number, lateral: number, out = new THREE.Vector3()): THREE.Vector3 {
    const sm = this.sample(s, _scratchSample);
    return out.copy(sm.position).addScaledVector(sm.left, lateral);
  }

  /** Ground height at (s, lateral). Flat across the width (run-off is level with the track). */
  heightAt(s: number, _lateral = 0): number {
    return this.sample(s, _scratchSample).position.y;
  }

  /**
   * Project a world XZ point onto the centreline. `hintS` (previous s) makes this O(1); without it a spatial hash is used.
   */
  project(x: number, z: number, hintS?: number, out?: TrackProjection): TrackProjection {
    const count = this.samples.length;
    let best = -1;
    let bestD2 = Infinity;

    if (hintS !== undefined && isFinite(hintS)) {
      const kc = Math.round(this.wrapS(hintS) / this.spacing);
      const win = Math.ceil(40 / this.spacing);
      for (let j = -win; j <= win; j++) {
        const k = (kc + j + count * 4) % count;
        const p = this.samples[k].position;
        const dx = p.x - x;
        const dz = p.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = k;
        }
      }
      // If the hint window result is far away, fall back to the grid search.
      if (bestD2 > 60 * 60) best = -1;
    }

    if (best < 0) {
      bestD2 = Infinity;
      const cx = Math.floor(x / this.cellSize);
      const cz = Math.floor(z / this.cellSize);
      for (let ring = 0; ring <= 40 && best < 0; ring++) {
        for (let ix = cx - ring; ix <= cx + ring; ix++) {
          for (let iz = cz - ring; iz <= cz + ring; iz++) {
            if (ring > 0 && Math.abs(ix - cx) !== ring && Math.abs(iz - cz) !== ring) continue;
            const arr = this.grid.get(`${ix},${iz}`);
            if (!arr) continue;
            for (const k of arr) {
              const p = this.samples[k].position;
              const dx = p.x - x;
              const dz = p.z - z;
              const d2 = dx * dx + dz * dz;
              if (d2 < bestD2) {
                bestD2 = d2;
                best = k;
              }
            }
          }
        }
        // Continue one more ring after the first hit to be safe near cell boundaries.
        if (best >= 0 && ring < 40) {
          const r2 = ring + 1;
          for (let ix = cx - r2; ix <= cx + r2; ix++) {
            for (let iz = cz - r2; iz <= cz + r2; iz++) {
              if (Math.abs(ix - cx) !== r2 && Math.abs(iz - cz) !== r2) continue;
              const arr = this.grid.get(`${ix},${iz}`);
              if (!arr) continue;
              for (const k of arr) {
                const p = this.samples[k].position;
                const dx = p.x - x;
                const dz = p.z - z;
                const d2 = dx * dx + dz * dz;
                if (d2 < bestD2) {
                  bestD2 = d2;
                  best = k;
                }
              }
            }
          }
          break;
        }
      }
      if (best < 0) {
        for (let k = 0; k < count; k++) {
          const p = this.samples[k].position;
          const dx = p.x - x;
          const dz = p.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = k;
          }
        }
      }
    }

    // Refine on the two adjacent segments.
    const kPrev = (best - 1 + count) % count;
    const kNext = (best + 1) % count;
    let bestS = this.samples[best].s;
    let bestLat = 0;
    let bestDist = Infinity;
    const trySeg = (ka: number, kb: number) => {
      const a = this.samples[ka].position;
      const b = this.samples[kb].position;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz;
      if (len2 < 1e-9) return;
      let u = ((x - a.x) * abx + (z - a.z) * abz) / len2;
      u = clamp(u, 0, 1);
      const px = a.x + abx * u;
      const pz = a.z + abz * u;
      const dx = x - px;
      const dz = z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist < bestDist) {
        bestDist = dist;
        bestS = this.wrapS(this.samples[ka].s + u * this.spacing);
        // left = (tz, -tx) with t = normalised ab
        const invLen = 1 / Math.sqrt(len2);
        const lx = abz * invLen;
        const lz = -abx * invLen;
        bestLat = dx * lx + dz * lz;
      }
    };
    trySeg(kPrev, best);
    trySeg(best, kNext);

    const o = out ?? { s: 0, lateral: 0, distance: 0 };
    o.s = bestS;
    o.lateral = bestLat;
    o.distance = bestDist;
    return o;
  }

  /* ───────────────────────────── surfaces & corridors ───────────────────────────── */

  sectorOf(s: number): number {
    s = this.wrapS(s);
    return s < this.sectorS[0] ? 0 : s < this.sectorS[1] ? 1 : 2;
  }

  /** Forward distance from pit entry, or -1 if s is not within the pit lane range. */
  pitD(s: number): number {
    const d = this.distanceForward(this.pitLane.entryS, s);
    return d <= this.pitLane.length ? d : -1;
  }

  /** Signed lateral of the pit lane centreline at forward distance d from entry. */
  pitLaneLateralAtD(d: number, width: number): number {
    const p = this.pitLane;
    const edge = p.side * (width / 2 - 1.2);
    if (d < p.transition) return lerp(edge, p.offset, smoothstep(0, 1, d / p.transition));
    if (d > p.length - p.transition) return lerp(p.offset, edge, smoothstep(0, 1, (d - (p.length - p.transition)) / p.transition));
    return p.offset;
  }

  /** Pit lane path sample at track-s (must be within pit range; clamps otherwise). */
  pitLaneSample(s: number, out?: PitLaneSample): PitLaneSample {
    const sm = this.sample(s, _scratchSample);
    let d = this.pitD(s);
    if (d < 0) d = this.distanceForward(this.pitLane.entryS, s) < this.length / 2 ? this.pitLane.length : 0;
    const lateral = this.pitLaneLateralAtD(d, sm.width);
    const o: PitLaneSample = out ?? { position: new THREE.Vector3(), tangent: new THREE.Vector3(), lateral: 0, d: 0, inTransition: false, speedLimited: false };
    o.position.copy(sm.position).addScaledVector(sm.left, lateral);
    // Tangent: include the lateral drift in transitions.
    const dl = this.pitLaneLateralAtD(Math.min(this.pitLane.length, d + 2), sm.width) - lateral;
    o.tangent.copy(sm.tangent).addScaledVector(sm.left, dl / 2).normalize();
    o.lateral = lateral;
    o.d = d;
    o.inTransition = d < this.pitLane.transition || d > this.pitLane.length - this.pitLane.transition;
    o.speedLimited = d >= this.pitLane.limitStartD && d <= this.pitLane.limitEndD;
    return o;
  }

  /** True if (s, lateral) is inside the pit lane corridor. */
  isInPitLane(s: number, lateral: number): boolean {
    const d = this.pitD(s);
    if (d < 0) return false;
    const width = this.sample(s, _scratchSample).width;
    const pl = this.pitLaneLateralAtD(d, width);
    // In the transitions the pit path overlaps the track edge; only count as "pit" once clear of the asphalt.
    if (Math.abs(lateral - pl) > this.pitLane.width / 2) return false;
    return Math.abs(lateral) > width / 2 + 0.3 || (d > this.pitLane.transition && d < this.pitLane.length - this.pitLane.transition);
  }

  surfaceAt(s: number, lateral: number): SurfaceType {
    const sm = this.sample(s, _scratchSample);
    const hw = sm.width / 2;
    const a = Math.abs(lateral);
    const pitSide = lateral * this.pitLane.side > 0;
    const d = this.pitD(s);
    if (d >= 0 && pitSide) {
      const pl = this.pitLaneLateralAtD(d, sm.width);
      const inLane = Math.abs(lateral - pl) <= this.pitLane.width / 2;
      const inTransition = d < this.pitLane.transition || d > this.pitLane.length - this.pitLane.transition;
      if (a <= hw) return 'asphalt';
      if (inLane) return a > hw + 0.3 || !inTransition ? 'pit' : 'asphalt';
      if (inTransition) {
        // Between the track edge and the pit lane: pit entry/exit road.
        if (a < Math.abs(pl) + this.pitLane.width / 2) return 'runoff';
        return 'wall';
      }
      const kerb = this.pitLane.side > 0 ? sm.kerbL : sm.kerbR;
      if (kerb && a <= hw + TRACK.kerbWidth) return 'kerb';
      return 'wall';
    }
    if (a <= hw) return 'asphalt';
    const kerb = lateral > 0 ? sm.kerbL : sm.kerbR;
    if (kerb && a <= hw + TRACK.kerbWidth) return 'kerb';
    const barrier = lateral > 0 ? sm.barrierL : sm.barrierR;
    if (a >= barrier) return 'wall';
    return lateral > 0 ? sm.runoffL : sm.runoffR;
  }

  /** Lateral bounds of the corridor containing (s, lateral). Physics collides with walls at these laterals. */
  corridorAt(s: number, lateral: number, out?: Corridor): Corridor {
    const sm = this.sample(s, _scratchSample);
    const o: Corridor = out ?? { kind: 'track', minLateral: 0, maxLateral: 0 };
    const side = this.pitLane.side;
    const d = this.pitD(s);
    let minL = -sm.barrierR;
    let maxL = sm.barrierL;
    o.kind = 'track';
    if (d >= 0) {
      const pl = this.pitLaneLateralAtD(d, sm.width);
      const inTransition = d < this.pitLane.transition || d > this.pitLane.length - this.pitLane.transition;
      const laneNear = pl - side * (this.pitLane.width / 2);
      const laneFar = pl + side * (this.pitLane.width / 2);
      const inLane = Math.abs(lateral - pl) <= this.pitLane.width / 2 && Math.abs(lateral) > sm.width / 2 + 0.3;
      if (inTransition) {
        o.kind = 'merged';
        if (side > 0) maxL = Math.max(laneFar, sm.width / 2 + 1);
        else minL = Math.min(laneFar, -sm.width / 2 - 1);
      } else if (inLane) {
        o.kind = 'pit';
        minL = Math.min(laneNear, laneFar);
        maxL = Math.max(laneNear, laneFar);
      } else {
        // Pit wall between track and pit lane.
        const wall = side * (sm.width / 2 + TRACK.kerbWidth + 1.4);
        if (side > 0) maxL = wall;
        else minL = wall;
      }
    }
    o.minLateral = minL;
    o.maxLateral = maxL;
    return o;
  }

  drsZoneAt(s: number): DrsZone | null {
    s = this.wrapS(s);
    for (const z of this.drsZones) {
      const len = this.distanceForward(z.startS, z.endS);
      if (this.distanceForward(z.startS, s) <= len) return z;
    }
    return null;
  }

  /* ───────────────────────────── grid & pit boxes ───────────────────────────── */

  /** Grid slot for position index (0 = pole). Slots extend backwards from the S/F line, staggered. */
  gridSlot(index: number): GridSlot {
    const s = this.wrapS(-(10 + TRACK.gridRowSpacing * index));
    const side = index % 2 === 0 ? this.def.poleSide : -this.def.poleSide;
    const lateral = side * TRACK.gridLateralOffset;
    return this.slotAt(s, lateral);
  }

  /** Pit box for a team's pitBoxIndex (0..9). Cars stop here, aligned with the pit lane. */
  pitBox(index: number): GridSlot {
    const s = this.wrapS(this.pitLane.boxStartS + index * TRACK.pitBoxSpacing);
    const sm = this.sample(s, _scratchSample);
    const d = this.pitD(s);
    const lateral = this.pitLaneLateralAtD(d < 0 ? this.pitLane.length / 2 : d, sm.width);
    return this.slotAt(s, lateral);
  }

  private slotAt(s: number, lateral: number): GridSlot {
    const sm = this.sample(s);
    const position = sm.position.clone().addScaledVector(sm.left, lateral);
    const yaw = sm.heading;
    const quaternion = new THREE.Quaternion().setFromAxisAngle(_up, yaw);
    return { position, yaw, quaternion, s, lateral };
  }

  /* ───────────────────────────── helpers ───────────────────────────── */

  /** Approximate the minimum barrier-to-barrier extent (for cameras / culling). */
  get maxHalfExtent(): number {
    let m = 0;
    for (const sm of this.samples) m = Math.max(m, sm.barrierL, sm.barrierR);
    return m;
  }

  /** Iterate control-point s values as corner list with numbering. */
  cornersWithS(): { number: number; name: string; s: number; cp: number }[] {
    return this.def.corners.map((c, i) => ({
      number: i + 1,
      name: c.name ?? `Turn ${i + 1}`,
      s: this.cpS[clamp(c.cp, 0, this.cpS.length - 1)],
      cp: c.cp,
    }));
  }

  /** Curvature-based "corner speed" estimate at s for a given lateral g limit (m/s). Handy for AI / cameras / boards. */
  cornerSpeed(s: number, lateralG = 4.0): number {
    const k = Math.abs(this.sample(s, _scratchSample).curvature);
    if (k < 1e-4) return 100;
    return Math.min(100, Math.sqrt((lateralG * 9.81) / k));
  }

  toLocalXZ(pos: THREE.Vector3): { s: number; lateral: number } {
    const p = this.project(pos.x, pos.z);
    return { s: p.s, lateral: p.lateral };
  }

  /** Forward unit vector at s (XZ). */
  forwardAt(s: number, out = _v): THREE.Vector3 {
    const sm = this.sample(s, _scratchSample);
    return out.set(sm.tangent.x, 0, sm.tangent.z).normalize();
  }

  /** Left unit vector at s (XZ). */
  leftAt(s: number, out = _v2): THREE.Vector3 {
    return out.copy(this.sample(s, _scratchSample).left);
  }
}

const _scratchSample: TrackSample = {
  s: 0,
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  left: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  width: 0,
  curvature: 0,
  grade: 0,
  heading: 0,
  kerbL: false,
  kerbR: false,
  runoffL: 'grass',
  runoffR: 'grass',
  barrierL: 0,
  barrierR: 0,
  sector: 0,
  cpIndex: 0,
};
