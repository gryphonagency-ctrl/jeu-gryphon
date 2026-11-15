/**
 * Short-lived synthesised events. Each call creates a handful of nodes that release themselves when done.
 * Noise comes from the pooled buffers in AudioCore.
 */
import type { UISound } from '../core/types';
import { AudioCore, clampSafe } from './core';

type NoiseKind = 'white' | 'pink' | 'brown';

export class OneShots {
  private readonly core: AudioCore;
  /** Called when a UI sound fires, so music can duck. */
  onUiSound: (() => void) | null = null;

  constructor(core: AudioCore) {
    this.core = core;
  }

  private get engineBus(): AudioNode {
    return this.core.buses.engine;
  }
  private get sfxBus(): AudioNode {
    return this.core.buses.sfx;
  }
  private get uiBus(): AudioNode {
    return this.core.buses.ui;
  }

  /* ───────────── primitives ───────────── */

  /** Filtered noise burst with an optional filter sweep and gain envelope. */
  noiseBurst(
    dest: AudioNode,
    kind: NoiseKind,
    filterType: BiquadFilterType,
    fStart: number,
    fEnd: number,
    q: number,
    peak: number,
    attack: number,
    duration: number,
    startAt = this.core.now,
    rate = 1,
  ): void {
    const c = this.core;
    if (!c.running) return;
    const src = c.noise(kind, true, rate);
    const f = c.filter(filterType, fStart, q);
    const g = c.gain(0);
    src.connect(f).connect(g).connect(dest);
    const t = startAt;
    const a = Math.max(0.002, attack);
    const d = Math.max(a + 0.01, duration);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(clampSafe(peak, 0, 4), t + a);
    g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    if (fEnd !== fStart) {
      f.frequency.setValueAtTime(clampSafe(fStart, 10, c.maxFreq, 1000), t);
      f.frequency.exponentialRampToValueAtTime(clampSafe(fEnd, 10, c.maxFreq, 1000), t + d);
    }
    src.start(t, Math.random() * 2);
    src.stop(t + d + 0.02);
    c.autoRelease(src, [src, f, g]);
  }

  /** Oscillator with a frequency glide and a percussive envelope. */
  tone(
    dest: AudioNode,
    type: OscillatorType,
    fStart: number,
    fEnd: number,
    peak: number,
    attack: number,
    duration: number,
    startAt = this.core.now,
    detune = 0,
  ): void {
    const c = this.core;
    if (!c.running) return;
    const o = c.osc(type, fStart, detune);
    const g = c.gain(0);
    o.connect(g).connect(dest);
    const t = startAt;
    const a = Math.max(0.002, attack);
    const d = Math.max(a + 0.01, duration);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(clampSafe(peak, 0, 4), t + a);
    g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    if (fEnd !== fStart) {
      o.frequency.setValueAtTime(clampSafe(fStart, 5, c.maxFreq, 440), t);
      o.frequency.exponentialRampToValueAtTime(clampSafe(fEnd, 5, c.maxFreq, 440), t + d);
    }
    o.start(t);
    o.stop(t + d + 0.02);
    c.autoRelease(o, [o, g]);
  }

  /** Two-operator FM 'ping'. */
  fmPing(dest: AudioNode, carrier: number, ratio: number, index: number, peak: number, duration: number, startAt = this.core.now): void {
    const c = this.core;
    if (!c.running) return;
    const car = c.osc('sine', carrier);
    const mod = c.osc('sine', carrier * ratio);
    const modGain = c.gain(0);
    const g = c.gain(0);
    mod.connect(modGain).connect(car.frequency);
    car.connect(g).connect(dest);
    const t = startAt;
    const d = Math.max(0.03, duration);
    modGain.gain.setValueAtTime(clampSafe(carrier * index, 0, 20000), t);
    modGain.gain.exponentialRampToValueAtTime(1, t + d);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(clampSafe(peak, 0, 4), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + d);
    car.start(t);
    mod.start(t);
    car.stop(t + d + 0.02);
    mod.stop(t + d + 0.02);
    c.autoRelease(car, [car, mod, modGain, g]);
  }

