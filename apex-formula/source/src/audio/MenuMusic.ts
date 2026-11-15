/**
 * Procedural menu music: a driving cinematic-electronic loop at 116 BPM built from persistent voices whose
 * envelopes are scheduled ahead of time on the AudioContext clock (look-ahead scheduler). No nodes are created per note.
 */
import { AudioCore, clampSafe } from './core';

const BPM = 116;
const STEP = 60 / BPM / 4; // sixteenth
const STEPS = 64; // 4 bars
const LOOKAHEAD = 0.2;
const TICK_MS = 30;

// Chord tones (Hz). Am then Fmaj: two-chord pad, 2 bars each.
const CHORDS: readonly (readonly number[])[] = [
  [110.0, 130.81, 164.81], // A2 C3 E3
  [87.31, 110.0, 130.81], // F2 A2 C3
];
// Bass rhythm (per bar): 1 = root, 2 = octave, 0 = rest.
const BASS_PATTERN = [1, 0, 1, 0, 1, 0, 1, 2, 1, 0, 1, 0, 1, 2, 0, 1];
// Arp degree index into 6-note chord (two octaves), per 8th-note; -1 = rest.
const ARP_PATTERN = [0, 2, 4, 5, 4, 2, 3, 1, 0, 2, 4, 5, 3, 4, 2, 1];

export class MenuMusic {
  private readonly core: AudioCore;

  private readonly kick: OscillatorNode;
  private readonly kickGain: GainNode;
  private readonly hatNoise: AudioBufferSourceNode;
  private readonly hatHpf: BiquadFilterNode;
  private readonly hatGain: GainNode;
  private readonly snareBpf: BiquadFilterNode;
  private readonly snareGain: GainNode;
  private readonly bass: OscillatorNode;
  private readonly bassSub: OscillatorNode;
  private readonly bassLpf: BiquadFilterNode;
  private readonly bassGain: GainNode;
  private readonly padOscs: OscillatorNode[] = [];
  private readonly padLpf: BiquadFilterNode;
  private readonly padLfo: OscillatorNode;
  private readonly padLfoDepth: GainNode;
  private readonly padGain: GainNode;
  private readonly lead: OscillatorNode;
  private readonly leadGain: GainNode;
  private readonly delay: DelayNode;
  private readonly delayFb: GainNode;
  private readonly delayLpf: BiquadFilterNode;
  private readonly delayMix: GainNode;
  private readonly reverb: ConvolverNode;
  private readonly reverbGain: GainNode;
  private readonly duck: GainNode;
  private readonly out: GainNode;
  private readonly nodes: AudioNode[];

  private timer: ReturnType<typeof setInterval> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private nextTime = 0;
  private step = 0;
  private alive = true;

