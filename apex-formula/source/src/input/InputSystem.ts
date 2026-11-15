import { events } from '../core/events';
import { clamp } from '../core/math';
import type { DriverInput, ErsMode, IInputSystem, InputCommand } from '../core/types';
import { createDefaultInput } from '../core/world';
import { GamepadInput, PAD, type PadButtonListener } from './GamepadInput';
import { SteeringModel } from './SteeringModel';

const ERS_CYCLE: readonly ErsMode[] = ['harvest', 'balanced', 'overtake'];
const PEDAL_RISE = 1 / 0.12;
const PEDAL_FALL = 1 / 0.08;

const moveToward = (v: number, target: number, step: number): number => {
  const d = target - v;
  if (Math.abs(d) <= step) return target;
  return v + Math.sign(d) * step;
};

/**
 * Keyboard + gamepad → DriverInput and InputCommands. See ARCHITECTURE.md "Controls" for bindings.
 * Edge flags (gearUp/gearDown/reset) are queued on key press and pulsed for exactly one getDriverInput() call.
 */
export class InputSystem implements IInputSystem, PadButtonListener {
  private readonly input: DriverInput = createDefaultInput();
  private readonly steering = new SteeringModel();
  private readonly pad = new GamepadInput(this);
  private readonly held = new Set<string>();

  private queue: InputCommand[] = [];
  private spare: InputCommand[] = [];

