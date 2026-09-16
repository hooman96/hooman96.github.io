/** Microscope 10 — decoding policies from one logits vector, and a speculative-decoding acceptance visualizer. */
import { html, canvas, svg, field, stat, rng, pct } from './util.js';

export const id = 'scope-decoding';
export const short = 'Decoding · speculative';
export const title = 'Generation decoding policies and speculative decoding';
export const description = 'Decoding policies act on the LM head’s logits and change output behaviour without changing weights. Speculative decoding lets a cheap draft propose several tokens that the target model verifies in one pass; the speedup depends on draft cost, candidate length and acceptance rate.';

const VOCAB = ['the', 'a', 'model', 'cache', 'token', 'GPU', 'batch', 'fast', 'prefix', 'layer', 'weights', 'memory'];

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="scope-grid">
      <div>
        <div class="scope-controls" style="margin-bottom:.6rem">
          <div class="field range"><label for="dc-temp">Temperature<output for="dc-temp">1.0</output></label><input type="range" id="dc-temp" min="0" max="2" step="0.05" value="1"></div>
          <div class="field range"><label for="dc-topk">Top-k<output for="dc-topk">12</output></label><input type="range" id="dc-topk" min="1" max="12" step="1" value="12"></div>
          <div class="field range"><label for="dc-topp">Top-p<output for="dc-topp">1.0</output></label><input type="range" id="dc-topp" min="0.05" max="1" step="0.05" value="1"></div>
          <div class="field"><label for="dc-gram">Constraint</label><select id="dc-gram"><option value="none">none</option><option value="noun">grammar: nouns only</option></select></div>
        </div>
        <div id="dc-vis"></div>
      </div>
      <div class="kv-list">
        <div><b>Greedy</b><span>argmax of the logits at every step. Deterministic, prone to repetition loops.</span></div>
        <div><b>Sampling</b><span>Divide logits by temperature, keep top-k / nucleus (top-p) mass, apply repetition / presence / frequency penalties, then sample.</span></div>
        <div><b>Beam search</b><span>Keep B partial sequences ranked by cumulative log-probability; better for short, exact outputs, needs B× KV state.</span></div>
        <div><b>Structured generation</b><span>Mask tokens that would violate a grammar, regex or JSON schema before sampling; the FSM advances with each accepted token.</span></div>
        <div><b>Assisted / speculative</b><span>Propose k tokens cheaply, verify with the target in one forward, accept the matching prefix. Output distribution unchanged when done with rejection sampling.</span></div>
      </div>
    </div>
    <div>
      <h4 class="ctl-label">Speculative decoding</h4>
      <div class="scope-controls" style="margin-bottom:.6rem" id="sp-ctl"><button type="button" class="btn primary" id="sp-run">Draft + verify</button></div>
      <div id="sp-vis"></div>
      <div class="stat-row" id="sp-stats"></div>
      <div class="kv-list">
        <div><b>Assistant model</b><span>A small model with the same tokenizer drafts k tokens autoregressively; cheapest when it is much smaller than the target.</span></div>
        <div><b>Prompt lookup</b><span>Drafts come from n-gram matches inside the prompt; free to produce, strong on copy-heavy tasks (editing, RAG).</span></div>
        <div><b>Multi-token prediction heads</b><span>Extra heads on the target's own hidden state predict tokens t+2… (Medusa-style, or MTP modules trained with the model as in DeepSeek-V3); no separate model.</span></div>
        <div><b>EAGLE-like</b><span>A light autoregressive head drafts at the feature level from the target's last hidden state, improving acceptance over independent heads.</span></div>
        <div><b>When it helps</b><span>Low batch sizes where decode is bandwidth-bound and target FLOPs are spare. At high batch occupancy the verification pass competes for compute and gains shrink.</span></div>
      </div>
    </div>
  `));

  // ---- policies ----
  const base = [3.1, 2.7, 2.4, 2.2, 1.9, 1.6, 1.3, 1.1, 0.8, 0.5, 0.2, -0.1];
  const NOUN = new Set(['model', 'cache', 'token', 'GPU', 'batch', 'prefix', 'layer', 'weights', 'memory']);
  const $ = q => root.querySelector(q);
  const dvis = $('#dc-vis');
  function drawPolicies() {
    const T = +$('#dc-temp').value, k = +$('#dc-topk').value, p = +$('#dc-topp').value, gram = $('#dc-gram').value;
    let logits = base.map((l, i) => (gram === 'noun' && !NOUN.has(VOCAB[i]) ? -Infinity : l));
    const temp = Math.max(T, 1e-3);
    const scaled = logits.map(l => l / temp);
    const m = Math.max(...scaled); const ex = scaled.map(l => Math.exp(l - m)); const Z = ex.reduce((a, b) => a + b, 0); const probs = ex.map(x => x / Z);
    const order = [...probs.keys()].sort((a, b) => probs[b] - probs[a]);
    const keep = new Set(); let mass = 0;
    order.forEach((i, rank) => { if (rank < k && (mass < p || rank === 0) && probs[i] > 0) { keep.add(i); mass += probs[i]; } });
    const kept = [...keep]; const Zk = kept.reduce((a, i) => a + probs[i], 0);
    dvis.innerHTML = '';
    const W = 460, H = 210, s = canvas(W, H, 'Next-token distribution after decoding policy');
    const bw = 34;
    VOCAB.forEach((w, i) => {
      const x = 12 + i * (bw + 3), pr = keep.has(i) ? probs[i] / Zk : 0, h = pr * 150;
      if (probs[i] > 0 && !keep.has(i)) svg('rect', { class: 'idle', x, y: 170 - probs[i] * 150, width: bw, height: probs[i] * 150, rx: 2, style: 'opacity:.6' }, s);
      if (h > 0) svg('rect', { class: 'bar', x, y: 170 - h, width: bw, height: h, rx: 2, style: i === order[0] ? 'fill:var(--atlas-accent)' : '' }, s);
      if (probs[i] === 0) svg('text', { class: 'tiny', x: x + bw / 2, y: 165, 'text-anchor': 'middle', fill: 'var(--atlas-bad)' }, s, '✕');
      const tx = svg('text', { class: 'tiny', x: x + bw / 2, y: 184, 'text-anchor': 'middle' }, s, w); tx.style.fontSize = '8px';
      if (h > 12) svg('text', { class: 'tiny', x: x + bw / 2, y: 166 - h, 'text-anchor': 'middle', style: 'font-size:8px' }, s, (pr * 100).toFixed(0) + '%');
    });
    svg('text', { class: 'tiny mut', x: 12, y: 204 }, s, `greedy → “${VOCAB[order[0]]}” · sampling draws from the ${kept.length} kept tokens (renormalised) · grey = truncated · ✕ = masked by constraint`);
    dvis.appendChild(s);
  }
  ['#dc-temp', '#dc-topk', '#dc-topp', '#dc-gram'].forEach(q => $(q).addEventListener('input', drawPolicies));
  drawPolicies();

  // ---- speculative ----
  const sctl = $('#sp-ctl');
  const f = { k: field({ id: 'sp-k', label: 'Draft length k', type: 'range', value: 5, min: 1, max: 8, step: 1 }), acc: field({ id: 'sp-acc', label: 'Per-token acceptance', type: 'range', value: 0.75, min: 0.1, max: 0.98, step: 0.01 }), cost: field({ id: 'sp-cost', label: 'Draft cost / target cost', type: 'range', value: 0.1, min: 0.02, max: 0.6, step: 0.01 }) };
  Object.values(f).forEach(x => { sctl.insertBefore(x.el, $('#sp-run')); x.input.addEventListener('input', spec); });
  let seed = 1; $('#sp-run').addEventListener('click', () => { seed++; spec(); });
  const TOK = ['The', 'KV', 'cache', 'stores', 'keys', 'and', 'values', 'per', 'layer'];
  function spec() {
    const k = +f.k.input.value, a = +f.acc.input.value, c = +f.cost.input.value, r = rng(seed);
    let accepted = 0; while (accepted < k && r() < a) accepted++;
    const vis = $('#sp-vis'); vis.innerHTML = '';
    const W = 760, H = 150, s = canvas(W, H, 'Draft tokens verified by the target model');
    svg('text', { class: 'mut', x: 10, y: 16 }, s, `draft model proposes ${k} tokens (k cheap steps)`);
    for (let i = 0; i < k; i++) { const x = 10 + i * 70; svg('rect', { class: 'tok draft', x, y: 24, width: 62, height: 22, rx: 3 }, s); svg('text', { class: 'tiny', x: x + 31, y: 39, 'text-anchor': 'middle' }, s, TOK[i]); }
    svg('text', { class: 'mut', x: 10, y: 76 }, s, 'target verifies all k+1 positions in ONE forward pass');
    for (let i = 0; i <= k; i++) { const x = 10 + i * 70; const cls = i < accepted ? 'done' : i === accepted ? 'rej' : 'draft'; svg('rect', { class: 'tok ' + cls, x, y: 84, width: 62, height: 22, rx: 3, style: i > accepted ? 'opacity:.3' : '' }, s); svg('text', { class: 'tiny', x: x + 31, y: 99, 'text-anchor': 'middle' }, s, i < accepted ? TOK[i] : i === accepted ? (i < k ? 'resample' : '+bonus') : '·'); }
    svg('text', { class: 'tiny mut', x: 10, y: 130 }, s, `accepted ${accepted} draft token${accepted === 1 ? '' : 's'} + 1 token from the target's own distribution at the first rejection (or a bonus token if all accepted) → ${accepted + 1} tokens for one target pass`);
    vis.appendChild(s);
    const expected = (1 - Math.pow(a, k + 1)) / (1 - a); // expected tokens per round for i.i.d. acceptance
    const speed = expected / (1 + k * c);
    $('#sp-stats').innerHTML = stat('this round', `${accepted + 1} tokens / 1 target pass`) + stat('expected tokens / round', expected.toFixed(2)) + stat('draft overhead / round', `${(k * c).toFixed(2)}× target`) + stat('≈ speedup', speed.toFixed(2) + '×', speed > 1.5 ? 'ok' : speed > 1 ? 'warn' : 'bad') + stat('acceptance rate', pct(a));
  }
  spec();
}
