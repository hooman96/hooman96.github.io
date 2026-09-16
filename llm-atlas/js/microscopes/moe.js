/** Microscope 03 — MoE router simulator: 8 experts, a small batch, top-2 routing, load per expert, imbalance. */
import { html, canvas, svg, rng, stat, flowStrip } from './util.js';

export const id = 'scope-moe';
export const short = 'MoE router';
export const title = 'MoE router simulator';
export const description = 'Route a batch of tokens through a softmax router to the top-2 of 8 experts and watch the load per expert. Skewed router logits produce hot experts and dropped tokens under a capacity limit; balancing strategies push the distribution back toward uniform.';

const PATH = ['token hidden state', 'router', 'expert scores', 'top-k experts', 'token permutation', 'all-to-all dispatch', 'expert GEMMs', 'all-to-all return', 'weighted combine', 'original token order'];

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div id="moe-path"></div>
    <div class="scope-controls">
      <div class="field range"><label for="moe-tokens">Tokens in batch<output for="moe-tokens">32</output></label><input type="range" id="moe-tokens" min="8" max="64" step="8" value="32"></div>
      <div class="field range"><label for="moe-skew">Router skew<output for="moe-skew">0.6</output></label><input type="range" id="moe-skew" min="0" max="2" step="0.1" value="0.6"></div>
      <div class="field range"><label for="moe-cap">Capacity factor<output for="moe-cap">1.25</output></label><input type="range" id="moe-cap" min="1" max="2.5" step="0.25" value="1.25"></div>
      <div class="field"><label for="moe-bal">Balancing</label><select id="moe-bal"><option value="none">None</option><option value="aux">Auxiliary loss (trained)</option><option value="bias">Bias adjustment (aux-loss-free)</option></select></div>
      <button type="button" class="btn primary" id="moe-route">Route new batch</button>
    </div>
    <div class="scope-grid">
      <div id="moe-vis"></div>
      <div>
        <div class="stat-row" id="moe-stats"></div>
        <div class="panel-desc" style="margin-top:.9rem">
          <p><b>Total vs activated parameters.</b> With E experts and top-k routing, a token touches k expert FFNs, so per-token compute scales with k while parameter capacity scales with E. Examples, clearly as examples: Mixtral 8×7B routes each token to 2 of 8 experts per MoE layer; DeepSeek-V3 is published as a 671B-parameter MoE with roughly 37B parameters activated per token. Architectures differ in E, k, shared experts and router type.</p>
          <p><b>Capacity.</b> With expert parallelism each expert has a fixed buffer of <code>capacity = capacity_factor × tokens × k / E</code> per batch. Tokens beyond it are dropped (residual passes through) or overflow to a secondary path, depending on the implementation. Dropless variants use grouped GEMMs over variable-size slabs instead.</p>
        </div>
      </div>
    </div>
    <div class="kv-list">
      <div><b>Router precision</b><span>Router logits are commonly kept in FP32 so small score differences do not flip top-k selections under BF16 noise.</span></div>
      <div><b>Shared experts</b><span>Always-active experts run alongside routed ones (DeepSeek-V3 uses one shared expert), capturing common knowledge so routed experts specialise.</span></div>
      <div><b>Grouped GEMM</b><span>After permutation each expert owns a contiguous token slab; one grouped GEMM launch computes all experts' matmuls without padding to equal sizes.</span></div>
      <div><b>Auxiliary balancing loss</b><span>Adds <code>α · E · Σ_e f_e · P_e</code> (fraction routed × mean probability) to the objective, penalising concentration; too large a weight hurts quality.</span></div>
      <div><b>Aux-loss-free balancing</b><span>Per-expert bias terms added to routing scores (not to the combine weights) are nudged up for under-loaded and down for over-loaded experts each step.</span></div>
      <div><b>Expert parallelism vs tensor parallelism</b><span>EP places whole experts on different devices and moves tokens with all-to-all; TP slices every matrix and all-reduces activations. They compose.</span></div>
      <div><b>Placement and hot replication</b><span>Popular experts can be replicated on several devices and co-located with correlated experts so cross-node all-to-all traffic shrinks.</span></div>
      <div><b>All-to-all overlap</b><span>Dispatch/combine communication is overlapped with the shared expert or with another micro-batch's compute; otherwise it dominates at scale.</span></div>
    </div>
  `));

  root.querySelector('#moe-path').appendChild(flowStrip(PATH, 'sub-moe', 'MoE execution path'));

  const E = 8; let seed = 7;
  const $ = s => root.querySelector(s);
  const vis = $('#moe-vis'), stats = $('#moe-stats');
  let bias = new Array(E).fill(0);
  function route() {
    const T = +$('#moe-tokens').value, skew = +$('#moe-skew').value, cf = +$('#moe-cap').value, bal = $('#moe-bal').value;
    const r = rng(seed);
    // expert "popularity" prior: skewed base logits
    const base = Array.from({ length: E }, (_, e) => -skew * e * 0.6);
    if (bal === 'aux') for (let e = 0; e < E; e++) base[e] *= 0.35; // trained balance: flatter prior
    const load = new Array(E).fill(0), kept = new Array(E).fill(0);
    const cap = Math.max(1, Math.round(cf * T * 2 / E));
    const tokens = [];
    for (let t = 0; t < T; t++) {
      const logits = base.map((b, e) => b + (r() - 0.5) * 2.2 + (bal === 'bias' ? bias[e] : 0));
      const m = Math.max(...logits); const ex = logits.map(l => Math.exp(l - m)); const Z = ex.reduce((a, b) => a + b, 0);
      const probs = ex.map(x => x / Z);
      const order = [...probs.keys()].sort((a, b) => probs[b] - probs[a]).slice(0, 2);
      const wsum = probs[order[0]] + probs[order[1]];
      const picks = order.map(e => { load[e]++; const ok = load[e] <= cap; if (ok) kept[e]++; return { e, w: probs[e] / wsum, dropped: !ok }; });
      tokens.push(picks);
    }
    if (bal === 'bias') { const mean = T * 2 / E; for (let e = 0; e < E; e++) bias[e] += (load[e] > mean ? -0.15 : 0.15); }
    else bias = new Array(E).fill(0);
    draw(T, load, kept, cap, tokens);
  }
  function draw(T, load, kept, cap, tokens) {
    vis.innerHTML = '';
    const W = 460, H = 250, s = canvas(W, H, 'Load per expert');
    const maxL = Math.max(cap, ...load) * 1.15, bw = 44;
    svg('line', { class: 'axis', x1: 40, y1: 200, x2: W - 10, y2: 200 }, s);
    const capY = 200 - (cap / maxL) * 170;
    svg('line', { x1: 40, y1: capY, x2: W - 10, y2: capY, stroke: 'var(--atlas-warn)', 'stroke-dasharray': '4 3' }, s);
    svg('text', { class: 'tiny', x: W - 12, y: capY - 4, 'text-anchor': 'end', fill: 'var(--atlas-warn)' }, s, `capacity ${cap}`);
    load.forEach((l, e) => {
      const x = 48 + e * 52, h = (l / maxL) * 170, hk = (kept[e] / maxL) * 170;
      svg('rect', { class: 'bar sub-moe', x, y: 200 - hk, width: bw, height: hk, style: 'fill:var(--atlas-moe)' }, s);
      if (l > kept[e]) svg('rect', { x, y: 200 - h, width: bw, height: h - hk, style: 'fill:var(--atlas-bad);opacity:.8' }, s);
      svg('text', { class: 'tiny', x: x + bw / 2, y: 214, 'text-anchor': 'middle' }, s, 'E' + e);
      svg('text', { class: 'tiny', x: x + bw / 2, y: 196 - h, 'text-anchor': 'middle' }, s, String(l));
    });
    svg('text', { class: 'mut tiny', x: 40, y: 236 }, s, `${T} tokens × top-2 = ${T * 2} assignments · ideal ${(T * 2 / E).toFixed(1)} per expert · red = dropped beyond capacity`);
    vis.appendChild(s);
    const mean = T * 2 / E, maxLoad = Math.max(...load), dropped = load.reduce((a, l) => a + Math.max(0, l - cap), 0);
    const cv = Math.sqrt(load.reduce((a, l) => a + (l - mean) ** 2, 0) / E) / mean;
    stats.innerHTML = stat('hottest expert', `${maxLoad} / ${mean.toFixed(1)}`, maxLoad > mean * 1.5 ? 'bad' : maxLoad > mean * 1.2 ? 'warn' : 'ok')
      + stat('load imbalance (CV)', cv.toFixed(2), cv > .5 ? 'bad' : cv > .25 ? 'warn' : 'ok')
      + stat('dropped assignments', String(dropped), dropped ? 'bad' : 'ok')
      + stat('active params / token', '2 of 8 experts', '');
  }
  $('#moe-route').addEventListener('click', () => { seed += 1; route(); });
  ['#moe-tokens', '#moe-skew', '#moe-cap', '#moe-bal'].forEach(q => $(q).addEventListener('input', route));
  route();
}
