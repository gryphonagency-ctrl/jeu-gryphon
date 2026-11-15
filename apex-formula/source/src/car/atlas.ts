/**
 * Livery atlas layout shared by the geometry builder (UV assignment) and the livery painter.
 * All rects are in UV space (v up). Body/pod regions map u = car z, v = profile parameter t.
 */
import type { UVRect } from './geom';

export const BODY_Z_REAR = -2.62;
export const BODY_Z_FRONT = 2.9;
export const POD_Z_REAR = -2.1;
export const POD_Z_FRONT = 0.66;

export const ATLAS = {
  body: { u0: 0.004, v0: 0.505, u1: 0.996, v1: 0.996 } as UVRect,
  podL: { u0: 0.004, v0: 0.3, u1: 0.496, v1: 0.496 } as UVRect,
  podR: { u0: 0.504, v0: 0.3, u1: 0.996, v1: 0.496 } as UVRect,
  fin: { u0: 0.504, v0: 0.17, u1: 0.996, v1: 0.29 } as UVRect,
  rwMain: { u0: 0.004, v0: 0.17, u1: 0.496, v1: 0.226 } as UVRect,
  rwFlap: { u0: 0.004, v0: 0.234, u1: 0.496, v1: 0.29 } as UVRect,
  rwEp: { u0: 0.504, v0: 0.03, u1: 0.746, v1: 0.16 } as UVRect,
  fw1: { u0: 0.004, v0: 0.03, u1: 0.496, v1: 0.07 } as UVRect,
  fw2: { u0: 0.004, v0: 0.076, u1: 0.496, v1: 0.116 } as UVRect,
  fw3: { u0: 0.004, v0: 0.122, u1: 0.496, v1: 0.16 } as UVRect,
  fwEp: { u0: 0.754, v0: 0.03, u1: 0.996, v1: 0.16 } as UVRect,
  misc: { u0: 0.754, v0: 0.17, u1: 0.996, v1: 0.29 } as UVRect,
} as const;

/** Body profile parameter t for a height feature f (0 = bottom, 1 = top) on a side (+1 left, -1 right). */
export const bodyT = (f: number, side: 1 | -1): number => (side > 0 ? 1 - f * 0.5 : f * 0.5);
/** Sidepod profile parameter t for a feature f along the outer face (0 = bottom outer, 1 = top inner). */
export const podT = (f: number, side: 1 | -1): number => (side > 0 ? 5 / 6 - (f * 4) / 6 : 1 / 6 + (f * 4) / 6);

/** Tyre lathe profile (radius, axial) for a half tread width h; v runs along the point index. */
export const tyreProfile = (h: number): [number, number][] => [
  [0.235, -(h - 0.015)],
  [0.27, -(h - 0.002)],
  [0.3, -h],
  [0.33, -h],
  [0.352, -(h - 0.012)],
  [0.36, -(h - 0.05)],
  [0.36, h - 0.05],
  [0.352, h - 0.012],
  [0.33, h],
  [0.3, h],
  [0.27, h - 0.002],
  [0.235, h - 0.015],
];
/** v-range of the coloured band on the outer sidewall (derived from tyreProfile indices 8..10). */
export const TYRE_BAND_V: [number, number] = [0.742, 0.879];

/** Decal texture quadrants (per car): nose number, fin number, code right side, code left side. */
export const DECAL = {
  nose: { u0: 0, v0: 0.5, u1: 0.5, v1: 1 } as UVRect,
  fin: { u0: 0.5, v0: 0.5, u1: 1, v1: 1 } as UVRect,
  codeR: { u0: 0, v0: 0, u1: 0.5, v1: 0.5 } as UVRect,
  codeL: { u0: 0.5, v0: 0, u1: 1, v1: 0.5 } as UVRect,
} as const;
