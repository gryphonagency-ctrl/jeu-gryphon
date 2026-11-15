/** Isolated harness for the render system: test scene, orbit camera, time-of-day / weather / quality / menu toggles. */
import * as THREE from 'three';
import { QUALITY_LEVELS, type QualityLevel } from '../core/constants';
import { KINGSMERE } from '../core/circuits';
import { Rng } from '../core/math';
import type { World } from '../core/types';
import { createEnvironment } from '../core/world';
import { RenderSystem } from './RenderSystem';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;

const render = new RenderSystem(canvas);
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.2, 3000);
render.setCamera(camera);

const env = createEnvironment(15.5);
const world = { mode: 'live', env } as unknown as World;
render.setEnvironment(KINGSMERE, env);

declare global {
  interface Window {
    apex?: { render: RenderSystem; env: typeof env; camera: THREE.PerspectiveCamera };
  }
}
window.apex = { render, env, camera };

/* ───────────── test scene ───────────── */

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const dark = (x + y) % 2 === 0;
      ctx.fillStyle = dark ? '#3a3d40' : '#5b6066';
      ctx.fillRect(x * 64, y * 64, 64, 64);
    }
  ctx.strokeStyle = '#d8dde2';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 509, 509);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(200, 200);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildTestScene(parent: THREE.Object3D): void {
  const rng = new Rng(42);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.85, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  parent.add(ground);

  // "Asphalt" strip + kerbs so the shadows read.
  const road = new THREE.Mesh(new THREE.PlaneGeometry(14, 600), new THREE.MeshStandardMaterial({ color: 0x2b2c2f, roughness: 0.7, metalness: 0.05 }));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  road.receiveShadow = true;
  parent.add(road);
  const kerbGeo = new THREE.BoxGeometry(1.6, 0.06, 2);
  for (let i = -30; i < 30; i++) {
    const m = new THREE.Mesh(kerbGeo, new THREE.MeshStandardMaterial({ color: i % 2 ? 0xd12b2b : 0xe8e8e8, roughness: 0.6 }));
    m.position.set(7.8, 0.03, i * 2 + 1);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
  }

  const shapes = [new THREE.SphereGeometry(0.7, 48, 32), new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.TorusKnotGeometry(0.45, 0.16, 120, 16), new THREE.CylinderGeometry(0.5, 0.5, 1.4, 32)];
  for (let i = 0; i < 48; i++) {
    const geo = shapes[i % shapes.length];
    const clearcoat = rng.next() > 0.5;
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setHSL(rng.next(), 0.7, 0.45),
      roughness: rng.range(0.05, 0.9),
      metalness: rng.next() > 0.6 ? 1 : 0,
      clearcoat: clearcoat ? 1 : 0,
      clearcoatRoughness: rng.range(0.02, 0.2),
    });
    const m = new THREE.Mesh(geo, mat);
    const a = (i / 48) * Math.PI * 2;
    const r = 5 + (i % 4) * 3.2;
    m.position.set(Math.cos(a) * r, 0.75 + (i % 3) * 0.3, Math.sin(a) * r);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
  }
  // Hero object at the origin (stand-in for the car).
  const hero = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.6, 3.6, 8, 24),
    new THREE.MeshPhysicalMaterial({ color: 0x1030a0, roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
  );
  hero.rotation.x = Math.PI / 2;
  hero.position.y = 0.65;
  hero.castShadow = hero.receiveShadow = true;
  parent.add(hero);

  // Emissives: brake-glow style and floodlight-style.
  for (let i = 0; i < 6; i++) {
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1, 0.25, 0.05), emissiveIntensity: 8 }));
    glow.position.set(-6 + i * 2.4, 0.4, -6);
    parent.add(glow);
  }
  for (let i = 0; i < 4; i++) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 24, 10), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.8 }));
    const a = (i / 4) * Math.PI * 2 + 0.4;
    pole.position.set(Math.cos(a) * 34, 12, Math.sin(a) * 34);
    pole.castShadow = true;
    parent.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 0.5), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1, 0.95, 0.85), emissiveIntensity: 12 }));
    head.position.set(Math.cos(a) * 34, 24, Math.sin(a) * 34);
    head.lookAt(0, 0, 0);
    parent.add(head);
  }
  // Grandstand-ish blocks and trees for scale / distant shadows.
  for (let i = 0; i < 20; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(rng.range(6, 18), rng.range(4, 14), rng.range(6, 12)), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.08, 0.15, rng.range(0.25, 0.5)), roughness: 0.9 }));
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(60, 220);
    b.position.set(Math.cos(a) * r, (b.geometry as THREE.BoxGeometry).parameters.height / 2, Math.sin(a) * r);
    b.castShadow = b.receiveShadow = true;
    parent.add(b);
  }
  const treeTrunk = new THREE.CylinderGeometry(0.25, 0.35, 4, 8);
  const treeCrown = new THREE.SphereGeometry(2.6, 12, 10);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f5a22, roughness: 0.85 });
  for (let i = 0; i < 80; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(30, 300);
    const t = new THREE.Mesh(treeTrunk, trunkMat);
    t.position.set(Math.cos(a) * r, 2, Math.sin(a) * r);
    t.castShadow = true;
    parent.add(t);
    const c = new THREE.Mesh(treeCrown, crownMat);
    c.position.set(t.position.x, 5.5, t.position.z);
    c.castShadow = c.receiveShadow = true;
    parent.add(c);
  }
}

