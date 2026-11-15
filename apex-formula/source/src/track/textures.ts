import * as THREE from 'three';
import { Rng } from '../core/math';
import type { Disposer } from './util';
import { fbm, valueNoise } from './util';
import { AD_BRANDS, AD_COLORS, type ThemePalette } from './themes';

type Ctx2D = CanvasRenderingContext2D;

const canvas = (w: number, h = w): [HTMLCanvasElement, Ctx2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
};

const finish = (d: Disposer, c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: boolean; aniso?: number } = {}): THREE.CanvasTexture => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = opts.repeat === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 8;
  t.needsUpdate = true;
  return d.tex(t);
};

/** Height field (0..1) → tangent-space normal map. */
const normalFromHeight = (d: Disposer, h: Float32Array, size: number, strength: number): THREE.CanvasTexture => {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const dn = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (dn - u) * strength;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      const i = (y * size + x) * 4;
      data[i] = 128 + nx * 127;
      data[i + 1] = 128 + ny * 127;
      data[i + 2] = 128 + nz * inv * 127;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(d, c, { srgb: false });
};

const hexRgb = (hex: string): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
};

export interface AtlasCell {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Fixed-cell text atlas for boards, garage signs, grid numbers. */
export class TextAtlas {
  readonly cols: number;
  readonly rows: number;
  readonly cellW: number;
  readonly cellH: number;
  private readonly c: HTMLCanvasElement;
  private readonly ctx: Ctx2D;
  private readonly keys = new Map<string, number>();
  private count = 0;
  texture: THREE.CanvasTexture;

  constructor(d: Disposer, cols: number, rows: number, cellW: number, cellH: number) {
    this.cols = cols;
    this.rows = rows;
    this.cellW = cellW;
    this.cellH = cellH;
    [this.c, this.ctx] = canvas(cols * cellW, rows * cellH);
    this.texture = finish(d, this.c, { repeat: false, aniso: 8 });
  }

  /** Add a cell drawn by `draw(ctx, w, h)`; returns its index. Keyed so duplicates are reused. */
  add(key: string, draw: (ctx: Ctx2D, w: number, h: number) => void): number {
    const existing = this.keys.get(key);
    if (existing !== undefined) return existing;
    const idx = this.count++;
    if (idx >= this.cols * this.rows) return (this.count = this.cols * this.rows) - 1;
    const cx = (idx % this.cols) * this.cellW;
    const cy = Math.floor(idx / this.cols) * this.cellH;
    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.beginPath();
    this.ctx.rect(0, 0, this.cellW, this.cellH);
    this.ctx.clip();
    draw(this.ctx, this.cellW, this.cellH);
    this.ctx.restore();
    this.keys.set(key, idx);
    this.texture.needsUpdate = true;
    return idx;
  }

