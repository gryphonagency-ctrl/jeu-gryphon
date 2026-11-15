/**
 * AI dev harness: 20 cars on Kingsmere driven by AIDrivers through the kinematic stand-in in devSim.ts.
 * Open http://localhost:5200/src/ai/dev.html (?session=qualifying&laps=6&difficulty=1&cars=20)
 */
import { KINGSMERE } from '../core/circuits';
import { PHYSICS_DT } from '../core/constants';
import { formatLapTime, kmh } from '../core/math';
import { DRIVER_BY_ID, TEAM_BY_ID } from '../core/teams';
import { createHarness } from './devHarness';

const params = new URLSearchParams(location.search);
const difficulty = Number(params.get('difficulty') ?? 1);
const autoStart = params.get('autostart') !== '0';
const h = createHarness({
  sessionType: params.get('session') === 'qualifying' ? 'qualifying' : 'race',
  totalLaps: Number(params.get('laps') ?? 6),
  difficulty,
  nCars: Number(params.get('cars') ?? 20),
});
const { track, cars, env, world, sim, director, ai, lineStats, paceScale, buildMs, aiStats, stepSim } = h;

/* ───────────────────────────── sim loop ───────────────────────────── */

let timeScale = 4;
let paused = false;
let acc = 0;

/* ───────────────────────────── drawing ───────────────────────────── */

const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d') as CanvasRenderingContext2D;
let zoom = false;
let followId = 0;
const view = { ox: 0, oz: 0, scale: 1 };

const fitView = (): void => {
  const w = canvas.width;
  const h = canvas.height;
  if (zoom) {
    const c = cars[followId];
    view.scale = Math.min(w, h) / 260;
    view.ox = w / 2 - c.position.x * view.scale;
    view.oz = h / 2 - c.position.z * view.scale;
  } else {
    const b = track.bounds;
    const bw = b.max.x - b.min.x;
    const bh = b.max.z - b.min.z;
    view.scale = Math.min(w / bw, h / bh) * 0.95;
    view.ox = w / 2 - ((b.min.x + b.max.x) / 2) * view.scale;
    view.oz = h / 2 - ((b.min.z + b.max.z) / 2) * view.scale;
  }
};
const sx = (x: number): number => view.ox + x * view.scale;
const sz = (z: number): number => view.oz + z * view.scale;

const speedColor = (v: number): string => {
  const t = Math.min(1, Math.max(0, (v - 20) / 70));
  const h = 220 - 220 * t;
  return `hsl(${h} 90% 55%)`;
};

const drawTrack = (): void => {
  const samples = track.samples;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // asphalt
  g.strokeStyle = '#2c3138';
  for (let k = 0; k < samples.length; k += 3) {
    const a = samples[k];
    const b = samples[(k + 3) % samples.length];
    g.lineWidth = a.width * view.scale;
    g.beginPath();
    g.moveTo(sx(a.position.x), sz(a.position.z));
    g.lineTo(sx(b.position.x), sz(b.position.z));
    g.stroke();
  }
  // edges
  g.lineWidth = 1;
  g.strokeStyle = '#8a8f96';
  for (const side of [1, -1]) {
    g.beginPath();
    for (let k = 0; k <= samples.length; k += 2) {
      const a = samples[k % samples.length];
      const x = a.position.x + a.left.x * (a.width / 2) * side;
      const z = a.position.z + a.left.z * (a.width / 2) * side;
      if (k === 0) g.moveTo(sx(x), sz(z));
      else g.lineTo(sx(x), sz(z));
    }
    g.stroke();
  }
  // pit lane + boxes
  g.strokeStyle = '#56606a';
  g.lineWidth = Math.max(1, track.pitLane.width * view.scale * 0.6);
  g.beginPath();
  for (let d = 0; d <= track.pitLane.length; d += 4) {
    const p = track.pitLaneSample(track.wrapS(track.pitLane.entryS + d)).position;
    if (d === 0) g.moveTo(sx(p.x), sz(p.z));
    else g.lineTo(sx(p.x), sz(p.z));
  }
  g.stroke();
  g.fillStyle = '#e0c040';
  for (let i = 0; i < 10; i++) {
    const p = track.pitBox(i).position;
    const r = Math.max(1.5, 1.2 * view.scale);
    g.fillRect(sx(p.x) - r, sz(p.z) - r, 2 * r, 2 * r);
  }
  // racing line
  const line = world.racingLine;
  if (line) {
    g.lineWidth = Math.max(1, 0.8 * view.scale);
    for (let i = 0; i < line.length; i += 2) {
      const a = line[i];
      const b = line[(i + 2) % line.length];
      const pa = track.trackToWorld(a.s, a.lateral);
      const pb = track.trackToWorld(b.s, b.lateral);
      g.strokeStyle = a.braking ? '#ff3060' : speedColor(a.speed);
      g.beginPath();
      g.moveTo(sx(pa.x), sz(pa.z));
      g.lineTo(sx(pb.x), sz(pb.z));
      g.stroke();
    }
  }
  // S/F line
  const sf = samples[0];
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(sx(sf.position.x + sf.left.x * 8), sz(sf.position.z + sf.left.z * 8));
  g.lineTo(sx(sf.position.x - sf.left.x * 8), sz(sf.position.z - sf.left.z * 8));
  g.stroke();
};

