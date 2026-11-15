/**
 * Procedural 2022+-regulation F1 car rig. Builds the geometry once per detail level and instantiates a `CarRig` per
 * car: a hierarchy with named animated nodes (wheels, steering, DRS flap, driver head, suspension arms, brake glow).
 *
 * Car local frame: +Z forward, +X left, +Y up, origin at the centre of the wheelbase on the ground plane.
 */
import * as THREE from 'three';
import { CAR, WHEEL_LOCAL_POSITIONS, type TyreCompound } from '../core/constants';
import type { DriverDef, TeamDef } from '../core/types';
import { ATLAS, BODY_Z_FRONT, BODY_Z_REAR, DECAL, POD_Z_FRONT, POD_Z_REAR, tyreProfile } from './atlas';
import { fanCap, loft, mergeParts, mirrorX, monotone, orientArm, placed, plateXZ, plateZY, remapUV, wingLoft, type UVRect, type V2, type V3 } from './geom';
import type { CarMaterialLibrary } from './materials';

export type Detail = 'high' | 'low';

/* ─────────────────────────────── profiles ─────────────────────────────── */

interface BodyKeys {
  z: number;
  y0: number;
  y1: number;
  hw0: number;
  hw1: number;
  n: number;
}

// Monocoque + nose + engine cover + airbox in one loft (rear → front so u increases with z).
const BODY_KEYS: BodyKeys[] = [
  { z: -2.62, y0: 0.22, y1: 0.44, hw0: 0.08, hw1: 0.05, n: 2 },
  { z: -2.35, y0: 0.16, y1: 0.48, hw0: 0.16, hw1: 0.06, n: 2.2 },
  { z: -2.0, y0: 0.1, y1: 0.52, hw0: 0.26, hw1: 0.06, n: 2.4 },
  { z: -1.6, y0: 0.06, y1: 0.64, hw0: 0.34, hw1: 0.08, n: 2.5 },
  { z: -1.2, y0: 0.06, y1: 0.8, hw0: 0.4, hw1: 0.12, n: 2.8 },
  { z: -0.9, y0: 0.06, y1: 0.94, hw0: 0.42, hw1: 0.16, n: 3 },
  { z: -0.6, y0: 0.06, y1: 0.94, hw0: 0.42, hw1: 0.17, n: 3 },
  { z: -0.45, y0: 0.06, y1: 0.76, hw0: 0.4, hw1: 0.3, n: 4 },
  { z: -0.1, y0: 0.06, y1: 0.72, hw0: 0.38, hw1: 0.34, n: 5 },
  { z: 0.4, y0: 0.06, y1: 0.72, hw0: 0.36, hw1: 0.34, n: 5 },
  { z: 0.8, y0: 0.06, y1: 0.72, hw0: 0.34, hw1: 0.3, n: 4.5 },
  { z: 1.3, y0: 0.08, y1: 0.7, hw0: 0.32, hw1: 0.25, n: 4 },
  { z: 1.8, y0: 0.12, y1: 0.64, hw0: 0.27, hw1: 0.2, n: 3.5 },
  { z: 2.2, y0: 0.16, y1: 0.5, hw0: 0.16, hw1: 0.13, n: 3 },
  { z: 2.6, y0: 0.2, y1: 0.4, hw0: 0.1, hw1: 0.09, n: 2.5 },
  { z: 2.9, y0: 0.24, y1: 0.34, hw0: 0.05, hw1: 0.05, n: 2 },
];

interface PodKeys {
  z: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  n: number;
}

const POD_KEYS: PodKeys[] = [
  { z: -2.1, x0: 0.2, x1: 0.36, y0: 0.12, y1: 0.3, n: 3 },
  { z: -1.5, x0: 0.3, x1: 0.62, y0: 0.08, y1: 0.4, n: 3.5 },
  { z: -0.9, x0: 0.38, x1: 0.84, y0: 0.08, y1: 0.5, n: 4 },
  { z: -0.3, x0: 0.4, x1: 0.96, y0: 0.09, y1: 0.58, n: 4.5 },
  { z: 0.3, x0: 0.4, x1: 0.99, y0: 0.14, y1: 0.62, n: 4 },
  { z: 0.66, x0: 0.4, x1: 0.98, y0: 0.2, y1: 0.62, n: 3.5 },
];

const interp = <K extends { z: number }>(keys: K[], field: Exclude<keyof K, 'z'>) => monotone(keys.map((k) => [k.z, k[field] as number] as V2));

