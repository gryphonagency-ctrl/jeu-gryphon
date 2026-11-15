/**
 * World bed: crowd murmur with swells/cheers/gasps, rain, wind gusts, helicopter whump.
 */
import type { CameraMode, World } from '../core/types';
import { AudioCore, approach, clampSafe } from './core';

export class Ambience {
  private readonly core: AudioCore;
  private readonly pink: AudioBufferSourceNode;
  private readonly white: AudioBufferSourceNode;
  private readonly brown: AudioBufferSourceNode;

  private readonly crowdBpf: BiquadFilterNode;
  private readonly crowdLpf: BiquadFilterNode;
  private readonly crowdGain: GainNode;
  private readonly crowdHi: BiquadFilterNode; // whistles / voices texture
  private readonly crowdHiGain: GainNode;
  private readonly swellLfo: OscillatorNode;
  private readonly swellDepth: GainNode;

  private readonly rainLpf: BiquadFilterNode;
  private readonly rainGain: GainNode;
  private readonly rainLow: BiquadFilterNode;
  private readonly rainLowGain: GainNode;

  private readonly gustLpf: BiquadFilterNode;
  private readonly gustGain: GainNode;

  private readonly heliBpf: BiquadFilterNode;
  private readonly heliAm: GainNode;
  private readonly heliLfo: OscillatorNode;
  private readonly heliDepth: GainNode;
  private readonly heliGain: GainNode;

  private readonly out: GainNode;
  private readonly nodes: AudioNode[];

  private cameraMode: CameraMode = 'chase';
  private cheer = 0; // 0..1 excitement envelope
  private cheerTarget = 0;
  private gasp = 0;
  private gustWalk = 0;
  private gustPhase = 0;
  private crowdWalk = 0;
  private alive = true;

  constructor(core: AudioCore, dest: AudioNode) {
    this.core = core;
    const c = core;
    this.pink = c.noise('pink');
    this.white = c.noise('white');
    this.brown = c.noise('brown');

    this.crowdBpf = c.filter('bandpass', 650, 0.6);
    this.crowdLpf = c.filter('lowpass', 2400, 0.5);
    this.crowdGain = c.gain(0);
    this.crowdHi = c.filter('bandpass', 1900, 3);
    this.crowdHiGain = c.gain(0);
    this.swellLfo = c.osc('sine', 0.09);
    this.swellDepth = c.gain(0);

    this.rainLpf = c.filter('lowpass', 3200, 0.5);
    this.rainGain = c.gain(0);
    this.rainLow = c.filter('lowpass', 180, 0.7);
    this.rainLowGain = c.gain(0);

    this.gustLpf = c.filter('lowpass', 450, 0.6);
    this.gustGain = c.gain(0);

    this.heliBpf = c.filter('bandpass', 130, 1.2);
    this.heliAm = c.gain(0.5);
    this.heliLfo = c.osc('square', 13.5);
    this.heliDepth = c.gain(0.5);
    this.heliGain = c.gain(0);

    this.out = c.gain(0);
    this.out.connect(dest);

    this.pink.connect(this.crowdBpf).connect(this.crowdLpf).connect(this.crowdGain).connect(this.out);
    this.pink.connect(this.crowdHi).connect(this.crowdHiGain).connect(this.out);
    this.swellLfo.connect(this.swellDepth).connect(this.crowdGain.gain);
    this.white.connect(this.rainLpf).connect(this.rainGain).connect(this.out);
    this.brown.connect(this.rainLow).connect(this.rainLowGain).connect(this.out);
    this.brown.connect(this.gustLpf).connect(this.gustGain).connect(this.out);
    this.brown.connect(this.heliBpf).connect(this.heliAm).connect(this.heliGain).connect(this.out);
    this.heliLfo.connect(this.heliDepth).connect(this.heliAm.gain);

    const t = c.now;
    this.pink.start(t, Math.random() * 2);
    this.white.start(t, Math.random() * 2);
    this.brown.start(t, Math.random() * 2);
    this.swellLfo.start(t);
    this.heliLfo.start(t);

    this.nodes = [
      this.pink,
      this.white,
      this.brown,
      this.crowdBpf,
      this.crowdLpf,
      this.crowdGain,
      this.crowdHi,
      this.crowdHiGain,
      this.swellLfo,
      this.swellDepth,
      this.rainLpf,
      this.rainGain,
      this.rainLow,
      this.rainLowGain,
      this.gustLpf,
      this.gustGain,
      this.heliBpf,
      this.heliAm,
      this.heliLfo,
      this.heliDepth,
      this.heliGain,
      this.out,
    ];
    c.gainTo(this.out.gain, 1, 0.4);
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
  }

