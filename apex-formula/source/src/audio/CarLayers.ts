/**
 * Continuous player-car layers driven from CarState every frame: tyre squeal/scrub (front/rear), lock-up howl,
 * kerb rumble, gravel/grass, wind, brake squeal, bottoming scrape, wet spray, pit-limiter beeps, suspension thumps.
 */
import type { CameraMode, CarState } from '../core/types';
import { CAR } from '../core/constants';
import { AudioCore, approach, clampSafe } from './core';
import { OneShots } from './OneShots';

const SUSPENSION_THUMP_RATE = 0.9; // m/s of travel change that triggers a thump

export class CarLayers {
  private readonly core: AudioCore;
  private readonly oneShots: OneShots;

  private readonly white: AudioBufferSourceNode;
  private readonly pink: AudioBufferSourceNode;
  private readonly brown: AudioBufferSourceNode;

  private readonly tyreF: BiquadFilterNode;
  private readonly tyreFGain: GainNode;
  private readonly tyreR: BiquadFilterNode;
  private readonly tyreRGain: GainNode;

  private readonly kerbOsc: OscillatorNode;
  private readonly kerbLpf: BiquadFilterNode;
  private readonly kerbGain: GainNode;

  private readonly gravelBpf: BiquadFilterNode;
  private readonly gravelGain: GainNode;
  private readonly tickHpf: BiquadFilterNode;
  private readonly tickGain: GainNode;
  private readonly grassLpf: BiquadFilterNode;
  private readonly grassGain: GainNode;
  private readonly thumpLpf: BiquadFilterNode;
  private readonly thumpGain: GainNode;

  private readonly windLpf: BiquadFilterNode;
  private readonly windGain: GainNode;

  private readonly brakeBpf: BiquadFilterNode;
  private readonly brakeGain: GainNode;

  private readonly bottomHpf: BiquadFilterNode;
  private readonly bottomGain: GainNode;
  private readonly sparkleBpf: BiquadFilterNode;
  private readonly sparkleGain: GainNode;

  private readonly sprayLpf: BiquadFilterNode;
  private readonly sprayGain: GainNode;

  private readonly limiterOsc: OscillatorNode;
  private readonly limiterGain: GainNode;

  private readonly out: GainNode;
  private readonly nodes: AudioNode[];

  private cameraMode: CameraMode = 'chase';
  private distanceGain = 1;
  private wetness = 0;
  private limiterTimer = 0;
  private limiterActive = false;
  private readonly prevTravel = new Float32Array(4);
  private thumpCooldown = 0;
  private slipF = 0;
  private slipR = 0;
  private alive = true;