  /** Short chord stab through a closing low-pass (synth 'hit'). */
  stab(dest: AudioNode, freqs: readonly number[], peak: number, duration: number, startAt = this.core.now, type: OscillatorType = 'sawtooth'): void {
    const c = this.core;
    if (!c.running) return;
    const t = startAt;
    const lp = c.filter('lowpass', 6000, 1.2);
    const g = c.gain(0);
    lp.connect(g).connect(dest);
    const nodes: AudioNode[] = [lp, g];
    let first: OscillatorNode | null = null;
    for (let i = 0; i < freqs.length; i++) {
      const o = c.osc(type, freqs[i], (i % 2 === 0 ? -1 : 1) * 6);
      o.connect(lp);
      o.start(t);
      o.stop(t + duration + 0.05);
      nodes.push(o);
      if (!first) first = o;
    }
    lp.frequency.setValueAtTime(6000, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + duration);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(clampSafe(peak / Math.max(1, freqs.length * 0.6), 0, 2), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + duration);
    if (first) c.autoRelease(first, nodes);
  }

  /* ───────────── car events ───────────── */

  gearShift(up: boolean, intensity: number): void {
    const t = this.core.now;
    const k = clampSafe(intensity, 0, 1.5, 0.7);
    if (up) {
      this.noiseBurst(this.engineBus, 'white', 'highpass', 1800, 1200, 0.7, 0.55 * k, 0.003, 0.07, t);
      this.tone(this.engineBus, 'sine', 140, 55, 0.35 * k, 0.003, 0.09, t);
    } else {
      this.noiseBurst(this.engineBus, 'white', 'bandpass', 900, 500, 1.5, 0.3 * k, 0.003, 0.06, t);
      this.tone(this.engineBus, 'sine', 110, 60, 0.28 * k, 0.003, 0.08, t);
    }
  }

  wastegate(intensity: number): void {
    const t = this.core.now;
    const k = clampSafe(intensity, 0, 1.2, 0.6);
    this.noiseBurst(this.engineBus, 'white', 'bandpass', 4200, 1100, 6, 0.4 * k, 0.01, 0.28, t);
    // Flutter: a second, lower chirp a touch later.
    this.noiseBurst(this.engineBus, 'white', 'bandpass', 2600, 700, 5, 0.22 * k, 0.01, 0.2, t + 0.09);
  }

  drs(open: boolean): void {
    const t = this.core.now;
    this.tone(this.sfxBus, 'sine', open ? 210 : 160, open ? 95 : 70, 0.4, 0.002, 0.07, t);
    this.noiseBurst(this.sfxBus, 'white', 'highpass', 2500, 2500, 0.7, 0.25, 0.002, 0.03, t);
    this.noiseBurst(this.sfxBus, 'pink', 'bandpass', 700, 400, 2, 0.18, 0.002, 0.06, t + 0.02);
  }

  /** Returns the normalised severity 0..1. `scale` attenuates distant (non-player) impacts. */
  collision(impulse: number, scale = 1): number {
    const t = this.core.now;
    const k = 1 - Math.exp(-clampSafe(impulse, 0, 1e6) / 3500); // 0..1
    const s = clampSafe(scale, 0, 1, 1);
    if (s < 0.02) return k;
    const big = k > 0.55;
    // Low thud
    this.tone(this.sfxBus, 'sine', 90, 34, (0.55 + 0.5 * k) * s, 0.003, 0.22 + 0.2 * k, t);
    // Metallic crunch
    this.noiseBurst(this.sfxBus, 'white', 'bandpass', 2400, 900, 2.6, (0.55 + 0.6 * k) * s, 0.003, 0.14 + 0.2 * k, t);
    this.tone(this.sfxBus, 'triangle', 1750, 1400, (0.16 + 0.2 * k) * s, 0.002, 0.18, t, 9);
    this.tone(this.sfxBus, 'square', 2950, 2600, (0.08 + 0.12 * k) * s, 0.002, 0.13, t + 0.01);
    // Debris rattle: gated noise for ~0.4 s.
    this.debris((0.3 + 0.7 * k) * s, 0.35 + 0.35 * k, t + 0.04);
    if (big) this.tone(this.sfxBus, 'sine', 48, 28, 0.9 * s, 0.004, 0.65, t);
    return k;
  }