/** Superellipse-ish closed profile: t in [0,1) runs bottom-centre → right side → top → left side → bottom. */
const superProfile = (N: number, z: number, y0: number, y1: number, hw0: number, hw1: number, n: number): V3[] => {
  const pts: V3[] = [];
  const yc = (y0 + y1) / 2;
  const hh = (y1 - y0) / 2;
  const e = 2 / n;
  for (let k = 0; k < N; k++) {
    const t = k / N;
    const side = t < 0.5 ? -1 : 1;
    const f = t < 0.5 ? t * 2 : (1 - t) * 2;
    const phi = -Math.PI / 2 + Math.PI * f;
    const sy = Math.sin(phi);
    const cx = Math.cos(phi);
    const yN = Math.sign(sy) * Math.pow(Math.abs(sy), e);
    const xN = Math.pow(Math.abs(cx), e);
    const hw = hw0 + (hw1 - hw0) * (yN + 1) * 0.5;
    pts.push([side * hw * xN, yc + hh * yN, z]);
  }
  return pts;
};

/** Rounded-box profile centred at (xc, yc). */
const boxProfile = (N: number, z: number, x0: number, x1: number, y0: number, y1: number, n: number): V3[] => {
  const pts: V3[] = [];
  const xc = (x0 + x1) / 2;
  const yc = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  const e = 2 / n;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push([xc + hw * Math.sign(c) * Math.pow(Math.abs(c), e), yc + hh * Math.sign(s) * Math.pow(Math.abs(s), e), z]);
  }
  return pts;
};

/* ─────────────────────────────── geometry set ─────────────────────────────── */

export interface CarGeometry {
  detail: Detail;
  /** Livery-mapped bodywork (monocoque, pods, fin, rear-wing main + endplates). */
  livery: THREE.BufferGeometry;
  /** Static carbon parts (floor, diffuser, halo, mirrors, mounts, intake caps, T-cam...). */
  carbon: THREE.BufferGeometry;
  /** Front wing pieces (livery material). */
  fwMain: THREE.BufferGeometry;
  fwFlapsL: THREE.BufferGeometry;
  fwFlapsR: THREE.BufferGeometry;
  fwEpL: THREE.BufferGeometry;
  fwEpR: THREE.BufferGeometry;
  /** DRS flap, trailing edge at the origin (pivot). */
  rwFlap: THREE.BufferGeometry;
  /** Decal quads (nose number, fin numbers, side codes). */
  decals: THREE.BufferGeometry;
  rainLight: THREE.BufferGeometry;
  tyreF: THREE.BufferGeometry;
  tyreR: THREE.BufferGeometry;
  rimF: THREE.BufferGeometry;
  rimR: THREE.BufferGeometry;
  brakeDisc: THREE.BufferGeometry;
  caliper: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  helmet: THREE.BufferGeometry;
  helmetStripe: THREE.BufferGeometry;
  helmetTop: THREE.BufferGeometry;
  visor: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  arms: THREE.BufferGeometry;
  hands: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  all: THREE.BufferGeometry[];
}

const ring = (N: number, base: number): number => Math.max(base, N);

