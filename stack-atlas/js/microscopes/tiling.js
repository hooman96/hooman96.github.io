/** Microscope 09 — memory coalescing and shared-memory tiling: global memory traffic and arithmetic intensity. */
import { html, canvas, svg, field, stat, fmt } from '/atlas-core/js/microscopes/util.js';

export const id = 'scope-tiling';
export const short = 'Coalescing & tiling';
export const title = 'Coalescing and shared-memory tiling';
export const description = 'A warp’s 32 loads become one transaction when the addresses are contiguous and many when they are strided. Tiling reuses each byte loaded from HBM many times from shared memory, which is what moves a GEMM from the bandwidth roof onto the compute roof. See the transactions and the traffic.';

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="scope-grid">
      <div>
        <div class="tabs" role="tablist" aria-label="Access pattern"><button type="button" role="tab" aria-selected="true" data-p="1">Contiguous (stride 1)</button><button type="button" role="tab" aria-selected="false" data-p="2">Stride 2</button><button type="button" role="tab" aria-selected="false" data-p="32">Column-wise (stride 32)</button><button type="button" role="tab" aria-selected="false" data-p="r">Random</button></div>
        <div id="co-vis"></div>
      </div>
      <div class="panel-desc" id="co-note"></div>
    </div>
    <h4 class="ctl-label" style="margin-top:1rem">Tiled GEMM traffic calculator</h4>
    <div class="scope-controls" id="ti-ctl"></div>
    <div class="stat-row" id="ti-stats"></div>
    <div class="note"><b>Reading it.</b> A naive kernel reloads a row of A and a column of B for every output element: 2·M·N·K element loads. With T×T output tiles staged through shared memory, each loaded element is reused T times, so global traffic falls by T and arithmetic intensity rises to about T/2 FLOP per byte in BF16 (before register blocking, which multiplies it again). Tensor-core GEMMs on Hopper use 128×256-class tiles with TMA feeding shared memory asynchronously; that is how they reach the compute roof.</div>
  `));
  const vis = root.querySelector('#co-vis'), note = root.querySelector('#co-note');
  const drawCo = p => {
    vis.innerHTML = ''; const s = canvas(460, 130, 'Warp access pattern');
    const cells = 64; const cw = 440 / cells; const addrs = [];
    for (let l = 0; l < 32; l++) addrs.push(p === 'r' ? Math.floor(Math.abs(Math.sin(l * 12.9898) * 43758.5453) % 1 * 512) : l * (+p));
    const maxA = Math.max(...addrs); const shown = Math.min(cells, maxA + 1);
    const segSize = 32 / 4; // 4-byte elements, 32-byte sectors → 8 elements per sector
    const sectors = new Set(addrs.map(a => Math.floor(a / segSize)));
    svg('text', { class: 'mut', x: 8, y: 14 }, s, `global memory (4-byte elements, 32-byte sectors) · ${addrs.length} lanes`);
    for (let i = 0; i < cells; i++) { const a = i * Math.ceil(shown / cells); const hit = addrs.includes(a) || (p === 'r' && addrs.some(x => Math.floor(x / (512 / cells)) === i)); svg('rect', { x: 10 + i * cw, y: 24, width: cw - 1, height: 22, rx: 1, fill: hit ? 'var(--atlas-gpu)' : 'var(--atlas-surface-elevated)', stroke: i % segSize === 0 ? 'var(--atlas-border-strong)' : 'none' }, s); }
    svg('text', { class: 'tiny mut', x: 10, y: 62 }, s, p === 'r' ? 'each lane touches a different sector' : `lanes touch elements 0, ${p}, ${2 * (+p)}, …`);
    const nS = p === 'r' ? 32 : sectors.size; const eff = 32 * 4 / (nS * 32);
    svg('text', { class: 'tiny', x: 10, y: 84 }, s, `${nS} sector${nS > 1 ? 's' : ''} fetched for 128 useful bytes → ${(eff * 100).toFixed(0)}% of moved bytes used`);
    for (let i = 0; i < Math.min(nS, 32); i++) svg('rect', { x: 10 + i * 13.5, y: 94, width: 12, height: 14, rx: 2, fill: i < 4 ? 'var(--atlas-ok)' : 'var(--atlas-bad)' }, s);
    svg('text', { class: 'tiny mut', x: 10, y: 124 }, s, 'green = minimum sectors for 128 bytes · red = wasted transactions');
    vis.appendChild(s);
    note.innerHTML = { '1': '<p><b>Coalesced.</b> 32 consecutive 4-byte loads fall in 4 sectors (one 128-byte line): one request, full efficiency. This is the pattern every element-wise kernel and the inner dimension of a well-laid-out matrix should have.</p>', '2': '<p><b>Stride 2.</b> The warp spans 256 bytes for 128 useful: twice the traffic. Structure-of-arrays layouts and vectorized loads fix this.</p>', '32': '<p><b>Column-wise access of a row-major matrix.</b> Every lane hits a different line: 32 sectors for 128 bytes, 12.5% efficiency. Transposing through shared memory or choosing the other loop order restores coalescing; this is the classic tiled-transpose lesson.</p>', 'r': '<p><b>Random gathers.</b> One sector per lane, no reuse; L2 hit rate decides the cost. Embedding lookups and sparse KV access look like this, which is why they are bandwidth-bound even at low FLOP counts.</p>' }[p];
  };
  root.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => { root.querySelectorAll('[data-p]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false')); drawCo(b.dataset.p); }));
  drawCo('1');
  const ctl = root.querySelector('#ti-ctl'), stats = root.querySelector('#ti-stats');
  const f = { m: field({ id: 'ti-m', label: 'M (rows / tokens)', value: 4096, min: 1, max: 1e6 }), n: field({ id: 'ti-n', label: 'N (output features)', value: 4096, min: 1, max: 1e6 }), k: field({ id: 'ti-k', label: 'K (input features)', value: 4096, min: 1, max: 1e6 }), t: field({ id: 'ti-t', label: 'Tile size T', type: 'select', value: '128', options: [['1', '1 (naive)'], ['16', '16'], ['32', '32'], ['64', '64'], ['128', '128'], ['256', '256']] }) };
  Object.values(f).forEach(x => { ctl.appendChild(x.el); x.input.addEventListener('input', calc); });
  function calc() {
    const M = +f.m.input.value, N = +f.n.input.value, K = +f.k.input.value, T = +f.t.input.value;
    const flops = 2 * M * N * K; const naive = 2 * M * N * K * 2; const tiled = (M * N * K * 2 / T) * 2 + M * N * 2; const I = flops / tiled;
    stats.innerHTML = stat('FLOPs', (flops / 1e12).toFixed(2) + ' TFLOP') + stat('naive global traffic', (naive / 1e12).toFixed(2) + ' TB') + stat(`tiled traffic (T=${T})`, (tiled / 1e9).toFixed(1) + ' GB') + stat('reuse factor', (naive / tiled).toFixed(0) + '×') + stat('arithmetic intensity', I.toFixed(0) + ' FLOP/B', I > 295 ? 'ok' : I > 50 ? 'warn' : 'bad') + stat('vs H100 ridge (≈295)', I > 295 ? 'compute-bound' : 'bandwidth-bound');
  }
  calc();
}