  engineFailure(): void {
    const t = this.core.now;
    this.tone(this.engineBus, 'sine', 120, 30, 0.8, 0.003, 0.5, t);
    this.noiseBurst(this.engineBus, 'white', 'lowpass', 3000, 400, 0.8, 0.7, 0.003, 0.4, t);
    this.noiseBurst(this.engineBus, 'pink', 'bandpass', 900, 500, 1.2, 0.35, 0.3, 2.4, t + 0.2);
  }

  private debris(level: number, duration: number, startAt: number): void {
    const c = this.core;
    if (!c.running) return;
    const src = c.noise('white');
    const f = c.filter('highpass', 3200, 0.8);
    const g = c.gain(0);
    src.connect(f).connect(g).connect(c.buses.sfx);
    let t = startAt;
    const end = startAt + duration;
    g.gain.setValueAtTime(0, t);
    while (t < end) {
      const fade = 1 - (t - startAt) / duration;
      g.gain.setValueAtTime(level * fade * (0.2 + 0.8 * Math.random()), t);
      g.gain.setTargetAtTime(0, t + 0.003, 0.008);
      t += 0.02 + Math.random() * 0.05;
    }
    src.start(startAt, Math.random() * 2);
    src.stop(end + 0.05);
    c.autoRelease(src, [src, f, g]);
  }

  suspensionThump(intensity: number): void {
    const k = clampSafe(intensity, 0, 1, 0.5);
    this.tone(this.sfxBus, 'sine', 75 + 30 * k, 42, 0.22 + 0.3 * k, 0.002, 0.11, this.core.now);
  }

  dustPuff(): void {
    this.noiseBurst(this.sfxBus, 'pink', 'lowpass', 1200, 500, 0.7, 0.28, 0.03, 0.35, this.core.now);
  }

  resetWhoosh(): void {
    const t = this.core.now;
    this.noiseBurst(this.sfxBus, 'pink', 'bandpass', 300, 2800, 1.5, 0.35, 0.25, 0.6, t);
    this.noiseBurst(this.sfxBus, 'pink', 'bandpass', 2800, 350, 1.5, 0.3, 0.05, 0.4, t + 0.55);
  }

  /* ───────────── race events ───────────── */

  lightOn(index: number): void {
    const t = this.core.now;
    const k = clampSafe(index, 1, 5, 1);
    this.tone(this.sfxBus, 'square', 880, 880, 0.14, 0.004, 0.13, t);
    this.tone(this.sfxBus, 'sine', 880, 880, 0.22, 0.004, 0.14, t);
    this.fmPing(this.sfxBus, 1760, 2, 0.4, 0.05 + 0.01 * k, 0.08, t);
  }

  lightsOut(): void {
    const t = this.core.now;
    this.tone(this.sfxBus, 'square', 1320, 1320, 0.14, 0.004, 0.5, t);
    this.tone(this.sfxBus, 'sine', 1320, 1320, 0.28, 0.004, 0.55, t);
    this.tone(this.sfxBus, 'sine', 2640, 2640, 0.06, 0.004, 0.3, t);
  }

  fanfare(): void {
    const t = this.core.now;
    // Two quick stabs and a held major chord (E major → A major).
    this.stab(this.sfxBus, [164.8, 207.7, 246.9, 329.6], 0.6, 0.22, t);
    this.stab(this.sfxBus, [164.8, 207.7, 246.9, 329.6], 0.6, 0.22, t + 0.26);
    this.stab(this.sfxBus, [220, 277.2, 329.6, 440, 554.4], 0.8, 1.4, t + 0.52);
    this.fmPing(this.sfxBus, 1760, 3, 0.8, 0.12, 0.7, t + 0.52);
  }

  /* ───────────── radio ───────────── */

