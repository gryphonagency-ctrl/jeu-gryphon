/**
 * Shared Web Audio plumbing: the context, the mix buses, node factories with live-node accounting,
 * pooled noise buffers / impulse response, and NaN-proof AudioParam setters.
 */

export type BusName = 'engine' | 'sfx' | 'ambience' | 'music' | 'ui' | 'radio';
export const BUS_NAMES: readonly BusName[] = ['engine', 'sfx', 'ambience', 'music', 'ui', 'radio'];

const BUS_DEFAULTS: Record<BusName, number> = {
  engine: 0.9,
  sfx: 0.85,
  ambience: 0.7,
  music: 0.55,
  ui: 0.7,
  radio: 0.8,
};

const isFiniteNumber = (v: number): boolean => typeof v === 'number' && v - v === 0;

/** Sanitise any number destined for an AudioParam. */
export const safe = (v: number, fallback = 0): number => (isFiniteNumber(v) ? v : fallback);
export const clampSafe = (v: number, lo: number, hi: number, fallback = lo): number => {
  if (!isFiniteNumber(v)) return fallback;
  return v < lo ? lo : v > hi ? hi : v;
};
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
/** Frame-rate independent exponential approach. */
export const approach = (current: number, target: number, tau: number, dt: number): number => {
  if (tau <= 0) return target;
  const k = 1 - Math.exp(-dt / tau);
  return current + (target - current) * k;
};

export interface Buses {
  engine: GainNode;
  sfx: GainNode;
  ambience: GainNode;
  music: GainNode;
  ui: GainNode;
  radio: GainNode;
}

export class AudioCore {
  readonly ctx: AudioContext;
  readonly buses: Buses;
  /** Lowpass used to muffle engine/sfx while paused. */
  readonly pauseFilterEngine: BiquadFilterNode;
  readonly pauseFilterSfx: BiquadFilterNode;
  readonly pauseDuck: GainNode;
  readonly busSum: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly masterVolume: GainNode;
  /** Shared by mute and tab-hidden (either → 0). */
  readonly muteGain: GainNode;

  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  readonly impulse: AudioBuffer;
  readonly softClip: Float32Array<ArrayBuffer>;
  readonly hardClip: Float32Array<ArrayBuffer>;
  readonly maxFreq: number;

  /** Number of nodes currently alive that were created via the factories. */
  liveNodes = 0;

  constructor() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.maxFreq = ctx.sampleRate * 0.5 - 200;

    this.white = this.makeNoise('white');
    this.pink = this.makeNoise('pink');
    this.brown = this.makeNoise('brown');
    this.impulse = this.makeImpulse(2.2, 2.8);
    this.softClip = AudioCore.makeCurve(2.6);
    this.hardClip = AudioCore.makeCurve(7);

    this.muteGain = this.gain(1);
    this.masterVolume = this.gain(1);
    this.limiter = this.compressor(-4, 8, 18, 0.003, 0.14);
    this.busSum = this.gain(1);
    this.pauseDuck = this.gain(1);
    this.pauseFilterEngine = this.filter('lowpass', this.maxFreq, 0.5);
    this.pauseFilterSfx = this.filter('lowpass', this.maxFreq, 0.5);

    this.buses = {
      engine: this.gain(BUS_DEFAULTS.engine),
      sfx: this.gain(BUS_DEFAULTS.sfx),
      ambience: this.gain(BUS_DEFAULTS.ambience),
      music: this.gain(BUS_DEFAULTS.music),
      ui: this.gain(BUS_DEFAULTS.ui),
      radio: this.gain(BUS_DEFAULTS.radio),
    };

    this.buses.engine.connect(this.pauseFilterEngine).connect(this.pauseDuck);
    this.buses.sfx.connect(this.pauseFilterSfx).connect(this.pauseDuck);
    this.pauseDuck.connect(this.busSum);
    this.buses.ambience.connect(this.busSum);
    this.buses.music.connect(this.busSum);
    this.buses.ui.connect(this.busSum);
    this.buses.radio.connect(this.busSum);
    this.busSum.connect(this.limiter).connect(this.masterVolume).connect(this.muteGain).connect(ctx.destination);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  get running(): boolean {
    return this.ctx.state === 'running';
  }

  /* ───────────── node factories (all account for liveNodes) ───────────── */

  gain(value = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = safe(value, 0);
    this.liveNodes++;
    return g;
  }

  osc(type: OscillatorType, freq: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = clampSafe(freq, 0.01, this.maxFreq, 100);
    o.detune.value = clampSafe(detune, -4800, 4800);
    this.liveNodes++;
    return o;
  }

  filter(type: BiquadFilterType, freq: number, q = 1, gainDb = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = clampSafe(freq, 10, this.maxFreq, 1000);
    f.Q.value = clampSafe(q, 0.0001, 100, 1);
    f.gain.value = clampSafe(gainDb, -40, 40);
    this.liveNodes++;
    return f;
  }

  /** Looping noise source; starts immediately at a random offset so parallel sources are decorrelated. */
  noise(kind: 'white' | 'pink' | 'brown', loop = true, playbackRate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = kind === 'white' ? this.white : kind === 'pink' ? this.pink : this.brown;
    s.loop = loop;
    s.playbackRate.value = clampSafe(playbackRate, 0.05, 8, 1);
    this.liveNodes++;
    return s;
  }