  constructor(core: AudioCore, oneShots: OneShots, dest: AudioNode) {
    this.core = core;
    this.oneShots = oneShots;
    const c = core;

    this.white = c.noise('white');
    this.pink = c.noise('pink');
    this.brown = c.noise('brown');

    this.tyreF = c.filter('bandpass', 900, 4);
    this.tyreFGain = c.gain(0);
    this.tyreR = c.filter('bandpass', 800, 4);
    this.tyreRGain = c.gain(0);

    this.kerbOsc = c.osc('sawtooth', 40);
    this.kerbLpf = c.filter('lowpass', 380, 1.5);
    this.kerbGain = c.gain(0);

    this.gravelBpf = c.filter('bandpass', 2400, 0.8);
    this.gravelGain = c.gain(0);
    this.tickHpf = c.filter('highpass', 4200, 0.7);
    this.tickGain = c.gain(0);
    this.grassLpf = c.filter('lowpass', 1300, 0.7);
    this.grassGain = c.gain(0);
    this.thumpLpf = c.filter('lowpass', 220, 1);
    this.thumpGain = c.gain(0);

    this.windLpf = c.filter('lowpass', 400, 0.5);
    this.windGain = c.gain(0);

    this.brakeBpf = c.filter('bandpass', 3600, 14);
    this.brakeGain = c.gain(0);

    this.bottomHpf = c.filter('highpass', 3000, 0.8);
    this.bottomGain = c.gain(0);
    this.sparkleBpf = c.filter('bandpass', 6800, 9);
    this.sparkleGain = c.gain(0);

    this.sprayLpf = c.filter('lowpass', 4500, 0.6);
    this.sprayGain = c.gain(0);

    this.limiterOsc = c.osc('sine', 1250);
    this.limiterGain = c.gain(0);

    this.out = c.gain(0);
    this.out.connect(dest);

    this.white.connect(this.tyreF).connect(this.tyreFGain).connect(this.out);
    this.white.connect(this.tyreR).connect(this.tyreRGain).connect(this.out);
    this.kerbOsc.connect(this.kerbLpf).connect(this.kerbGain).connect(this.out);
    this.white.connect(this.gravelBpf).connect(this.gravelGain).connect(this.out);
    this.white.connect(this.tickHpf).connect(this.tickGain).connect(this.out);
    this.pink.connect(this.grassLpf).connect(this.grassGain).connect(this.out);
    this.brown.connect(this.thumpLpf).connect(this.thumpGain).connect(this.out);
    this.pink.connect(this.windLpf).connect(this.windGain).connect(this.out);
    this.white.connect(this.brakeBpf).connect(this.brakeGain).connect(this.out);
    this.white.connect(this.bottomHpf).connect(this.bottomGain).connect(this.out);
    this.white.connect(this.sparkleBpf).connect(this.sparkleGain).connect(this.out);
    this.white.connect(this.sprayLpf).connect(this.sprayGain).connect(this.out);
    this.limiterOsc.connect(this.limiterGain).connect(this.out);

    const t = c.now;
    this.white.start(t, Math.random() * 2);
    this.pink.start(t, Math.random() * 2);
    this.brown.start(t, Math.random() * 2);
    this.kerbOsc.start(t);
    this.limiterOsc.start(t);

    this.nodes = [
      this.white,
      this.pink,
      this.brown,
      this.tyreF,
      this.tyreFGain,
      this.tyreR,
      this.tyreRGain,
      this.kerbOsc,
      this.kerbLpf,
      this.kerbGain,
      this.gravelBpf,
      this.gravelGain,
      this.tickHpf,
      this.tickGain,
      this.grassLpf,
      this.grassGain,
      this.thumpLpf,
      this.thumpGain,
      this.windLpf,
      this.windGain,
      this.brakeBpf,
      this.brakeGain,
      this.bottomHpf,
      this.bottomGain,
      this.sparkleBpf,
      this.sparkleGain,
      this.sprayLpf,
      this.sprayGain,
      this.limiterOsc,
      this.limiterGain,
      this.out,
    ];
    c.gainTo(this.out.gain, 1, 0.15);
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
  }

  setWetness(w: number): void {
    this.wetness = clampSafe(w, 0, 1);
  }

  /** Distance attenuation for detached cameras (1 for attached cameras). */
  setDistanceGain(g: number): void {
    this.distanceGain = clampSafe(g, 0, 1, 1);
  }