/** Rough F1-shaped stand-in (~5.6 m long, facing +Z) so the menu studio can be judged with a car-like object. */
function buildCarStandIn(): THREE.Group {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x0b2a7a, roughness: 0.32, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.04 });
  const carbon = new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.45, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.15 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  add(new THREE.BoxGeometry(0.9, 0.45, 3.4), paint, 0, 0.45, 0.1);
  add(new THREE.CylinderGeometry(0.12, 0.3, 1.8, 16), paint, 0, 0.42, 2.7, Math.PI / 2);
  add(new THREE.BoxGeometry(1.9, 0.05, 0.7), carbon, 0, 0.22, 2.9);
  add(new THREE.BoxGeometry(1.0, 0.5, 0.06), carbon, 0, 0.9, -2.3);
  add(new THREE.BoxGeometry(0.5, 0.8, 1.0), paint, 0, 0.85, -0.9);
  add(new THREE.BoxGeometry(1.5, 0.08, 1.6), carbon, 0, 0.06, 0);
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.4, 32);
  for (const [x, z] of [[-0.85, 1.7], [0.85, 1.7], [-0.85, -1.75], [0.85, -1.75]]) add(wheel, rubber, x, 0.36, z, 0, Math.PI / 2);
  return g;
}

const testGroup = new THREE.Group();
buildTestScene(testGroup);
render.sessionGroup.add(testGroup);
const carGroup = buildCarStandIn();
carGroup.visible = false;
render.sessionGroup.add(carGroup);

/* ───────────── controls ───────────── */

let orbit = true;
let yaw = 0.6;
let pitch = 0.18;
let radius = 7.5;
let menu = false;
let paused = false;
let qualityIndex = 2;
let dragging = false;
let lastX = 0;
let lastY = 0;
let hudVisible = true;
let showcase = false;
let lookUp = false;

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener('pointerup', () => (dragging = false));
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw -= (e.clientX - lastX) * 0.005;
  pitch = THREE.MathUtils.clamp(pitch + (e.clientY - lastY) * 0.004, -0.05, 1.3);
  lastX = e.clientX;
  lastY = e.clientY;
});
window.addEventListener('wheel', (e) => {
  radius = THREE.MathUtils.clamp(radius * (1 + e.deltaY * 0.001), 3, 120);
});

