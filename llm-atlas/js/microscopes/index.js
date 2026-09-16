/** Microscope registry. Each module exports { id, number, title, description, mount(bodyEl, ctx) }. */
import * as tokenizer from './tokenizer.js';
import * as transformer from './transformer.js';
import * as moe from './moe.js';
import * as training from './training.js';
import * as parallelism from './parallelism.js';
import * as posttraining from './posttraining.js';
import * as prefix from './prefix.js';
import * as kv from './kv.js';
import * as batching from './batching.js';
import * as decoding from './decoding.js';
import * as quant from './quant.js';
import * as serving from './serving.js';
import { esc } from './util.js';

const PANELS = [tokenizer, transformer, moe, training, parallelism, posttraining, prefix, kv, batching, decoding, quant, serving];

export function mountMicroscopes(listEl, navEl, ctx) {
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
