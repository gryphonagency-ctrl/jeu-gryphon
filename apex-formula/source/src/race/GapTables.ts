import { clamp } from '../core/math';
import { CP_SPACING, type CarRecord } from './internal';

/**
 * Broadcast-style time gaps: every car stores the session time at which it passed each 20 m checkpoint of the lap
 * (keyed by absolute checkpoint index = floor(progress / 20), kept for the last two laps). The gap from A (ahead)
 * to B (behind) is `now - timeAtProgress(A, B.progress)`: how long ago the car ahead was where the car behind is now.
 */
export class GapTables {
  readonly size: number;

  constructor(trackLength: number) {
    this.size = Math.ceil(trackLength / CP_SPACING) * 2 + 8;
  }

  init(rec: CarRecord): void {
    rec.cpTime = new Float64Array(this.size);
    rec.cpIdx = new Int32Array(this.size).fill(-1);
    rec.lastCp = -1;
    rec.firstCp = -1;
    rec.prevProgress = -1;
  }

  private slot(i: number): number {
    const m = i % this.size;
    return m < 0 ? m + this.size : m;
  }

  /** Call every physics step. Interpolates the crossing time of every checkpoint passed since the previous step. */
  record(rec: CarRecord, progress: number, now: number, dt: number): void {
    const idx = Math.floor(progress / CP_SPACING);
    if (rec.prevProgress < 0) {
      // First sighting (grid / spawn): anchor the current cell at `now` so cars right behind still get table-based gaps.
      const s = this.slot(idx);
      rec.cpTime[s] = now;
      rec.cpIdx[s] = idx;
      rec.lastCp = idx;
      rec.firstCp = idx;
      rec.prevProgress = progress;
      return;
    }
    if (idx > rec.lastCp) {
      const dp = progress - rec.prevProgress;
      if (idx - rec.lastCp > this.size) rec.lastCp = idx - this.size;
      for (let i = rec.lastCp + 1; i <= idx; i++) {
        const f = dp > 1e-6 ? clamp((i * CP_SPACING - rec.prevProgress) / dp, 0, 1) : 1;
        const s = this.slot(i);
        rec.cpTime[s] = now - dt + f * dt;
        rec.cpIdx[s] = i;
      }
      rec.lastCp = idx;
    } else if (idx < rec.lastCp) {
      // Moved backwards (spin / reset): forget the checkpoints ahead of the car so stale times are not used.
      const n = Math.min(this.size, rec.lastCp - idx);
      for (let k = 1; k <= n; k++) rec.cpIdx[this.slot(idx + k)] = -1;
      rec.lastCp = idx;
    }
    rec.prevProgress = progress;
  }

  /** Session time at which `rec` was at `progress`, or NaN if unknown. `speed` extrapolates past the latest checkpoint. */
  timeAt(rec: CarRecord, progress: number, speed: number): number {
    const f = progress / CP_SPACING;
    const i0 = Math.floor(f);
    const u = f - i0;
    const s0 = this.slot(i0);
    if (rec.cpIdx[s0] !== i0) return NaN;
    const t0 = rec.cpTime[s0];
    const s1 = this.slot(i0 + 1);
    if (rec.cpIdx[s1] === i0 + 1) return t0 + (rec.cpTime[s1] - t0) * u;
    return t0 + (u * CP_SPACING) / Math.max(5, speed);
  }

  /**
   * Time gap in seconds between a car ahead and a car behind given the behind car's progress.
   * Falls back to distance / speed when the table has no data (e.g. more than two laps apart).
   */
  gap(ahead: CarRecord, aheadProgress: number, aheadSpeed: number, behindProgress: number, behindSpeed: number, now: number): number {
    const t = this.timeAt(ahead, behindProgress, aheadSpeed);
    if (t === t) return Math.max(0, now - t);
    // The car ahead has never been there (race start: it started further up the road): anchor on its first checkpoint.
    const first = ahead.firstCp;
    if (first >= 0 && ahead.lastCp - first < this.size && behindProgress < first * CP_SPACING) {
      const tFirst = ahead.cpTime[this.slot(first)];
      return Math.max(0, now - tFirst + (first * CP_SPACING - behindProgress) / Math.max(20, behindSpeed));
    }
    return Math.max(0, (aheadProgress - behindProgress) / Math.max(20, Math.max(aheadSpeed, behindSpeed)));
  }
}