export const buildCarGeometry = (detail: Detail): CarGeometry => {
  const hi = detail === 'high';
  const NB = hi ? 36 : 14; // body profile points
  const SB = hi ? 46 : 16; // body stations
  const NP = hi ? 20 : 10;
  const SP = hi ? 22 : 8;
  const WS = hi ? 40 : 14; // wheel segments
  const all: THREE.BufferGeometry[] = [];
  const keep = <T extends THREE.BufferGeometry>(g: T): T => {
    all.push(g);
    return g;
  };

  /* ── body loft */
  const bY0 = interp(BODY_KEYS, 'y0');
  const bY1 = interp(BODY_KEYS, 'y1');
  const bH0 = interp(BODY_KEYS, 'hw0');
  const bH1 = interp(BODY_KEYS, 'hw1');
  const bN = interp(BODY_KEYS, 'n');
  const bodyStations: V3[][] = [];
  const bodyT: number[] = [];
  for (let i = 0; i < SB; i++) {
    // Denser sampling where the airbox rises / the nose tapers.
    const f = i / (SB - 1);
    const z = BODY_Z_REAR + (BODY_Z_FRONT - BODY_Z_REAR) * f;
    bodyStations.push(superProfile(NB, z, bY0(z), bY1(z), bH0(z), bH1(z), bN(z)));
    bodyT.push(f);
  }
  const body = loft(bodyStations, { uv: ATLAS.body, stationT: bodyT, closed: true });
  // Cap the tail (exhaust box) and the nose tip.
  const tailCap = fanCap(bodyStations[0], [0, 0, -1]);
  const noseCap = fanCap(bodyStations[SB - 1], [0, 0, 1]);

  /* ── sidepods */
  const pX0 = interp(POD_KEYS, 'x0');
  const pX1 = interp(POD_KEYS, 'x1');
  const pY0 = interp(POD_KEYS, 'y0');
  const pY1 = interp(POD_KEYS, 'y1');
  const pN = interp(POD_KEYS, 'n');
  const podStations: V3[][] = [];
  const podT: number[] = [];
  for (let i = 0; i < SP; i++) {
    const f = i / (SP - 1);
    const z = POD_Z_REAR + (POD_Z_FRONT - POD_Z_REAR) * f;
    podStations.push(boxProfile(NP, z, pX0(z), pX1(z), pY0(z), pY1(z), pN(z)));
    podT.push(f);
  }
  const podL = loft(podStations, { uv: ATLAS.podL, stationT: podT, closed: true });
  const podR = mirrorX(podL, ATLAS.podR);
  remapUV(podR, ATLAS.podR);
  const inletL = fanCap(
    podStations[SP - 1].map(([x, y, z]) => [x, y, z - 0.03] as V3),
    [0, 0, 1],
  );
  const inletR = mirrorX(inletL);

  /* ── engine cover fin */
  const finOutline: V2[] = [
    [-0.8, 0.9],
    [-1.0, 1.0],
    [-1.6, 0.96],
    [-2.05, 0.78],
    [-2.05, 0.4],
    [-0.9, 0.4],
  ];
  const fin = plateZY(finOutline, 0.02, 0, ATLAS.fin, 0.02, 0.002);

  /* ── rear wing */
  const rwEpOutline: V2[] = [
    [-1.98, 0.62],
    [-2.05, 0.58],
    [-2.66, 0.58],
    [-2.72, 1.06],
    [-2.1, 1.06],
    [-1.96, 0.82],
  ];
  const bevel = hi ? 0.002 : 0;
  const rwEpL = plateZY(rwEpOutline, 0.016, 0.5, ATLAS.rwEp, 0.02, bevel);
  const rwEpR = mirrorX(rwEpL, ATLAS.rwEp);
  const rwMain = wingLoft({
    x0: -0.49,
    x1: 0.49,
    stations: hi ? 9 : 3,
    N: hi ? 22 : 10,
    thick: 0.11,
    camber: 0.1,
    upperFirst: true,
    uv: ATLAS.rwMain,
    chord: () => 0.32,
    alpha: () => 0.18,
    y: (x) => 0.85 - 0.02 * Math.pow(Math.abs(x) / 0.49, 2),
    z: () => -2.15,
  });
  const FLAP_CHORD = 0.22;
  const FLAP_ALPHA = 0.6;
  // DRS flap: built so its trailing edge sits at the origin; placed by the rig at the pivot.
  const rwFlap = wingLoft({
    x0: -0.485,
    x1: 0.485,
    stations: hi ? 7 : 3,
    N: hi ? 18 : 10,
    thick: 0.09,
    camber: 0.06,
    upperFirst: true,
    uv: ATLAS.rwFlap,
    chord: () => FLAP_CHORD,
    alpha: () => FLAP_ALPHA,
    y: () => -FLAP_CHORD * Math.sin(FLAP_ALPHA),
    z: () => FLAP_CHORD * Math.cos(FLAP_ALPHA),
  });
  // Beam wing (carbon), swan-neck mounts.
  const beam = wingLoft({
    x0: -0.46,
    x1: 0.46,
    stations: 3,
    N: hi ? 14 : 8,
    thick: 0.1,
    camber: 0.08,
    upperFirst: true,
    uv: ATLAS.misc,
    chord: () => 0.2,
    alpha: () => 0.4,
    y: () => 0.6,
    z: () => -2.22,
  });
  const mountL = plateZY(
    [
      [-1.9, 0.5],
      [-2.2, 0.5],
      [-2.34, 0.9],
      [-2.2, 0.92],
    ],
    0.02,
    0.13,
    ATLAS.misc,
    0.01,
    0,
  );
  const mountR = mirrorX(mountL);

  /* ── front wing */
  const fwMainGeo = wingLoft({
    x0: -0.97,
    x1: 0.97,
    stations: hi ? 17 : 5,
    N: hi ? 20 : 10,
    thick: 0.1,
    camber: 0.06,
    upperFirst: true,
    uv: ATLAS.fw1,
    chord: (x) => 0.42 - 0.14 * Math.exp(-((x / 0.22) * (x / 0.22))),
    alpha: (x) => 0.1 + 0.08 * Math.exp(-((x / 0.22) * (x / 0.22))),
    y: (x) => 0.11 + 0.06 * Math.pow(Math.abs(x) / 0.97, 2),
    z: () => 2.95,
  });
  const pylonL = plateZY(
    [
      [2.35, 0.14],
      [2.75, 0.14],
      [2.75, 0.3],
      [2.4, 0.26],
    ],
    0.03,
    0.1,
    ATLAS.misc,
    0.01,
    0,
  );
  const pylonR = mirrorX(pylonL);
  const fwMain = mergeParts([fwMainGeo, pylonL, pylonR]);
  const flapSpec = (x0: number, x1: number, uv: UVRect, chord: number, zLE: number, y: number, alpha: number) =>
    wingLoft({
      x0,
      x1,
      stations: hi ? 7 : 3,
      N: hi ? 16 : 8,
      thick: 0.1,
      camber: 0.08,
      upperFirst: true,
      uv,
      chord: () => chord,
      alpha: () => alpha,
      y: (x) => y + 0.05 * Math.pow((Math.abs(x) - 0.28) / 0.68, 2),
      z: () => zLE,
    });
  const fwFlapsL = mergeParts([flapSpec(0.28, 0.955, ATLAS.fw2, 0.28, 2.6, 0.2, 0.34), flapSpec(0.3, 0.955, ATLAS.fw3, 0.22, 2.4, 0.3, 0.55)]);
  const fwFlapsR = mirrorX(fwFlapsL);
  const fwEpOutline: V2[] = [
    [3.02, 0.08],
    [2.32, 0.06],
    [2.24, 0.4],
    [2.58, 0.44],
    [3.06, 0.14],
  ];
  const fwEpL = plateZY(fwEpOutline, 0.012, 0.985, ATLAS.fwEp, 0.02, bevel, (_z, y) => 0.06 * Math.max(0, (y - 0.08) / 0.36));
  const fwEpR = mirrorX(fwEpL, ATLAS.fwEp);

  /* ── floor & diffuser (carbon) */
  const floorOutline: V2[] = [
    [0.3, 1.3],
    [0.62, 1.15],
    [0.86, 0.75],
    [0.98, 0.2],
    [0.98, -1.1],
    [0.86, -1.7],
    [0.55, -2.05],
    [-0.55, -2.05],
    [-0.86, -1.7],
    [-0.98, -1.1],
    [-0.98, 0.2],
    [-0.86, 0.75],
    [-0.62, 1.15],
    [-0.3, 1.3],
  ];
  const floor = plateXZ(floorOutline, 0.03, 0.05, ATLAS.misc, 0.03, 0.002);
  // Floor edge wings.
  const edgeL = placed(plateXZ([[0.0, 0.0], [0.08, -0.02], [0.08, -1.0], [0.0, -1.1]], 0.012, 0, ATLAS.misc, 0.005, 0), [0.9, 0.09, 0.3]);
  const edgeR = mirrorX(edgeL);
  // Diffuser: rising plate + strakes.
  const diffuser = plateXZ(
    [
      [0.55, 0.0],
      [-0.55, 0.0],
      [-0.5, -0.55],
      [0.5, -0.55],
    ],
    0.02,
    0,
    ATLAS.misc,
    0.01,
    0,
  );
  placed(diffuser, [0, 0.07, -1.55], [0.22, 0, 0]);
  const strakes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const x = -0.36 + i * 0.24;
    strakes.push(
      plateZY(
        [
          [-1.6, 0.06],
          [-2.08, 0.06],
          [-2.08, 0.22],
          [-1.7, 0.1],
        ],
        0.01,
        x,
        ATLAS.misc,
        0.005,
        0,
      ),
    );
  }

  /* ── halo (carbon) */
  const haloRing = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, 0.93, 0.5),
      new THREE.Vector3(0.3, 0.945, 0.36),
      new THREE.Vector3(0.44, 0.96, 0.0),
      new THREE.Vector3(0.4, 0.97, -0.42),
      new THREE.Vector3(0.18, 0.98, -0.62),
      new THREE.Vector3(-0.18, 0.98, -0.62),
      new THREE.Vector3(-0.4, 0.97, -0.42),
      new THREE.Vector3(-0.44, 0.96, 0.0),
      new THREE.Vector3(-0.3, 0.945, 0.36),
    ],
    true,
    'catmullrom',
    0.5,
  );
  const haloTube = new THREE.TubeGeometry(haloRing, hi ? 64 : 24, 0.036, hi ? 10 : 6, true);
  const haloPylonCurve = new THREE.LineCurve3(new THREE.Vector3(0, 0.66, 0.78), new THREE.Vector3(0, 0.93, 0.5));
  const haloPylon = new THREE.TubeGeometry(haloPylonCurve, 2, 0.03, hi ? 10 : 6, false);
  // Cockpit rim padding.
  const rimCurve = new THREE.EllipseCurve(0, 0, 0.29, 0.46, 0, Math.PI * 2, false, 0);
  const rimPts = rimCurve.getPoints(hi ? 40 : 16).map((p) => new THREE.Vector3(p.x, 0.72, p.y + 0.05));
  const cockpitRim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), hi ? 40 : 16, 0.03, hi ? 8 : 5, true);
  // Headrest behind the helmet.
  const headrest = placed(new THREE.BoxGeometry(0.36, 0.2, 0.1), [0, 0.8, -0.58]);
  // Mirrors + stalks.
  const mirrorL = placed(new THREE.BoxGeometry(0.16, 0.07, 0.06), [0.6, 0.76, 0.5]);
  const stalkL = new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6);
  placed(stalkL, [0.48, 0.72, 0.5], [0, 0, Math.PI / 2 - 0.3]);
  const mirrorR = mirrorX(mirrorL);
  const stalkR = mirrorX(stalkL);
  // T-cam.
  const tcam = placed(new THREE.BoxGeometry(0.1, 0.04, 0.13), [0, 0.945, -0.6]);
  // Airbox intake cap (dark).
  const intake = fanCap(
    [
      [-0.15, 0.78, -0.46],
      [0.15, 0.78, -0.46],
      [0.1, 0.93, -0.56],
      [-0.1, 0.93, -0.56],
    ],
    [0, 0.3, 1],
  );
  // Brake ducts (inboard of each wheel).
  const ducts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const [wx, , wz] = WHEEL_LOCAL_POSITIONS[i];
    const side = Math.sign(wx);
    ducts.push(placed(new THREE.BoxGeometry(0.06, 0.24, 0.3), [wx - side * 0.24, 0.36, wz]));
  }
  // Exhaust.
  const exhaust = new THREE.CylinderGeometry(0.045, 0.05, 0.14, hi ? 12 : 6, 1, true);
  placed(exhaust, [0, 0.4, -2.64], [Math.PI / 2 - 0.15, 0, 0]);

  const carbon = mergeParts([floor, edgeL, edgeR, diffuser, ...strakes, haloTube, haloPylon, cockpitRim, headrest, mirrorL, mirrorR, stalkL, stalkR, tcam, intake, ...ducts, exhaust, beam, mountL, mountR, inletL, inletR, tailCap]);

  const livery = mergeParts([body, noseCap, podL, podR, fin, rwMain, rwEpL, rwEpR]);

  /* ── decals */
  const quad = (w: number, h: number, uv: UVRect, pos: V3, normal: V3, up: V3 = [0, 1, 0]): THREE.BufferGeometry => {
    const g = remapUV(new THREE.PlaneGeometry(w, h), uv);
    const p = new THREE.Vector3(...pos);
    const n = new THREE.Vector3(...normal).normalize();
    const m = new THREE.Matrix4().lookAt(p, p.clone().sub(n), new THREE.Vector3(...up));
    m.setPosition(p);
    g.applyMatrix4(m);
    return g;
  };
  // Nose number on top of the nose (reads from the front), fin numbers both sides, driver codes on the flanks.
  const noseNum = quad(0.16, 0.2, DECAL.nose, [0, 0.548, 2.05], [0, 0.96, 0.28], [0, 0, -1]);
  const finNumL = quad(0.24, 0.18, DECAL.fin, [0.012, 0.86, -1.35], [1, 0, 0]);
  const finNumR = quad(0.24, 0.18, DECAL.fin, [-0.012, 0.86, -1.35], [-1, 0, 0]);
  const codeL = quad(0.34, 0.16, DECAL.codeL, [0.235, 0.62, -1.0], [0.84, 0.55, 0]);
  const codeR = quad(0.34, 0.16, DECAL.codeR, [-0.235, 0.62, -1.0], [-0.84, 0.55, 0]);
  const decals = mergeParts([noseNum, finNumL, finNumR, codeL, codeR]);

  const rainLight = placed(new THREE.BoxGeometry(0.05, 0.14, 0.03), [0, 0.3, -2.66]);

  /* ── wheels */
  const lathe = (h: number): THREE.BufferGeometry => {
    const pts = tyreProfile(h).map(([r, a]) => new THREE.Vector2(r, a));
    const g = new THREE.LatheGeometry(pts, WS);
    g.rotateZ(-Math.PI / 2);
    return g;
  };
  const tyreF = lathe(CAR.frontTyreWidth / 2);
  const tyreR = lathe(CAR.rearTyreWidth / 2);
  const rimGeo = (h: number): THREE.BufferGeometry => {
    const barrel = new THREE.CylinderGeometry(0.236, 0.236, h * 2 - 0.04, WS, 1, true);
    barrel.rotateZ(-Math.PI / 2);
    // Wheel cover: shallow dish on the outer face; spokes hinted by the inner disc.
    const cover = new THREE.CircleGeometry(0.236, WS);
    cover.rotateY(Math.PI / 2);
    cover.translate(h - 0.03, 0, 0);
    const inner = new THREE.RingGeometry(0.2, 0.236, WS, 1);
    inner.rotateY(-Math.PI / 2);
    inner.translate(-(h - 0.03), 0, 0);
    const nut = new THREE.CylinderGeometry(0.035, 0.035, 0.04, 6);
    nut.rotateZ(-Math.PI / 2);
    nut.translate(h - 0.01, 0, 0);
    return mergeParts([barrel, cover, inner, nut]);
  };
  const rimF = rimGeo(CAR.frontTyreWidth / 2);
  const rimR = rimGeo(CAR.rearTyreWidth / 2);
  const brakeDisc = new THREE.CylinderGeometry(0.19, 0.19, 0.03, ring(WS, 16), 1, false);
  brakeDisc.rotateZ(-Math.PI / 2);
  const caliper = new THREE.BoxGeometry(0.06, 0.14, 0.1);
  caliper.translate(0, -0.13, 0.12);

  /* ── suspension arm (unit cylinder along Y) */
  const arm = new THREE.CylinderGeometry(1, 1, 1, hi ? 8 : 5, 1);

  /* ── driver */
  const helmet = new THREE.SphereGeometry(0.135, hi ? 24 : 10, hi ? 16 : 8);
  helmet.scale(1, 1.05, 1.08);
  const helmetStripe = new THREE.TorusGeometry(0.128, 0.022, hi ? 8 : 4, hi ? 32 : 12);
  helmetStripe.rotateX(Math.PI / 2);
  helmetStripe.translate(0, 0.045, 0);
  const helmetTop = new THREE.SphereGeometry(0.128, hi ? 20 : 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.32);
  helmetTop.translate(0, 0.012, 0);
  // SphereGeometry: phi = π/2 points along +Z, so centre the visor window there.
  const visor = new THREE.SphereGeometry(0.142, hi ? 20 : 10, 10, Math.PI * 0.12, Math.PI * 0.76, Math.PI * 0.36, Math.PI * 0.26);
  visor.scale(1, 1.05, 1.08);
  const torso = new THREE.BoxGeometry(0.42, 0.16, 0.3);
  torso.translate(0, 0.66, -0.3);
  const hans = new THREE.CylinderGeometry(0.07, 0.09, 0.1, 10);
  hans.translate(0, 0.66, -0.4);
  const torsoAll = mergeParts([torso, hans]);
  const armGeo = (side: number): THREE.BufferGeometry => {
    const g = new THREE.CylinderGeometry(0.038, 0.045, 1, 8);
    const tmp = new THREE.Object3D();
    orientArm(tmp, new THREE.Vector3(side * 0.19, 0.7, -0.24), new THREE.Vector3(side * 0.13, 0.66, 0.18), 1, 1);
    tmp.updateMatrix();
    g.applyMatrix4(tmp.matrix);
    return g;
  };
  const arms = mergeParts([armGeo(1), armGeo(-1)]);
  const handL = new THREE.SphereGeometry(0.045, 8, 6);
  handL.translate(0.13, 0, 0.01);
  const handR = new THREE.SphereGeometry(0.045, 8, 6);
  handR.translate(-0.13, 0, 0.01);
  const hands = mergeParts([handL, handR]);
  // Steering wheel: rectangular rim + centre display, built in the XY plane (rotation about Z = steering).
  const wheelRim = new THREE.TorusGeometry(0.12, 0.018, 8, hi ? 24 : 12);
  wheelRim.scale(1.15, 0.7, 1);
  const wheelHub = new THREE.BoxGeometry(0.16, 0.1, 0.03);
  const wheel = mergeParts([wheelRim, wheelHub]);

  const set: CarGeometry = {
    detail,
    livery: keep(livery),
    carbon: keep(carbon),
    fwMain: keep(fwMain),
    fwFlapsL: keep(fwFlapsL),
    fwFlapsR: keep(fwFlapsR),
    fwEpL: keep(fwEpL),
    fwEpR: keep(fwEpR),
    rwFlap: keep(rwFlap),
    decals: keep(decals),
    rainLight: keep(rainLight),
    tyreF: keep(tyreF),
    tyreR: keep(tyreR),
    rimF: keep(rimF),
    rimR: keep(rimR),
    brakeDisc: keep(brakeDisc),
    caliper: keep(caliper),
    arm: keep(arm),
    helmet: keep(helmet),
    helmetStripe: keep(helmetStripe),
    helmetTop: keep(helmetTop),
    visor: keep(visor),
    torso: keep(torsoAll),
    arms: keep(arms),
    hands: keep(hands),
    wheel: keep(wheel),
    all,
  };
  return set;
};