  cell(idx: number): AtlasCell {
    const cx = idx % this.cols;
    const cy = Math.floor(idx / this.cols);
    const pad = 0.004;
    return {
      u0: cx / this.cols + pad,
      u1: (cx + 1) / this.cols - pad,
      // canvas y grows downward; texture v grows upward (flipY default true)
      v0: 1 - (cy + 1) / this.rows + pad,
      v1: 1 - cy / this.rows - pad,
    };
  }
}

/** Draw text fitted into a box. */
export const fitText = (ctx: Ctx2D, text: string, x: number, y: number, w: number, h: number, opts: { color?: string; weight?: string; italic?: boolean; align?: CanvasTextAlign; family?: string } = {}): void => {
  let size = h;
  const fam = opts.family ?? '"Helvetica Neue", Arial, sans-serif';
  const style = `${opts.italic ? 'italic ' : ''}${opts.weight ?? '800'} `;
  ctx.font = `${style}${size}px ${fam}`;
  let tw = ctx.measureText(text).width;
  if (tw > w) {
    size = Math.floor((size * w) / tw);
    ctx.font = `${style}${size}px ${fam}`;
    tw = ctx.measureText(text).width;
  }
  ctx.fillStyle = opts.color ?? '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = opts.align ?? 'center';
  const tx = opts.align === 'left' ? x : opts.align === 'right' ? x + w : x + w / 2;
  ctx.fillText(text, tx, y + h / 2);
};

export interface TextureLib {
  asphaltMap: THREE.Texture;
  asphaltNormal: THREE.Texture;
  asphaltRough: THREE.Texture;
  grassMap: THREE.Texture;
  grassNormal: THREE.Texture;
  gravelMap: THREE.Texture;
  gravelNormal: THREE.Texture;
  runoffMap: THREE.Texture;
  concreteMap: THREE.Texture;
  concreteNormal: THREE.Texture;
  groundMap: THREE.Texture;
  rockMap: THREE.Texture;
  rockNormal: THREE.Texture;
  tyreMap: THREE.Texture;
  tyreNormal: THREE.Texture;
  tecproMap: THREE.Texture;
  armcoMap: THREE.Texture;
  armcoNormal: THREE.Texture;
  fenceMap: THREE.Texture;
  crowdMap: THREE.Texture;
  treeMap: THREE.Texture;
  palmMap: THREE.Texture;
  waterNormal: THREE.Texture;
  checker: THREE.Texture;
  adAtlas: TextAtlas;
  boardAtlas: TextAtlas;
  gridAtlas: TextAtlas;
  garageAtlas: TextAtlas;
  banner: THREE.Texture;
  glassMap: THREE.Texture;
  metalMap: THREE.Texture;
  yellowBlack: THREE.Texture;
}

export const createTextures = async (d: Disposer, pal: ThemePalette, size: number, yieldFn: () => Promise<void>, seed: number): Promise<TextureLib> => {
  const rng = new Rng(seed);
  const S = size;
  const small = Math.min(512, size);

  /* ── asphalt ── */
  const asphaltH = new Float32Array(S * S);
  const asphaltMap = (() => {
    const [c, ctx] = canvas(S);
    const img = ctx.createImageData(S, S);
    const data = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const fx = x / S;
        const fy = y / S;
        const n1 = fbm(fx * 48, fy * 48, 3);
        const n2 = valueNoise(fx * 260, fy * 260);
        const grain = rng.next();
        const h = 0.55 * n1 + 0.3 * n2 + 0.15 * grain;
        asphaltH[y * S + x] = h;
        const v = 62 + (h - 0.5) * 70 + (grain - 0.5) * 22;
        const i = (y * S + x) * 4;
        data[i] = v * 0.98;
        data[i + 1] = v;
        data[i + 2] = v * 1.04;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(d, c, { aniso: 16 });
  })();
  await yieldFn();
  const asphaltNormal = normalFromHeight(d, asphaltH, S, 2.2);
  const asphaltRough = (() => {
    const [c, ctx] = canvas(small);
    const img = ctx.createImageData(small, small);
    for (let y = 0; y < small; y++)
      for (let x = 0; x < small; x++) {
        const n = fbm((x / small) * 20, (y / small) * 20, 3);
        const v = 175 + n * 60 + (rng.next() - 0.5) * 30;
        const i = (y * small + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return finish(d, c, { srgb: false });
  })();
  await yieldFn();

  /* ── grass with mown stripes (stripes run along u) ── */
  const grassH = new Float32Array(small * small);
  const grassMap = (() => {
    const [c, ctx] = canvas(small);
    const img = ctx.createImageData(small, small);
    const [gr, gg, gb] = hexRgb(pal.grass);
    const [dr, dg, db] = hexRgb(pal.grassDark);
    for (let y = 0; y < small; y++) {
      const stripe = Math.floor((y / small) * 4) % 2 === 0 ? 1 : 0.8;
      for (let x = 0; x < small; x++) {
        const n = fbm((x / small) * 30, (y / small) * 30, 4);
        const blades = valueNoise((x / small) * 220, (y / small) * 60);
        grassH[y * small + x] = n * 0.6 + blades * 0.4;
        const t = n * 0.7 + blades * 0.3;
        const i = (y * small + x) * 4;
        img.data[i] = (dr + (gr - dr) * t) * stripe;
        img.data[i + 1] = (dg + (gg - dg) * t) * stripe;
        img.data[i + 2] = (db + (gb - db) * t) * stripe;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(d, c);
  })();
  const grassNormal = normalFromHeight(d, grassH, small, 0.8);
  await yieldFn();

  /* ── gravel ── */
  const gravelH = new Float32Array(small * small);
  const gravelMap = (() => {
    const [c, ctx] = canvas(small);
    const img = ctx.createImageData(small, small);
    const [br, bg, bb] = hexRgb(pal.gravel);
    for (let y = 0; y < small; y++)
      for (let x = 0; x < small; x++) {
        const p = valueNoise((x / small) * 140, (y / small) * 140);
        const n = fbm((x / small) * 12, (y / small) * 12, 3);
        gravelH[y * small + x] = p;
        const t = 0.75 + p * 0.35 + (n - 0.5) * 0.2;
        const i = (y * small + x) * 4;
        img.data[i] = br * t;
        img.data[i + 1] = bg * t;
        img.data[i + 2] = bb * t;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return finish(d, c);
  })();
  const gravelNormal = normalFromHeight(d, gravelH, small, 2.5);

  /* ── asphalt run-off (pale, with faint painted grid) ── */
  const runoffMap = (() => {
    const [c, ctx] = canvas(small);
    const img = ctx.createImageData(small, small);
    const [br, bg, bb] = hexRgb(pal.runoffAsphalt);
    for (let y = 0; y < small; y++)
      for (let x = 0; x < small; x++) {
        const n = fbm((x / small) * 40, (y / small) * 40, 3);
        const t = 0.85 + (n - 0.5) * 0.35 + (rng.next() - 0.5) * 0.1;
        const i = (y * small + x) * 4;
        img.data[i] = br * t;
        img.data[i + 1] = bg * t;
        img.data[i + 2] = bb * t;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = Math.max(2, small / 128);
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(0, (small / 4) * k + 4);
      ctx.lineTo(small, (small / 4) * k + 4);
      ctx.stroke();
    }
    return finish(d, c);
  })();
  await yieldFn();

  /* ── concrete ── */
  const concH = new Float32Array(small * small);
  const concreteMap = (() => {
    const [c, ctx] = canvas(small);
    const img = ctx.createImageData(small, small);
    const [br, bg, bb] = hexRgb(pal.concrete);
    for (let y = 0; y < small; y++)
      for (let x = 0; x < small; x++) {
        const n = fbm((x / small) * 9, (y / small) * 9, 4);
        const stain = fbm((x / small) * 3 + 5, (y / small) * 3, 2);
        concH[y * small + x] = n;
        const t = 0.82 + (n - 0.5) * 0.25 - stain * 0.12 + (rng.next() - 0.5) * 0.06;
        const i = (y * small + x) * 4;
        img.data[i] = br * t;
        img.data[i + 1] = bg * t;
        img.data[i + 2] = bb * t;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return finish(d, c);
  })();
  const concreteNormal = normalFromHeight(d, concH, small, 0.6);

  /* ── ground (far terrain) ── */
  const groundMap = (() => {
    const [c, ctx] = canvas(small);
    const img = ctx.createImageData(small, small);
    const [br, bg, bb] = hexRgb(pal.ground);
    const [fr, fg, fb] = hexRgb(pal.groundFar);
    for (let y = 0; y < small; y++)
      for (let x = 0; x < small; x++) {
        const n = fbm((x / small) * 16, (y / small) * 16, 4);
        const m = fbm((x / small) * 3 + 11, (y / small) * 3 + 7, 2);
        const i = (y * small + x) * 4;
        const t = 0.8 + n * 0.4;
        img.data[i] = (br + (fr - br) * m) * t;
        img.data[i + 1] = (bg + (fg - bg) * m) * t;
        img.data[i + 2] = (bb + (fb - bb) * m) * t;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return finish(d, c);
  })();
  await yieldFn();

  /* ── rock ── */
  const rockH = new Float32Array(small * small);
  const rockMap = (() => {
    const [c, ctx] = canvas(small);
    const img = ctx.createImageData(small, small);
    for (let y = 0; y < small; y++)
      for (let x = 0; x < small; x++) {
        const n = fbm((x / small) * 6, (y / small) * 6, 5);
        const strata = 0.5 + 0.5 * Math.sin((y / small) * 60 + n * 8);
        rockH[y * small + x] = n * 0.7 + strata * 0.3;
        const t = 0.55 + n * 0.5 + strata * 0.15;
        const i = (y * small + x) * 4;
        img.data[i] = 150 * t;
        img.data[i + 1] = 128 * t;
        img.data[i + 2] = 105 * t;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return finish(d, c);
  })();
  const rockNormal = normalFromHeight(d, rockH, small, 3);

  /* ── tyre wall: one tyre column wide, N rows tall ── */
  const tyreRows = pal.tyreRows;
  const tyreH = new Float32Array(small * small);
  const tyreMap = (() => {
    const [c, ctx] = canvas(small);
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, small, small);
    const rows = tyreRows.length;
    const rh = small / rows;
    for (let r = 0; r < rows; r++) {
      const cy = small - rh * (r + 0.5);
      const cx = small / 2;
      const rad = rh * 0.48;
      const grad = ctx.createRadialGradient(cx, cy, rad * 0.35, cx, cy, rad);
      grad.addColorStop(0, '#0c0c0c');
      grad.addColorStop(0.55, tyreRows[r]);
      grad.addColorStop(0.9, tyreRows[r]);
      grad.addColorStop(1, '#101010');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let y = 0; y < small; y++)
      for (let x = 0; x < small; x++) {
        const r = Math.floor(y / rh);
        const cy = rh * (r + 0.5);
        const dx = (x - small / 2) / (rh * 0.48);
        const dy = (y - cy) / (rh * 0.48);
        const rr = Math.hypot(dx, dy);
        tyreH[y * small + x] = rr < 1 ? Math.sqrt(Math.max(0, 1 - rr * rr)) * (rr > 0.32 ? 1 : 0.6) : 0;
      }
    return finish(d, c);
  })();
  const tyreNormal = normalFromHeight(d, tyreH, small, 4);
  await yieldFn();

  /* ── Tecpro blocks (tiles: 2 blocks per tile, red / white) ── */
  const tecproMap = (() => {
    const [c, ctx] = canvas(small, small / 2);
    const w = small;
    const h = small / 2;
    ctx.fillStyle = '#d31f1f';
    ctx.fillRect(0, 0, w / 2, h);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(w / 2, 0, w / 2, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, 3, h);
    ctx.fillRect(w / 2 - 3, 0, 6, h);
    ctx.fillRect(w - 3, 0, 3, h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, h - 6, w, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, 0, w, 4);
    return finish(d, c);
  })();

  /* ── Armco (galvanised W-beam) ── */
  const armH = new Float32Array(small * small);
  const armcoMap = (() => {
    const [c, ctx] = canvas(small);
    const img = ctx.createImageData(small, small);
    for (let y = 0; y < small; y++) {
      const fy = y / small;
      const wave = Math.abs(Math.sin(fy * Math.PI * 2)) ;
      for (let x = 0; x < small; x++) {
        const n = fbm((x / small) * 18, fy * 18, 3);
        const bolt = ((x + small / 8) % (small / 2) < small / 32 && Math.abs(fy - 0.5) < 0.05) ? 0.35 : 0;
        armH[y * small + x] = wave * 0.85 + n * 0.15 + bolt;
        const t = 0.62 + wave * 0.28 + (n - 0.5) * 0.18 - bolt * 0.4;
        const i = (y * small + x) * 4;
        img.data[i] = 175 * t;
        img.data[i + 1] = 180 * t;
        img.data[i + 2] = 185 * t;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(d, c);
  })();
  const armcoNormal = normalFromHeight(d, armH, small, 2.5);
  await yieldFn();

  /* ── catch fence mesh (alpha) ── */
  const fenceMap = (() => {
    const [c, ctx] = canvas(256);
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = pal.fence;
    ctx.lineWidth = 3;
    const step = 32;
    for (let k = 0; k <= 256; k += step) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k + 128, 256);
      ctx.moveTo(k - 128, 256);
      ctx.lineTo(k, 0);
      ctx.moveTo(k, 0);
      ctx.lineTo(k - 128, 256);
      ctx.moveTo(k + 128, 256);
      ctx.lineTo(k, 0);
      ctx.stroke();
    }
    const t = finish(d, c, { aniso: 4 });
    return t;
  })();

  /* ── crowd atlas: 4 x 2 silhouettes, body white (tinted per instance), skin head ── */
  const crowdMap = (() => {
    const [c, ctx] = canvas(512, 256);
    ctx.clearRect(0, 0, 512, 256);
    const skins = ['#f1c7a3', '#d9a173', '#a76b41', '#6b4227', '#f3d2b5', '#c98a5c', '#8b5a34', '#e8b892'];
    for (let i = 0; i < 8; i++) {
      const ox = (i % 4) * 128;
      const oy = Math.floor(i / 4) * 128;
      const cx = ox + 64;
      const armsUp = i % 3 === 0;
      const wide = 26 + (i % 4) * 4;
      // legs
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - wide * 0.45, oy + 84, wide * 0.38, 40);
      ctx.fillRect(cx + wide * 0.07, oy + 84, wide * 0.38, 40);
      // torso
      ctx.beginPath();
      ctx.roundRect(cx - wide / 2, oy + 42, wide, 48, 8);
      ctx.fill();
      // arms
      if (armsUp) {
        ctx.fillRect(cx - wide / 2 - 10, oy + 8, 9, 50);
        ctx.fillRect(cx + wide / 2 + 1, oy + 8, 9, 50);
      } else {
        ctx.fillRect(cx - wide / 2 - 9, oy + 46, 8, 40);
        ctx.fillRect(cx + wide / 2 + 1, oy + 46, 8, 40);
      }
      // head (skin)
      ctx.fillStyle = skins[i];
      ctx.beginPath();
      ctx.arc(cx, oy + 26, 13, 0, Math.PI * 2);
      ctx.fill();
      // hair / cap
      ctx.fillStyle = i % 2 ? '#2a1c12' : '#c33';
      ctx.beginPath();
      ctx.arc(cx, oy + 22, 13, Math.PI, Math.PI * 2);
      ctx.fill();
    }
    const t = finish(d, c, { repeat: false, aniso: 4 });
    return t;
  })();

  /* ── trees ── */
  const treeMap = (() => {
    const [c, ctx] = canvas(512, 512);
    ctx.clearRect(0, 0, 512, 512);
    const kind = pal.treeKind;
    // trunk
    ctx.fillStyle = '#4a3421';
    ctx.fillRect(236, 300, 40, 212);
    const g = (x: number, y: number, r: number, col: string) => {
      const gr = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      gr.addColorStop(0, col);
      gr.addColorStop(1, shade(col, 0.55));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (kind === 'pine') {
      ctx.fillStyle = '#4a3421';
      ctx.fillRect(244, 380, 24, 132);
      for (let i = 0; i < 6; i++) {
        const y = 60 + i * 66;
        const w = 60 + i * 34;
        const gr = ctx.createLinearGradient(256 - w, y, 256 + w, y);
        gr.addColorStop(0, '#1d3d1f');
        gr.addColorStop(0.5, '#2f6a33');
        gr.addColorStop(1, '#1a351b');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(256, y - 70);
        ctx.lineTo(256 + w, y + 40);
        ctx.lineTo(256 - w, y + 40);
        ctx.closePath();
        ctx.fill();
      }
    } else if (kind === 'poplar') {
      for (let i = 0; i < 40; i++) {
        const t = i / 40;
        g(256 + Math.sin(i * 2.3) * 30 * (1 - Math.abs(t - 0.5) * 1.6), 40 + t * 380, 34 + Math.sin(i) * 8, i % 2 ? '#3f7a2c' : '#4f8f36');
      }
    } else {
      const cols = ['#3d7a2a', '#4d8f33', '#5da13d', '#2f6a25'];
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const rr = 90 + Math.sin(i * 1.7) * 40;
        g(256 + Math.cos(a) * rr, 190 + Math.sin(a) * rr * 0.8, 70 + Math.sin(i * 2.1) * 20, cols[i % 4]);
      }
      g(256, 170, 120, '#4a8a31');
    }
    return finish(d, c, { repeat: false, aniso: 4 });
  })();
  const palmMap = (() => {
    const [c, ctx] = canvas(512, 512);
    ctx.clearRect(0, 0, 512, 512);
    ctx.strokeStyle = '#7a5a3a';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(240, 512);
    ctx.quadraticCurveTo(250, 300, 280, 150);
    ctx.stroke();
    ctx.strokeStyle = '#3f8a3a';
    ctx.lineWidth = 16;
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(280, 150);
      ctx.quadraticCurveTo(280 + Math.cos(a) * 120, 150 + Math.sin(a) * 60 - 40, 280 + Math.cos(a) * 200, 150 + Math.sin(a) * 110 + 30);
      ctx.strokeStyle = i % 2 ? '#2f7a2f' : '#4a9a3f';
      ctx.stroke();
    }
    ctx.fillStyle = '#6b4a2a';
    ctx.beginPath();
    ctx.arc(280, 160, 18, 0, Math.PI * 2);
    ctx.fill();
    return finish(d, c, { repeat: false, aniso: 4 });
  })();
  await yieldFn();

  /* ── water normal ── */
  const waterH = new Float32Array(small * small);
  for (let y = 0; y < small; y++) for (let x = 0; x < small; x++) waterH[y * small + x] = fbm((x / small) * 8, (y / small) * 8, 4);
  const waterNormal = normalFromHeight(d, waterH, small, 1.6);

  /* ── chequered S/F ── */
  const checker = (() => {
    const [c, ctx] = canvas(256, 64);
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#f4f4f4' : '#111';
        ctx.fillRect(i * 32, j * 32, 32, 32);
      }
    return finish(d, c, { repeat: false });
  })();

  /* ── ad atlas ── */
  const adAtlas = new TextAtlas(d, 2, 5, 512, 128);
  AD_BRANDS.forEach((brand, i) => {
    const [bg, fg] = AD_COLORS[i];
    adAtlas.add(brand, (ctx, w, h) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      // logo mark
      ctx.fillStyle = fg;
      ctx.beginPath();
      if (i % 3 === 0) {
        ctx.moveTo(24, h - 24);
        ctx.lineTo(60, 24);
        ctx.lineTo(96, h - 24);
        ctx.closePath();
      } else if (i % 3 === 1) {
        ctx.arc(60, h / 2, 36, 0, Math.PI * 2);
      } else {
        ctx.roundRect(24, 24, 72, h - 48, 14);
      }
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(60, h / 2, 14, 0, Math.PI * 2);
      ctx.fill();
      fitText(ctx, brand, 116, 18, w - 140, h - 36, { color: fg, weight: '900', italic: i % 2 === 0 });
    });
  });

  /* ── board atlas (signs) ── */
  const boardAtlas = new TextAtlas(d, 8, 4, 256, 192);

  /* ── grid box atlas: 20 numbered boxes ── */
  const gridAtlas = new TextAtlas(d, 5, 4, 204, 256);
  for (let i = 0; i < 20; i++) {
    gridAtlas.add(`grid${i}`, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#f4f4f4';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(8, 8);
      ctx.lineTo(w - 8, 8);
      ctx.lineTo(w - 8, h * 0.45);
      ctx.moveTo(8, 8);
      ctx.lineTo(8, h * 0.45);
      ctx.stroke();
      fitText(ctx, `${i + 1}`, 20, h * 0.5, w - 40, h * 0.42, { color: '#f4f4f4', weight: '900' });
    });
  }

  /* ── garage light boxes (filled later per team by pit builder) ── */
  const garageAtlas = new TextAtlas(d, 2, 6, 512, 128);

  /* ── gantry banner ── */
  const banner = (() => {
    const [c, ctx] = canvas(2048, 256);
    const gr = ctx.createLinearGradient(0, 0, 2048, 0);
    gr.addColorStop(0, '#0b0f1e');
    gr.addColorStop(0.5, '#141b33');
    gr.addColorStop(1, '#0b0f1e');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 2048, 256);
    ctx.fillStyle = '#e10600';
    ctx.fillRect(0, 232, 2048, 24);
    fitText(ctx, 'APEX FORMULA', 80, 30, 900, 170, { color: '#ffffff', weight: '900', italic: true });
    fitText(ctx, 'ZENITH WATCHES GRAND PRIX', 1060, 60, 900, 110, { color: '#ffd200', weight: '800' });
    return finish(d, c, { repeat: false });
  })();

  /* ── glass / metal / hazard ── */
  const glassMap = (() => {
    const [c, ctx] = canvas(256);
    const gr = ctx.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#b8d8f0');
    gr.addColorStop(1, '#6e97b8');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(20,30,50,0.55)';
    for (let i = 0; i < 4; i++) ctx.fillRect(0, i * 64 + 58, 256, 6);
    for (let i = 0; i < 4; i++) ctx.fillRect(i * 64 + 60, 0, 4, 256);
    return finish(d, c);
  })();
  const metalMap = (() => {
    const [c, ctx] = canvas(128);
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) {
      const v = 150 + (rng.next() - 0.5) * 40;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v + 5;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return finish(d, c);
  })();
  const yellowBlack = (() => {
    const [c, ctx] = canvas(128, 32);
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(0, 0, 128, 32);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(32, 0);
    ctx.lineTo(64, 32);
    ctx.lineTo(32, 32);
    ctx.closePath();
    ctx.moveTo(64, 0);
    ctx.lineTo(96, 0);
    ctx.lineTo(128, 32);
    ctx.lineTo(96, 32);
    ctx.closePath();
    ctx.fill();
    return finish(d, c);
  })();

  return {
    asphaltMap,
    asphaltNormal,
    asphaltRough,
    grassMap,
    grassNormal,
    gravelMap,
    gravelNormal,
    runoffMap,
    concreteMap,
    concreteNormal,
    groundMap,
    rockMap,
    rockNormal,
    tyreMap,
    tyreNormal,
    tecproMap,
    armcoMap,
    armcoNormal,
    fenceMap,
    crowdMap,
    treeMap,
    palmMap,
    waterNormal,
    checker,
    adAtlas,
    boardAtlas,
    gridAtlas,
    garageAtlas,
    banner,
    glassMap,
    metalMap,
    yellowBlack,
  };
};

const shade = (hex: string, f: number): string => {
  const c = new THREE.Color(hex).multiplyScalar(f);
  return `#${c.getHexString()}`;
};

/** Standard sign painter: dark board, coloured band, big text (and optional small line). */
export const drawSign = (ctx: Ctx2D, w: number, h: number, big: string, small?: string, bg = '#101418', fg = '#ffffff', band = '#e10600'): void => {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, w, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(6, 20, w - 12, h - 26);
  if (small) {
    fitText(ctx, big, 12, 24, w - 24, h * 0.5, { color: fg, weight: '900' });
    fitText(ctx, small, 12, h * 0.68, w - 24, h * 0.24, { color: fg, weight: '700' });
  } else {
    fitText(ctx, big, 12, 22, w - 24, h - 34, { color: fg, weight: '900' });
  }
};
