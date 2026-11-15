/**
 * The player's 1.6 L V6 turbo-hybrid. Layered oscillators + soft clip + rpm-tracking formants,
 * induction noise, turbo spool whistle, wastegate flutter, limiter stutter, shift crack, ERS whine,
 * overrun crackle, camera-dependent EQ. All continuous nodes are built once; per-frame work only sets params.
 */
import type { CameraMode, CarState } from '../core/types';
import { CAR } from '../core/constants';
import { AudioCore, approach, clampSafe } from './core';
import { OneShots } from './OneShots';

const RPM_MIN = CAR.idleRpm;
const RPM_MAX = CAR.maxRpm;
/** Base detune (cents) per oscillator: A, B, sub, H2, H3, H4.5. */
const OSC_DETUNE = [-6, 7, 0, 4, -3, 5];

interface CameraEq {
  lowpass: number;
  peakFreq: number;
  peakGainDb: number;
  peakQ: number;
  gain: number;
}

const CAMERA_EQ: Record<CameraMode, CameraEq> = {
  cockpit: { lowpass: 3400, peakFreq: 260, peakGainDb: 6, peakQ: 1.4, gain: 0.95 },
  nose: { lowpass: 14000, peakFreq: 1800, peakGainDb: 2, peakQ: 0.8, gain: 1.0 },
  tcam: { lowpass: 12000, peakFreq: 2400, peakGainDb: 2.5, peakQ: 0.9, gain: 1.0 },
  chase: { lowpass: 15000, peakFreq: 2600, peakGainDb: 3, peakQ: 0.8, gain: 1.0 },
  'chase-far': { lowpass: 9000, peakFreq: 2200, peakGainDb: 1.5, peakQ: 0.8, gain: 0.85 },
  tv: { lowpass: 8500, peakFreq: 2000, peakGainDb: 2, peakQ: 0.7, gain: 0.8 },
  helicopter: { lowpass: 2600, peakFreq: 400, peakGainDb: 0, peakQ: 0.7, gain: 0.55 },
};

export class PlayerEngine {
  private readonly core: AudioCore;
  private readonly oneShots: OneShots;

  // Oscillator bank
  private readonly oscA: OscillatorNode;
  private readonly oscB: OscillatorNode;
  private readonly oscSub: OscillatorNode;
  private readonly oscH2: OscillatorNode;
  private readonly oscH3: OscillatorNode;
  private readonly oscH45: OscillatorNode;
  private readonly gFund: GainNode;
  private readonly gSub: GainNode;
  private readonly gH2: GainNode;
  private readonly gH3: GainNode;
  private readonly gH45: GainNode;
  private readonly oscillators: OscillatorNode[];

  // Dynamics chain
  private readonly limiterGate: GainNode;
  private readonly limiterLfo: OscillatorNode;
  private readonly limiterDepth: GainNode;
  private readonly shiftGate: GainNode;
  private readonly burbleAm: GainNode;
  private readonly burbleLfo: OscillatorNode;
  private readonly burbleDepth: GainNode;
  private readonly drive: GainNode;
  private readonly clip: WaveShaperNode;

  // Formants
  private readonly formants: BiquadFilterNode[];
  private readonly formantGains: GainNode[];
  private readonly dryGain: GainNode;

  // Aux layers
  private readonly noise: AudioBufferSourceNode;
  private readonly intakeFilter: BiquadFilterNode;
  private readonly intakeGain: GainNode;
  private readonly turboOsc: OscillatorNode;
  private readonly turboOscGain: GainNode;
  private readonly turboNoiseFilter: BiquadFilterNode;
  private readonly turboNoiseGain: GainNode;
  private readonly ersOsc: OscillatorNode;
  private readonly ersGain: GainNode;
  private readonly crackleFilter: BiquadFilterNode;
  private readonly crackleGain: GainNode;

  // Output
  private readonly eqLow: BiquadFilterNode;
  private readonly eqPeak: BiquadFilterNode;
  private readonly comp: DynamicsCompressorNode;
  private readonly out: GainNode;

