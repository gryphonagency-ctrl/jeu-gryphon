import { events } from '../core/events';
import { clamp, clamp01 } from '../core/math';

/** Standard-mapping button indices. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

export interface PadButtonListener {
  onPadPress(button: number): void;
  onPadRelease(button: number): void;
}

const MAX_BUTTONS = 20;
const DEADZONE = 0.06;

/** Polls the first connected gamepad, tracks button edges, and drives dual-rumble haptics. */
export class GamepadInput {
  connected = false;
  id = '';
  /** Steer in -1..1, POSITIVE = LEFT (stick pushed left). */
  steer = 0;
  /** Deadzoned, uncurved steer for the HUD. */
  rawSteer = 0;
  throttle = 0;
  brake = 0;

  private index = -1;
  private readonly pressed = new Uint8Array(MAX_BUTTONS);
  private readonly prev = new Uint8Array(MAX_BUTTONS);
  private time = 0;
  private rumbleIntensity = 0;
  private rumbleUntil = 0;
  private rumbleNextIssue = 0;
  private readonly rumbleParams = { startDelay: 0, duration: 100, strongMagnitude: 0, weakMagnitude: 0 };
  private readonly listener: PadButtonListener;

  private readonly onConnected = (e: GamepadEvent): void => {
    if (this.index < 0) this.index = e.gamepad.index;
  };
  private readonly onDisconnected = (e: GamepadEvent): void => {
    if (e.gamepad.index === this.index) this.index = -1;
  };

  constructor(listener: PadButtonListener) {
    this.listener = listener;
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', this.onConnected);
      window.addEventListener('gamepaddisconnected', this.onDisconnected);
    }
  }

  isPressed(button: number): boolean {
    return this.pressed[button] === 1;
  }

  update(dt: number): void {
    this.time += dt;
    const pad = this.poll();

    if (pad && !this.connected) {
      this.connected = true;
      this.id = pad.id;
      this.index = pad.index;
      events.emit('input:gamepad', { connected: true, id: pad.id });
    } else if (!pad && this.connected) {
      this.connected = false;
      this.index = -1;
      this.clearState();
      events.emit('input:gamepad', { connected: false, id: this.id });
      this.id = '';
      return;
    }
    if (!pad) return;

    const axes = pad.axes;
    const ax = axes.length > 0 ? axes[0] : 0;
    const mag = Math.abs(ax);
    let m = mag < DEADZONE ? 0 : (mag - DEADZONE) / (1 - DEADZONE);
    m = clamp01(m);
    this.rawSteer = -Math.sign(ax) * m;
    // 60 % cubic / 40 % linear response: precise around centre, full authority at the stops.
    this.steer = -Math.sign(ax) * (0.4 * m + 0.6 * m * m * m);

    const buttons = pad.buttons;
    const n = Math.min(buttons.length, MAX_BUTTONS);
    this.throttle = n > PAD.RT ? clamp01(buttons[PAD.RT].value) : 0;
    this.brake = n > PAD.LT ? clamp01(buttons[PAD.LT].value) : 0;

    for (let i = 0; i < n; i++) {
      const b = buttons[i];
      const down = b.pressed || b.value > 0.5;
      this.pressed[i] = down ? 1 : 0;
      if (down && this.prev[i] === 0) this.listener.onPadPress(i);
      else if (!down && this.prev[i] === 1) this.listener.onPadRelease(i);
    }
    this.prev.set(this.pressed);

    this.updateRumble(pad);
  }

  /** Request rumble; overlapping requests merge (max intensity, latest end time). */
  rumble(intensity: number, duration: number): void {
    intensity = clamp01(intensity);
    if (intensity <= 0 || duration <= 0) return;
    const active = this.time < this.rumbleUntil;
    if (!active || intensity >= this.rumbleIntensity) this.rumbleIntensity = intensity;
    this.rumbleUntil = Math.max(active ? this.rumbleUntil : 0, this.time + duration);
    this.rumbleNextIssue = 0;
  }

  clearState(): void {
    this.steer = 0;
    this.rawSteer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.pressed.fill(0);
    this.prev.fill(0);
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('gamepadconnected', this.onConnected);
      window.removeEventListener('gamepaddisconnected', this.onDisconnected);
    }
    this.stopRumble();
  }

  private poll(): Gamepad | null {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    let pads: (Gamepad | null)[];
    try {
      pads = navigator.getGamepads();
    } catch {
      return null;
    }
    if (this.index >= 0 && this.index < pads.length) {
      const p = pads[this.index];
      if (p && p.connected) return p;
    }
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) return p;
    }
    return null;
  }

  private actuator(pad: Gamepad): GamepadHapticActuator | null {
    const act = (pad as { vibrationActuator?: GamepadHapticActuator | null }).vibrationActuator;
    return act && typeof act.playEffect === 'function' ? act : null;
  }

  private updateRumble(pad: Gamepad): void {
    if (this.time >= this.rumbleUntil) {
      this.rumbleIntensity = 0;
      return;
    }
    if (this.time < this.rumbleNextIssue) return;
    const act = this.actuator(pad);
    if (!act) return;
    const remaining = this.rumbleUntil - this.time;
    const slice = Math.min(remaining, 0.2);
    this.rumbleParams.duration = Math.max(20, Math.round(slice * 1000));
    this.rumbleParams.strongMagnitude = clamp(this.rumbleIntensity, 0, 1);
    this.rumbleParams.weakMagnitude = clamp(this.rumbleIntensity * 0.65, 0, 1);
    try {
      void act.playEffect('dual-rumble', this.rumbleParams).catch(() => undefined);
    } catch {
      /* haptics unsupported on this pad */
    }
    this.rumbleNextIssue = this.time + slice * 0.85;
  }

  private stopRumble(): void {
    this.rumbleUntil = 0;
    this.rumbleIntensity = 0;
    const pad = this.poll();
    if (!pad) return;
    const act = this.actuator(pad);
    if (act && typeof act.reset === 'function') {
      try {
        void act.reset().catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
  }
}
