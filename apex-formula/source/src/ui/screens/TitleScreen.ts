import type { Screen, UIContext } from '../context';
import { div, span } from '../dom';

export const VERSION = 'v1.0.0';

export class TitleScreen implements Screen {
  readonly el: HTMLElement;
  onStart: (() => void) | null = null;
  private armed = false;
  private armTimer = 0;

  constructor(private readonly ctx: UIContext) {
    const e = div('af-screen af-title hidden');
    this.el = e;
    e.appendChild(div('af-title-bg'));
    e.appendChild(div('af-title-grid'));
    const streaks = div('af-streaks');
    for (let i = 0; i < 7; i++) {
      const s = div('af-streak');
      s.style.setProperty('--i', String(i));
      streaks.appendChild(s);
    }
    e.appendChild(streaks);

    const centre = div('af-title-centre');
    const kicker = div('af-title-kicker', 'FORMULA RACING · SEASON ONE');
    const word = div('af-wordmark');
    const w1 = div('af-word');
    const w2 = div('af-word af-word2');
    'APEX'.split('').forEach((ch, i) => {
      const s = span('af-letter', ch);
      s.style.setProperty('--d', `${i * 70}ms`);
      w1.appendChild(s);
    });
    'FORMULA'.split('').forEach((ch, i) => {
      const s = span('af-letter', ch);
      s.style.setProperty('--d', `${320 + i * 60}ms`);
      w2.appendChild(s);
    });
    word.append(w1, w2);
    const rule = div('af-title-rule');
    const tag = div('af-tagline', 'TWENTY CARS. ONE APEX. NO MERCY.');
    const press = div('af-press');
    press.appendChild(span('af-press-key', 'PRESS'));
    press.appendChild(span('af-press-glyph', ctx.gamepad ? 'A' : 'ENTER'));
    press.appendChild(span('af-press-key', 'TO START'));
    centre.append(kicker, word, rule, tag, press);
    e.appendChild(centre);

    const foot = div('af-title-foot');
    foot.appendChild(span('', `APEX FORMULA ${VERSION}`));
    foot.appendChild(span('af-dim', 'FULLY PROCEDURAL · THREE.JS · NO EXTERNAL ASSETS'));
    foot.appendChild(span('af-dim', 'KEYBOARD · GAMEPAD'));
    e.appendChild(foot);

    e.addEventListener('click', () => this.confirm());
  }

  refreshGlyph(): void {
    const g = this.el.querySelector('.af-press-glyph');
    if (g) g.textContent = this.ctx.gamepad ? 'A' : 'ENTER';
  }

  show(): void {
    this.el.classList.remove('hidden');
    // Restart the letter animation each time.
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    this.armed = false;
    clearTimeout(this.armTimer);
    this.armTimer = window.setTimeout(() => (this.armed = true), 900);
  }

  hide(): void {
    this.el.classList.add('hidden');
    clearTimeout(this.armTimer);
  }

  move(): void {
    /* nothing to navigate */
  }

  confirm(): void {
    if (!this.armed) {
      // Skip the intro if the player is impatient.
      this.armed = true;
      this.el.classList.add('skip');
      return;
    }
    this.ctx.sound('start');
    this.onStart?.();
  }

  back(): void {
    /* no-op on the title */
  }
}