  private readonly allNodes: AudioNode[] = [];

  // State
  private spool = 0;
  private prevThrottle = 0;
  private wastegateCooldown = 0;
  private crackleEnergy = 0;
  private limiterOn = false;
  private cameraMode: CameraMode = 'chase';
  private cameraGain = 1;
  private distanceGain = 1;
  private dopplerRatio = 1;
  private alive = true;
  private smoothedRpm: number = RPM_MIN;

  constructor(core: AudioCore, oneShots: OneShots, destination: AudioNode) {
    this.core = core;
    this.oneShots = oneShots;
    const c = core;
    const f0 = (RPM_MIN / 60) * 3;

    this.oscA = c.osc('sawtooth', f0, OSC_DETUNE[0]);
    this.oscB = c.osc('sawtooth', f0, OSC_DETUNE[1]);
    this.oscSub = c.osc('sine', f0 * 0.5, OSC_DETUNE[2]);
    this.oscH2 = c.osc('square', f0 * 2, OSC_DETUNE[3]);
    this.oscH3 = c.osc('sawtooth', f0 * 3, OSC_DETUNE[4]);
    this.oscH45 = c.osc('sawtooth', f0 * 4.5, OSC_DETUNE[5]);
    this.gFund = c.gain(0);
    this.gSub = c.gain(0);
    this.gH2 = c.gain(0);
    this.gH3 = c.gain(0);
    this.gH45 = c.gain(0);
    this.oscillators = [this.oscA, this.oscB, this.oscSub, this.oscH2, this.oscH3, this.oscH45];

    this.limiterGate = c.gain(1);
    this.limiterLfo = c.osc('square', 15);
    this.limiterDepth = c.gain(0);
    this.shiftGate = c.gain(1);
    this.burbleAm = c.gain(1);
    this.burbleLfo = c.osc('sawtooth', 7);
    this.burbleDepth = c.gain(0);
    this.drive = c.gain(0.8);
    this.clip = c.shaper(c.softClip, '2x');

    this.formants = [c.filter('bandpass', 300, 2), c.filter('bandpass', 1200, 2), c.filter('bandpass', 3000, 2)];
    this.formantGains = [c.gain(0.5), c.gain(0.35), c.gain(0.15)];
    this.dryGain = c.gain(0.5);

    this.noise = c.noise('white');
    this.intakeFilter = c.filter('bandpass', 900, 1.2);
    this.intakeGain = c.gain(0);
    this.turboOsc = c.osc('sine', 3000);
    this.turboOscGain = c.gain(0);
    this.turboNoiseFilter = c.filter('bandpass', 3000, 28);
    this.turboNoiseGain = c.gain(0);
    this.ersOsc = c.osc('sine', 1500);
    this.ersGain = c.gain(0);
    this.crackleFilter = c.filter('bandpass', 1800, 2.5);
    this.crackleGain = c.gain(0);

    this.eqLow = c.filter('lowpass', 15000, 0.6);
    this.eqPeak = c.filter('peaking', 2600, 0.8, 3);
    this.comp = c.compressor(-14, 10, 4, 0.004, 0.12);
    this.out = c.gain(0);

    // Wiring
    this.oscA.connect(this.gFund);
    this.oscB.connect(this.gFund);
    this.oscSub.connect(this.gSub);
    this.oscH2.connect(this.gH2);
    this.oscH3.connect(this.gH3);
    this.oscH45.connect(this.gH45);
    for (const g of [this.gFund, this.gSub, this.gH2, this.gH3, this.gH45]) g.connect(this.limiterGate);

    this.limiterLfo.connect(this.limiterDepth).connect(this.limiterGate.gain);
    this.limiterGate.connect(this.shiftGate).connect(this.burbleAm).connect(this.drive).connect(this.clip);
    this.burbleLfo.connect(this.burbleDepth).connect(this.burbleAm.gain);

    // Everything sums into the camera EQ (eqLow) then compressor → out.
    const sum = this.eqLow;
    for (let i = 0; i < 3; i++) {
      this.clip.connect(this.formants[i]).connect(this.formantGains[i]).connect(sum);
    }
    this.clip.connect(this.dryGain).connect(sum);

    this.noise.connect(this.intakeFilter).connect(this.intakeGain).connect(sum);
    this.noise.connect(this.turboNoiseFilter).connect(this.turboNoiseGain).connect(sum);
    this.turboOsc.connect(this.turboOscGain).connect(sum);
    this.ersOsc.connect(this.ersGain).connect(sum);
    this.noise.connect(this.crackleFilter).connect(this.crackleGain).connect(sum);

    this.eqLow.connect(this.eqPeak).connect(this.comp).connect(this.out).connect(destination);

    this.allNodes.push(
      ...this.oscillators,
      this.gFund,
      this.gSub,
      this.gH2,
      this.gH3,
      this.gH45,
      this.limiterGate,
      this.limiterLfo,
      this.limiterDepth,
      this.shiftGate,
      this.burbleAm,
      this.burbleLfo,
      this.burbleDepth,
      this.drive,
      this.clip,
      ...this.formants,
      ...this.formantGains,
      this.dryGain,
      this.noise,
      this.intakeFilter,
      this.intakeGain,
      this.turboOsc,
      this.turboOscGain,
      this.turboNoiseFilter,
      this.turboNoiseGain,
      this.ersOsc,
      this.ersGain,
      this.crackleFilter,
      this.crackleGain,
      this.eqLow,
      this.eqPeak,
      this.comp,
      this.out,
    );

    const t = c.now;
    for (const o of this.oscillators) o.start(t);
    this.limiterLfo.start(t);
    this.burbleLfo.start(t);
    this.turboOsc.start(t);
    this.ersOsc.start(t);
    this.noise.start(t, Math.random() * 2);
    this.setCameraMode(this.cameraMode, true);
    c.gainTo(this.out.gain, 1, 0.15);
  }