/* ─────────────────────────────── suspension pickups ─────────────────────────────── */

interface ArmDef {
  /** Chassis pickup (car local). */
  a: V3;
  /** Offset from the wheel centre to the upright pickup (car local). */
  b: V3;
  rx: number;
  rz: number;
}

const armDefs = (wheel: number): ArmDef[] => {
  const [wx, , wz] = WHEEL_LOCAL_POSITIONS[wheel];
  const s = Math.sign(wx);
  const front = wheel < 2;
  const inb = s * (front ? -0.19 : -0.22); // upright pickup inboard of the wheel centre
  const zf = front ? 0.25 : 0.3;
  const xu = front ? 0.2 : 0.12; // upper chassis pickups
  const xl = front ? 0.25 : 0.22; // lower chassis pickups
  return [
    { a: [s * xu, 0.56, wz + zf], b: [inb, 0.16, 0.02], rx: 0.012, rz: 0.03 },
    { a: [s * xu, 0.54, wz - zf], b: [inb, 0.16, -0.02], rx: 0.012, rz: 0.03 },
    { a: [s * xl, 0.15, wz + zf], b: [inb, -0.16, 0.0], rx: 0.012, rz: 0.03 },
    { a: [s * xl, 0.15, wz - zf], b: [inb, -0.16, 0.0], rx: 0.012, rz: 0.03 },
    { a: [s * (front ? 0.18 : 0.14), front ? 0.62 : 0.55, wz - 0.1], b: [inb, -0.12, -0.02], rx: 0.011, rz: 0.018 },
    front ? { a: [s * 0.24, 0.36, wz - 0.2], b: [inb, 0.0, -0.08], rx: 0.01, rz: 0.02 } : { a: [s * 0.2, 0.36, wz], b: [inb, 0.0, 0.0], rx: 0.022, rz: 0.022 },
  ];
};

