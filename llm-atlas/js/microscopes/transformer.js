/** Microscope 02 — one decoder block (Dense vs MoE), attention head layouts, FlashAttention IO diagram. */
import { html, canvas, svg } from './util.js';

export const id = 'scope-transformer';
export const short = 'Decoder block';
export const title = 'Transformer block explorer';
export const description = 'One pre-norm decoder block of a conventional decoder-only Transformer. Toggle the MLP between a dense SwiGLU and an MoE router + experts, compare MHA / GQA / MQA head layouts, and see why FlashAttention is an IO optimisation rather than a different attention.';

const DENSE = ['x (residual stream)', 'RMSNorm', 'Q / K / V projections', 'RoPE on Q, K', 'Causal attention', 'Output projection W_o', 'Residual add', 'RMSNorm', 'Dense SwiGLU MLP', 'Residual add', 'next layer'];
const MOE = ['x (residual stream)', 'RMSNorm', 'Q / K / V projections', 'RoPE on Q, K', 'Causal attention', 'Output projection W_o', 'Residual add', 'RMSNorm', 'MoE router → top-k experts → combine', 'Residual add', 'next layer'];
const NOTES = {
  'x (residual stream)': 'Shape [T, d_model]. Every sublayer reads it and adds back into it.',
  'RMSNorm': 'x · rsqrt(mean(x²) + ε) · g. Pre-norm keeps the residual path unnormalised.',
  'Q / K / V projections': 'Q: [d_model, n_heads·d_head]; K, V: [d_model, n_kv_heads·d_head]. Fewer KV heads → smaller KV cache.',
  'RoPE on Q, K': 'Rotates pairs of dimensions by position-dependent angles so QKᵀ depends on relative offset.',
  'Causal attention': 'softmax(QKᵀ/√d_head + mask)·V per head; scores are [n_heads, T, T] if materialised. FlashAttention tiles this.',
  'Output projection W_o': '[n_heads·d_head, d_model]. Mixes heads back into the residual width.',
  'Residual add': 'x ← x + sublayer(x). Gradients and information flow along this path.',
  'Dense SwiGLU MLP': 'down(silu(gate(x)) ⊙ up(x)); hidden ≈ 8/3·d_model rounded. Every token uses every MLP weight.',
  'MoE router → top-k experts → combine': 'router [d_model, E] → scores → top-k → dispatch → expert FFNs → weighted sum. Each token uses k of E experts.',
  'next layer': 'Repeat L times, then final RMSNorm → LM head → logits [T, vocab].',
};

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="scope-grid">
      <div>
        <div class="tabs" role="tablist" aria-label="MLP variant">
          <button type="button" role="tab" aria-selected="true" data-v="dense">Dense</button>
          <button type="button" role="tab" aria-selected="false" data-v="moe">MoE</button>
        </div>
        <div id="blk"></div>
      </div>
      <div class="panel-desc" id="blk-note" aria-live="polite"></div>
    </div>
    <div class="scope-grid">
      <div>
        <div class="tabs" role="tablist" aria-label="Attention head layout">
          <button type="button" role="tab" aria-selected="true" data-h="mha">MHA</button>
          <button type="button" role="tab" aria-selected="false" data-h="gqa">GQA</button>
          <button type="button" role="tab" aria-selected="false" data-h="mqa">MQA</button>
        </div>
        <div id="heads"></div>
      </div>
      <div class="panel-desc" id="heads-note"></div>
    </div>
    <div class="scope-grid">
      <div id="flash"></div>
      <div class="panel-desc">
        <p><b>FlashAttention is exact attention.</b> It computes the same softmax(QKᵀ/√d)V, but never materialises the [T, T] score matrix in HBM. Q, K, V are processed in tiles that fit on-chip (SRAM / registers), using an online softmax with a running max and normaliser, and only the [T, d_head] output is written back.</p>
        <p>The win is memory traffic, not FLOPs: naive attention reads and writes O(T²) intermediates through HBM; the tiled kernel keeps them on-chip, so practical throughput improves and memory scales linearly in T. The backward pass recomputes tiles instead of storing the score matrix.</p>
      </div>
    </div>
  `));

  // ---- block diagram ----
  const blk = root.querySelector('#blk'), note = root.querySelector('#blk-note');
  let variant = 'dense', sel = 4;
  const drawBlock = () => {
    const steps = variant === 'dense' ? DENSE : MOE;
    blk.innerHTML = '';
    const rowH = 30, W = 420, H = steps.length * rowH + 16;
    const s = canvas(W, H, 'Decoder block diagram');
    steps.forEach((t, i) => {
      const y = 8 + i * rowH;
      const g = svg('g', { class: 'blk-row', tabindex: 0, role: 'button', 'aria-label': t, 'aria-pressed': i === sel ? 'true' : 'false', style: 'cursor:pointer' }, s);
      const isMlp = i === 8;
      svg('rect', { class: 'box' + (i === sel ? ' on' : '') + (isMlp ? ' ' + (variant === 'dense' ? 'sub-model' : 'sub-moe') : ''), x: 120, y, width: 220, height: 22, rx: 4 }, g);
      svg('text', { x: 230, y: y + 15, 'text-anchor': 'middle' }, g, t);
      if (i < steps.length - 1) svg('path', { class: 'arrow', d: `M230 ${y + 22} L230 ${y + rowH - 1}` }, s);
      // residual skip lines
      if (i === 0) svg('path', { class: 'arrow', d: `M340 ${y + 11} H380 V${8 + 6 * rowH + 11} H340` }, s);
      if (i === 6) svg('path', { class: 'arrow', d: `M340 ${y + 11} H380 V${8 + 9 * rowH + 11} H340` }, s);
      const pick = () => { sel = i; drawBlock(); };
      g.addEventListener('click', pick); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    svg('text', { class: 'mut tiny', x: 384, y: 8 + 3 * rowH, 'text-anchor': 'start' }, s, 'skip');
    svg('text', { class: 'mut tiny', x: 384, y: 8 + 8 * rowH, 'text-anchor': 'start' }, s, 'skip');
    blk.appendChild(s);
    const t = steps[sel];
    note.innerHTML = `<p><b>${t}</b></p><p>${NOTES[t]}</p>` + (sel === 8 ? (variant === 'dense'
      ? '<p>Dense: parameters used per token = all MLP weights. Compute per token ≈ 2 × params (FLOPs).</p>'
      : '<p>MoE: total parameters grow with the number of experts E, but per-token compute only grows with k. Example: Mixtral 8×7B has 8 experts per layer and routes each token to 2. The router adds a small matmul and a communication step under expert parallelism.</p>') : '');
  };
  root.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { variant = b.dataset.v; root.querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false')); drawBlock(); }));
  drawBlock();

  // ---- heads ----
  const heads = root.querySelector('#heads'), hnote = root.querySelector('#heads-note');
  const HEADS = {
    mha: { kv: 8, text: '<p><b>Multi-head attention.</b> One K/V head per query head. With 8 query heads there are 8 KV heads; the KV cache stores all of them for every layer and position.</p>' },
    gqa: { kv: 2, text: '<p><b>Grouped-query attention.</b> Query heads are grouped and each group shares one KV head. 8 query heads over 2 KV heads cut KV-cache bytes by 4× at this layer with a small quality cost. Llama 3 uses GQA with 8 KV heads (example).</p>' },
    mqa: { kv: 1, text: '<p><b>Multi-query attention.</b> All query heads share a single KV head: the smallest possible KV cache for conventional attention, at some quality cost.</p>' },
  };
  const drawHeads = h => {
    heads.innerHTML = '';
    const q = 8, kv = HEADS[h].kv, W = 420, H = 150;
    const s = canvas(W, H, `${h.toUpperCase()} head layout`);
    svg('text', { class: 'mut', x: 10, y: 22 }, s, `${q} query heads`);
    svg('text', { class: 'mut', x: 10, y: 118 }, s, `${kv} KV head${kv > 1 ? 's' : ''}  → KV bytes ∝ ${kv}`);
    for (let i = 0; i < q; i++) { const x = 10 + i * 50; svg('rect', { class: 'box sub-model', x, y: 30, width: 40, height: 22, rx: 3 }, s); svg('text', { class: 'tiny', x: x + 20, y: 45, 'text-anchor': 'middle' }, s, 'Q' + i); }
    const kvw = 40, gap = (W - 20 - kv * kvw) / Math.max(1, kv - 1);
    for (let j = 0; j < kv; j++) { const x = kv === 1 ? W / 2 - 20 : 10 + j * (kvw + gap); svg('rect', { class: 'box sub-runtime', x, y: 86, width: kvw, height: 22, rx: 3 }, s); svg('text', { class: 'tiny', x: x + 20, y: 101, 'text-anchor': 'middle' }, s, 'KV' + j); }
    for (let i = 0; i < q; i++) { const j = Math.floor(i / (q / kv)); const x1 = 30 + i * 50; const x2 = kv === 1 ? W / 2 : 30 + j * (kvw + gap); svg('path', { class: 'comm', d: `M${x1} 52 L${x2} 86` }, s); }
    heads.appendChild(s); hnote.innerHTML = HEADS[h].text + '<p>Why it matters in serving: KV bytes per token = 2 × layers × KV_heads × head_dim × bytes. Fewer KV heads mean more concurrent sequences fit in the same GPU memory and less KV is read per decode step.</p>';
  };
  root.querySelectorAll('[data-h]').forEach(b => b.addEventListener('click', () => { root.querySelectorAll('[data-h]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false')); drawHeads(b.dataset.h); }));
  drawHeads('mha');

  // ---- flash ----
  const flash = root.querySelector('#flash');
  const s = canvas(420, 200, 'Naive attention versus tiled FlashAttention memory traffic');
  svg('text', { class: 'mut', x: 10, y: 18 }, s, 'Naive');
  svg('rect', { class: 'box', x: 10, y: 28, width: 80, height: 60, rx: 4 }, s); svg('text', { x: 50, y: 62, 'text-anchor': 'middle' }, s, 'HBM');
  svg('rect', { class: 'box bad', x: 160, y: 28, width: 120, height: 60, rx: 4 }, s); svg('text', { class: 'tiny', x: 220, y: 54, 'text-anchor': 'middle' }, s, 'S = QKᵀ  [T×T]'); svg('text', { class: 'tiny', x: 220, y: 70, 'text-anchor': 'middle' }, s, 'P = softmax(S) [T×T]');
  svg('rect', { class: 'box', x: 330, y: 28, width: 80, height: 60, rx: 4 }, s); svg('text', { x: 370, y: 62, 'text-anchor': 'middle' }, s, 'HBM');
  svg('path', { class: 'arrow', d: 'M90 50 H158' }, s); svg('path', { class: 'arrow', d: 'M158 70 H92' }, s); svg('path', { class: 'arrow', d: 'M280 50 H328' }, s); svg('path', { class: 'arrow', d: 'M328 70 H282' }, s);
  svg('text', { class: 'tiny mut', x: 210, y: 104, 'text-anchor': 'middle' }, s, 'O(T²) intermediates written and re-read');
  svg('text', { class: 'mut', x: 10, y: 130 }, s, 'FlashAttention (tiled, exact)');
  svg('rect', { class: 'box', x: 10, y: 140, width: 80, height: 50, rx: 4 }, s); svg('text', { x: 50, y: 169, 'text-anchor': 'middle' }, s, 'HBM');
  svg('rect', { class: 'box ok', x: 160, y: 140, width: 120, height: 50, rx: 4 }, s); svg('text', { class: 'tiny', x: 220, y: 160, 'text-anchor': 'middle' }, s, 'SRAM tile: Q_i, K_j, V_j'); svg('text', { class: 'tiny', x: 220, y: 176, 'text-anchor': 'middle' }, s, 'online softmax, running max');
  svg('rect', { class: 'box', x: 330, y: 140, width: 80, height: 50, rx: 4 }, s); svg('text', { x: 370, y: 169, 'text-anchor': 'middle' }, s, 'O [T×d]');
  svg('path', { class: 'arrow on', d: 'M90 165 H158' }, s); svg('path', { class: 'arrow on', d: 'M280 165 H328' }, s);
  flash.appendChild(s);
}