  setCameraMode(mode: CameraMode, immediate = false): void {
    this.cameraMode = mode;
    const eq = CAMERA_EQ[mode] ?? CAMERA_EQ.chase;
    const tc = immediate ? 0.001 : 0.12;
    this.core.freqTo(this.eqLow.frequency, eq.lowpass, tc);
    this.core.freqTo(this.eqPeak.frequency, eq.peakFreq, tc);
    this.core.target(this.eqPeak.gain, eq.peakGainDb, tc, -24, 24);
    this.core.qTo(this.eqPeak.Q, eq.peakQ, tc);
    this.cameraGain = eq.gain;
  }

  /**
   * For detached cameras (TV / helicopter): distance attenuation 0..1 and a Doppler pitch ratio for the
   * player's own car passing the camera. Attached cameras should pass (1, 1).
   */
  setExternalPerspective(distanceGain: number, dopplerRatio: number): void {
    this.distanceGain = clampSafe(distanceGain, 0, 1, 1);
    this.dopplerRatio = clampSafe(dopplerRatio, 0.75, 1.25, 1);
  }

  /** Called on car:gear for the player. */
  onGearShift(up: boolean, rpm: number): void {
    if (!this.alive) return;
    const c = this.core;
    const t = c.now;
    // 30 ms pitch dip on every oscillator + a hard 25 ms gate cut = the "crack".
    for (let i = 0; i < this.oscillators.length; i++) {
      const d = this.oscillators[i].detune;
      const base = OSC_DETUNE[i];
      d.cancelScheduledValues(t);
      d.setValueAtTime(base, t);
      d.linearRampToValueAtTime(base + (up ? -260 : 180), t + 0.012);
      d.linearRampToValueAtTime(base, t + (up ? 0.05 : 0.09));
    }
    this.shiftGate.gain.cancelScheduledValues(t);
    this.shiftGate.gain.setValueAtTime(1, t);
    this.shiftGate.gain.linearRampToValueAtTime(up ? 0.12 : 0.45, t + 0.008);
    this.shiftGate.gain.linearRampToValueAtTime(1, t + (up ? 0.045 : 0.07));
    const n = clampSafe((rpm - RPM_MIN) / (RPM_MAX - RPM_MIN), 0, 1);
    this.oneShots.gearShift(up, 0.55 + 0.45 * n);
    if (!up) this.crackleEnergy = Math.max(this.crackleEnergy, 0.5 + 0.4 * n);
  }