  update(car: CarState, dt: number): void {
    if (!this.alive) return;
    const c = this.core;
    const speed = clampSafe(car.speedAbs, 0, 150);
    const spdN = speed / 95;
    const cockpit = this.cameraMode === 'cockpit';
    const heli = this.cameraMode === 'helicopter';
    const distanceAtten = this.distanceGain * (heli ? 0.6 : this.cameraMode === 'chase-far' ? 0.8 : 1);
    const wheels = car.wheels;

    // ── Tyres: front/rear groups. slip 1 ≈ peak grip; squeal beyond ~0.7 of the way to sliding.
    let sf = 0;
    let sr = 0;
    let loadF = 0;
    let loadR = 0;
    let lockedF = false;
    let lockedR = false;
    let gravelWheels = 0;
    let grassWheels = 0;
    let anyLocked = false;
    let maxSpin = 0;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const slip = w.contact ? clampSafe(w.slip, 0, 3) : 0;
      const load = w.contact ? clampSafe(w.load, 0, 30000) : 0;
      const spin = Math.abs(clampSafe(w.spinRate, -600, 600)) * CAR.wheelRadius;
      if (spin > maxSpin) maxSpin = spin;
      if (i < 2) {
        if (slip > sf) sf = slip;
        loadF += load;
        if (w.locked) lockedF = true;
      } else {
        if (slip > sr) sr = slip;
        loadR += load;
        if (w.locked) lockedR = true;
      }
      if (w.locked) anyLocked = true;
      if (w.contact) {
        if (w.surface === 'gravel') gravelWheels++;
        else if (w.surface === 'grass' || w.surface === 'runoff') grassWheels++;
      }
    }
    this.slipF = approach(this.slipF, sf, 0.06, dt);
    this.slipR = approach(this.slipR, sr, 0.06, dt);
    const moving = clampSafe((speed - 2.5) / 8, 0, 1);
    // Wheelspin at a standstill (race start) must still squeal: use wheel surface speed for the rear group.
    const spinning = clampSafe((Math.max(speed, maxSpin) - 2.5) / 8, 0, 1);
    const onAsphaltish = gravelWheels + grassWheels < 3;
    const tyreScale = (onAsphaltish ? 1 : 0.3) * distanceAtten * (1 - 0.6 * this.wetness);
    this.tyreGroup(this.tyreF, this.tyreFGain, this.slipF, loadF, lockedF, moving * tyreScale, speed);
    this.tyreGroup(this.tyreR, this.tyreRGain, this.slipR, loadR, lockedR, spinning * tyreScale, Math.max(speed, maxSpin));

    // ── Kerb rumble: pulse-train rate follows speed (kerb ribs ~0.35 m apart).
    const kerb = clampSafe(car.chassis.kerbRumble, 0, 1);
    c.freqTo(this.kerbOsc.frequency, 18 + speed * 2.6, 0.03);
    c.gainTo(this.kerbGain.gain, kerb * (0.35 + 0.45 * clampSafe(spdN, 0, 1)) * (cockpit ? 1.25 : 0.9) * distanceAtten, 0.03);

    // ── Surfaces
    const gravel = (gravelWheels / 4) * moving;
    const grass = (grassWheels / 4) * moving;
    c.gainTo(this.gravelGain.gain, gravel * (0.35 + 0.5 * clampSafe(spdN, 0, 1)) * distanceAtten, 0.05);
    c.freqTo(this.gravelBpf.frequency, 1600 + 1800 * clampSafe(spdN, 0, 1), 0.05);
    c.gainTo(this.grassGain.gain, grass * (0.25 + 0.45 * clampSafe(spdN, 0, 1)) * distanceAtten, 0.05);
    if (gravel > 0.05 && Math.random() < gravel * 40 * dt) this.kick(this.tickGain.gain, 0.15 + 0.35 * Math.random() * gravel, 0.006);
    if (grass > 0.05 && Math.random() < grass * 9 * dt) this.kick(this.thumpGain.gain, 0.3 + 0.4 * Math.random(), 0.03);

    // ── Wind: ∝ speed², louder & darker in cockpit.
    const wind = spdN * spdN;
    c.freqTo(this.windLpf.frequency, 250 + 2600 * clampSafe(wind, 0, 1.6) * (cockpit ? 0.7 : 1), 0.08);
    c.gainTo(this.windGain.gain, clampSafe(wind, 0, 1.6) * (cockpit ? 0.7 : 0.32) * (heli ? 0.15 : 1), 0.08);

    // ── Brake squeal: faint high whistle ∝ brake × speed (not when locked — the tyre howl takes over).
    const brake = clampSafe(car.engine.brake, 0, 1);
    const squeal = brake > 0.25 && speed > 8 && !anyLocked ? (brake - 0.25) * clampSafe(spdN, 0, 1) : 0;
    c.freqTo(this.brakeBpf.frequency, 3200 + 900 * brake, 0.05);
    c.gainTo(this.brakeGain.gain, squeal * 0.09 * distanceAtten, 0.05);

