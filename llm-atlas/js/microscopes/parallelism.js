/** Microscope 05 — 8-GPU distributed parallelism explorer: DP, TP, PP, CP, EP, FSDP/ZeRO. */
import { html, canvas, svg } from './util.js';

export const id = 'scope-parallelism';
export const short = 'Parallelism';
export const title = 'Distributed parallelism explorer';
export const description = 'Eight GPUs, one model. Each strategy partitions a different dimension: batch (DP), tensors inside a layer (TP), depth (PP), sequence (CP), experts (EP), or parameter / gradient / optimizer state (FSDP / ZeRO). Large systems compose several of these rather than choosing one.';

const STRATS = {
  dp: { name: 'Data parallel (DP)', dim: 'batch dimension', lives: 'Full replica of all weights, gradients and optimizer state on every GPU; each GPU holds a different slice of the global batch.', comm: 'All-reduce of gradients once per step (ring: 2·(n−1)/n × gradient bytes per GPU).', why: 'Simplest way to use more accelerators; scales throughput with batch size.', bottleneck: 'Memory: the whole model must fit on one GPU. Gradient all-reduce bandwidth at large parameter counts.' },
  tp: { name: 'Tensor parallel (TP)', dim: 'individual layer / tensor dimension', lives: 'Each GPU holds a column or row slice of every weight matrix (Q/K/V/O, MLP up/gate/down); activations are full-width only at sync points.', comm: 'Two all-reduces per Transformer block in forward (and two in backward), every micro-step. Needs NVLink-class bandwidth; usually kept within a node.', why: 'Fits layers that are too large for one GPU and reduces per-GPU weight memory and latency.', bottleneck: 'Communication latency per layer; scaling past 8 GPUs crosses slow inter-node links.' },
  pp: { name: 'Pipeline parallel (PP)', dim: 'model depth (layers)', lives: 'Consecutive layer ranges (stages) on different GPUs; each stage holds only its layers\' weights and optimizer state.', comm: 'Point-to-point activation sends between adjacent stages per micro-batch; small volume, but sequential.', why: 'Splits depth across nodes cheaply in bandwidth; composes with TP inside a node.', bottleneck: 'Pipeline bubble ≈ (p−1)/m of step time with p stages and m micro-batches; mitigated by 1F1B, interleaved and zero-bubble schedules.' },
  cp: { name: 'Context parallel (CP)', dim: 'sequence / context dimension', lives: 'Each GPU holds a chunk of the sequence for every layer plus full weights (or sharded via FSDP); attention needs K/V from all chunks.', comm: 'Ring exchange of K/V blocks between GPUs during attention (ring attention); all-gather-free for MLPs.', why: 'Makes very long contexts fit by dividing activation and KV memory across GPUs.', bottleneck: 'Causal load imbalance across chunks (fixed by zig-zag ordering); K/V exchange bandwidth.' },
  ep: { name: 'Expert parallel (EP)', dim: 'expert dimension (MoE layers)', lives: 'Each GPU hosts a subset of experts; attention and dense layers are replicated or sharded by other strategies.', comm: 'All-to-all dispatch and all-to-all combine per MoE layer, forward and backward (four all-to-alls per layer per step).', why: 'Lets total parameters grow with experts without growing per-GPU memory or per-token compute.', bottleneck: 'All-to-all across nodes and load imbalance: the most loaded expert bounds the step.' },
  fsdp: { name: 'FSDP / ZeRO', dim: 'parameter, gradient and optimizer state', lives: 'Each GPU holds 1/n of parameters, gradients and optimizer state (ZeRO-3 / FSDP); full weights exist only transiently per layer during compute.', comm: 'All-gather parameters before each layer\'s forward and backward, reduce-scatter gradients after backward; ~1.5× the bytes of plain DP all-reduce.', why: 'Removes the replica memory ceiling of DP: memory per GPU ≈ 16 bytes × params / n plus activations.', bottleneck: 'Communication is on the critical path unless prefetch overlaps it; small layers underutilise bandwidth.' },
};

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="tabs" role="tablist" aria-label="Parallelism strategy">${Object.entries(STRATS).map(([k, s], i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-s="${k}">${k.toUpperCase()}</button>`).join('')}</div>
    <div class="scope-grid">
      <div id="par-vis"></div>
      <div class="panel-desc" id="par-note" aria-live="polite"></div>
    </div>
    <div class="note"><b>Legend.</b> P = parameters, G = gradients, m and v = AdamW moments; coloured cells are what this GPU stores, dashed lines are collectives. <b>Composition.</b> A common recipe (illustrative): TP across the 8 GPUs of a node, PP across a handful of nodes, FSDP or DP across the remaining nodes, EP for MoE layers and CP only when sequences are long enough to need it. The product of the degrees equals the GPU count.</div>
  `));
  const vis = root.querySelector('#par-vis'), note = root.querySelector('#par-note');
  function draw(k) {
    vis.innerHTML = '';
    const W = 480, H = 260, s = canvas(W, H, `${STRATS[k].name} across 8 GPUs`);
    const cols = 4, gw = 100, gh = 100, gx = 12, gy = 24;
    for (let g = 0; g < 8; g++) {
      const x = gx + (g % cols) * (gw + 14), y = gy + Math.floor(g / cols) * (gh + 24);
      svg('rect', { class: 'gpu', x, y, width: gw, height: gh, rx: 5 }, s);
      svg('text', { class: 'tiny mut', x: x + 6, y: y + 12 }, s, 'GPU ' + g);
      const inner = { x: x + 6, y: y + 18, w: gw - 12, h: gh - 26 };
      drawContents(s, k, g, inner);
    }
    // comm lines
    const centers = [...Array(8)].map((_, g) => ({ x: gx + (g % cols) * (gw + 14) + gw / 2, y: gy + Math.floor(g / cols) * (gh + 24) + gh }));
    if (k === 'dp' || k === 'fsdp' || k === 'ep' || k === 'cp') { const yb = gy + gh + 12; centers.forEach((c, g) => { const yTop = g < 4 ? gy + gh : gy + gh + 24; svg('path', { class: 'comm', d: `M${c.x} ${yTop} V${yb}` }, s); }); svg('line', { class: 'comm', x1: centers[0].x, y1: yb, x2: centers[3].x, y2: yb }, s); svg('text', { class: 'tiny', x: W / 2, y: 256, 'text-anchor': 'middle', fill: 'var(--atlas-accent)' }, s, k === 'dp' ? 'all-reduce gradients' : k === 'fsdp' ? 'all-gather params · reduce-scatter grads' : k === 'ep' ? 'all-to-all tokens ↔ experts' : 'ring K/V exchange'); }
    if (k === 'tp') { for (let r = 0; r < 2; r++) { const y = gy + r * (gh + 24) + gh / 2; svg('line', { class: 'comm', x1: gx + gw, y1: y, x2: gx + 3 * (gw + 14), y2: y }, s); } svg('text', { class: 'tiny', x: W / 2, y: 256, 'text-anchor': 'middle', fill: 'var(--atlas-accent)' }, s, 'all-reduce activations twice per block (NVLink)'); }
    if (k === 'pp') { for (let g = 0; g < 7; g++) { const a = { x: gx + (g % cols) * (gw + 14) + gw, y: gy + Math.floor(g / cols) * (gh + 24) + gh / 2 }; if (g % cols === 3) svg('path', { class: 'comm', d: `M${a.x - gw / 2} ${a.y + gh / 2} V${a.y + gh / 2 + 12} H${gx + gw / 2} V${a.y + gh / 2 + 24}` }, s); else svg('path', { class: 'arrow on', d: `M${a.x} ${a.y} H${a.x + 12}` }, s); } svg('text', { class: 'tiny', x: W / 2, y: 256, 'text-anchor': 'middle', fill: 'var(--atlas-accent)' }, s, 'point-to-point activations between stages'); }
    vis.appendChild(s);
    const S = STRATS[k];
    note.innerHTML = `<p><b>${S.name}</b> · partitions the <b>${S.dim}</b>.</p><p><b>What lives on each GPU.</b> ${S.lives}</p><p><b>Communication.</b> ${S.comm}</p><p><b>Why.</b> ${S.why}</p><p><b>Common bottleneck.</b> ${S.bottleneck}</p>`;
  }
  function drawContents(s, k, g, r) {
    const layers = 4; const lh = (r.h - 6) / layers;
    const cell = (i, x, w, cls, label) => { svg('rect', { class: 'shard ' + cls, x, y: r.y + i * lh, width: w, height: lh - 2, rx: 2 }, s); if (label) svg('text', { class: 'tiny', x: x + w / 2, y: r.y + i * lh + lh / 2 + 3, 'text-anchor': 'middle', style: 'font-size:7.5px' }, s, label); };
    const full = 'fill:var(--atlas-training)';
    const part = 'fill:color-mix(in srgb,var(--atlas-training) 55%,var(--atlas-surface))';
    for (let i = 0; i < layers; i++) {
      if (k === 'dp') cell(i, r.x, r.w, '', i === 0 ? `L${i} · batch ${g}` : `L${i}`), s.lastChild.previousSibling.style = full;
      else if (k === 'tp') { const w = r.w / 8; cell(i, r.x + g * w, w, ''); s.lastChild.style = full; svg('rect', { x: r.x, y: r.y + i * lh, width: r.w, height: lh - 2, rx: 2, fill: 'none', stroke: 'var(--atlas-border)' }, s); }
      else if (k === 'pp') { const stage = Math.floor(g / 2); const mine = Math.floor(i / 2) === Math.floor(stage / 2); cell(i, r.x, r.w, '', mine ? `L${i} stage ${stage}` : ''); s.lastChild.previousSibling.style = mine ? full : 'fill:var(--atlas-surface);stroke:var(--atlas-border)'; }
      else if (k === 'cp') { cell(i, r.x, r.w, '', `L${i} · seq chunk ${g}`); s.lastChild.previousSibling.style = part; }
      else if (k === 'ep') { const moe = i % 2 === 1; cell(i, r.x, r.w, '', moe ? `experts ${g * 8}–${g * 8 + 7}` : `attn L${i} (replica)`); s.lastChild.previousSibling.style = moe ? 'fill:var(--atlas-moe)' : part; }
      else if (k === 'fsdp') { const w = r.w / 8; for (let j = 0; j < 8; j++) { svg('rect', { class: 'shard', x: r.x + j * w, y: r.y + i * lh, width: w, height: lh - 2, rx: 1, style: j === g ? full : 'fill:var(--atlas-surface);stroke:var(--atlas-border)' }, s); } }
    }
    if (k === 'dp') svg('text', { class: 'tiny mut', x: r.x + 2, y: r.y + r.h + 4, style: 'font-size:7px' }, s, 'full weights + m, v');
    if (k === 'fsdp') svg('text', { class: 'tiny mut', x: r.x + 2, y: r.y + r.h + 4, style: 'font-size:7px' }, s, `shard ${g}/8 of P, G, m, v`);
    if (k === 'tp') svg('text', { class: 'tiny mut', x: r.x + 2, y: r.y + r.h + 4, style: 'font-size:7px' }, s, `slice ${g}/8 of every matrix`);
  }
  root.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { root.querySelectorAll('[data-s]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false')); draw(b.dataset.s); }));
  draw('dp');
}