const timePresets = [8, 12, 15.5, 18.5, 19.3, 21, 3];
window.addEventListener('keydown', (e) => {
  const w = env.weather;
  switch (e.key) {
    case '1': case '2': case '3': case '4': case '5': case '6': case '7':
      env.timeOfDay = timePresets[Number(e.key) - 1];
      break;
    case '[': env.timeOfDay = (env.timeOfDay - 0.25 + 24) % 24; break;
    case ']': env.timeOfDay = (env.timeOfDay + 0.25) % 24; break;
    case 'c': w.cloud = Math.min(1, w.cloud + 0.1); break;
    case 'C': w.cloud = Math.max(0, w.cloud - 0.1); break;
    case 'r': w.rain = Math.min(1, w.rain + 0.1); w.wetness = Math.min(1, w.wetness + 0.15); break;
    case 'R': w.rain = Math.max(0, w.rain - 0.1); w.wetness = Math.max(0, w.wetness - 0.15); break;
    case 'f': w.fog = Math.min(1, w.fog + 0.1); break;
    case 'F': w.fog = Math.max(0, w.fog - 0.1); break;
    case 'o': w.cloud = 0.95; w.rain = 0.6; w.wetness = 0.8; w.fog = 0.2; break;
    case 'd': w.cloud = 0.2; w.rain = 0; w.wetness = 0; w.fog = 0; break;
    case 'm': menu = !menu; render.setMenuMode(menu); testGroup.visible = !menu; carGroup.visible = menu || showcase; break;
    case 's': showcase = !showcase; carGroup.visible = menu || showcase; break;
    case 'u': lookUp = !lookUp; break;
    case 'q':
      qualityIndex = (qualityIndex + 1) % QUALITY_LEVELS.length;
      render.setQuality(QUALITY_LEVELS[qualityIndex] as QualityLevel);
      break;
    case ' ': orbit = !orbit; break;
    case 'p': paused = !paused; break;
    case 'h': hudVisible = !hudVisible; hud.style.display = hudVisible ? 'block' : 'none'; break;
    case 'v': radius = 40; pitch = 0.5; break;
  }
});

window.addEventListener('resize', () => {
  render.resize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
render.resize(window.innerWidth, window.innerHeight);

const target = new THREE.Vector3(0, 0.6, 0);
const speedTarget = new THREE.Vector3();
let last = performance.now();
let simTime = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) simTime += dt;
  if (orbit && !paused) yaw += dt * (menu ? 0.12 : 0.25);
  if (menu) {
    camera.position.set(Math.sin(yaw) * 7, 1.2, Math.cos(yaw) * 7);
    camera.lookAt(0, 0.55, 0);
  } else {
    // In session mode: fly along the road to exercise motion blur, then orbit.
    const fly = !orbit;
    if (fly) {
      const z = ((simTime * 60) % 500) - 250;
      camera.position.set(3.5, 2.2, z);
      speedTarget.set(0, 1.0, z + 40);
      camera.lookAt(speedTarget);
    } else if (lookUp) {
      camera.position.set(0, 1.6, 0);
      speedTarget.set(Math.sin(yaw) * 10, 7, Math.cos(yaw) * 10);
      camera.lookAt(speedTarget);
    } else {
      const cp = Math.cos(pitch);
      camera.position.set(target.x + Math.sin(yaw) * radius * cp, target.y + Math.sin(pitch) * radius + 0.4, target.z + Math.cos(yaw) * radius * cp);
      camera.lookAt(target);
    }
  }
  camera.updateMatrixWorld();
  render.update(menu ? null : world, camera, dt);
  render.render();
  const s = render.getStats();
  if ((now | 0) % 6 === 0) {
    const w = env.weather;
    hud.textContent =
      `fps ${s.fps.toFixed(0)}  ${s.frameMs.toFixed(1)} ms  draws ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(0)}k  quality ${s.quality}  dpr ${render.renderer.getPixelRatio().toFixed(2)}\n` +
      `time ${env.timeOfDay.toFixed(2)}h  cloud ${w.cloud.toFixed(1)}  rain ${w.rain.toFixed(1)}  wet ${w.wetness.toFixed(1)}  fog ${w.fog.toFixed(1)}  ${menu ? 'MENU' : 'SESSION'}\n` +
      `1-7 time presets  [ ] ±15min  c/C cloud  r/R rain  f/F fog  o overcast  d dry  m menu  s car  u look up  q quality  space orbit/fly  p pause  drag/wheel camera`;
  }
}
requestAnimationFrame(frame);