  update(car: CarState, dt: number): void {
    if (!this.alive) return;
    const c = this.core;
    const e = car.engine;
    const health = clampSafe(e.health, 0, 1, 1);
    let rpm = clampSafe(e.rpm, 0, RPM_MAX * 1.1, RPM_MIN);
    const engineDead = rpm < 400 || health <= 0.001 || car.status === 'retired' || car.status === 'dnf';
    if (engineDead) rpm = 0;
    this.smoothedRpm = approach(this.smoothedRpm, rpm, 0.02, dt);
    const rpmForPitch = this.smoothedRpm < 300 ? 300 : this.smoothedRpm;
    const n = clampSafe((rpmForPitch - RPM_MIN) / (RPM_MAX - RPM_MIN), 0, 1);
    const th = clampSafe(e.throttle, 0, 1);
    const f0 = (rpmForPitch / 60) * 3 * this.dopplerRatio;

    // Pitch
    c.freqTo(this.oscA.frequency, f0, 0.012);
    c.freqTo(this.oscB.frequency, f0, 0.012);
    c.freqTo(this.oscSub.frequency, f0 * 0.5, 0.012);
    c.freqTo(this.oscH2.frequency, f0 * 2, 0.012);
    c.freqTo(this.oscH3.frequency, f0 * 3, 0.012);
    c.freqTo(this.oscH45.frequency, f0 * 4.5, 0.012);

    // Load-dependent harmonic balance
    const load = 0.3 + 0.7 * th;
    c.gainTo(this.gFund.gain, 0.5);
    c.gainTo(this.gSub.gain, 0.4 * Math.pow(1 - n, 1.6));
    c.gainTo(this.gH2.gain, 0.16 + 0.26 * th);
    c.gainTo(this.gH3.gain, 0.06 + 0.32 * th * (0.3 + 0.7 * n));
    c.gainTo(this.gH45.gain, 0.03 + 0.26 * th * n);
    c.gainTo(this.drive.gain, 0.7 + 1.7 * th * (0.5 + 0.5 * n), 0.04);
    // Post-clip make-up (louder drive → less make-up), folded into the formant/dry gains below.
    const post = 0.72 - 0.22 * th;

    // Off-throttle burble (slow uneven LFO on amplitude), fades with load and rpm.
    c.gainTo(this.burbleDepth.gain, 0.32 * (1 - th) * (1 - th) * (0.35 + 0.65 * (1 - n)), 0.06);
    c.freqTo(this.burbleLfo.frequency, 5.5 + 9 * n, 0.1);

    // Formants: track rpm; Q rises above ~10k rpm for the F1 scream.
    const scream = clampSafe((rpmForPitch - 9500) / (RPM_MAX - 9500), 0, 1);
    c.freqTo(this.formants[0].frequency, 300 * (1 + 0.6 * n), 0.03);
    c.freqTo(this.formants[1].frequency, 1200 * (1 + 0.5 * n), 0.03);
    c.freqTo(this.formants[2].frequency, 3000 * (1 + 0.45 * n), 0.03);
    const q = 1.8 + 6 * scream;
    for (let i = 0; i < 3; i++) c.qTo(this.formants[i].Q, q, 0.05);
    c.gainTo(this.formantGains[0].gain, 0.55 * load * post);
    c.gainTo(this.formantGains[1].gain, (0.3 + 0.25 * n) * post);
    c.gainTo(this.formantGains[2].gain, (0.12 + 0.5 * scream) * (0.5 + 0.5 * th) * post);
    c.gainTo(this.dryGain.gain, (0.5 - 0.15 * scream) * post);

    // Induction
    c.freqTo(this.intakeFilter.frequency, 700 + 1900 * n, 0.03);
    c.gainTo(this.intakeGain.gain, 0.38 * th * (0.25 + 0.75 * n), 0.04);

    // Turbo spool with lag
    const spoolTarget = n * (0.25 + 0.75 * th);
    this.spool = approach(this.spool, spoolTarget, spoolTarget > this.spool ? 0.32 : 0.55, dt);
    const tf = 3000 + 6000 * this.spool;
    c.freqTo(this.turboOsc.frequency, tf, 0.03);
    c.freqTo(this.turboNoiseFilter.frequency, tf * 1.02, 0.03);
    const sp2 = this.spool * this.spool;
    c.gainTo(this.turboOscGain.gain, 0.03 * sp2, 0.04);
    c.gainTo(this.turboNoiseGain.gain, 0.11 * sp2, 0.04);

    // Wastegate / blow-off on throttle lift at high rpm
    this.wastegateCooldown -= dt;
    if (this.prevThrottle > 0.6 && th < 0.25 && rpmForPitch > 9000 && this.wastegateCooldown <= 0) {
      this.wastegateCooldown = 0.7;
      this.oneShots.wastegate(0.5 + 0.5 * this.spool);
      this.crackleEnergy = Math.max(this.crackleEnergy, 0.6 + 0.4 * n);
    }
    // Sudden throttle drop from high rpm → overrun crackle energy.
    if (this.prevThrottle > 0.5 && th < 0.15 && n > 0.45) this.crackleEnergy = Math.max(this.crackleEnergy, 0.5 + 0.5 * n);
    this.prevThrottle = approach(this.prevThrottle, th, 0.05, dt);

    // Overrun crackle: random pops while energy remains and throttle is closed.
    this.crackleEnergy = approach(this.crackleEnergy, 0, 0.55, dt);
    if (this.crackleEnergy > 0.03 && th < 0.2) {
      if (Math.random() < this.crackleEnergy * 24 * dt) {
        const t = c.now;
        const g = this.crackleGain.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(0.18 + 0.45 * Math.random() * this.crackleEnergy, t);
        g.setTargetAtTime(0, t + 0.004, 0.012);
        c.freqTo(this.crackleFilter.frequency, 900 + Math.random() * 2200, 0.005);
      }
    } else {
      c.gainTo(this.crackleGain.gain, 0, 0.02);
    }

    // Rev limiter stutter
    const lim = !!e.limiter && !engineDead;
    if (lim !== this.limiterOn) {
      this.limiterOn = lim;
      c.gainTo(this.limiterDepth.gain, lim ? 0.42 : 0, 0.01);
      c.gainTo(this.limiterGate.gain, lim ? 0.56 : 1, 0.01);
      c.freqTo(this.limiterLfo.frequency, 14 + Math.random() * 2, 0.005);
    }

    // ERS / MGU-K whine
    const spd = clampSafe(car.speedAbs, 0, 120) / 95;
    c.freqTo(this.ersOsc.frequency, 1500 + 2500 * clampSafe(spd, 0, 1), 0.05);
    const ersLevel = car.ers.deploying ? 0.028 : car.ers.harvesting ? 0.014 : 0;
    c.gainTo(this.ersGain.gain, engineDead ? 0 : ersLevel * (0.4 + 0.6 * spd), 0.08);

    // Overall level
    const level = engineDead ? 0 : (0.36 + 0.64 * th) * (0.62 + 0.38 * n) * (0.4 + 0.6 * health);
    c.gainTo(this.out.gain, level * this.cameraGain * this.distanceGain, 0.04);
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    const c = this.core;
    c.gainTo(this.out.gain, 0, 0.03);
    const nodes = this.allNodes;
    setTimeout(() => {
      for (let i = 0; i < nodes.length; i++) c.release(nodes[i]);
    }, 160);
  }
}
