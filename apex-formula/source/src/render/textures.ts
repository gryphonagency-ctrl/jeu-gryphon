import * as THREE from 'three';
import { Rng } from '../core/math';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

/** Grayscale lens dirt / smudge plate: soft splotches, faint scratches and a few bokeh rings. */
export function createLensDirtTexture(size = 512, seed = 1337): THREE.CanvasTexture {
  const [c, ctx] = canvas(size);
  const rng = new Rng(seed);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(size * 0.01, size * 0.09);
    const a = rng.range(0.03, 0.16) * (r < size * 0.03 ? 1.6 : 1);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(255,255,255,${a * 0.4})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(size * 0.015, size * 0.05);
    ctx.strokeStyle = `rgba(255,255,255,${rng.range(0.05, 0.16)})`;
    ctx.lineWidth = rng.range(1, 3);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 60; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const len = rng.range(size * 0.03, size * 0.25);
    const ang = rng.range(0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${rng.range(0.03, 0.1)})`;
    ctx.lineWidth = rng.range(0.5, 1.5);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  for (let i = 0; i < 1800; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    ctx.fillStyle = `rgba(255,255,255,${rng.range(0.05, 0.3)})`;
    ctx.fillRect(x, y, rng.range(0.6, 1.8), rng.range(0.6, 1.8));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/** Soft radial gradient (white centre → transparent edge) with a gentle noise breakup, for additive haze cards. */
export function createHazeTexture(size = 256, softness = 0.6, seed = 7): THREE.CanvasTexture {
  const [c, ctx] = canvas(size);
  const rng = new Rng(seed);
  const half = size / 2;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(softness * 0.5, 'rgba(255,255,255,0.55)');
  g.addColorStop(softness, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 40; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(size * 0.1, size * 0.4);
    const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = Math.floor(rng.range(170, 255));
    gg.addColorStop(0, `rgba(${v},${v},${v},1)`);
    gg.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Ring that fades from transparent (inner) to opaque black (outer): masks the studio floor edge into the backdrop. */
export function createEdgeFadeTexture(size = 512): THREE.CanvasTexture {
  const [c, ctx] = canvas(size);
  const half = size / 2;
  const g = ctx.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.55, 'rgba(0,0,0,0)');
  g.addColorStop(0.8, 'rgba(0,0,0,0.75)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Fine brushed / micro-scratch roughness variation for the studio floor. */
export function createFloorRoughnessTexture(size = 512, seed = 99): THREE.CanvasTexture {
  const [c, ctx] = canvas(size);
  const rng = new Rng(seed);
  ctx.fillStyle = 'rgb(40,40,40)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4000; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const v = Math.floor(rng.range(30, 110));
    ctx.fillStyle = `rgba(${v},${v},${v},${rng.range(0.2, 0.6)})`;
    ctx.fillRect(x, y, rng.range(1, 3), rng.range(1, 3));
  }
  for (let i = 0; i < 300; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const len = rng.range(10, 120);
    const ang = rng.range(0, Math.PI * 2);
    const v = Math.floor(rng.range(60, 140));
    ctx.strokeStyle = `rgba(${v},${v},${v},${rng.range(0.15, 0.4)})`;
    ctx.lineWidth = rng.range(0.5, 1.2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
