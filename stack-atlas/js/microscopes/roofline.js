/** Microscope 02 — roofline calculator for LLM workloads on a GPU. */
import { html, canvas, svg, field, stat } from '/atlas-core/js/microscopes/util.js';

export const id = 'scope-roofline';
export const short = 'Roofline';
export const title = 'Roofline: is this kernel compute-bound or bandwidth-bound?';
export const description = 'Attainable performance = min(peak FLOP/s, arithmetic intensity × memory bandwidth). For a weight-streaming decode step the intensity is roughly the number of tokens in the batch, which is why small-batch decode lives on the bandwidth roof and prefill lives on the compute roof. Pick a GPU and a workload and read the plot.';

const GPUS = { h100: ['H100 SXM (example)', 989, 3.35], a100: ['A100 80 GB (example)', 312, 2.0], l40s: ['L40S (example)', 362, 0.86], b200: ['B200 (published dense BF16, example)', 2250, 8.0], custom: ['Custom', 500, 1] };

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="formula">attainable FLOP/s = min( peak FLOP/s , intensity × bandwidth )   ·   ridge point = peak / bandwidth   ·   decode intensity ≈ tokens per step (BF16 weights, approximation)</div>
    <div class="scope-controls" id="rl-ctl"></div>
    <div class="scope-grid">
      <div id="rl-vis"></div>
      <div>
        <div class="stat-row" id="rl-stats"></div>
        <div class="panel-desc" style="margin-top:.8rem" id="rl-note"></div>
      </div>
    </div>
    <div class="kv-list">
      <div><b>Why batch fixes decode</b><span>Each decode step streams every weight once. With B sequences in the batch the same bytes serve B tokens, so intensity ≈ B and throughput rises almost linearly until the ridge point.</span></div>
      <div><b>Why prefill is different</b><span>A prompt of T tokens multiplies each weight tile by T rows: intensity ≈ T, far past the ridge, so prefill is compute-bound and tensor-core rate is what matters.</span></div>
      <div><b>Attention over KV</b><span>Decode attention reads the whole KV cache for one query per head: intensity of order 1 FLOP/byte. It is always bandwidth-bound; GQA and KV quantization shrink the bytes.</span></div>
      <div><b>Co-design lever</b><span>Move a workload right (batching, fusion, reuse in shared memory) or raise the roof (faster HBM, lower precision). Kernel work cannot beat the roofline; it can only approach it.</span></div>
    </div>
  `));
  const ctl = root.querySelector('#rl-ctl');
  const f = {
    gpu: field({ id: 'rl-gpu', label: 'GPU', type: 'select', value: 'h100', options: Object.entries(GPUS).map(([k, v]) => [k, v[0]]) }),
    peak: field({ id: 'rl-peak', label: 'Peak dense BF16 (TFLOP/s)', value: 989, min: 1, max: 100000 }),
    bw: field({ id: 'rl-bw', label: 'HBM bandwidth (TB/s)', value: 3.35, min: 0.1, max: 100, step: 0.01 }),
    params: field({ id: 'rl-params', label: 'Parameters (B)', value: 70, min: 0.1, max: 3000, step: 0.1 }),
    tokens: field({ id: 'rl-tokens', label: 'Tokens per step (batch × tokens)', type: 'range', value: 16, min: 1, max: 2048, step: 1 }),
    bytes: field({ id: 'rl-bytes', label: 'Weight bytes', type: 'select', value: '2', options: [['2', 'BF16 (2)'], ['1', 'FP8 / INT8 (1)'], ['0.5', 'INT4 (0.5)']] }),
  };
  Object.values(f).forEach(x => { ctl.appendChild(x.el); x.input.addEventListener('input', () => { if (x === f.gpu) { const g = GPUS[f.gpu.input.value]; if (f.gpu.input.value !== 'custom') { f.peak.input.value = g[1]; f.bw.input.value = g[2]; } } else if (x === f.peak || x === f.bw) f.gpu.input.value = 'custom'; draw(); }); });
  const vis = root.querySelector('#rl-vis'), stats = root.querySelector('#rl-stats'), note = root.querySelector('#rl-note');
  function draw() {
    const peak = +f.peak.input.value * 1e12, bw = +f.bw.input.value * 1e12, P = +f.params.input.value * 1e9, M = +f.tokens.input.value, wb = +f.bytes.input.value;
    const flops = 2 * P * M, bytes = P * wb; const I = flops / bytes; const ridge = peak / bw;
    const attain = Math.min(peak, I * bw); const t = Math.max(flops / peak, bytes / bw);
    vis.innerHTML = '';
    const W = 460, H = 300, s = canvas(W, H, 'Roofline plot'); const x0 = 50, y0 = 250, xw = 390, yh = 210;
    const lx = v => x0 + (Math.log10(v) + 1) / 5 * xw; // intensity 0.1..1e4
    const ly = v => y0 - (Math.log10(v) - 11) / 5 * yh;    // 1e11..1e16 FLOP/s
    svg('line', { class: 'axis', x1: x0, y1: y0, x2: x0 + xw, y2: y0 }, s); svg('line', { class: 'axis', x1: x0, y1: y0, x2: x0, y2: y0 - yh }, s);
    [0.1, 1, 10, 100, 1000, 10000].forEach(v => { svg('text', { class: 'tiny mut', x: lx(v), y: y0 + 14, 'text-anchor': 'middle' }, s, v >= 1000 ? (v / 1000) + 'k' : String(v)); });
    [1e11, 1e12, 1e13, 1e14, 1e15, 1e16].forEach(v => { svg('text', { class: 'tiny mut', x: x0 - 6, y: ly(v) + 3, 'text-anchor': 'end' }, s, (v / 1e12) >= 1 ? (v / 1e12) + 'T' : '0.1T'); svg('line', { x1: x0, y1: ly(v), x2: x0 + xw, y2: ly(v), stroke: 'var(--atlas-border)' }, s); });
    svg('text', { class: 'tiny mut', x: x0 + xw / 2, y: H - 6, 'text-anchor': 'middle' }, s, 'arithmetic intensity (FLOP / byte)'); 
    // roof: bandwidth line from I=0.1 to ridge, then flat
    const pts = [[0.1, 0.1 * bw], [ridge, peak], [1e4, peak]].map(([i, v]) => `${lx(i).toFixed(1)},${ly(Math.min(Math.max(v, 1e11), 1e16)).toFixed(1)}`).join(' ');
    svg('polyline', { points: pts, fill: 'none', stroke: 'var(--atlas-accent)', 'stroke-width': 2 }, s);
    svg('line', { x1: lx(ridge), y1: ly(peak), x2: lx(ridge), y2: y0, stroke: 'var(--atlas-warn)', 'stroke-dasharray': '4 3' }, s);
    svg('text', { class: 'tiny', x: lx(ridge) + 4, y: y0 - 6, fill: 'var(--atlas-warn)' }, s, `ridge ≈ ${ridge.toFixed(0)}`);
    const px = lx(Math.min(Math.max(I, 0.1), 1e4)), py = ly(Math.min(Math.max(attain, 1e11), 1e16));
    svg('circle', { cx: px, cy: py, r: 6, fill: I < ridge ? 'var(--atlas-bad)' : 'var(--atlas-ok)', stroke: 'var(--atlas-text)', 'stroke-width': 1.5 }, s);
    svg('text', { class: 'tiny', x: px + 10, y: py - 8 }, s, `${M} tokens · I ≈ ${I.toFixed(1)}`);
    vis.appendChild(s);
    const bound = I < ridge ? 'bandwidth-bound' : 'compute-bound';
    stats.innerHTML = stat('intensity', I.toFixed(1) + ' FLOP/B') + stat('ridge point', ridge.toFixed(0) + ' FLOP/B') + stat('regime', bound, I < ridge ? 'warn' : 'ok') + stat('attainable', (attain / 1e12).toFixed(0) + ' TFLOP/s') + stat('step time (weights only)', t < 1e-3 ? (t * 1e6).toFixed(0) + ' µs' : (t * 1e3).toFixed(1) + ' ms') + stat('tokens / s', (M / t).toFixed(0));
    note.innerHTML = `<p>At ${M} tokens per step this workload reaches <b>${((attain / peak) * 100).toFixed(0)}% of peak</b>. ${I < ridge ? `It needs about <b>${Math.ceil(ridge)}</b> tokens per step (batch × tokens) to reach the ridge on this GPU with ${wb}-byte weights; lower-precision weights halve the bytes but also halve the intensity per token, so the ridge in tokens does not move much unless the kernels use lower-precision tensor cores too.` : 'Further batching no longer helps; kernel efficiency (tile shapes, tensor-core utilization, fusion) and clocks decide the rest.'}</p><p class="ctl-help">Weights-only model: ignores KV-cache reads, activations and attention. Real decode steps are more bandwidth-bound than this because KV traffic adds bytes without adding FLOPs per weight.</p>`;
  }
  draw();
}