  shaper(curve: Float32Array<ArrayBuffer>, oversample: OverSampleType = 'none'): WaveShaperNode {
    const w = this.ctx.createWaveShaper();
    w.curve = curve;
    w.oversample = oversample;
    this.liveNodes++;
    return w;
  }

  panner(hrtf: boolean): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 8;
    p.maxDistance = 250;
    p.rolloffFactor = 1.2;
    this.liveNodes++;
    return p;
  }

  delay(seconds: number, maxSeconds = 2): DelayNode {
    const d = this.ctx.createDelay(clampSafe(maxSeconds, 0.05, 30, 2));
    d.delayTime.value = clampSafe(seconds, 0, maxSeconds, 0.25);
    this.liveNodes++;
    return d;
  }

  convolver(buffer: AudioBuffer = this.impulse): ConvolverNode {
    const c = this.ctx.createConvolver();
    c.buffer = buffer;
    c.normalize = true;
    this.liveNodes++;
    return c;
  }

  compressor(threshold: number, knee: number, ratio: number, attack: number, release: number): DynamicsCompressorNode {
    const c = this.ctx.createDynamicsCompressor();
    c.threshold.value = clampSafe(threshold, -100, 0, -12);
    c.knee.value = clampSafe(knee, 0, 40, 6);
    c.ratio.value = clampSafe(ratio, 1, 20, 4);
    c.attack.value = clampSafe(attack, 0, 1, 0.003);
    c.release.value = clampSafe(release, 0, 1, 0.25);
    this.liveNodes++;
    return c;
  }

  analyser(): AnalyserNode {
    const a = this.ctx.createAnalyser();
    a.fftSize = 1024;
    this.liveNodes++;
    return a;
  }

  /** Disconnect + stop a node and decrement the live counter. Safe to call twice. */
  release(node: AudioNode | null | undefined): void {
    if (!node) return;
    const tagged = node as AudioNode & { __released?: boolean };
    if (tagged.__released) return;
    tagged.__released = true;
    try {
      if (node instanceof AudioScheduledSourceNode) node.stop();
    } catch {
      /* already stopped */
    }
    try {
      node.disconnect();
    } catch {
      /* not connected */
    }
    this.liveNodes--;
  }

  /** For one-shot sources: release everything in `nodes` once the source has ended. */
  autoRelease(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    source.onended = () => {
      for (let i = 0; i < nodes.length; i++) this.release(nodes[i]);
      source.onended = null;
    };
  }

  /* ───────────── parameter setters ───────────── */

  /** Smooth approach (setTargetAtTime). Allocation-free; use per frame. */
  target(param: AudioParam, value: number, tc = 0.03, lo = -1e9, hi = 1e9): void {
    param.setTargetAtTime(clampSafe(value, lo, hi, lo > -1e8 ? lo : 0), this.ctx.currentTime, tc < 0.0005 ? 0.0005 : tc);
  }

  gainTo(param: AudioParam, value: number, tc = 0.03): void {
    this.target(param, value, tc, 0, 8);
  }

  freqTo(param: AudioParam, value: number, tc = 0.02): void {
    this.target(param, value, tc, 5, this.maxFreq);
  }

  qTo(param: AudioParam, value: number, tc = 0.05): void {
    this.target(param, value, tc, 0.0001, 60);
  }

  detuneTo(param: AudioParam, cents: number, tc = 0.02): void {
    this.target(param, cents, tc, -4800, 4800);
  }

  /** Immediate set with automation cleared (for one-shots / discrete events). */
  set(param: AudioParam, value: number, at = this.ctx.currentTime, lo = -1e9, hi = 1e9): void {
    param.cancelScheduledValues(at);
    param.setValueAtTime(clampSafe(value, lo, hi, 0), at);
  }

  ramp(param: AudioParam, value: number, at: number, lo = -1e9, hi = 1e9): void {
    param.linearRampToValueAtTime(clampSafe(value, lo, hi, 0), at);
  }

  expRamp(param: AudioParam, value: number, at: number, lo = 0.0001, hi = 1e9): void {
    const v = clampSafe(value, lo, hi, lo);
    param.exponentialRampToValueAtTime(v < 0.0001 ? 0.0001 : v, at);
  }

  /* ───────────── buffers ───────────── */

  private makeNoise(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const seconds = 2.5;
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      let last = 0;
      let peak = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        let v: number;
        if (kind === 'white') {
          v = w;
        } else if (kind === 'pink') {
          // Paul Kellet's refined pink filter.
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
          b6 = w * 0.115926;
        } else {
          last = (last + 0.02 * w) / 1.02;
          v = last * 3.5;
        }
        data[i] = v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
      if (peak > 0) {
        const norm = 0.95 / peak;
        for (let i = 0; i < len; i++) data[i] *= norm;
      }
      // Seamless loop: short crossfade at the tail.
      const fade = Math.min(2048, len >> 2);
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        data[len - fade + i] = data[len - fade + i] * (1 - t) + data[i] * t;
      }
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
        // Progressive low-pass so the tail darkens like a real hall.
        lp += (Math.random() * 2 - 1 - lp) * (0.9 - 0.7 * t);
        const early = i < 2400 && i % 397 === 0 ? 0.6 : 0;
        data[i] = (lp * 0.8 + early) * env;
      }
    }
    return buf;
  }

  static makeCurve(drive: number): Float32Array<ArrayBuffer> {
    const n = 2048;
    const curve = new Float32Array(n);
    const norm = Math.tanh(drive);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * x) / norm;
    }
    return curve;
  }
}
