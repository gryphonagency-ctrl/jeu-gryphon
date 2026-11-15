import type { TrackTheme } from '../core/types';

export interface ThemePalette {
  grass: string;
  grassDark: string;
  gravel: string;
  runoffAsphalt: string;
  ground: string;
  groundFar: string;
  concrete: string;
  kerbA: string;
  kerbB: string;
  /** Tyre wall row colours bottom → top. */
  tyreRows: string[];
  fence: string;
  roof: string;
  seat: string[];
  buildingBase: string;
  /** Painted stripe on top of concrete barriers. */
  barrierStripe: string;
  water: string;
  treeKind: 'oak' | 'pine' | 'palm' | 'poplar';
  /** Terrain undulation amplitude (m) and feature size (m). */
  terrainAmp: number;
  terrainScale: number;
}

export const PALETTES: Record<TrackTheme, ThemePalette> = {
  permanent: {
    grass: '#5f8c3a',
    grassDark: '#4a7230',
    gravel: '#cbbba0',
    runoffAsphalt: '#8d8d8a',
    ground: '#5a8236',
    groundFar: '#4f7333',
    concrete: '#b9b7b0',
    kerbA: '#d5261f',
    kerbB: '#f2f0ea',
    tyreRows: ['#1a1a1a', '#f0f0f0', '#1f4fbf', '#f0f0f0'],
    fence: '#7f8790',
    roof: '#e6e6e8',
    seat: ['#1d4d9e', '#d0d3d8', '#c8312a', '#1d4d9e'],
    buildingBase: '#d7d8d5',
    barrierStripe: '#ffffff',
    water: '#2c6a8f',
    treeKind: 'oak',
    terrainAmp: 4,
    terrainScale: 420,
  },
  street: {
    grass: '#6d8f4d',
    grassDark: '#587a3b',
    gravel: '#bfb4a0',
    runoffAsphalt: '#7f8083',
    ground: '#6f6f70',
    groundFar: '#5f6062',
    concrete: '#c4c1b8',
    kerbA: '#d92a22',
    kerbB: '#f4f2ee',
    tyreRows: ['#1a1a1a', '#f0f0f0', '#f0f0f0'],
    fence: '#8a9099',
    roof: '#f0efe9',
    seat: ['#0a5aa8', '#e9e9ec', '#0a5aa8', '#f0b500'],
    buildingBase: '#e9d7c1',
    barrierStripe: '#ffd400',
    water: '#0f3f63',
    treeKind: 'palm',
    terrainAmp: 0,
    terrainScale: 400,
  },
  desert: {
    grass: '#a3a06a',
    grassDark: '#8f8c58',
    gravel: '#d8c9a5',
    runoffAsphalt: '#a3a29b',
    ground: '#cdb27f',
    groundFar: '#c9ac78',
    concrete: '#d2cdbf',
    kerbA: '#d5261f',
    kerbB: '#f2f0ea',
    tyreRows: ['#1a1a1a', '#f0f0f0', '#1f4fbf'],
    fence: '#8f949a',
    roof: '#f1eee6',
    seat: ['#c8312a', '#f0f0f0', '#0e2d69', '#f0f0f0'],
    buildingBase: '#e8e2d2',
    barrierStripe: '#ffffff',
    water: '#2f8aa8',
    treeKind: 'palm',
    terrainAmp: 12,
    terrainScale: 380,
  },
  forest: {
    grass: '#4f7f33',
    grassDark: '#3d652a',
    gravel: '#c7b697',
    runoffAsphalt: '#8a8b88',
    ground: '#4a7431',
    groundFar: '#3f6a2d',
    concrete: '#b5b3ab',
    kerbA: '#d5261f',
    kerbB: '#f2f0ea',
    tyreRows: ['#1a1a1a', '#f0f0f0', '#e0322a', '#f0f0f0'],
    fence: '#7c848c',
    roof: '#5a3b26',
    seat: ['#c8312a', '#f0f0f0', '#1d4d9e', '#f0f0f0'],
    buildingBase: '#e2d9c8',
    barrierStripe: '#ffffff',
    water: '#28607a',
    treeKind: 'pine',
    terrainAmp: 16,
    terrainScale: 520,
  },
  coastal: {
    grass: '#7f9a4e',
    grassDark: '#6a8342',
    gravel: '#d9cdae',
    runoffAsphalt: '#95948f',
    ground: '#9b9a63',
    groundFar: '#8e8f5c',
    concrete: '#d0cbbd',
    kerbA: '#d5261f',
    kerbB: '#f2f0ea',
    tyreRows: ['#1a1a1a', '#f0f0f0', '#1f6fd0', '#f0f0f0'],
    fence: '#8a9099',
    roof: '#c8643c',
    seat: ['#0a5aa8', '#f0f0f0', '#0a5aa8', '#e6b422'],
    buildingBase: '#f1e3c9',
    barrierStripe: '#ffffff',
    water: '#1f7fa6',
    treeKind: 'pine',
    terrainAmp: 9,
    terrainScale: 460,
  },
};