  /** Crowd excitement swell (0..1). */
  cheerSwell(amount: number): void {
    this.cheerTarget = Math.max(this.cheerTarget, clampSafe(amount, 0, 1));
  }

  /** Crowd gasp: a quick rise with a falling pitch. */
  gaspSwell(amount: number): void {
    this.gasp = Math.max(this.gasp, clampSafe(amount, 0, 1));
  }

  update(world: World, dt: number): void {
    if (!this.alive) return;
    const c = this.core;
    const player = world.cars[world.playerCarId];
    const heli = this.cameraMode === 'helicopter';
    const cockpit = this.cameraMode === 'cockpit';

    // ── Crowd: base murmur louder near the start/finish straight & grandstands.
    let prox = 0.35;
    if (player && world.track) {
      const len = clampSafe(world.track.length, 100, 1e5, 4000);
      const s = clampSafe(player.track.s, 0, len);
      const dsf = Math.min(s, len - s);
      prox = 0.35 + 0.65 * (1 - clampSafe(dsf / 450, 0, 1));
    }
    this.crowdWalk = approach(this.crowdWalk, (Math.random() - 0.5) * 0.3, 1.8, dt);
    this.cheerTarget = approach(this.cheerTarget, 0, 1.4, dt);
    this.cheer = approach(this.cheer, this.cheerTarget, this.cheerTarget > this.cheer ? 0.35 : 2.2, dt);
    this.gasp = approach(this.gasp, 0, 0.9, dt);
    const camScale = heli ? 1.4 : cockpit ? 0.45 : 1;
    const base = 0.16 * prox * camScale;
    const level = (base + 0.42 * this.cheer + 0.3 * this.gasp) * (1 + this.crowdWalk);
    c.gainTo(this.crowdGain.gain, level, 0.12);
    c.gainTo(this.swellDepth.gain, base * 0.35, 0.2);
    c.freqTo(this.crowdBpf.frequency, 650 + 700 * this.cheer - 250 * this.gasp, 0.15);
    c.freqTo(this.crowdLpf.frequency, 2400 + 3200 * this.cheer, 0.15);
    c.gainTo(this.crowdHiGain.gain, (0.02 * prox + 0.16 * this.cheer + 0.1 * this.gasp) * camScale, 0.12);
    c.freqTo(this.crowdHi.frequency, 1900 + 600 * this.cheer - 500 * this.gasp, 0.2);

    // ── Rain
    const rain = clampSafe(world.env.weather.rain, 0, 1);
    c.gainTo(this.rainGain.gain, rain * (cockpit ? 0.18 : 0.34), 0.3);
    c.freqTo(this.rainLpf.frequency, 2200 + 3000 * rain, 0.3);
    c.gainTo(this.rainLowGain.gain, rain * rain * 0.3, 0.3);

    // ── Wind gusts
    const wind = clampSafe(world.env.weather.windSpeed, 0, 40) / 14;
    this.gustPhase += dt * (0.25 + 0.4 * Math.random());
    if (this.gustPhase > 1) {
      this.gustPhase = 0;
      this.gustWalk = Math.random();
    }
    const gust = wind * (0.35 + 0.65 * this.gustWalk);
    c.gainTo(this.gustGain.gain, clampSafe(gust, 0, 2) * 0.16 * (cockpit ? 0.4 : 1), 0.6);
    c.freqTo(this.gustLpf.frequency, 300 + 700 * clampSafe(gust, 0, 1.5), 0.6);

    // ── Helicopter
    c.gainTo(this.heliGain.gain, heli ? 0.32 : 0, 0.35);
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    const c = this.core;
    c.gainTo(this.out.gain, 0, 0.05);
    const nodes = this.nodes;
    setTimeout(() => {
      for (let i = 0; i < nodes.length; i++) c.release(nodes[i]);
    }, 200);
  }
}
