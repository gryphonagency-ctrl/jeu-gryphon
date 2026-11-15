/**
 * Team radio: squelch in/out, band-limited distorted static bed, and speech via window.speechSynthesis
 * (which cannot be routed through Web Audio — so the bed plays around it and is ducked under the voice).
 */
import { AudioCore, clampSafe } from './core';
import { OneShots } from './OneShots';

const MAX_CHARS = 150;

export class Radio {
  private readonly core: AudioCore;
  private readonly oneShots: OneShots;
  private readonly noise: AudioBufferSourceNode;
  private readonly hpf: BiquadFilterNode;
  private readonly lpf: BiquadFilterNode;
  private readonly dist: WaveShaperNode;
  private readonly staticGain: GainNode;
  private readonly nodes: AudioNode[];

  private voice: SpeechSynthesisVoice | null = null;
  private current: SpeechSynthesisUtterance | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private muted = false;
  private volume = 1;
  private alive = true;
  private readonly onVoices = (): void => this.pickVoice();

  constructor(core: AudioCore, oneShots: OneShots) {
    this.core = core;
    this.oneShots = oneShots;
    const c = core;
    this.noise = c.noise('white');
    this.hpf = c.filter('highpass', 300, 0.7);
    this.lpf = c.filter('lowpass', 3000, 0.7);
    this.dist = c.shaper(c.hardClip);
    this.staticGain = c.gain(0);
    this.noise.connect(this.hpf).connect(this.lpf).connect(this.dist).connect(this.staticGain).connect(c.buses.radio);
    this.noise.start(c.now, Math.random() * 2);
    this.nodes = [this.noise, this.hpf, this.lpf, this.dist, this.staticGain];

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.pickVoice();
      try {
        window.speechSynthesis.addEventListener('voiceschanged', this.onVoices);
      } catch {
        /* older engines */
      }
    }
  }

  private pickVoice(): void {
    try {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      const preferred = ['Google UK English Male', 'Daniel', 'Google UK English Female', 'Google US English', 'Samantha', 'Alex'];
      let best: SpeechSynthesisVoice | null = null;
      for (const name of preferred) {
        const v = voices.find((x) => x.name === name);
        if (v) {
          best = v;
          break;
        }
      }
      if (!best) best = voices.find((v) => v.lang.toLowerCase().startsWith('en-gb')) ?? voices.find((v) => v.lang.toLowerCase().startsWith('en')) ?? voices[0];
      this.voice = best;
    } catch {
      this.voice = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.cancelSpeech();
  }

  setVolume(v: number): void {
    this.volume = clampSafe(v, 0, 1, 1);
    if (this.current) this.current.volume = this.volume;
  }

  /** Play a message. `fromRaceControl` gets a flatter, more clinical treatment. */
  message(text: string, fromRaceControl = false): void {
    if (!this.alive || !this.core.running) return;
    const c = this.core;
    this.clearTimers();
    this.cancelSpeech();

    const clean = Radio.trim(text);
    this.oneShots.squelch(true);
    const t = c.now;
    const g = this.staticGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(fromRaceControl ? 0.07 : 0.13, t + 0.05);
    g.linearRampToValueAtTime(0.045, t + 0.22);
    c.freqTo(this.lpf.frequency, fromRaceControl ? 2400 : 3000, 0.05);

    const canSpeak = !this.muted && typeof window !== 'undefined' && 'speechSynthesis' in window && this.volume > 0.001;
    const fallbackSeconds = clampSafe(0.8 + clean.length * 0.055, 1, 6.5, 2);

    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      if (!this.alive) return;
      if (canSpeak) {
        const u = new SpeechSynthesisUtterance(clean);
        u.rate = 1.05;
        u.pitch = fromRaceControl ? 0.95 : 0.9;
        u.volume = this.volume;
        if (this.voice) u.voice = this.voice;
        u.lang = this.voice?.lang ?? 'en-GB';
        const done = (): void => {
          if (this.current !== u) return;
          this.current = null;
          this.finish();
        };
        u.onend = done;
        u.onerror = done;
        this.current = u;
        try {
          window.speechSynthesis.speak(u);
        } catch {
          this.current = null;
          this.finish();
          return;
        }
        // Safety net: some engines never fire onend.
        this.endTimer = setTimeout(() => {
          if (this.current === u) {
            this.current = null;
            this.finish();
          }
        }, (fallbackSeconds + 6) * 1000);
      } else {
        this.endTimer = setTimeout(() => this.finish(), fallbackSeconds * 1000);
      }
    }, 160);
  }

  private finish(): void {
    if (!this.alive) return;
    this.clearTimers();
    const c = this.core;
    if (!c.running) return;
    const t = c.now;
    const g = this.staticGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.045, t);
    g.linearRampToValueAtTime(0.11, t + 0.06);
    g.linearRampToValueAtTime(0, t + 0.14);
    setTimeout(() => {
      if (this.alive) this.oneShots.squelch(false);
    }, 90);
  }

  private clearTimers(): void {
    if (this.endTimer) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
  }

  private cancelSpeech(): void {
    if (this.current) {
      this.current.onend = null;
      this.current.onerror = null;
      this.current = null;
    }
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }

  /** Stop any message immediately (session end). */
  stop(): void {
    this.clearTimers();
    this.cancelSpeech();
    if (this.core.running) this.core.gainTo(this.staticGain.gain, 0, 0.02);
  }

  private static trim(text: string): string {
    const s = (text ?? '').replace(/\s+/g, ' ').trim();
    if (s.length <= MAX_CHARS) return s;
    const cut = s.slice(0, MAX_CHARS);
    const sp = cut.lastIndexOf(' ');
    return (sp > 60 ? cut.slice(0, sp) : cut) + '.';
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    this.stop();
    try {
      window.speechSynthesis?.removeEventListener('voiceschanged', this.onVoices);
    } catch {
      /* ignore */
    }
    for (const n of this.nodes) this.core.release(n);
  }
}