const ARM_DEFS: ArmDef[][] = [0, 1, 2, 3].map(armDefs);
export const ARMS_PER_CAR = 24;

/* ─────────────────────────────── rig ─────────────────────────────── */

export interface WheelRig {
  hub: THREE.Group;
  spin: THREE.Group;
  tyre: THREE.Mesh;
}

export class CarRig {
  readonly root = new THREE.Group();
  readonly wheels: WheelRig[] = [];
  readonly flapPivot = new THREE.Group();
  readonly steering = new THREE.Group();
  readonly head = new THREE.Group();
  readonly driverParts: THREE.Object3D[] = [];
  readonly fwFlapsL: THREE.Mesh;
  readonly fwFlapsR: THREE.Mesh;
  readonly fwEpL: THREE.Mesh;
  readonly fwEpR: THREE.Mesh;
  readonly rwGroup = new THREE.Group();
  readonly tyreMat: THREE.MeshStandardMaterial;
  readonly brakeMat: THREE.MeshStandardMaterial;
  readonly rainMat: THREE.MeshStandardMaterial;
  readonly arms: THREE.InstancedMesh | null;
  readonly shadowCasters: THREE.Mesh[] = [];
  compound: TyreCompound;
  private readonly dummy = new THREE.Object3D();
  private readonly pa = new THREE.Vector3();
  private readonly pb = new THREE.Vector3();

