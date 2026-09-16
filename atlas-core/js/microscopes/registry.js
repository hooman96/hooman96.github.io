/** Mounts microscope panels. Each panel module exports { id, short, title, description, mount(bodyEl, ctx) }. */
import { esc } from './util.js';

export function mountMicroscopes(listEl, navEl, PANELS, ctx) {
  navEl.innerHTML = PANELS.map((p, i) => `<a href="#${p.id}">${String(i + 1).padStart(2, '0')} ${esc(p.short || p.title)}</a>`).join('');
  // Panels are mounted eagerly (they are small SVG/DOM builds) so anchor links land on final layout.
  const t0 = performance.now();
  PANELS.forEach((p, i) => {
    const sec = document.createElement('section');
    sec.className = 'scope'; sec.id = p.id; sec.setAttribute('aria-labelledby', p.id + '-h');
    sec.innerHTML = `<div class="scope-h"><span class="scope-n">Microscope ${String(i + 1).padStart(2, '0')}</span><h3 id="${p.id}-h">${esc(p.title)}</h3></div><p class="scope-desc">${esc(p.description)}</p><div class="scope-body"></div>`;
    listEl.appendChild(sec);
    try { p.mount(sec.querySelector('.scope-body'), ctx); } catch (err) { console.error('[llm-atlas] microscope failed', p.id, err); }
  });
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') console.info(`[llm-atlas] microscopes mounted in ${(performance.now() - t0).toFixed(1)} ms`);
}