const drawCars = (): void => {
  for (const c of cars) {
    const team = TEAM_BY_ID[c.teamId];
    const yaw = Math.atan2(2 * (c.quaternion.w * c.quaternion.y), 1 - 2 * c.quaternion.y * c.quaternion.y);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const lx = fz;
    const lz = -fx;
    const hl = 2.8;
    const hwid = 1.0;
    const px = c.position.x;
    const pz = c.position.z;
    g.beginPath();
    g.moveTo(sx(px + fx * hl + lx * hwid), sz(pz + fz * hl + lz * hwid));
    g.lineTo(sx(px + fx * hl - lx * hwid), sz(pz + fz * hl - lz * hwid));
    g.lineTo(sx(px - fx * hl - lx * hwid), sz(pz - fz * hl - lz * hwid));
    g.lineTo(sx(px - fx * hl + lx * hwid), sz(pz - fz * hl + lz * hwid));
    g.closePath();
    g.fillStyle = team ? team.primaryColor : '#888';
    g.fill();
    g.strokeStyle = c.isPlayer ? '#fff' : c.input.brake > 0.3 ? '#f44' : '#000';
    g.lineWidth = zoom ? 2 : 1;
    g.stroke();
    if (zoom) {
      g.fillStyle = '#fff';
      g.font = '11px ui-monospace';
      g.fillText(DRIVER_BY_ID[c.driverId]?.code ?? String(c.id), sx(px) + 8, sz(pz) - 6);
    }
  }
};