  constructor(
    readonly geo: CarGeometry,
    readonly lib: CarMaterialLibrary,
    team: TeamDef,
    driver: DriverDef,
    compound: TyreCompound,
    opts: { arms: boolean; driver: boolean } = { arms: true, driver: true },
  ) {
    this.compound = compound;
    const { body } = lib.livery(team);
    const decal = lib.decal(team, driver).mat;
    const g = geo;
    const root = this.root;
    root.name = 'car';

    const mesh = (geom: THREE.BufferGeometry, mat: THREE.Material, cast = true): THREE.Mesh => {
      const m = new THREE.Mesh(geom, mat);
      m.castShadow = cast;
      m.receiveShadow = false;
      m.frustumCulled = true;
      if (cast) this.shadowCasters.push(m);
      return m;
    };

    root.add(mesh(g.livery, body));
    root.add(mesh(g.carbon, lib.carbon));
    root.add(mesh(g.decals, decal, false));
    // Front wing.
    root.add(mesh(g.fwMain, body));
    this.fwFlapsL = mesh(g.fwFlapsL, body);
    this.fwFlapsR = mesh(g.fwFlapsR, body);
    this.fwEpL = mesh(g.fwEpL, body);
    this.fwEpR = mesh(g.fwEpR, body);
    root.add(this.fwFlapsL, this.fwFlapsR, this.fwEpL, this.fwEpR);
    // Rear wing flap on its pivot (trailing edge) inside a group we can bend for damage.
    this.flapPivot.position.set(0, 1.0, -2.6);
    this.flapPivot.add(mesh(g.rwFlap, body));
    this.rwGroup.add(this.flapPivot);
    root.add(this.rwGroup);
    // Rain light.
    this.rainMat = lib.rainLight.clone();
    root.add(mesh(g.rainLight, this.rainMat, false));

    // Wheels.
    this.tyreMat = lib.newTyreMaterial(compound);
    this.brakeMat = lib.newBrakeMaterial();
    for (let i = 0; i < 4; i++) {
      const [wx, wy, wz] = WHEEL_LOCAL_POSITIONS[i];
      const hub = new THREE.Group();
      hub.position.set(wx, wy, wz);
      const spin = new THREE.Group();
      const front = i < 2;
      const tyre = mesh(front ? g.tyreF : g.tyreR, this.tyreMat);
      const rim = mesh(front ? g.rimF : g.rimR, lib.rim, false);
      if (wx < 0) {
        tyre.rotation.y = Math.PI;
        rim.rotation.y = Math.PI;
      }
      spin.add(tyre, rim);
      hub.add(spin);
      if (opts.driver) {
        const disc = mesh(g.brakeDisc, this.brakeMat, false);
        const cal = mesh(g.caliper, lib.darkMetal, false);
        if (wx < 0) cal.rotation.y = Math.PI;
        hub.add(disc, cal);
      }
      root.add(hub);
      this.wheels.push({ hub, spin, tyre });
    }

    // Suspension arms: one InstancedMesh (24 arms).
    if (opts.arms) {
      this.arms = new THREE.InstancedMesh(g.arm, lib.carbon, ARMS_PER_CAR);
      this.arms.castShadow = false;
      this.arms.frustumCulled = false;
      root.add(this.arms);
    } else {
      this.arms = null;
    }

    // Driver.
    const helmetMats = lib.helmet(driver);
    this.head.position.set(0, 0.765, -0.4);
    const helmet = mesh(g.helmet, helmetMats[0], false);
    const stripe = mesh(g.helmetStripe, helmetMats[1], false);
    const top = mesh(g.helmetTop, helmetMats[2], false);
    const visor = mesh(g.visor, lib.visor, false);
    this.head.add(helmet, stripe, top, visor);
    root.add(this.head);
    this.driverParts.push(this.head);
    if (opts.driver) {
      const torso = mesh(g.torso, lib.suit, false);
      const arms = mesh(g.arms, lib.suit, false);
      root.add(torso, arms);
      this.driverParts.push(torso);
      this.steering.position.set(0, 0.66, 0.2);
      this.steering.rotation.x = -0.45;
      const wheel = mesh(g.wheel, lib.carbonMatte, false);
      const hands = mesh(g.hands, lib.glove, false);
      this.steering.add(wheel, hands);
      root.add(this.steering);
    }
    this.updateArms();
  }