  constructor(core: AudioCore) {
    this.core = core;
    const c = core;

    this.out = c.gain(0);
    this.duck = c.gain(1);
    this.duck.connect(this.out).connect(c.buses.music);

    this.reverb = c.convolver();
    this.reverbGain = c.gain(0.32);
    this.reverb.connect(this.reverbGain).connect(this.duck);

    this.kick = c.osc('sine', 50);
    this.kickGain = c.gain(0);
    this.kick.connect(this.kickGain).connect(this.duck);

    this.hatNoise = c.noise('white');
    this.hatHpf = c.filter('highpass', 7800, 0.7);
    this.hatGain = c.gain(0);
    this.hatNoise.connect(this.hatHpf).connect(this.hatGain).connect(this.duck);
    this.snareBpf = c.filter('bandpass', 1900, 0.9);
    this.snareGain = c.gain(0);
    this.hatNoise.connect(this.snareBpf).connect(this.snareGain).connect(this.duck);
    this.snareGain.connect(this.reverb);

    this.bass = c.osc('sawtooth', 110);
    this.bassSub = c.osc('square', 55);
    this.bassLpf = c.filter('lowpass', 400, 6);
    this.bassGain = c.gain(0);
    this.bass.connect(this.bassLpf);
    this.bassSub.connect(this.bassLpf);
    this.bassLpf.connect(this.bassGain).connect(this.duck);

    this.padLpf = c.filter('lowpass', 900, 1.5);
    this.padGain = c.gain(0.12);
    this.padLfo = c.osc('sine', 0.11);
    this.padLfoDepth = c.gain(450);
    this.padLfo.connect(this.padLfoDepth).connect(this.padLpf.frequency);
    for (let i = 0; i < 6; i++) {
      const o = c.osc('sawtooth', CHORDS[0][i % 3] * 2, i % 2 === 0 ? -9 : 9);
      o.connect(this.padLpf);
      this.padOscs.push(o);
    }
    this.padLpf.connect(this.padGain).connect(this.duck);
    this.padGain.connect(this.reverb);

    this.lead = c.osc('triangle', 440);
    this.leadGain = c.gain(0);
    this.delay = c.delay(STEP * 3, 1.5);
    this.delayFb = c.gain(0.38);
    this.delayLpf = c.filter('lowpass', 3200, 0.7);
    this.delayMix = c.gain(0.5);
    this.lead.connect(this.leadGain);
    this.leadGain.connect(this.duck);
    this.leadGain.connect(this.delay);
    this.delay.connect(this.delayLpf).connect(this.delayFb).connect(this.delay);
    this.delayLpf.connect(this.delayMix).connect(this.duck);
    this.delayMix.connect(this.reverb);
    this.leadGain.connect(this.reverb);

    const t = c.now;
    this.kick.start(t);
    this.hatNoise.start(t, Math.random() * 2);
    this.bass.start(t);
    this.bassSub.start(t);
    this.padLfo.start(t);
    for (const o of this.padOscs) o.start(t);
    this.lead.start(t);

    this.nodes = [
      this.out,
      this.duck,
      this.reverb,
      this.reverbGain,
      this.kick,
      this.kickGain,
      this.hatNoise,
      this.hatHpf,
      this.hatGain,
      this.snareBpf,
      this.snareGain,
      this.bass,
      this.bassSub,
      this.bassLpf,
      this.bassGain,
      this.padLpf,
      this.padGain,
      this.padLfo,
      this.padLfoDepth,
      ...this.padOscs,
      this.lead,
      this.leadGain,
      this.delay,
      this.delayFb,
      this.delayLpf,
      this.delayMix,
    ];

    // Fade in and start the scheduler.
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(1, t + 2.0);
    this.nextTime = t + 0.12;
    this.step = 0;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Briefly duck the music (UI sounds). */
  duckNow(level = 0.55, seconds = 0.3): void {
    if (!this.alive) return;
    const t = this.core.now;
    const g = this.duck.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(clampSafe(level, 0, 1, 0.6), t + 0.03);
    g.linearRampToValueAtTime(1, t + 0.03 + Math.max(0.05, seconds));
  }

  private tick(): void {
    if (!this.alive) return;
    const now = this.core.now;
    // Guard against a suspended clock / tab switch: resync instead of scheduling a burst.
    if (this.nextTime < now - 0.5) this.nextTime = now + 0.05;
    while (this.nextTime < now + LOOKAHEAD) {
      this.schedule(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % STEPS;
    }
  }

  private schedule(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const s16 = step % 16;
    const chord = CHORDS[bar < 2 ? 0 : 1];

    // Pad chord change on bar boundaries (glide).
    if (s16 === 0 && (bar === 0 || bar === 2)) {
      for (let i = 0; i < 6; i++) {
        const f = chord[i % 3] * (i < 3 ? 2 : 4);
        this.padOscs[i].frequency.setTargetAtTime(clampSafe(f, 20, 5000, 220), t, 0.08);
      }
    }

    // Kick: four on the floor + a ghost before bar ends on bars 2/4.
    if (s16 % 4 === 0 || (s16 === 14 && bar % 2 === 1)) {
      const strong = s16 % 4 === 0;
      this.kick.frequency.cancelScheduledValues(t);
      this.kick.frequency.setValueAtTime(170, t);
      this.kick.frequency.exponentialRampToValueAtTime(44, t + 0.1);
      const g = this.kickGain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(strong ? 0.95 : 0.5, t + 0.003);
      g.exponentialRampToValueAtTime(0.0005, t + 0.3);
    }

    // Hats: 8th offbeats closed, plus an open hat at the end of bars 2/4.
    if (s16 % 4 === 2 || (s16 === 15 && bar % 2 === 1) || (s16 % 2 === 1 && bar === 3)) {
      const open = s16 === 15;
      const g = this.hatGain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(open ? 0.2 : 0.14, t + 0.002);
      g.exponentialRampToValueAtTime(0.0005, t + (open ? 0.16 : 0.05));
    }

    // Clap/snare on 2 and 4 (subtle, reverbed).
    if (s16 === 4 || s16 === 12) {
      const g = this.snareGain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(0.22, t + 0.003);
      g.exponentialRampToValueAtTime(0.0005, t + 0.11);
    }

    // Bass pulses.
    const b = BASS_PATTERN[s16];
    if (b > 0) {
      const f = chord[0] * (b === 2 ? 2 : 1);
      this.bass.frequency.setValueAtTime(clampSafe(f, 20, 2000, 110), t);
      this.bassSub.frequency.setValueAtTime(clampSafe(f * 0.5, 10, 1000, 55), t);
      const lf = this.bassLpf.frequency;
      lf.cancelScheduledValues(t);
      lf.setValueAtTime(2400, t);
      lf.exponentialRampToValueAtTime(190, t + 0.2);
      const g = this.bassGain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(0.42, t + 0.006);
      g.setValueAtTime(0.42, t + STEP * 0.7);
      g.linearRampToValueAtTime(0, t + STEP * 0.95);
    }

    // Arpeggio lead on 8ths, skipping bar 0 on the first pass for a lift into bar 1.
    if (s16 % 2 === 0) {
      const deg = ARP_PATTERN[(s16 >> 1) + (bar % 2) * 8];
      if (deg >= 0 && !(bar === 0 && s16 < 8)) {
        const f = chord[deg % 3] * (deg < 3 ? 4 : 8);
        this.lead.frequency.setValueAtTime(clampSafe(f, 50, 8000, 880), t);
        const g = this.leadGain.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(0, t);
        g.linearRampToValueAtTime(0.16, t + 0.008);
        g.exponentialRampToValueAtTime(0.0005, t + STEP * 1.6);
      }
    }
  }

  /** Fade out over `seconds` and free the graph. */
  stop(seconds = 1.5): void {
    if (!this.alive) return;
    this.alive = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const c = this.core;
    const t = c.now;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + Math.max(0.05, seconds));
    const nodes = this.nodes;
    this.stopTimer = setTimeout(() => {
      for (let i = 0; i < nodes.length; i++) c.release(nodes[i]);
    }, (seconds + 0.15) * 1000);
  }

  get running(): boolean {
    return this.alive;
  }

  dispose(): void {
    if (this.alive) this.stop(0.05);
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
      for (const n of this.nodes) this.core.release(n);
    }
  }
}