export interface WaterRegion {
  /** Axis-aligned XZ rectangle. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Water surface height. */
  level: number;
  kind: 'sea' | 'harbour' | 'lake';
}

export interface CircuitHints {
  water?: WaterRegion[];
  /** Land where inlandDistance(x,z) > 0; terrain drops to seabed below 0. */
  inland?: (x: number, z: number) => number;
  seabed?: number;
  tunnel?: { fromCp: number; toCp: number };
  /** Hills added to the terrain: centre, radius, height. */
  hills?: { x: number; z: number; r: number; h: number }[];
  cityGrid?: { x0: number; z0: number; x1: number; z1: number };
  /** Slope of the ground rising with inland distance (coastal hillsides). */
  inlandRise?: number;
  castle?: { x: number; z: number };
}

export const CIRCUIT_HINTS: Record<string, CircuitHints> = {
  'porto-azzurro': {
    water: [{ x0: 44, z0: -700, x1: 2400, z1: 900, level: -3.2, kind: 'harbour' }],
    inland: (x, z) => -Math.min(x - 44, z + 700),
    seabed: -9,
    tunnel: { fromCp: 51, toCp: 54 },
    hills: [{ x: -330, z: -1000, r: 170, h: 26 }],
    cityGrid: { x0: -1500, z0: -1300, x1: 20, z1: 700 },
  },
  riviera: {
    water: [{ x0: -3000, z0: -3200, x1: 3000, z1: 3000, level: -6, kind: 'sea' }],
    inland: (x, z) => Math.min(x + 48, z + 1060),
    seabed: -16,
    inlandRise: 0.035,
  },
  'al-sahra': {
    water: [{ x0: 1935, z0: -420, x1: 2030, z1: -200, level: 0.3, kind: 'lake' }],
    hills: [
      { x: 2600, z: -900, r: 380, h: 60 },
      { x: -800, z: 300, r: 420, h: 48 },
    ],
  },
  schwarzwald: {
    water: [{ x0: -900, z0: -260, x1: -600, z1: -40, level: 23, kind: 'lake' }],
    hills: [
      { x: -1500, z: 900, r: 500, h: 90 },
      { x: 500, z: -900, r: 600, h: 70 },
      { x: 300, z: 640, r: 230, h: 42 },
    ],
    castle: { x: 300, z: 640 },
  },
  velocita: {
    water: [{ x0: -1100, z0: -100, x1: -800, z1: 150, level: -2.5, kind: 'lake' }],
  },
  kingsmere: {
    water: [{ x0: -280, z0: -300, x1: -150, z1: -40, level: 0, kind: 'lake' }],
  },
};

export const AD_BRANDS = ['APEX', 'IGNIS', 'VELOCITÀ TYRES', 'MERIDIAN', 'KESTREL AIRLINES', 'ORBIT', 'NIMBUS', 'HALO ENERGY', 'BRIDGE', 'ZENITH WATCHES'] as const;
export const AD_COLORS: [string, string][] = [
  ['#0d0d12', '#ffd200'],
  ['#c8102e', '#ffffff'],
  ['#ffd200', '#111111'],
  ['#0b3c5d', '#7fd3ff'],
  ['#0a2a6b', '#ffffff'],
  ['#111111', '#00e5ff'],
  ['#f2f2f2', '#1a2b6d'],
  ['#0f7a3d', '#e8ff3a'],
  ['#1b1b1b', '#ff6a00'],
  ['#ffffff', '#101010'],
];
