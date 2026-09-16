/** Shared DOM/SVG helpers for microscope panels. */
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const rich = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

/** Parse an HTML string into a single element (or fragment). */
export function html(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content;
}

const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, parent, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}
/** Create a responsive SVG canvas with an arrow marker defined. */
export function canvas(w, h, label) {
  const s = svg('svg', { class: 'vis', viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': label });
  const defs = svg('defs', {}, s);
  const m = svg('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
  svg('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--atlas-muted)' }, m);
  return s;
}

/** Numeric/range field helper returning {el, input} */
export function field({ id, label, type = 'number', value, min, max, step, options, unit }) {
  const wrap = document.createElement('div');
  wrap.className = 'field' + (type === 'range' ? ' range' : '');
  const lab = document.createElement('label'); lab.htmlFor = id; lab.textContent = label;
  let input;
  if (type === 'select') {
    input = document.createElement('select');
    for (const [v, t] of options) { const o = document.createElement('option'); o.value = v; o.textContent = t; if (String(v) === String(value)) o.selected = true; input.appendChild(o); }
  } else {
    input = document.createElement('input'); input.type = type; input.value = value;
    if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; if (step !== undefined) input.step = step;
  }
  input.id = id;
  wrap.appendChild(lab); wrap.appendChild(input);
  if (type === 'range') { const out = document.createElement('output'); out.htmlFor = id; out.textContent = value + (unit || ''); lab.appendChild(out); input.addEventListener('input', () => (out.textContent = input.value + (unit || ''))); }
  return { el: wrap, input };
}

export const stat = (label, value, cls = '') => `<div class="stat ${cls}"><b>${value}</b><span>${label}</span></div>`;
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Seeded PRNG (mulberry32) so simulations are reproducible per "batch". */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const fmt = n => Intl.NumberFormat('en-US').format(Math.round(n));
export const pct = x => (x * 100).toFixed(0) + '%';

/** Horizontal execution-path strip with word-wrapped labels (max 2 lines). */
export function flowStrip(labels, subClass, aria) {
  const W = 760, H = 64, w = W / labels.length;
  const s = canvas(W, H, aria);
  labels.forEach((t, i) => {
    svg('rect', { class: 'box ' + subClass, x: i * w + 3, y: 10, width: w - 6, height: 44, rx: 4 }, s);
    const maxChars = Math.max(6, Math.floor((w - 12) / 5.2));
    const words = t.split(' '); const lines = ['']; 
    for (const wd of words) { if ((lines[lines.length - 1] + ' ' + wd).trim().length > maxChars && lines[lines.length - 1]) lines.push(wd); else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + wd).trim(); }
    const shown = lines.slice(0, 2); if (lines.length > 2) shown[1] += '…';
    shown.forEach((ln, j) => { const tx = svg('text', { class: 'tiny', x: i * w + w / 2, y: shown.length === 1 ? 36 : 30 + j * 12, 'text-anchor': 'middle' }, s, ln); tx.style.fontSize = '8.5px'; });
    if (i < labels.length - 1) svg('path', { class: 'arrow', d: `M${(i + 1) * w - 3} 32 L${(i + 1) * w + 3} 32` }, s);
  });
  return s;
}