const drawHud = (): void => {
  const race = world.race;
  const line = world.racingLine ?? [];
  let vMin = Infinity;
  let vMax = 0;
  for (const p of line) {
    if (p.speed < vMin) vMin = p.speed;
    if (p.speed > vMax) vMax = p.speed;
  }
  const best = Math.min(...sim.cars.map((c) => c.bestLap));
  const lines = [
    `phase ${race.phase}  t=${race.time.toFixed(1)}s  x${timeScale}${paused ? ' PAUSED' : ''}  wet ${env.weather.wetness.toFixed(2)}`,
    `AI: ${aiStats.avg.toFixed(3)} ms/step avg (${cars.length} cars), max ${aiStats.max.toFixed(2)} ms   line build ${buildMs.toFixed(0)} ms`,
    `profile: ideal lap ${formatLapTime(lineStats.idealLap)}  ref ${formatLapTime(KINGSMERE.referenceLapTime)}  paceScale ${paceScale.toFixed(3)}  min ${kmh(vMin).toFixed(0)} km/h  max ${kmh(vMax).toFixed(0)} km/h`,
    `best lap ${isFinite(best) ? formatLapTime(best) : '--'}  contacts ${sim.contacts}  overtakes ${director.overtakes}  pit stops ${director.pitStops} (max box err ${director.maxBoxError.toFixed(2)} m, speeding ${director.speedingEvents})  blue events ${director.blueFlagEvents}`,
  ];
  (document.getElementById('stats') as HTMLElement).textContent = lines.join('\n');

  const rows = ['<tr><th>P</th><th>drv</th><th>lap</th><th>last</th><th>best</th><th>gap</th><th>tyre</th><th>km/h</th><th>st</th></tr>'];
  for (const e of race.entries) {
    const c = cars[e.carId];
    const sc = sim.cars[e.carId];
    const code = DRIVER_BY_ID[e.driverId]?.code ?? e.driverId;
    const st = e.status === 'finished' ? '<span class="fin">FIN</span>' : e.pitPhase !== 'none' ? `<span class="pit">${e.pitPhase}</span>` : e.blueFlag ? '<span class="blue">BLUE</span>' : c.drs.open ? 'DRS' : '';
    rows.push(
      `<tr><td>${e.position}</td><td>${code}${c.isPlayer ? '*' : ''}</td><td>${e.lap}</td><td>${formatLapTime(e.lastLap)}</td><td>${formatLapTime(isFinite(sc.bestLap) ? sc.bestLap : 0)}</td><td>${e.position === 1 ? '' : '+' + e.gapToLeader.toFixed(1)}</td><td>${c.tyres.compound[0].toUpperCase()} ${(c.tyres.wear * 100).toFixed(0)}%</td><td>${kmh(c.speed).toFixed(0)}</td><td>${st}</td></tr>`,
    );
  }
  (document.getElementById('tower') as HTMLElement).innerHTML = rows.join('');
};

let last = performance.now();
let hudTimer = 0;
const frame = (now: number): void => {
  requestAnimationFrame(frame);
  const rawDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += rawDt * timeScale;
    let n = 0;
    while (acc >= PHYSICS_DT && n < 40 * timeScale) {
      stepSim(PHYSICS_DT);
      acc -= PHYSICS_DT;
      n++;
    }
    if (n >= 40 * timeScale) acc = 0;
  }
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height)) {
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);
  }
  fitView();
  g.fillStyle = '#1a3a1a';
  g.fillRect(0, 0, canvas.width, canvas.height);
  drawTrack();
  drawCars();
  hudTimer += rawDt;
  if (hudTimer > 0.25) {
    hudTimer = 0;
    drawHud();
  }
};

/* ───────────────────────────── controls ───────────────────────────── */

const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
byId('start').addEventListener('click', () => director.startProcedure());
byId('pause').addEventListener('click', () => (paused = !paused));
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-speed]'))) b.addEventListener('click', () => (timeScale = Number(b.dataset.speed)));
byId('pit3').addEventListener('click', () => {
  const e = world.race.entryByCar[Math.min(3, cars.length - 1)];
  if (e.pitPhase === 'none') e.pitPhase = 'requested';
});
byId('pit0').addEventListener('click', () => {
  const e = world.race.entryByCar[0];
  if (e.pitPhase === 'none') e.pitPhase = 'requested';
});
byId('rain').addEventListener('click', () => {
  const wet = env.weather.wetness > 0.3 ? 0 : 0.6;
  env.weather.wetness = wet;
  env.weather.rain = wet;
});
byId('zoom').addEventListener('click', () => (zoom = !zoom));
(byId('follow') as HTMLInputElement).addEventListener('input', (ev) => (followId = Math.min(cars.length - 1, Math.max(0, Number((ev.target as HTMLInputElement).value)))));
const diffInput = byId('diff') as HTMLInputElement;
diffInput.value = String(difficulty);
byId('diffv').textContent = difficulty.toFixed(2);
diffInput.addEventListener('input', () => {
  ai.setDifficulty(Number(diffInput.value));
  byId('diffv').textContent = Number(diffInput.value).toFixed(2);
});

// Expose for scripted checks from the console / browser tools.
Object.assign(window as unknown as Record<string, unknown>, { world, sim, director, ai, lineStats, track, stepSim, setSpeed: (s: number) => (timeScale = s) });

if (autoStart && world.race.sessionType === 'race') setTimeout(() => director.startProcedure(), 500);
requestAnimationFrame(frame);
