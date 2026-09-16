/** Microscope 04 — one pre-training step, with the glossary a practitioner needs. */
import { html, field, stat, fmt, flowStrip } from './util.js';

export const id = 'scope-training';
export const short = 'Training step';
export const title = 'One pre-training step';
export const description = 'From a training shard to updated parameters: forward, shifted next-token labels, cross-entropy, backward, gradient communication, optimizer. Adjust the batch shape to see tokens per step and the memory that mixed precision plus AdamW moments imply before sharding.';

const FLOW = ['training shard', 'token sequence', 'model forward', 'logits [T, V]', 'shifted labels', 'cross-entropy', 'backward', 'gradient all-reduce / reduce-scatter', 'AdamW', 'updated params'];

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div id="tr-flow"></div>
    <div class="scope-controls" id="tr-ctl"></div>
    <div class="stat-row" id="tr-stats"></div>
    <div class="note"><b>Memory accounting (unsharded, illustrative).</b> Mixed-precision training with AdamW commonly keeps BF16 weights (2 B) + BF16 grads (2 B) + FP32 master weights (4 B) + FP32 moments m, v (8 B) ≈ 16 bytes per parameter, before activations. FSDP / ZeRO divide these across data-parallel ranks; activation checkpointing trades recompute for activation memory.</div>
    <div class="kv-list">
      <div><b>Global batch</b><span>Tokens the optimizer sees per step, summed over all data-parallel ranks and accumulation steps.</span></div>
      <div><b>Microbatch</b><span>What one rank pushes through one forward/backward; bounded by activation memory.</span></div>
      <div><b>Gradient accumulation</b><span>Sum microbatch gradients locally, step once: <code>global = micro × accum × DP</code>.</span></div>
      <div><b>Tokens per step</b><span><code>global_batch × seq_len</code>; the unit most training logs are plotted against.</span></div>
      <div><b>LR warmup</b><span>Linear ramp over the first few thousand steps so Adam's moment estimates stabilise before large updates; then cosine or warmup-stable-decay.</span></div>
      <div><b>Weight decay</b><span>Decoupled L2 shrinkage in AdamW, commonly ~0.1, usually excluded for norms and biases.</span></div>
      <div><b>Gradient clipping</b><span>Scale the global gradient norm to a maximum (commonly 1.0) to survive loss spikes.</span></div>
      <div><b>BF16 / FP16 / FP8</b><span>BF16 keeps FP32's exponent range so no loss scaling is needed; FP16 needs dynamic loss scaling; FP8 needs per-tensor or per-block scaling and careful op selection.</span></div>
      <div><b>Activation checkpointing</b><span>Store only block inputs, recompute the rest in backward: ~+33% compute for a large activation-memory cut.</span></div>
      <div><b>Checkpoint recovery</b><span>Sharded, asynchronous saves including optimizer state, RNG and data-loader position so a restart resumes bit-for-bit.</span></div>
      <div><b>Data-loader stalls</b><span>GPUs idle while waiting on tokenized shards; watch loader wait time and prefetch depth.</span></div>
      <div><b>Model FLOP utilization (MFU)</b><span><code>achieved FLOP/s ÷ peak FLOP/s</code> using the 6·N·D model-FLOP count; 35–45% is typical at scale (illustrative).</span></div>
      <div><b>Network bottlenecks</b><span>Gradient collectives scale with parameter bytes; slow inter-node links show up as low MFU with high communication wait time.</span></div>
    </div>
  `));
  root.querySelector('#tr-flow').appendChild(flowStrip(FLOW, 'sub-training', 'Training step flow'));

  const ctl = root.querySelector('#tr-ctl');
  const f = {
    params: field({ id: 'tr-params', label: 'Parameters (B)', value: 8, min: 0.1, max: 2000, step: 0.1 }),
    dp: field({ id: 'tr-dp', label: 'DP ranks', value: 64, min: 1, max: 8192 }),
    micro: field({ id: 'tr-micro', label: 'Microbatch (seqs)', value: 2, min: 1, max: 64 }),
    accum: field({ id: 'tr-accum', label: 'Grad accumulation', value: 8, min: 1, max: 128 }),
    seq: field({ id: 'tr-seq', label: 'Sequence length', value: 8192, min: 128, max: 262144, step: 128 }),
    tps: field({ id: 'tr-tps', label: 'Cluster PFLOP/s (BF16 peak)', value: 8, min: 0.1, max: 100000, step: 0.1 }),
  };
  Object.values(f).forEach(x => { ctl.appendChild(x.el); x.input.addEventListener('input', update); });
  const stats = root.querySelector('#tr-stats');
  function update() {
    const P = +f.params.input.value * 1e9, dp = +f.dp.input.value, micro = +f.micro.input.value, accum = +f.accum.input.value, seq = +f.seq.input.value, peak = +f.tps.input.value * 1e15;
    const global = micro * accum * dp, tokens = global * seq;
    const flops = 6 * P * tokens; // model FLOPs per step (approx.)
    const stepS = flops / (peak * 0.4);
    const bytesPerParam = 16;
    stats.innerHTML = stat('global batch (seqs)', fmt(global)) + stat('tokens / step', fmt(tokens)) + stat('model FLOPs / step', (flops / 1e18).toFixed(2) + ' EFLOP')
      + stat('step time at 40% MFU', stepS < 1 ? (stepS * 1000).toFixed(0) + ' ms' : stepS.toFixed(1) + ' s')
      + stat('weights+grads+optimizer', (P * bytesPerParam / 1e9).toFixed(0) + ' GB total') + stat('per DP rank (ZeRO-3)', (P * bytesPerParam / dp / 1e9).toFixed(1) + ' GB');
  }
  update();
}
