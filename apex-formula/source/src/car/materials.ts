/**
 * Procedural car materials: per-team livery atlases (CanvasTexture), carbon weave, tyres per compound, per-driver
 * decals (numbers / TLA), plus the shared metal / rubber / glass / brake materials. Everything is generated once per
 * CarVisuals instance and cached; nothing is loaded.
 */
import * as THREE from 'three';
import { TYRE_DATA, type TyreCompound } from '../core/constants';
import { hashString, Rng } from '../core/math';
import type { DriverDef, TeamDef } from '../core/types';
import { ATLAS, DECAL, TYRE_BAND_V } from './atlas';
import type { UVRect } from './geom';

const SPONSORS = ['IGNIS', 'APEX', 'QUBIT', 'NORTHWIND', 'HALO TECH', 'VELOCITA', 'ORBITAL', 'STRATA', 'KINETIC', 'LUMEN', 'MERIDIAN', 'PULSAR', 'VANTA', 'AERIS', 'TORQ', 'NOVA FUELS'];

const makeCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const tex = (canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture => {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
};

const shade = (hex: string, f: number): string => {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
};

const mix = (a: string, b: string, t: number): string => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

const luminance = (hex: string): number => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

/* ─────────────────────────────── carbon weave ─────────────────────────────── */

export const makeCarbonTexture = (size = 256): THREE.CanvasTexture => {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1c1f';
  g.fillRect(0, 0, size, size);
  const cell = size / 16;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const twill = (x + y) % 4;
      const horiz = twill < 2;
      const grad = g.createLinearGradient(x * cell, y * cell, horiz ? (x + 1) * cell : x * cell, horiz ? y * cell : (y + 1) * cell);
      grad.addColorStop(0, '#15161a');
      grad.addColorStop(0.5, horiz ? '#3a3d44' : '#2b2e34');
      grad.addColorStop(1, '#15161a');
      g.fillStyle = grad;
      g.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  return t;
};

/* ─────────────────────────────── livery ─────────────────────────────── */

interface PaintCtx {
  g: CanvasRenderingContext2D;
  size: number;
  team: TeamDef;
  rng: Rng;
  sponsors: string[];
}

/** Canvas rectangle for a UV rect (canvas y is down, UV v is up). */
const rectPx = (r: UVRect, size: number) => ({ x: r.u0 * size, y: (1 - r.v1) * size, w: (r.u1 - r.u0) * size, h: (r.v1 - r.v0) * size });

const clipRect = (p: PaintCtx, r: UVRect, draw: (x: number, y: number, w: number, h: number) => void): void => {
  const { x, y, w, h } = rectPx(r, p.size);
  p.g.save();
  p.g.beginPath();
  p.g.rect(x, y, w, h);
  p.g.clip();
  draw(x, y, w, h);
  p.g.restore();
};

const paintStyle = (p: PaintCtx, r: UVRect, along: 'u' | 'v' = 'u'): void => {
  const { team } = p;
  const { primaryColor: pri, secondaryColor: sec, accentColor: acc, liveryStyle } = team;
  clipRect(p, r, (x, y, w, h) => {
    const g = p.g;
    g.fillStyle = pri;
    g.fillRect(x, y, w, h);
    const L = along === 'u' ? w : h;
    // Helper: a band across the "along" axis at fraction a..b of the length.
    const band = (a: number, b: number, color: string, skew = 0) => {
      g.fillStyle = color;
      g.beginPath();
      if (along === 'u') {
        g.moveTo(x + a * L, y);
        g.lineTo(x + b * L, y);
        g.lineTo(x + b * L + skew * h, y + h);
        g.lineTo(x + a * L + skew * h, y + h);
      } else {
        g.moveTo(x, y + h - a * L);
        g.lineTo(x + w, y + h - a * L + skew * w);
        g.lineTo(x + w, y + h - b * L + skew * w);
        g.lineTo(x, y + h - b * L);
      }
      g.closePath();
      g.fill();
    };
    switch (liveryStyle) {
      case 'solid': {
        band(0.0, 0.035, acc);
        band(0.965, 1.0, sec);
        band(0.55, 0.575, acc, -0.25);
        break;
      }
      case 'split': {
        band(0.46, 1.0, sec, -0.35);
        band(0.44, 0.47, acc, -0.35);
        break;
      }
      case 'stripes': {
        for (let i = 0; i < 3; i++) {
          const a = 0.18 + i * 0.16;
          band(a, a + 0.05, i === 1 ? acc : sec, -0.3);
        }
        band(0.9, 1.0, sec);
        break;
      }
      case 'gradient': {
        const grad = along === 'u' ? g.createLinearGradient(x, 0, x + w, 0) : g.createLinearGradient(0, y + h, 0, y);
        grad.addColorStop(0, pri);
        grad.addColorStop(0.45, pri);
        grad.addColorStop(1, sec);
        g.fillStyle = grad;
        g.fillRect(x, y, w, h);
        band(0.3, 0.32, acc, -0.4);
        break;
      }
      case 'carbon': {
        g.fillStyle = '#1e2024';
        g.fillRect(x, y, w, h);
        // Subtle weave hatch.
        g.strokeStyle = 'rgba(255,255,255,0.045)';
        g.lineWidth = 1;
        for (let i = 0; i < L; i += 5) {
          g.beginPath();
          if (along === 'u') {
            g.moveTo(x + i, y);
            g.lineTo(x + i + h, y + h);
          } else {
            g.moveTo(x, y + i);
            g.lineTo(x + w, y + i + w);
          }
          g.stroke();
        }
        band(0.12, 0.2, pri, -0.3);
        band(0.2, 0.215, acc, -0.3);
        band(0.7, 0.78, pri, -0.3);
        band(0.78, 0.795, sec, -0.3);
        break;
      }
      case 'chevron': {
        g.fillStyle = sec;
        const n = 3;
        for (let i = 0; i < n; i++) {
          const a = 0.35 + i * 0.13;
          g.beginPath();
          if (along === 'u') {
            g.moveTo(x + a * L, y);
            g.lineTo(x + (a + 0.06) * L, y);
            g.lineTo(x + (a + 0.06) * L + h * 0.45, y + h * 0.5);
            g.lineTo(x + (a + 0.06) * L, y + h);
            g.lineTo(x + a * L, y + h);
            g.lineTo(x + a * L + h * 0.45, y + h * 0.5);
          } else {
            g.moveTo(x, y + h - a * L);
            g.lineTo(x, y + h - (a + 0.06) * L);
            g.lineTo(x + w * 0.5, y + h - (a + 0.06) * L - w * 0.45);
            g.lineTo(x + w, y + h - (a + 0.06) * L);
            g.lineTo(x + w, y + h - a * L);
            g.lineTo(x + w * 0.5, y + h - a * L - w * 0.45);
          }
          g.closePath();
          g.fill();
        }
        band(0.0, 0.03, acc);
        break;
      }
    }
  });
};

const sponsorText = (p: PaintCtx, r: UVRect, count: number, scale = 1, along: 'u' | 'v' = 'u'): void => {
  clipRect(p, r, (x, y, w, h) => {
    const g = p.g;
    const lum = luminance(p.team.primaryColor);
    for (let i = 0; i < count; i++) {
      const name = p.sponsors[(i * 3 + Math.floor(p.rng.next() * 2)) % p.sponsors.length];
      const fx = x + w * (0.08 + (0.84 * (i + 0.5)) / count);
      const fy = y + h * (0.28 + 0.44 * p.rng.next());
      g.save();
      g.translate(fx, fy);
      if (along === 'v') g.rotate(-Math.PI / 2);
      g.font = `italic 900 ${Math.round(Math.min(h, w) * 0.26 * scale)}px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = lum > 0.35 ? 'rgba(10,10,12,0.9)' : i % 3 === 1 ? p.team.accentColor : 'rgba(255,255,255,0.92)';
      g.fillText(name, 0, 0);
      g.restore();
    }
  });
};

/** Paint the full livery atlas for a team. Rects follow `ATLAS`. */
export const makeLiveryTexture = (team: TeamDef, size = 1024): THREE.CanvasTexture => {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d')!;
  const rng = new Rng(hashString(team.id));
  const sponsors = [...SPONSORS].sort(() => rng.next() - 0.5);
  const p: PaintCtx = { g, size, team, rng, sponsors };
  g.fillStyle = team.primaryColor;
  g.fillRect(0, 0, size, size);

  paintStyle(p, ATLAS.body, 'u');
  // Dark carbon floor edges of the body loft (bottom of the profile maps to v edges).
  clipRect(p, ATLAS.body, (x, y, w, h) => {
    g.fillStyle = '#1a1b1e';
    g.fillRect(x, y, w, h * 0.06);
    g.fillRect(x, y + h * 0.94, w, h * 0.06);
  });
  sponsorText(p, ATLAS.body, 4, 0.55);
  paintStyle(p, ATLAS.podL, 'u');
  paintStyle(p, ATLAS.podR, 'u');
  sponsorText(p, ATLAS.podL, 2, 1.1);
  sponsorText(p, ATLAS.podR, 2, 1.1);
  paintStyle(p, ATLAS.fin, 'u');
  sponsorText(p, ATLAS.fin, 1, 1.4);
  paintStyle(p, ATLAS.rwMain, 'u');
  paintStyle(p, ATLAS.rwFlap, 'u');
  sponsorText(p, ATLAS.rwMain, 1, 1.9);
  sponsorText(p, ATLAS.rwFlap, 1, 1.9);
  paintStyle(p, ATLAS.rwEp, 'u');
  sponsorText(p, ATLAS.rwEp, 1, 1.3);
  paintStyle(p, ATLAS.fw1, 'u');
  paintStyle(p, ATLAS.fw2, 'u');
  paintStyle(p, ATLAS.fw3, 'u');
  sponsorText(p, ATLAS.fw2, 2, 1.6);
  paintStyle(p, ATLAS.fwEp, 'u');
  sponsorText(p, ATLAS.fwEp, 1, 1.3);
  // misc: plain secondary for pylons / mounts.
  clipRect(p, ATLAS.misc, (x, y, w, h) => {
    g.fillStyle = shade(team.primaryColor, 0.8);
    g.fillRect(x, y, w, h);
  });
  return tex(c);
};

/* ─────────────────────────────── decals ─────────────────────────────── */

/** Number + TLA decal sheet per driver (quadrants per `DECAL`). Transparent background. */
export const makeDecalTexture = (team: TeamDef, driver: DriverDef, size = 512): THREE.CanvasTexture => {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  const lum = luminance(team.primaryColor);
  const fill = lum > 0.45 ? '#0d0d10' : '#ffffff';
  const stroke = lum > 0.45 ? team.secondaryColor : team.accentColor;
  const drawIn = (r: UVRect, text: string, fontScale: number, rotate = 0) => {
    const { x, y, w, h } = rectPx(r, size);
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.rotate(rotate);
    g.font = `italic 900 ${Math.round(h * fontScale)}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = h * 0.045;
    g.strokeStyle = stroke;
    g.strokeText(text, 0, 0);
    g.fillStyle = fill;
    g.fillText(text, 0, 0);
    g.restore();
  };
  const num = String(driver.number);
  drawIn(DECAL.nose, num, 0.62);
  drawIn(DECAL.fin, num, 0.7);
  drawIn(DECAL.codeR, driver.code, 0.42);
  drawIn(DECAL.codeL, driver.code, 0.42);
  return tex(c);
};

/* ─────────────────────────────── tyres ─────────────────────────────── */

/** Tyre texture: u around the circumference, v along the lathe profile (see atlas.tyreProfile). */
export const makeTyreTexture = (compound: TyreCompound, w = 512, h = 128): THREE.CanvasTexture => {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  g.fillStyle = '#17181a';
  g.fillRect(0, 0, w, h);
  // Tread: slightly lighter, with grooves for inters / wets.
  g.fillStyle = '#1e1f22';
  g.fillRect(0, h * 0.36, w, h * 0.28);
  if (compound === 'intermediate' || compound === 'wet') {
    g.fillStyle = '#0c0c0e';
    const grooves = compound === 'wet' ? 5 : 4;
    for (let i = 0; i < grooves; i++) g.fillRect(0, h * (0.38 + (0.24 * (i + 0.5)) / grooves) - 1.5, w, 3);
    for (let i = 0; i < 48; i++) {
      const x0 = (i / 48) * w;
      g.beginPath();
      g.moveTo(x0, h * 0.37);
      g.lineTo(x0 + w * 0.012, h * 0.63);
      g.lineWidth = 2;
      g.strokeStyle = '#0c0c0e';
      g.stroke();
    }
  }
  // Sidewall branding band (outer face).
  const info = TYRE_DATA[compound];
  const y0 = (1 - TYRE_BAND_V[1]) * h;
  const y1 = (1 - TYRE_BAND_V[0]) * h;
  g.fillStyle = info.color;
  g.fillRect(0, y0, w, (y1 - y0) * 0.22);
  g.fillRect(0, y1 - (y1 - y0) * 0.22, w, (y1 - y0) * 0.22);
  g.font = `900 ${Math.round((y1 - y0) * 0.56)}px "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = info.color;
  for (let i = 0; i < 4; i++) {
    g.fillText(i % 2 === 0 ? 'APEX' : info.label.toUpperCase(), ((i + 0.5) / 4) * w, (y0 + y1) / 2);
  }
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
};

/* ─────────────────────────────── material library ─────────────────────────────── */

export class CarMaterialLibrary {
  readonly carbonMap: THREE.CanvasTexture;
  readonly carbon: THREE.MeshStandardMaterial;
  readonly carbonMatte: THREE.MeshStandardMaterial;
  readonly metal: THREE.MeshStandardMaterial;
  readonly darkMetal: THREE.MeshStandardMaterial;
  readonly rim: THREE.MeshStandardMaterial;
  readonly visor: THREE.MeshPhysicalMaterial;
  readonly suit: THREE.MeshStandardMaterial;
  readonly glove: THREE.MeshStandardMaterial;
  readonly rainLight: THREE.MeshStandardMaterial;
  readonly seat: THREE.MeshStandardMaterial;
  private readonly liveries = new Map<string, { map: THREE.CanvasTexture; body: THREE.MeshPhysicalMaterial; matte: THREE.MeshStandardMaterial }>();
  private readonly tyreMaps = new Map<TyreCompound, THREE.CanvasTexture>();
  private readonly decals = new Map<string, { map: THREE.CanvasTexture; mat: THREE.MeshStandardMaterial }>();
  private readonly helmets = new Map<string, THREE.MeshPhysicalMaterial[]>();
  private readonly owned: THREE.Material[] = [];
  private readonly liverySize: number;

  constructor(liverySize = 1024) {
    this.liverySize = liverySize;
    this.carbonMap = makeCarbonTexture();
    this.carbon = this.own(new THREE.MeshStandardMaterial({ map: this.carbonMap, color: 0xffffff, roughness: 0.32, metalness: 0.25, envMapIntensity: 1.1 }));
    this.carbonMatte = this.own(new THREE.MeshStandardMaterial({ map: this.carbonMap, color: 0x9a9a9a, roughness: 0.75, metalness: 0.1 }));
    this.metal = this.own(new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.35, metalness: 0.95 }));
    this.darkMetal = this.own(new THREE.MeshStandardMaterial({ color: 0x35383d, roughness: 0.5, metalness: 0.85 }));
    this.rim = this.own(new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.28, metalness: 0.9 }));
    this.visor = this.own(new THREE.MeshPhysicalMaterial({ color: 0x0c0f18, roughness: 0.05, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.5 }));
    this.suit = this.own(new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.9, metalness: 0 }));
    this.glove = this.own(new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.85, metalness: 0 }));
    this.rainLight = this.own(new THREE.MeshStandardMaterial({ color: 0x3a0a0a, emissive: 0xff2010, emissiveIntensity: 0, roughness: 0.3 }));
    this.seat = this.own(new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.95 }));
  }

  private own<T extends THREE.Material>(m: T): T {
    this.owned.push(m);
    return m;
  }

  livery(team: TeamDef) {
    let e = this.liveries.get(team.id);
    if (!e) {
      const map = makeLiveryTexture(team, this.liverySize);
      const body = this.own(
        new THREE.MeshPhysicalMaterial({
          map,
          roughness: 0.28,
          metalness: 0.35,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          envMapIntensity: 1.2,
          sheen: 0.15,
          sheenColor: new THREE.Color(team.accentColor),
        }),
      );
      const matte = this.own(new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.2 }));
      e = { map, body, matte };
      this.liveries.set(team.id, e);
    }
    return e;
  }

  /** Two solid materials for the team: primary (satin) and secondary. */
  teamPaint(team: TeamDef): { primary: THREE.MeshPhysicalMaterial; secondary: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial } {
    const key = `${team.id}:paint`;
    let cached = this.paints.get(key);
    if (!cached) {
      cached = {
        primary: this.own(new THREE.MeshPhysicalMaterial({ color: team.primaryColor, roughness: 0.3, metalness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.08 })),
        secondary: this.own(new THREE.MeshStandardMaterial({ color: team.secondaryColor, roughness: 0.4, metalness: 0.3 })),
        accent: this.own(new THREE.MeshStandardMaterial({ color: team.accentColor, roughness: 0.4, metalness: 0.2, emissive: team.accentColor, emissiveIntensity: 0.05 })),
      };
      this.paints.set(key, cached);
    }
    return cached;
  }
  private readonly paints = new Map<string, { primary: THREE.MeshPhysicalMaterial; secondary: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial }>();

  decal(team: TeamDef, driver: DriverDef) {
    let e = this.decals.get(driver.id);
    if (!e) {
      const map = makeDecalTexture(team, driver);
      const mat = this.own(
        new THREE.MeshStandardMaterial({
          map,
          transparent: true,
          roughness: 0.35,
          metalness: 0.2,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      e = { map, mat };
      this.decals.set(driver.id, e);
    }
    return e;
  }

  /** Helmet [base, secondary, accent] glossy paints per driver. */
  helmet(driver: DriverDef): THREE.MeshPhysicalMaterial[] {
    let mats = this.helmets.get(driver.id);
    if (!mats) {
      mats = driver.helmet.map((hex) => this.own(new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.18, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 })));
      this.helmets.set(driver.id, mats);
    }
    return mats;
  }

  tyreMap(compound: TyreCompound): THREE.CanvasTexture {
    let t = this.tyreMaps.get(compound);
    if (!t) {
      t = makeTyreTexture(compound);
      this.tyreMaps.set(compound, t);
    }
    return t;
  }

  /** A fresh per-car tyre material (wear / compound are mutated per car). */
  newTyreMaterial(compound: TyreCompound): THREE.MeshStandardMaterial {
    return this.own(new THREE.MeshStandardMaterial({ map: this.tyreMap(compound), color: 0xffffff, roughness: 0.92, metalness: 0 }));
  }

  /** Per-car brake disc material (emissive glow animated). */
  newBrakeMaterial(): THREE.MeshStandardMaterial {
    return this.own(new THREE.MeshStandardMaterial({ color: 0x4a4c50, emissive: 0xff4a00, emissiveIntensity: 0, roughness: 0.6, metalness: 0.8 }));
  }

  /** Tinted / darkened variant helpers for the livery painter (exported for potential reuse). */
  static shade = shade;
  static mix = mix;

  dispose(): void {
    for (const m of this.owned) m.dispose();
    this.owned.length = 0;
    this.carbonMap.dispose();
    for (const e of this.liveries.values()) e.map.dispose();
    for (const t of this.tyreMaps.values()) t.dispose();
    for (const e of this.decals.values()) e.map.dispose();
    this.liveries.clear();
    this.tyreMaps.clear();
    this.decals.clear();
    this.helmets.clear();
    this.paints.clear();
  }
}