  /** Re-aim the suspension arms at the current wheel hub positions. */
  updateArms(): void {
    const arms = this.arms;
    if (!arms) return;
    const d = this.dummy;
    let k = 0;
    for (let w = 0; w < 4; w++) {
      const hub = this.wheels[w].hub.position;
      const defs = ARM_DEFS[w];
      for (let j = 0; j < defs.length; j++) {
        const def = defs[j];
        this.pa.set(def.a[0], def.a[1], def.a[2]);
        this.pb.set(hub.x + def.b[0], hub.y + def.b[1], hub.z + def.b[2]);
        orientArm(d, this.pa, this.pb, def.rx, def.rz);
        d.updateMatrix();
        arms.setMatrixAt(k++, d.matrix);
      }
    }
    arms.instanceMatrix.needsUpdate = true;
  }

  setCompound(compound: TyreCompound): void {
    if (compound === this.compound) return;
    this.compound = compound;
    this.tyreMat.map = this.lib.tyreMap(compound);
    this.tyreMat.needsUpdate = true;
  }

  setCockpitView(enabled: boolean): void {
    for (const p of this.driverParts) p.visible = !enabled;
  }

  setShadows(cast: boolean): void {
    for (const m of this.shadowCasters) m.castShadow = cast;
  }

  dispose(): void {
    this.rainMat.dispose();
    this.arms?.dispose();
    this.root.removeFromParent();
  }
}
