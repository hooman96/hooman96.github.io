/** Microscope 12 — serving plane, disaggregated prefill/decode, and the metrics glossary. */
import { html, canvas, svg, flowStrip } from './util.js';

export const id = 'scope-serving';
export const short = 'Serving · metrics';
export const title = 'Serving plane, disaggregation and metrics';
export const description = 'Around the engine sits the fleet: gateway, router, admission control, workers, streams and telemetry. Disaggregating prefill and decode into separate pools lets each be tuned independently at the cost of KV transfer and orchestration. The metrics defined here are what the whole page is optimised against.';

const METRICS = [
  ['Queue time', 'Time a request waits after admission before its first scheduler iteration. Grows with saturation; the first sign of an under-provisioned fleet.'],
  ['TTFT', 'Time To First Token: queue time + prefill (minus prefix-cache hits) + first decode + stream delivery. Dominated by prompt length and scheduler contention.'],
  ['TPOT / ITL', 'Time Per Output Token / Inter-Token Latency: the decode-iteration period as seen by one request. Set by batch size, KV read volume, kernel efficiency and interference from prefill chunks.'],
  ['Throughput', 'Useful token work per unit time (input and output tokens, ideally reported separately). Raising batch size raises throughput until the iteration becomes compute-bound.'],
  ['KV utilization', 'Fraction of the KV block pool occupied by active or cached blocks. Near 100% means admission stalls or preemption; low means capacity to admit more.'],
  ['Prefix-cache hit rate', 'Fraction of eligible prefix blocks reused rather than recomputed. Depends on workload structure, block alignment, routing locality and eviction pressure.'],
  ['Batch occupancy', 'Useful active token work per scheduler iteration relative to the iteration budget. Idle slots or tiny batches waste the weight read every step.'],
  ['GPU utilization', 'SM activity percentage is not enough on its own: read it with memory-bandwidth utilization, kernel occupancy and communication wait time to tell compute-bound from bandwidth- or comm-bound.'],
  ['Cost per request / successful task', 'Serving economics: fleet cost divided by requests, and by requests that actually completed the user\'s task. Prefix caching, quantization and batching all move this number.'],
];

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div id="sv-plane"></div>
    <div class="kv-list">
      <div><b>Multi-LoRA</b><span>One resident base model plus selectable adapters per request; batched heterogeneous adapters via custom kernels, adapter cache with eviction, adapter id in the prefix-cache key.</span></div>
      <div><b>Autoscaling</b><span>Scale on token-aware signals (queue depth, KV utilization, TTFT / ITL SLO attainment), not HTTP request count; weight loading makes cold starts slow, so scale ahead.</span></div>
      <div><b>Model routing</b><span>Capability-, cost- and latency-aware routing across models and versions; sticky routing keeps prefix-cache locality.</span></div>
      <div><b>Canary releases</b><span>Compare model, version, kernel and scheduler changes on a traffic slice with quality and latency guardrails before promotion.</span></div>
      <div><b>Backpressure</b><span>Under burst demand, queue with bounded depth, shed with 429 / 503 and priority classes; protect the fleet rather than every request.</span></div>
      <div><b>CUDA Graphs and compiled kernels</b><span>Capture the decode step per batch-size bucket to remove launch overhead; compile and fuse kernels ahead of traffic and warm up before serving.</span></div>
    </div>
    <div style="margin-top:1.2rem">
      <h4 class="ctl-label">Disaggregated prefill / decode</h4>
      <div id="sv-disagg"></div>
      <div class="two">
        <div class="panel-desc"><p><b>Why.</b> Prefill wants compute (large GEMMs, high arithmetic intensity); decode wants bandwidth and large batches. Separate pools let each be sized and configured independently (TP degree, chunk sizes, batch limits) and isolate TTFT from ITL interference.</p></div>
        <div class="panel-desc"><p><b>Cost.</b> KV state must move from the prefill worker to the decode worker (NVLink, RDMA or network), adding transfer time, orchestration complexity, locality constraints and a second queue. For short prompts or small fleets the transfer can cost more than the interference it removes. It is not automatically superior for every workload.</p></div>
      </div>
    </div>
    <div style="margin-top:1.2rem">
      <h4 class="ctl-label">Performance metrics · select a term</h4>
      <div class="tabs" role="tablist" aria-label="Metric" id="sv-terms"></div>
      <div class="panel-desc" id="sv-term" aria-live="polite"></div>
    </div>
  `));
  const PLANE = ['API gateway', 'model router', 'queue / admission', 'inference worker', 'response stream', 'telemetry'];
  root.querySelector('#sv-plane').appendChild(flowStrip(PLANE, 'sub-serving', 'Serving plane'));
  {
    const s = canvas(760, 150, 'Prefill pool transferring KV to decode pool');
    const pool = (x, label, n, cls) => { svg('rect', { class: 'lane', x, y: 24, width: 250, height: 100, rx: 6 }, s); svg('text', { class: 'mut', x: x + 10, y: 16 }, s, label); for (let i = 0; i < n; i++) svg('rect', { class: cls, x: x + 12 + (i % 4) * 58, y: 36 + Math.floor(i / 4) * 44, width: 50, height: 34, rx: 4 }, s); };
    pool(10, 'context / prefill workers (compute-heavy, high TP)', 4, 'prefill');
    pool(500, 'generation / decode workers (bandwidth-heavy, big batches)', 8, 'decode');
    svg('path', { class: 'arrow on', d: 'M262 74 H498' }, s);
    svg('text', { class: 'tiny', x: 380, y: 66, 'text-anchor': 'middle' }, s, 'KV transfer (layers × tokens × KV bytes)');
    svg('text', { class: 'tiny mut', x: 380, y: 90, 'text-anchor': 'middle' }, s, 'NVLink / RDMA / network · orchestration · second queue');
    svg('text', { class: 'tiny mut', x: 10, y: 142 }, s, 'each pool scales, batches and is configured independently; the link in the middle is the cost');
    root.querySelector('#sv-disagg').appendChild(s);
  }
  const terms = root.querySelector('#sv-terms'), out = root.querySelector('#sv-term');
  terms.innerHTML = METRICS.map(([t], i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-i="${i}">${t}</button>`).join('');
  const show = i => { out.innerHTML = `<p><b>${METRICS[i][0]}.</b> ${METRICS[i][1]}</p>`; terms.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-selected', j === i ? 'true' : 'false')); };
  terms.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) show(+b.dataset.i); });
  show(0);
}