  squelch(on: boolean): void {
    const t = this.core.now;
    const bus = this.core.buses.radio;
    if (on) {
      this.noiseBurst(bus, 'white', 'bandpass', 1500, 2200, 1.5, 0.35, 0.004, 0.09, t);
      this.tone(bus, 'sine', 1900, 1500, 0.18, 0.002, 0.045, t);
    } else {
      this.noiseBurst(bus, 'white', 'bandpass', 2200, 1200, 1.5, 0.3, 0.004, 0.07, t);
      this.tone(bus, 'sine', 1400, 1000, 0.16, 0.002, 0.04, t + 0.02);
    }
  }

  /* ───────────── UI ───────────── */

  ui(sound: UISound): void {
    const c = this.core;
    if (!c.running) return;
    this.onUiSound?.();
    const t = c.now;
    const bus = this.uiBus;
    switch (sound) {
      case 'nav':
        this.fmPing(bus, 1900, 1.5, 0.3, 0.22, 0.05, t);
        this.noiseBurst(bus, 'white', 'highpass', 5000, 5000, 0.7, 0.07, 0.002, 0.018, t);
        break;
      case 'confirm':
        this.fmPing(bus, 880, 2, 0.5, 0.3, 0.14, t);
        this.fmPing(bus, 1320, 2, 0.5, 0.3, 0.2, t + 0.09);
        break;
      case 'back':
        this.fmPing(bus, 1100, 2, 0.4, 0.28, 0.12, t);
        this.fmPing(bus, 700, 2, 0.4, 0.26, 0.18, t + 0.08);
        break;
      case 'error':
        this.tone(bus, 'square', 185, 170, 0.16, 0.004, 0.2, t);
        this.tone(bus, 'square', 196, 180, 0.12, 0.004, 0.2, t, 8);
        this.tone(bus, 'square', 150, 140, 0.12, 0.004, 0.22, t + 0.16);
        break;
      case 'notify':
        this.fmPing(bus, 1568, 1.01, 0.15, 0.24, 0.45, t);
        this.tone(bus, 'sine', 3136, 3136, 0.06, 0.004, 0.3, t);
        break;
      case 'purple':
        this.fmPing(bus, 1319, 2, 0.3, 0.2, 0.09, t);
        this.fmPing(bus, 1760, 2, 0.3, 0.2, 0.09, t + 0.06);
        this.fmPing(bus, 2637, 2, 0.3, 0.22, 0.32, t + 0.12);
        break;
      case 'penalty':
        this.tone(bus, 'square', 440, 430, 0.18, 0.004, 0.22, t);
        this.tone(bus, 'square', 330, 320, 0.2, 0.004, 0.36, t + 0.22);
        this.noiseBurst(bus, 'pink', 'lowpass', 600, 300, 0.7, 0.2, 0.005, 0.15, t);
        break;
      case 'finish':
        this.stab(bus, [220, 277.2, 329.6, 440], 0.6, 0.9, t);
        this.fmPing(bus, 1760, 3, 0.8, 0.12, 0.6, t);
        break;
      case 'lights':
        this.tone(bus, 'square', 880, 880, 0.12, 0.004, 0.13, t);
        this.tone(bus, 'sine', 880, 880, 0.22, 0.004, 0.14, t);
        break;
      case 'lights-out':
        this.tone(bus, 'square', 1320, 1320, 0.12, 0.004, 0.5, t);
        this.tone(bus, 'sine', 1320, 1320, 0.26, 0.004, 0.55, t);
        break;
      case 'start':
        this.noiseBurst(bus, 'pink', 'bandpass', 250, 3200, 1.2, 0.45, 0.35, 0.7, t);
        this.tone(bus, 'sine', 120, 38, 0.7, 0.004, 0.5, t + 0.6);
        this.noiseBurst(bus, 'white', 'lowpass', 4000, 300, 0.7, 0.4, 0.004, 0.35, t + 0.6);
        this.fmPing(bus, 660, 2, 0.6, 0.25, 0.5, t + 0.62);
        break;
      default:
        this.fmPing(bus, 1200, 2, 0.3, 0.2, 0.08, t);
    }
  }
}
