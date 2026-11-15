import type { UISound } from '../core/types';

export interface NavItem {
  el: HTMLElement;
  onConfirm?: () => void;
  /** Left/right on a focused item (sliders, selectors). When absent, left/right move within a grid. */
  onAdjust?: (dir: -1 | 1) => void;
  onFocus?: () => void;
  disabled?: boolean;
}

/**
 * Focus model for one screen: a list (or grid) of items driven by keyboard, gamepad and mouse.
 * The focused item gets the `focus` class; screens style it.
 */
export class Navigator {
  items: NavItem[] = [];
  index = -1;
  columns = 1;
  wrap = true;
  onBack: (() => void) | null = null;
  /** Called for left/right when the focused item has no onAdjust and the grid is single-column. */
  onSide: ((dir: -1 | 1) => void) | null = null;
  private readonly sound: (s: UISound) => void;

  constructor(sound: (s: UISound) => void) {
    this.sound = sound;
  }

  setItems(items: NavItem[], focusIndex = 0, columns = 1): void {
    for (const it of this.items) it.el.classList.remove('focus');
    this.items = items;
    this.columns = Math.max(1, columns);
    items.forEach((it, i) => this.bind(it, i));
    this.index = -1;
    if (items.length) this.focus(Math.min(focusIndex, items.length - 1), true);
  }

  private bind(item: NavItem, i: number): void {
    const e = item.el;
    if (e.dataset.navBound === '1') {
      e.dataset.navIndex = String(i);
      return;
    }
    e.dataset.navBound = '1';
    e.dataset.navIndex = String(i);
    e.addEventListener('pointerenter', () => {
      const idx = Number(e.dataset.navIndex);
      if (idx !== this.index) this.focus(idx);
    });
    e.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const idx = Number(e.dataset.navIndex);
      if (idx !== this.index) this.focus(idx, true);
      this.confirm();
    });
  }

  focus(i: number, silent = false): void {
    if (!this.items.length) return;
    const n = this.items.length;
    i = ((i % n) + n) % n;
    if (i === this.index) return;
    const prev = this.items[this.index];
    if (prev) prev.el.classList.remove('focus');
    this.index = i;
    const it = this.items[i];
    it.el.classList.add('focus');
    if (!silent) this.sound('nav');
    it.onFocus?.();
  }

  get current(): NavItem | null {
    return this.items[this.index] ?? null;
  }

  move(dx: number, dy: number): void {
    if (!this.items.length) return;
    const cur = this.current;
    if (dx !== 0) {
      if (cur?.onAdjust) {
        if (!cur.disabled) {
          cur.onAdjust(dx > 0 ? 1 : -1);
          this.sound('nav');
        }
        return;
      }
      if (this.columns <= 1) {
        if (this.onSide) {
          this.onSide(dx > 0 ? 1 : -1);
          this.sound('nav');
        }
        return;
      }
      this.step(dx);
      return;
    }
    if (dy !== 0) this.step(dy * this.columns);
  }

  private step(delta: number): void {
    const n = this.items.length;
    let i = this.index + delta;
    if (this.columns > 1 && (i < 0 || i >= n)) {
      if (!this.wrap) return;
      i = ((i % n) + n) % n;
    } else if (!this.wrap) {
      if (i < 0 || i >= n) return;
    }
    // Skip disabled items (bounded loop).
    let guard = 0;
    while (this.items[((i % n) + n) % n]?.disabled && guard++ < n) i += Math.sign(delta) || 1;
    this.focus(i);
  }

  confirm(): void {
    const it = this.current;
    if (!it || it.disabled) {
      this.sound('error');
      return;
    }
    if (it.onConfirm) {
      this.sound('confirm');
      it.onConfirm();
    } else if (it.onAdjust) {
      // Confirm on a selector cycles it forward.
      this.sound('nav');
      it.onAdjust(1);
    }
  }

  back(): void {
    if (this.onBack) {
      this.sound('back');
      this.onBack();
    }
  }
}
