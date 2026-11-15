/**
 * Scripted physics verification: straight-line, braking, cornering, surfaces, walls, services and a benchmark.
 * Shared by the browser harness (dev.ts) and the headless runner (headless.ts).
 */
import * as THREE from 'three';
import { CAR, PHYSICS_DT, TYRE_DATA } from '../core/constants';
import { events } from '../core/events';
import type { CarState, ErsMode } from '../core/types';
import { carYaw, createDefaultInput } from '../core/world';
import { AI_ASSISTS, NO_ASSISTS, TEST_OVAL, followerInput, makeSession, runBench } from './bench';

let offtrackEvents = 0;
events.on('car:offtrack', () => offtrackEvents++);

const warm = (car: CarState): void => car.wheels.forEach((w) => (w.temp = TYRE_DATA[car.tyres.compound].optimalTemp));

const _leftVec = new THREE.Vector3();
const leftOf = (car: CarState): THREE.Vector3 => {
  const yaw = carYaw(car);
  return _leftVec.set(Math.cos(yaw), 0, -Math.sin(yaw));
};

export function runTests(log: (s: string) => void): void {
  log('=== TESTS ===');
  const t = makeSession(TEST_OVAL, 1, NO_ASSISTS);
  const { physics, world, cars, inputs } = t;
  const car = cars[0];
  const inp = inputs[0];
  const step = (): void => {
    physics.setInput(0, inp);
    physics.step(world, PHYSICS_DT);
  };
  const stepN = (n: number): void => {
    for (let k = 0; k < n; k++) step();
  };
  const reset = (s: number, a = NO_ASSISTS): void => {
    physics.setAssists(0, a);
    physics.serviceCar(0, { compound: 'soft', repair: true });
    physics.resetCar(0, world.track.wrapS(s));
    warm(car);
    car.ers.battery = 1;
    Object.assign(inp, createDefaultInput());
    stepN(60);
  };
  /** Start of the 2.6 km straight (s = 0 is 300 m into it). */
  const STRAIGHT = -280;
  /** Steer along the centreline (a driver would), full throttle. */
  const flatOut = (drs = false, ers: ErsMode = 'balanced'): void => {
    followerInput(car, world.track, 400, 0, inp, 99);
    inp.throttle = 1;
    inp.brake = 0;
    inp.drs = drs;
    inp.ersMode = ers;
    if (drs) car.drs.available = true;
    step();
  };

  // 1. acceleration & top speed (DRS closed)
  for (const tc of ['off', 'medium'] as const) {
    reset(400, { ...NO_ASSISTS, tractionControl: tc });
    let t100 = -1;
    let t200 = -1;
    let t300 = -1;
    let vmax = 0;
    let wheelspin = false;
    let gearAt100 = 0;
    for (let k = 0; k < 120 * 45; k++) {
      flatOut();
      const kmh = car.speed * 3.6;
      const tt = k / 120;
      if (t100 < 0 && kmh >= 100) {
        t100 = tt;
        gearAt100 = car.engine.gear;
      }
      if (t200 < 0 && kmh >= 200) t200 = tt;
      if (t300 < 0 && kmh >= 300) t300 = tt;
      if (car.wheels[2].spinning) wheelspin = true;
      vmax = Math.max(vmax, kmh);
      if (car.track.s > 2200) break;
    }
    log(`ACCEL (TC ${tc}, auto gears, warm softs): 0-100 ${t100.toFixed(2)} s (gear ${gearAt100}), 0-200 ${t200.toFixed(2)} s, 0-300 ${t300 < 0 ? 'n/a' : t300.toFixed(2) + ' s'}, vmax DRS closed ${vmax.toFixed(0)} km/h (ERS ${(car.ers.battery * 100).toFixed(0)}%) wheelspin ${wheelspin}`);
  }

  // 1b. top speed with DRS open + ERS
  const TC_ON = { ...NO_ASSISTS, tractionControl: 'medium' as const };
  reset(STRAIGHT, TC_ON);
  let vmaxDrs = 0;
  for (let k = 0; k < 120 * 45; k++) {
    flatOut(true, 'overtake');
    vmaxDrs = Math.max(vmaxDrs, car.speed * 3.6);
    if (car.track.s > 2250 && car.track.s < 3000) break;
  }
  log(`TOP SPEED DRS open + overtake ERS: ${vmaxDrs.toFixed(0)} km/h (drs open ${car.drs.open}, battery ${(car.ers.battery * 100).toFixed(0)}%)`);
  // 1c. closed, ERS balanced from full battery
  reset(STRAIGHT, TC_ON);
  let vmaxBal = 0;
  for (let k = 0; k < 120 * 45; k++) {
    flatOut();
    vmaxBal = Math.max(vmaxBal, car.speed * 3.6);
    if (car.track.s > 2250 && car.track.s < 3000) break;
  }
  log(`TOP SPEED DRS closed + balanced ERS: ${vmaxBal.toFixed(0)} km/h (battery ${(car.ers.battery * 100).toFixed(0)}%)`);

  // 2. braking from 300 km/h
  for (const abs of [true, false]) {
    reset(STRAIGHT, { ...NO_ASSISTS, tractionControl: 'medium', abs });
    let ok = false;
    for (let k = 0; k < 120 * 40; k++) {
      flatOut(true, 'overtake');
      if (car.speed * 3.6 >= 300) {
        ok = true;
        break;
      }
      if (car.track.s > 2200 && car.track.s < 3000) break;
    }
    if (!ok) {
      log('BRAKING: could not reach 300 km/h');
      continue;
    }
    inp.throttle = 0;
    inp.brake = 1;
    inp.drs = false;
    const s0 = car.track.s;
    let peakG = 0;
    let locked = false;
    let time = 0;
    while (car.speed > 0.5 && time < 10) {
      step();
      time += PHYSICS_DT;
      peakG = Math.max(peakG, -car.localAccel.z / 9.81);
      if (car.wheels.some((w) => w.locked)) locked = true;
    }
    log(`BRAKING 300→0 (ABS ${abs}): ${(car.track.s - s0).toFixed(0)} m in ${time.toFixed(2)} s, peak ${peakG.toFixed(1)} g, lockup ${locked}, final lateral ${car.track.lateral.toFixed(2)}`);
  }

  // 3. steady-state cornering through the 200 m radius turn at several speeds
  for (const cap of [24, 45, 62, 75, 85]) {
    reset(1500, AI_ASSISTS);
    let maxSlip = 0;
    let maxLatG = 0;
    let spun = false;
    let minSpeed = 999;
    for (let k = 0; k < 120 * 90; k++) {
      followerInput(car, world.track, cap, 0, inp, 4.5);
      step();
      if (car.track.s > 2350 && car.track.s < 3100) {
        const beta = Math.abs(Math.atan2(car.velocity.dot(leftOf(car)), Math.max(1, car.speed)));
        maxSlip = Math.max(maxSlip, beta);
        maxLatG = Math.max(maxLatG, Math.abs(car.localAccel.x) / 9.81);
        minSpeed = Math.min(minSpeed, car.speed);
        if (beta > 0.2 || car.speed < cap * 0.7) spun = true;
      }
      if (car.track.s > 3200 && car.track.s < 4000) break;
    }
    log(`CORNER R=200 cap ${cap} m/s (${(cap * cap / 200 / 9.81).toFixed(1)} g req): lat ${maxLatG.toFixed(2)} g, min speed ${(minSpeed * 3.6).toFixed(0)} km/h, max sideslip ${(maxSlip * 57.3).toFixed(1)}°, ${spun ? 'LOST IT' : 'ok'}`);
  }

  // 4. lift-off in the corner
  {
    reset(1500, AI_ASSISTS);
    for (let k = 0; k < 120 * 60; k++) {
      followerInput(car, world.track, 68, 0, inp, 4.5);
      step();
      if (car.track.s > 2550) break;
    }
    const yaw0 = car.angularVelocity.y;
    const steer0 = inp.steer;
    inp.throttle = 0;
    inp.brake = 0;
    inp.steer = steer0;
    let maxYaw = 0;
    let beta = 0;
    for (let k = 0; k < 120; k++) {
      step();
      maxYaw = Math.max(maxYaw, Math.abs(car.angularVelocity.y));
      beta = Math.max(beta, Math.abs(Math.atan2(car.velocity.dot(leftOf(car)), Math.max(1, car.speed))));
    }
    log(`LIFT-OFF at ${(68 * 3.6).toFixed(0)} km/h mid-corner, steering frozen 1 s: yaw ${yaw0.toFixed(2)} → max ${maxYaw.toFixed(2)} rad/s, sideslip ${(beta * 57.3).toFixed(1)}°`);
  }

  // 5. grass / gravel deceleration
  {
    reset(300);
    for (let k = 0; k < 120 * 20; k++) {
      flatOut();
      if (car.speed * 3.6 >= 200) break;
    }
    inp.throttle = 0;
    const v0 = car.speed;
    // Shallow excursion: ease left onto the run-off, straighten, then coast.
    inp.steer = 0.08;
    stepN(90);
    inp.steer = -0.08;
    stepN(90);
    inp.steer = 0;
    const v1 = car.speed;
    const surf1 = car.track.surface;
    stepN(360);
    log(`OFF-TRACK: lifted at ${(v0 * 3.6).toFixed(0)} km/h, left the track at ${(v1 * 3.6).toFixed(0)} km/h (${surf1}); 3 s later ${(car.speed * 3.6).toFixed(0)} km/h, lateral ${car.track.lateral.toFixed(1)}, surface ${car.track.surface}, wheelsOff ${car.track.wheelsOff}, yaw rate ${car.angularVelocity.y.toFixed(2)}, offtrack events ${offtrackEvents}`);
  }

  // 6. walls on the back straight (barriers 9 m out): a glancing hit and a hard hit
  for (const hard of [false, true]) {
    reset(3600, TC_ON);
    for (let k = 0; k < 120 * 20; k++) {
      flatOut();
      if (car.speed * 3.6 >= 150) break;
    }
    const v0 = car.speed;
    inp.throttle = hard ? 1 : 0.3;
    inp.steer = hard ? 0.5 : 0.06;
    let maxLat = 0;
    let impulse = 0;
    let nan = false;
    let hits = 0;
    let vAtHit = 0;
    for (let k = 0; k < 120 * 4; k++) {
      if (car.track.lateral > 5) inp.steer = 0;
      step();
      maxLat = Math.max(maxLat, car.track.lateral);
      if (car.collision.active) {
        hits++;
        if (car.collision.impulse > impulse) {
          impulse = car.collision.impulse;
          vAtHit = car.speedAbs;
        }
      }
      if (!isFinite(car.position.x) || !isFinite(car.velocity.x) || !isFinite(car.quaternion.w)) nan = true;
    }
    const corr = world.track.corridorAt(car.track.s, car.track.lateral);
    log(`WALL ${hard ? 'hard' : 'glancing'} from ${(v0 * 3.6).toFixed(0)} km/h: max lateral ${maxLat.toFixed(2)} (barrier ${corr.maxLateral.toFixed(2)}), contact steps ${hits}, peak impulse ${impulse.toFixed(0)} N·s (Δv ${(impulse / (car.fuel + CAR.dryMass)).toFixed(1)} m/s at ${(vAtHit * 3.6).toFixed(0)} km/h), after 4 s ${(car.speed * 3.6).toFixed(0)} km/h lateral ${car.track.lateral.toFixed(2)} yaw rate ${car.angularVelocity.y.toFixed(2)}, damage fw ${car.damage.frontWing.toFixed(2)} susp ${car.damage.suspension.map((d) => d.toFixed(2)).join('/')} total ${car.damage.total.toFixed(2)}, NaN ${nan}`);
  }

  // 7. held car revs
  {
    reset(300);
    physics.holdCar(0, true);
    inp.throttle = 1;
    const p0 = car.position.clone();
    stepN(120);
    log(`HELD: rpm ${car.engine.rpm.toFixed(0)} limiter ${car.engine.limiter}, moved ${p0.distanceTo(car.position).toFixed(3)} m, speed ${car.speed.toFixed(2)}`);
    physics.holdCar(0, false);
    stepN(120);
    log(`RELEASED after 1 s full throttle: ${(car.speed * 3.6).toFixed(0)} km/h`);
  }

  // 8. reverse
  {
    reset(300);
    inp.brake = 1;
    stepN(130);
    inp.brake = 0;
    inp.throttle = 0.4;
    stepN(240);
    log(`REVERSE: gear ${car.engine.gear}, speed ${(car.speed * 3.6).toFixed(1)} km/h`);
  }

  // 9. tyre thermal equilibrium: 2 laps of the oval flat out
  {
    reset(300, AI_ASSISTS);
    car.wheels.forEach((w) => (w.temp = 70));
    const start = car.track.lap;
    let steps = 0;
    while (car.track.lap < start + 2 && steps < 120 * 400) {
      followerInput(car, world.track, 90, 0, inp, 4.2);
      step();
      steps++;
    }
    log(`TYRES after ${(steps / 120).toFixed(0)} s hard driving from 70°C: temps ${car.wheels.map((w) => w.temp.toFixed(0)).join('/')} wear ${(car.tyres.wear * 100).toFixed(1)}% grip ${car.tyres.gripFactor.toFixed(2)} fuel ${car.fuel.toFixed(1)} battery ${(car.ers.battery * 100).toFixed(0)}%`);
  }

  // 10. benchmark
  const r = runBench(2400, 20);
  log(`BENCH 20 cars × ${r.steps} steps: ${r.msPerStep.toFixed(3)} ms/step  speeds ${r.minKmh.toFixed(0)}–${r.maxKmh.toFixed(0)} km/h  collision-steps ${r.collisions}`);
  log('=== DONE ===');
}