    // ── Bottoming: metallic scrape + sparkle.
    const bottoming = clampSafe(car.chassis.bottoming, 0, 1) * moving;
    c.gainTo(this.bottomGain.gain, bottoming * 0.35 * distanceAtten, 0.03);
    c.gainTo(this.sparkleGain.gain, bottoming * 0.22 * distanceAtten, 0.03);
    c.freqTo(this.sparkleBpf.frequency, 5500 + 2500 * Math.random(), 0.04);

    // ── Wet spray hiss ∝ speed × wetness.
    c.gainTo(this.sprayGain.gain, this.wetness * clampSafe(spdN, 0, 1.3) * 0.28 * (cockpit ? 0.6 : 1) * distanceAtten, 0.08);
    c.freqTo(this.sprayLpf.frequency, 2500 + 4000 * clampSafe(spdN, 0, 1), 0.08);

    // ── Pit limiter beep pattern: two short beeps every second while engaged.
    const lim = !!car.input.pitLimiter && car.engine.rpm > 300;
    if (lim !== this.limiterActive) {
      this.limiterActive = lim;
      this.limiterTimer = 0;
      if (!lim) c.gainTo(this.limiterGain.gain, 0, 0.01);
    }
    if (lim) {
      const prev = this.limiterTimer;
      this.limiterTimer += dt;
      let wrapped = false;
      if (this.limiterTimer >= 1.0) {
        this.limiterTimer -= 1.0;
        wrapped = true;
      }
      if (prev === 0 || wrapped || (prev < 0.16 && this.limiterTimer >= 0.16)) this.beep();
    }

    // ── Suspension thumps on big travel changes.
    this.thumpCooldown -= dt;
    if (dt > 0.0005) {
      let biggest = 0;
      for (let i = 0; i < 4; i++) {
        const tr = clampSafe(wheels[i].suspensionTravel, -0.2, 0.2);
        const rate = Math.abs(tr - this.prevTravel[i]) / dt;
        this.prevTravel[i] = tr;
        if (rate > biggest) biggest = rate;
      }
      if (biggest > SUSPENSION_THUMP_RATE && this.thumpCooldown <= 0 && !car.chassis.held) {
        this.thumpCooldown = 0.09;
        this.oneShots.suspensionThump(clampSafe((biggest - SUSPENSION_THUMP_RATE) / 2.5, 0, 1) * distanceAtten);
      }
    }
  }

  private tyreGroup(filter: BiquadFilterNode, gain: GainNode, slip: number, load: number, locked: boolean, scale: number, speed: number): void {
    const c = this.core;
    const loadN = clampSafe(load / 9000, 0, 1.5);
    const excess = clampSafe(slip - 0.7, 0, 1.6);
    // Scrub (moderate slip, low & broad) → squeal (high slip, higher & narrow).
    const squealMix = clampSafe((slip - 0.95) / 0.5, 0, 1);
    let freq = 480 + 900 * squealMix + 250 * clampSafe(speed / 60, 0, 1);
    let q = 2.2 + 7 * squealMix;
    let level = excess * (0.45 + 0.55 * loadN) * 0.55;
    if (locked) {
      freq *= 1.55;
      q = 12;
      level = Math.max(level, 0.5 * (0.5 + 0.5 * loadN));
    }
    c.freqTo(filter.frequency, freq, 0.04);
    c.qTo(filter.Q, q, 0.05);
    c.gainTo(gain.gain, clampSafe(level * scale, 0, 1.2), 0.04);
  }

  private kick(param: AudioParam, level: number, decay: number): void {
    const t = this.core.now;
    param.cancelScheduledValues(t);
    param.setValueAtTime(clampSafe(level, 0, 2), t);
    param.setTargetAtTime(0, t + 0.002, decay);
  }

  private beep(): void {
    const g = this.limiterGain.gain;
    const t = this.core.now;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(0.16, t + 0.005);
    g.setValueAtTime(0.16, t + 0.055);
    g.linearRampToValueAtTime(0, t + 0.07);
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    const c = this.core;
    c.gainTo(this.out.gain, 0, 0.03);
    const nodes = this.nodes;
    setTimeout(() => {
      for (let i = 0; i < nodes.length; i++) c.release(nodes[i]);
    }, 160);
  }
}