  private drivingEnabled = true;
  private kbThrottle = 0;
  private kbBrake = 0;
  private gearUpQueue = 0;
  private gearDownQueue = 0;
  private resetQueue = 0;
  private ersBase: ErsMode = 'balanced';
  private overtakeKb = false;
  private pitLimiter = false;
  private lookBackKb = false;
  private lookBackPad = false;
  private playerCarId = 0;
  private time = 0;
  private lastLockupRumble = -1;
  private lastCollisionRumble = -1;
  private readonly offs: (() => void)[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.onBlur);
    }
    this.offs.push(
      events.on('player:car', ({ carId }) => {
        this.playerCarId = carId;
      }),
      events.on('car:collision', ({ carId, impulse }) => {
        if (carId !== this.playerCarId) return;
        if (this.time - this.lastCollisionRumble < 0.12) return;
        this.lastCollisionRumble = this.time;
        const k = clamp(impulse / 6000, 0.35, 1);
        this.rumble(k, 0.2 + 0.35 * k);
      }),
      events.on('car:lockup', ({ carId, active }) => {
        if (carId !== this.playerCarId || !active) return;
        if (this.time - this.lastLockupRumble < 0.3) return;
        this.lastLockupRumble = this.time;
        this.rumble(0.3, 0.12);
      }),
    );
  }

  /* ───────────────────────────── IInputSystem ───────────────────────────── */

  update(dt: number): void {
    dt = clamp(dt, 0, 0.1);
    this.time += dt;
    this.pad.update(dt);

    const inp = this.input;
    if (!this.drivingEnabled) {
      this.steering.update(0, dt);
      this.kbThrottle = moveToward(this.kbThrottle, 0, PEDAL_FALL * dt);
      this.kbBrake = moveToward(this.kbBrake, 0, PEDAL_FALL * dt);
      inp.steer = 0;
      inp.throttle = 0;
      inp.brake = 0;
      inp.drs = false;
      inp.ersMode = this.ersBase;
      inp.pitLimiter = this.pitLimiter;
      return;
    }

    const left = this.held.has('KeyA') || this.held.has('ArrowLeft');
    const right = this.held.has('KeyD') || this.held.has('ArrowRight');
    this.steering.update((left ? 1 : 0) - (right ? 1 : 0), dt);

    const thrTarget = this.held.has('KeyW') || this.held.has('ArrowUp') ? 1 : 0;
    const brkTarget = this.held.has('KeyS') || this.held.has('ArrowDown') ? 1 : 0;
    this.kbThrottle = moveToward(this.kbThrottle, thrTarget, (thrTarget > this.kbThrottle ? PEDAL_RISE : PEDAL_FALL) * dt);
    this.kbBrake = moveToward(this.kbBrake, brkTarget, (brkTarget > this.kbBrake ? PEDAL_RISE : PEDAL_FALL) * dt);

    inp.steer = clamp(this.steering.output() + this.pad.steer, -1, 1);
    inp.throttle = Math.max(this.kbThrottle, this.pad.throttle);
    inp.brake = Math.max(this.kbBrake, this.pad.brake);
    inp.drs = this.held.has('Space') || this.pad.isPressed(PAD.X);
    const overtake = this.overtakeKb || this.pad.isPressed(PAD.Y);
    inp.ersMode = overtake ? 'overtake' : this.ersBase;
    inp.pitLimiter = this.pitLimiter;
  }

  getDriverInput(): DriverInput {
    const inp = this.input;
    inp.gearUp = this.gearUpQueue > 0;
    if (this.gearUpQueue > 0) this.gearUpQueue--;
    inp.gearDown = this.gearDownQueue > 0;
    if (this.gearDownQueue > 0) this.gearDownQueue--;
    inp.reset = this.resetQueue > 0;
    if (this.resetQueue > 0) this.resetQueue--;
    inp.pitRequest = false;
    inp.pitCompound = null;
    return inp;
  }

  consumeCommands(): InputCommand[] {
    const out = this.queue;
    this.queue = this.spare;
    this.spare = out;
    this.queue.length = 0;
    return out;
  }

  setDrivingEnabled(enabled: boolean): void {
    if (this.drivingEnabled === enabled) return;
    this.drivingEnabled = enabled;
    if (!enabled) {
      this.steering.reset();
      this.kbThrottle = 0;
      this.kbBrake = 0;
      this.gearUpQueue = 0;
      this.gearDownQueue = 0;
      this.resetQueue = 0;
      this.overtakeKb = false;
      this.input.steer = 0;
      this.input.throttle = 0;
      this.input.brake = 0;
      this.input.drs = false;
      this.input.gearUp = false;
      this.input.gearDown = false;
      this.input.reset = false;
      this.input.ersMode = this.ersBase;
      this.releaseLookBack();
    }
  }

  rumble(intensity: number, duration: number): void {
    this.pad.rumble(intensity, duration);
  }

  isGamepadConnected(): boolean {
    return this.pad.connected;
  }

  getRawSteer(): number {
    const kb = this.steering.raw;
    const pad = this.pad.rawSteer;
    return clamp(Math.abs(kb) >= Math.abs(pad) ? kb : pad, -1, 1);
  }

  setErsMode(mode: ErsMode): void {
    this.ersBase = mode;
    if (!(this.overtakeKb || this.pad.isPressed(PAD.Y)) || !this.drivingEnabled) this.input.ersMode = mode;
  }

  /** Optional speed hint (m/s) for the speed-sensitive keyboard steering rate. */
  setSpeedHint(speedMs: number): void {
    this.steering.setSpeedHint(speedMs * 3.6);
  }

  getErsMode(): ErsMode {
    return this.input.ersMode;
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
    }
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.pad.dispose();
    this.held.clear();
  }

  /* ───────────────────────────── gamepad edges ───────────────────────────── */

  onPadPress(button: number): void {
    const driving = this.drivingEnabled;
    switch (button) {
      case PAD.A:
        if (driving) this.gearUpQueue++;
        else this.push({ type: 'menu-confirm' });
        break;
      case PAD.B:
        if (driving) this.gearDownQueue++;
        else this.push({ type: 'menu-back' });
        break;
      case PAD.LB:
        this.lookBackPad = true;
        this.push({ type: 'look-back', active: true });
        break;
      case PAD.RB:
        this.push({ type: 'cycle-camera' });
        break;
      case PAD.UP:
        this.push({ type: 'menu-up' });
        break;
      case PAD.DOWN:
        this.push({ type: 'menu-down' });
        break;
      case PAD.LEFT:
        this.push({ type: 'menu-left' });
        break;
      case PAD.RIGHT:
        this.push({ type: 'menu-right' });
        break;
      case PAD.START:
        this.push({ type: 'pause' });
        break;
      case PAD.BACK:
        this.push({ type: 'toggle-replay' });
        break;
      case PAD.RS:
        if (driving) this.resetQueue++;
        break;
      case PAD.LS:
        if (driving) this.pitLimiter = !this.pitLimiter;
        break;
    }
  }

  onPadRelease(button: number): void {
    if (button === PAD.LB && this.lookBackPad) {
      this.lookBackPad = false;
      if (!this.lookBackKb) this.push({ type: 'look-back', active: false });
    }
  }

  /* ───────────────────────────── keyboard ───────────────────────────── */

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || this.isTextTarget()) return;
    const code = e.code;
    const driving = this.drivingEnabled;
    const isArrow = code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight';

    if (isArrow || code === 'Space' || (driving && (code === 'Tab' || code === 'Backspace')) || code === 'F8') e.preventDefault();
    this.held.add(code);
    if (e.repeat) return;

    switch (code) {
      case 'KeyE':
      case 'ShiftLeft':
      case 'ShiftRight':
        if (driving) this.gearUpQueue++;
        break;
      case 'KeyQ':
      case 'ControlLeft':
      case 'ControlRight':
        if (driving) this.gearDownQueue++;
        break;
      case 'Backspace':
        if (driving) this.resetQueue++;
        break;
      case 'KeyR':
        if (driving) this.overtakeKb = true;
        break;
      case 'KeyV':
        this.cycleErs();
        this.push({ type: 'ers-cycle' });
        break;
      case 'KeyL':
        if (driving) this.pitLimiter = !this.pitLimiter;
        break;
      case 'KeyP':
        this.push({ type: 'request-pit' });
        break;
      case 'Tab':
        this.push({ type: 'mfd-toggle' });
        break;
      case 'Period':
        this.push({ type: 'mfd-next' });
        break;
      case 'Comma':
        this.push({ type: 'mfd-prev' });
        break;
      case 'Enter':
      case 'NumpadEnter':
        this.push({ type: 'menu-confirm' });
        break;
      case 'Space':
        if (!driving) this.push({ type: 'menu-confirm' });
        break;
      case 'KeyC':
        this.push({ type: 'cycle-camera' });
        break;
      case 'KeyB':
        if (driving && !this.lookBackKb) {
          this.lookBackKb = true;
          if (!this.lookBackPad) this.push({ type: 'look-back', active: true });
        }
        break;
      case 'KeyI':
        this.push({ type: 'toggle-replay' });
        break;
      case 'KeyH':
        this.push({ type: 'toggle-hud' });
        break;
      case 'KeyM':
        this.push({ type: 'toggle-mute' });
        break;
      case 'KeyT':
        this.push({ type: 'radio' });
        break;
      case 'F8':
        this.push({ type: 'screenshot' });
        break;
      case 'Escape':
        this.push(driving ? { type: 'pause' } : { type: 'menu-back' });
        break;
      case 'KeyW':
      case 'ArrowUp':
        if (!driving) this.push({ type: 'menu-up' });
        break;
      case 'KeyS':
      case 'ArrowDown':
        if (!driving) this.push({ type: 'menu-down' });
        break;
      case 'KeyA':
      case 'ArrowLeft':
        if (!driving) this.push({ type: 'menu-left' });
        break;
      case 'KeyD':
      case 'ArrowRight':
        if (!driving) this.push({ type: 'menu-right' });
        break;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const code = e.code;
    this.held.delete(code);
    if (code === 'KeyR') this.overtakeKb = false;
    if (code === 'KeyB' && this.lookBackKb) {
      this.lookBackKb = false;
      if (!this.lookBackPad) this.push({ type: 'look-back', active: false });
    }
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.overtakeKb = false;
    this.releaseLookBack();
  };

  private isTextTarget(): boolean {
    const el = typeof document !== 'undefined' ? document.activeElement : null;
    if (!el) return false;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
    return el instanceof HTMLElement && el.isContentEditable;
  }

  private cycleErs(): void {
    const i = ERS_CYCLE.indexOf(this.ersBase);
    this.setErsMode(ERS_CYCLE[(i + 1) % ERS_CYCLE.length]);
  }

  private releaseLookBack(): void {
    if (this.lookBackKb || this.lookBackPad) {
      this.lookBackKb = false;
      this.lookBackPad = false;
      this.push({ type: 'look-back', active: false });
    }
  }

  private push(cmd: InputCommand): void {
    this.queue.push(cmd);
  }
}
