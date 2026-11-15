/**
 * Headless (Node) runner for the scripted tests, the 20-car benchmark and a per-step allocation probe.
 *   npx vite build --ssr src/physics/headless.ts --outDir /tmp/physics-headless
 *   cd /tmp/physics-headless && ln -sfn <F1>/node_modules node_modules && node --expose-gc headless.js
 */
import { PHYSICS_DT } from '../core/constants';
import { KINGSMERE } from '../core/circuits';
import { AI_ASSISTS, followerInput, makeSession } from './bench';
import { runTests } from './tests';

runTests((s) => console.log(s));

// Allocation probe: heap growth across 1200 steps of 20 cars after a GC (inputs are prepared outside the timed region).
const g = globalThis as { gc?: () => void; process?: { memoryUsage: () => { heapUsed: number } } };
if (g.gc && g.process) {
  const { physics, world, cars, inputs } = makeSession(KINGSMERE, 20, AI_ASSISTS);
  for (let i = 0; i < 20; i++) physics.resetCar(i, world.track.wrapS(-40 - i * 120));
  for (let k = 0; k < 600; k++) {
    for (let i = 0; i < 20; i++) physics.setInput(i, followerInput(cars[i], world.track, 50, 0, inputs[i]));
    physics.step(world, PHYSICS_DT);
  }
  for (const n of [1200, 6000, 24000]) {
    g.gc();
    const before = g.process.memoryUsage().heapUsed;
    for (let k = 0; k < n; k++) physics.step(world, PHYSICS_DT);
    const after = g.process.memoryUsage().heapUsed;
    console.log(`ALLOC probe: heap delta over ${n} steps × 20 cars = ${((after - before) / 1024).toFixed(0)} kB (${(((after - before) / n) | 0)} B/step)`);
  }
}
