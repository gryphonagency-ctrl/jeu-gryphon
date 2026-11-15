/**
 * Procedural sprite textures for the VFX systems (canvas generated, no external assets).
 * All textures are linear masks: RGB = luminance variation, A = coverage.
 */
import * as THREE from 'three';
import { Rng } from '../core/math';

export interface VFXTextures {
  smoke: THREE.Texture;
  dust: THREE.Texture;
  spark: THREE.Texture;
  rain: THREE.Texture;
  glow: THREE.Texture;
  chip: THREE.Texture;
  confetti: THREE.Texture;
  ring: THREE.Texture;
  noise: THREE.Texture;
  dispose(): void;
}

const canvas2d = (size: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
};

const finish = (c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
};

/** Tileable value noise with fbm. */
class Noise {
  private readonly grid: Float32Array;
  constructor(private readonly n: number, rng: Rng) {
    this.grid = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) this.grid[i] = rng.next();
  }
  value(x: number, y: number): number {
    const n = this.n;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const g = (ix: number, iy: number) => this.grid[(((iy % n) + n) % n) * n + (((ix % n) + n) % n)];
    const a = g(xi, yi);
    const b = g(xi + 1, yi);
    const c = g(xi, yi + 1);
    const d = g(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  /** u,v in [0,1) tile. */
  fbm(u: number, v: number, octaves: number, baseFreq: number): number {
    let amp = 0.5;
    let freq = baseFreq;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.value(u * freq, v * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}

const writePixels = (size: number, fn: (u: number, v: number, out: [number, number, number, number]) => void): HTMLCanvasElement => {
  const [c, ctx] = canvas2d(size);
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fn((x + 0.5) / size, (y + 0.5) / size, out);
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(out[0] * 255)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(out[1] * 255)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(out[2] * 255)));
      data[i + 3] = Math.max(0, Math.min(255, Math.round(out[3] * 255)));
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const createVFXTextures = (): VFXTextures => {
  const rng = new Rng(0x5eed);
  const noise = new Noise(64, rng);
  const noise2 = new Noise(64, new Rng(0xbeef));

  // Smoke: soft puff whose coverage is broken up by fbm so overlapping sprites read as a volume, not discs.
  const smoke = writePixels(128, (u, v, o) => {
    const dx = u - 0.5;
    const dy = v - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy) * 2;
    const n = noise.fbm(u, v, 4, 3);
    const n2 = noise2.fbm(u + 0.31, v + 0.17, 3, 5);
    const radial = 1 - smooth(0.2, 1.0, r + (n - 0.5) * 0.55);
    const body = clamp01(radial * (0.6 + 0.65 * n2));
    const a = clamp01(Math.pow(body, 1.6) * 1.25);
    const lum = 0.84 + 0.16 * n;
    o[0] = lum;
    o[1] = lum;
    o[2] = lum;
    o[3] = a;
  });

  // Dust: coarser, grainier, more irregular puff.
  const dust = writePixels(128, (u, v, o) => {
    const dx = u - 0.5;
    const dy = v - 0.5;
    const r = Math.sqrt(dx * dx + dy * dy) * 2;
    const n = noise2.fbm(u * 1.3, v * 1.3, 5, 4);
    const radial = 1 - smooth(0.1, 1.0, r + (n - 0.5) * 0.6);
    const core = Math.exp(-r * r * 2.2);
    const a = clamp01(radial * (0.55 + 0.55 * n) * 0.85 + core * 0.35);
    const lum = 0.7 + 0.3 * noise.fbm(u, v, 3, 6);
    o[0] = lum;
    o[1] = lum;
    o[2] = lum;
    o[3] = Math.pow(a, 1.5);
  });

  // Spark: bright thin core along V with a hot centre and soft halo.
  const spark = writePixels(64, (u, v, o) => {
    const dx = (u - 0.5) * 2;
    const dy = (v - 0.5) * 2;
    const core = Math.exp(-dx * dx * 28) * (1 - smooth(0.7, 1.0, Math.abs(dy)));
    const halo = Math.exp(-dx * dx * 5) * (1 - smooth(0.5, 1.0, Math.abs(dy))) * 0.35;
    const a = clamp01(core + halo);
    const heat = clamp01(core * 1.4);
    o[0] = 1;
    o[1] = 0.55 + 0.45 * heat;
    o[2] = 0.25 + 0.75 * heat;
    o[3] = a;
  });

  // Rain streak: very thin, soft ended.
  const rain = writePixels(32, (u, v, o) => {
    const dx = (u - 0.5) * 2;
    const dy = (v - 0.5) * 2;
    const line = Math.exp(-dx * dx * 12) * (1 - smooth(0.55, 1.0, Math.abs(dy)));
    o[0] = 1;
    o[1] = 1;
    o[2] = 1;
    o[3] = clamp01(line);
  });

  // Glow: gaussian blob.
  const glow = writePixels(64, (u, v, o) => {
    const dx = (u - 0.5) * 2;
    const dy = (v - 0.5) * 2;
    const r2 = dx * dx + dy * dy;
    const a = Math.exp(-r2 * 4.5) * (1 - smooth(0.85, 1.0, Math.sqrt(r2)));
    o[0] = 1;
    o[1] = 1;
    o[2] = 1;
    o[3] = clamp01(a);
  });

  // Debris chip: irregular polygon with a slightly bevelled tone.
  const chipVerts: [number, number][] = [];
  const chipN = 6;
  for (let i = 0; i < chipN; i++) {
    const ang = (i / chipN) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const rad = rng.range(0.55, 0.95);
    chipVerts.push([0.5 + Math.cos(ang) * rad * 0.5, 0.5 + Math.sin(ang) * rad * 0.5]);
  }
  const insidePoly = (x: number, y: number): boolean => {
    let inside = false;
    for (let i = 0, j = chipN - 1; i < chipN; j = i++) {
      const [xi, yi] = chipVerts[i];
      const [xj, yj] = chipVerts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const chip = writePixels(64, (u, v, o) => {
    // 4-tap AA
    let cov = 0;
    for (let s = 0; s < 4; s++) cov += insidePoly(u + ((s & 1) - 0.5) / 96, v + ((s >> 1) - 0.5) / 96) ? 0.25 : 0;
    const lum = 0.75 + 0.25 * noise.fbm(u, v, 2, 4) + (u - 0.5) * 0.35;
    o[0] = lum;
    o[1] = lum;
    o[2] = lum;
    o[3] = cov;
  });

  // Confetti: soft-edged rectangle with a subtle sheen gradient.
  const confetti = writePixels(32, (u, v, o) => {
    const ax = Math.abs(u - 0.5);
    const ay = Math.abs(v - 0.5);
    const a = (1 - smooth(0.36, 0.44, ax)) * (1 - smooth(0.4, 0.48, ay));
    const lum = 0.8 + 0.3 * (u - 0.5) + 0.15 * (v - 0.5);
    o[0] = lum;
    o[1] = lum;
    o[2] = lum;
    o[3] = a;
  });

  // Splash ring: thin circle, softer inside than out.
  const ring = writePixels(64, (u, v, o) => {
    const dx = (u - 0.5) * 2;
    const dy = (v - 0.5) * 2;
    const r = Math.sqrt(dx * dx + dy * dy);
    const band = smooth(0.55, 0.78, r) * (1 - smooth(0.82, 0.98, r));
    const n = 0.7 + 0.3 * noise.fbm(u * 2, v * 2, 3, 4);
    o[0] = 1;
    o[1] = 1;
    o[2] = 1;
    o[3] = clamp01(band * n);
  });

  // Tileable noise (R: fbm, G: fbm offset, B: fine, A: 1) for haze, racing line and skid streaks.
  const noiseTex = writePixels(128, (u, v, o) => {
    o[0] = noise.fbm(u, v, 4, 4);
    o[1] = noise2.fbm(u, v, 4, 4);
    o[2] = noise.fbm(u + 0.5, v + 0.5, 2, 16);
    o[3] = 1;
  });

  const list: THREE.Texture[] = [];
  const mk = (c: HTMLCanvasElement, repeat = false) => {
    const t = finish(c, repeat);
    list.push(t);
    return t;
  };

  return {
    smoke: mk(smoke),
    dust: mk(dust),
    spark: mk(spark),
    rain: mk(rain),
    glow: mk(glow),
    chip: mk(chip),
    confetti: mk(confetti),
    ring: mk(ring),
    noise: mk(noiseTex, true),
    dispose() {
      for (const t of list) t.dispose();
    },
  };
};
