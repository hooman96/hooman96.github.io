/** Microscope 07 — block-based prefix cache simulator. */
import { html, canvas, svg, field, stat, pct } from './util.js';

export const id = 'scope-prefix';
export const short = 'Prefix cache';
export const title = 'Prefix cache simulator';
export const description = 'A request is a chain of fixed-size KV blocks: system prompt, shared document, then new user content. Blocks whose hash chain matches an earlier request are reused; the rest need prefill. Prefix caching reduces repeated prefill work. It does not remove the autoregressive computation for new output tokens.';

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="scope-controls" id="pc-ctl"></div>
    <div id="pc-vis"></div>
    <div class="stat-row" id="pc-stats"></div>
    <div class="two">
      <div class="note"><b>KV caching vs prefix caching.</b> Every request keeps its own K/V for tokens already processed (per-request KV reuse inside the decode loop). Prefix caching is the cross-request layer on top: blocks computed for a previous compatible request are reused for this one, so only the suffix is prefilled. Both are needed; they solve different problems.</div>
      <div class="note"><b>Block identity (vLLM-style, conceptually).</b> <code>block_hash = H(parent_prefix_hash, block_tokens, extra_identity)</code>. Extra identity can include the LoRA adapter, multimodal input hashes and a cache salt for isolation, so two requests only share a block when their entire prefix and context are equivalent. Other engines (radix-tree caches, for example) use different structures; the key idea is the same.</div>
    </div>
    <div class="kv-list">
      <div><b>Only full blocks are cached</b><span>The last partial block of a prompt is prefilled fresh; alignment of shared prefixes to block boundaries matters.</span></div>
      <div><b>Eviction</b><span>Cached blocks with no active references are evicted LRU when new sequences need memory; hit rates fall under memory pressure.</span></div>
      <div><b>Routing for locality</b><span>Sending requests with the same prefix to the same replica raises hit rates; disaggregated or sharded fleets need prefix-aware routing.</span></div>
      <div><b>Decode is unchanged</b><span>Each new output token still costs one decode iteration reading weights and all cached K/V, hit or miss.</span></div>
    </div>
  `));
  const ctl = root.querySelector('#pc-ctl'), vis = root.querySelector('#pc-vis'), stats = root.querySelector('#pc-stats');
  const f = {
    total: field({ id: 'pc-total', label: 'Prompt blocks', type: 'range', value: 24, min: 4, max: 64, step: 1 }),
    sys: field({ id: 'pc-sys', label: 'System prompt blocks', type: 'range', value: 6, min: 0, max: 32, step: 1 }),
    doc: field({ id: 'pc-doc', label: 'Shared document blocks', type: 'range', value: 10, min: 0, max: 48, step: 1 }),
    cached: field({ id: 'pc-cached', label: 'Cached prefix blocks', type: 'range', value: 12, min: 0, max: 64, step: 1 }),
    cap: field({ id: 'pc-cap', label: 'Cache capacity (blocks)', type: 'range', value: 40, min: 4, max: 128, step: 1 }),
    bs: field({ id: 'pc-bs', label: 'Block size (tokens)', type: 'select', value: '16', options: [['16', '16'], ['32', '32'], ['64', '64']] }),
    out: field({ id: 'pc-out', label: 'Output tokens', value: 256, min: 1, max: 8192 }),
  };
  Object.values(f).forEach(x => { ctl.appendChild(x.el); x.input.addEventListener('input', update); });
  function update() {
    const total = +f.total.input.value, cap = +f.cap.input.value, bs = +f.bs.input.value, out = +f.out.input.value;
    const sys = Math.min(+f.sys.input.value, total), doc = Math.min(+f.doc.input.value, total - sys);
    const cachedWanted = +f.cached.input.value;
    const cached = Math.min(cachedWanted, total - 1, cap); // last block is always partial → prefill; capacity bounds hits
    const capacityLimited = cachedWanted > cap;
    vis.innerHTML = '';
    const W = 760, per = 32, rows = Math.ceil(total / per), H = 40 + rows * 30, s = canvas(W, H, 'Prompt blocks: reused versus prefilled');
    const bw = (W - 20) / per;
    for (let i = 0; i < total; i++) {
      const r = Math.floor(i / per), c = i % per, x = 10 + c * bw, y = 26 + r * 30;
      const hit = i < cached;
      const seg = i < sys ? 'S' : i < sys + doc ? 'D' : 'U';
      svg('rect', { class: 'tok ' + (hit ? 'done' : 'active'), x: x + 1, y, width: bw - 2, height: 20, rx: 2 }, s);
      svg('text', { class: 'tiny', x: x + bw / 2, y: y + 14, 'text-anchor': 'middle', style: 'font-size:8px' }, s, seg);
    }
    svg('text', { class: 'tiny mut', x: 10, y: 14 }, s, `S = system prompt · D = shared document · U = new user content · green = cache hit (reused) · blue = cache miss (prefill)`);
    vis.appendChild(s);
    const miss = total - cached, hitRatio = cached / total;
    stats.innerHTML = stat('prefix hit ratio', pct(hitRatio), hitRatio > .6 ? 'ok' : hitRatio > .3 ? 'warn' : '')
      + stat('blocks reused', String(cached)) + stat('blocks to prefill', String(miss)) + stat('prefill tokens saved', `${cached * bs} of ${total * bs}`)
      + stat('≈ prefill reduction', pct(hitRatio)) + stat('decode iterations', `${out} (unchanged)`, 'warn')
      + (capacityLimited ? stat('capacity limit', `hits capped at ${cap}`, 'bad') : '');
  }
  update();
}
