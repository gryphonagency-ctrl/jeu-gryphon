/** Tiny DOM helpers. Text/class setters only touch the DOM when the value actually changes. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.appendChild(document.createTextNode(text));
  return e;
}

export const div = (cls?: string, text?: string): HTMLDivElement => el('div', cls, text);
export const span = (cls?: string, text?: string): HTMLSpanElement => el('span', cls, text);

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

/** Update a single-text-node element without re-creating nodes. */
export function setText(e: Element, s: string): void {
  const n = e.firstChild;
  if (!n || n.nodeType !== 3) {
    e.textContent = s;
    return;
  }
  if (n.nodeValue !== s) n.nodeValue = s;
}

export function setToggle(e: Element, cls: string, on: boolean): void {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

export function setAttr(e: Element, name: string, value: string): void {
  if (e.getAttribute(name) !== value) e.setAttribute(name, value);
}

export function clear(e: Element): void {
  while (e.firstChild) e.removeChild(e.firstChild);
}

export function append(parent: Element, ...children: (Element | string | null | undefined | false)[]): void {
  for (const c of children) {
    if (!c) continue;
    parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

/** mm:ss (session clocks). */
export function fmtClock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds - m * 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Signed delta with 3 decimals: +0.123 / -1.204 */
export function fmtDelta(d: number, digits = 3): string {
  if (!isFinite(d)) return '--.---';
  const s = Math.abs(d).toFixed(digits);
  return (d < 0 ? '-' : '+') + s;
}

/** Hours (0..24) → HH:MM */
export function fmtHours(h: number): string {
  const hh = Math.floor(((h % 24) + 24) % 24);
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`;
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function ordinal(p: number): string {
  const r = p % 100;
  if (r >= 11 && r <= 13) return `${p}th`;
  switch (p % 10) {
    case 1:
      return `${p}st`;
    case 2:
      return `${p}nd`;
    case 3:
      return `${p}rd`;
    default:
      return `${p}th`;
  }
}

/** Inline SVG icons (stroke-based, currentColor). */
export const ICONS = {
  gamepad:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12a4 4 0 0 1 4 4v3.5a2.5 2.5 0 0 1-4.5 1.5L16 15H8l-1.5 2A2.5 2.5 0 0 1 2 15.5V12a4 4 0 0 1 4-4z"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16.5" cy="11.5" r=".9" fill="currentColor"/><circle cx="18.5" cy="13.5" r=".9" fill="currentColor"/></svg>',
  radio:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v6"/><path d="M8.5 6.5a5 5 0 0 0 7 0"/><rect x="5" y="9" width="14" height="12" rx="1.5"/><circle cx="12" cy="15" r="2.5"/></svg>',
  rain:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 15a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 8a3.5 3.5 0 0 1 0 7"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  sunset:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M17 17a5 5 0 0 0-10 0"/><path d="M12 8V4M4 17H2M22 17h-2M5.6 10.6L4.2 9.2M18.4 10.6l1.4-1.4M2 21h20"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  cloud:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 11a3.5 3.5 0 0 1 0 7z"/></svg>',
  thermo:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 4a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z"/><path d="M12 9v6"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 2h2v20H4zM7 3h13l-2.5 4L20 11H7z"/></svg>',
  warning:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17.5v.5"/></svg>',
  speaker:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  camera:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
};

export function icon(name: keyof typeof ICONS, cls = 'af-ico'): HTMLSpanElement {
  const s = span(cls);
  s.innerHTML = ICONS[name];
  return s;
}
