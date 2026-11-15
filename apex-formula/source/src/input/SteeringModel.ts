import { clamp } from '../core/math';

/**
 * Rate-based keyboard steering that feels like a wheel rather than a switch: the value walks toward the held direction
 * at a speed-dependent rate, auto-centres when released and the output is shaped by a soft curve so short taps produce
 * small angles.
 */
export class SteeringModel {
  /** Smoothed pre-curve value in -1..1 (what the HUD shows as "raw"). */
  raw = 0;
  private speedKmh = 110;

  /** Optional hint (km/h). Without one a middle rate is used. */
  setSpeedHint(kmh: number): void {
    this.speedKmh = clamp(kmh, 0, 400);
  }

  /** Full-lock rate in units/s: 3.0 at rest → 1.2 at 300 km/h. */
  rate(): number {
    const t = clamp(this.speedKmh / 300, 0, 1);
    return 3.0 - 1.8 * t;
  }

  update(target: number, dt: number): void {
    if (target === 0) {
      const step = 4.0 * dt;
      if (Math.abs(this.raw) <= step) this.raw = 0;
      else this.raw -= Math.sign(this.raw) * step;
      return;
    }
    // Counter-steering back through centre is always quick; steering further out uses the speed-sensitive rate.
    const crossing = this.raw !== 0 && Math.sign(target) !== Math.sign(this.raw);
    const step = (crossing ? Math.max(this.rate(), 4.0) : this.rate()) * dt;
    const d = target - this.raw;
    if (Math.abs(d) <= step) this.raw = target;
    else this.raw += Math.sign(d) * step;
  }

  /** Soft-curved output: fine near centre, full at the stops. */
  output(): number {
    const a = Math.abs(this.raw);
    return Math.sign(this.raw) * a * (0.45 + 0.55 * a);
  }

  reset(): void {
    this.raw = 0;
  }
}
