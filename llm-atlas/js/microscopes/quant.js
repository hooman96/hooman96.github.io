/** Microscope 11 — quantization / weight-memory calculator. */
import { html, field, stat } from './util.js';
import { weightBytes, fmtBytes } from '../lib/kvMemory.js';

export const id = 'scope-quant';
export const short = 'Quantization';
export const title = 'Quantization and weight memory';
export const description = 'Weight memory scales with bits per weight, but latency does not scale with it proportionally: the answer depends on hardware, kernels, memory bandwidth, dequantization overhead, batch size and model shape. Model quantization and KV-cache quantization are separate decisions.';

const FORMATS = [['16', 'BF16 / FP16 (16)'], ['8', 'FP8 / INT8 (8)'], ['4', 'INT4 / NF4 (4)'], ['3', 'INT3 (3)'], ['2', 'INT2 (2)']];

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="formula">weight memory ≈ parameters × bits_per_weight / 8</div>
    <div class="scope-controls" id="q-ctl"></div>
    <div class="stat-row" id="q-stats"></div>
    <div class="note warn"><b>Smaller weights do not guarantee proportional speed.</b> Weight-only INT4 helps small-batch decode where weight reads dominate, provided fused dequant-GEMV kernels exist for the hardware. At large batch the GEMMs become compute-bound and the dequantization work can cost more than the bandwidth it saves. FP8 with hardware support (Hopper-class and later) can speed both phases; INT8 activations need calibration. Measure TTFT and ITL, not file size.</div>
    <div class="kv-list">
      <div><b>Weight-only vs weight + activation</b><span>Weight-only (W4A16) dequantizes to BF16 for the matmul; W8A8 quantizes activations too and needs per-token or per-channel scales and calibration data.</span></div>
      <div><b>Calibration</b><span>A few hundred representative sequences to pick scales / zero-points and, for GPTQ / AWQ style methods, to decide which weights matter most.</span></div>
      <div><b>GPTQ-style</b><span>Layer-wise post-training quantization that minimises output error using second-order (Hessian) information, quantizing columns sequentially with error feedback.</span></div>
      <div><b>AWQ-style</b><span>Keeps salient weight channels (those multiplying large activations) more precise by scaling them before uniform quantization.</span></div>
      <div><b>Quantization-aware training</b><span>Simulate quantization in the forward pass during (fine-)tuning so the weights adapt; best quality at low bits, highest cost.</span></div>
      <div><b>KV-cache quantization</b><span>Separate from weights: FP8 / INT8 K and V with per-head or per-token scales raise concurrency; see the KV calculator.</span></div>
      <div><b>Quality checks</b><span>Perplexity deltas hide task regressions; evaluate downstream tasks, long-context behaviour and refusal / safety drift after quantizing.</span></div>
      <div><b>Deployment artifacts</b><span>Quantized checkpoints bind to kernel formats (Marlin, GPTQ, AWQ, FP8 block scales); the serving engine must support the format for any benefit.</span></div>
    </div>
  `));
  const ctl = root.querySelector('#q-ctl'), stats = root.querySelector('#q-stats');
  const f = { params: field({ id: 'q-p', label: 'Parameters (B)', value: 70, min: 0.1, max: 3000, step: 0.1 }), bits: field({ id: 'q-b', label: 'Bits per weight', type: 'select', value: '16', options: FORMATS }), gpu: field({ id: 'q-g', label: 'GPU memory (GB)', value: 80, min: 8, max: 2000 }), bw: field({ id: 'q-bw', label: 'HBM bandwidth (TB/s)', value: 3.35, min: 0.1, max: 20, step: 0.05 }) };
  Object.values(f).forEach(x => { ctl.appendChild(x.el); x.input.addEventListener('input', update); });
  function update() {
    const P = +f.params.input.value * 1e9, bits = +f.bits.input.value, gpu = +f.gpu.input.value * 1e9, bw = +f.bw.input.value * 1e12;
    const bytes = weightBytes({ params: P, bits }), gpus = Math.ceil(bytes / (gpu * 0.9));
    const readMs = (bytes / bw) * 1000; // one full weight read per decode step, batch 1, ignoring KV and overhead
    stats.innerHTML = stat('weight memory', fmtBytes(bytes)) + stat('vs BF16', (bits / 16 * 100).toFixed(0) + '%') + stat('min GPUs (weights only, 90% usable)', String(gpus)) + stat('weight-read floor / decode step', readMs.toFixed(1) + ' ms', '') + stat('≈ max tokens/s (batch 1, bandwidth floor)', (1000 / readMs).toFixed(0));
  }
  update();
}
