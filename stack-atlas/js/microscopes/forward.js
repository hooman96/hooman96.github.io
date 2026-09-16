/** Microscope 01 — a forward pass down the stack: layer walkthrough + CPU/GPU timeline (launch-bound vs GPU-bound). */
import { html, canvas, svg, field, stat, prefersReducedMotion } from '/atlas-core/js/microscopes/util.js';

export const id = 'scope-forward';
export const short = 'Forward pass';
export const title = 'A forward pass down the stack';
export const description = 'What happens between model(x) in Python and a tensor core doing math, and why "GPU utilization" is really a question about two timelines: the CPU that issues work and the GPU that executes it. Change per-op overheads to see when a workload becomes launch-bound and what CUDA Graphs and fusion buy.';

const STEPS = [
  ['Python call', 'app', 'model(x) enters the PyTorch frontend. Each op costs microseconds of Python and dispatcher work before any GPU code runs.'],
  ['ATen dispatcher', 'app', 'Dispatch keys (device, autograd, functionalization) route the op to its CUDA implementation. Boxed/unboxed calling adds overhead on tiny ops.'],
  ['CUDA runtime (cudart)', 'runtime', 'The kernel launch API marshals grid/block config and arguments. Memory comes from the caching allocator, not cudaMalloc, on the hot path.'],
  ['Command buffer + doorbell', 'runtime', 'Launches are written to a user-mode command buffer (pushbuffer) and a doorbell register is rung. No syscall per launch, commonly.'],
  ['Kernel-mode driver', 'kernel', 'Only allocation, mapping, context work and some synchronization go through ioctl into the driver. Launch-heavy loops barely touch the kernel.'],
  ['Command processor', 'gpu', 'The GPU front end reads the queue, launches the grid, and the work distributor hands thread blocks to SMs with free resources.'],
  ['SM: warps → tensor cores', 'gpu', 'Warp schedulers issue instructions; GEMM tiles run on tensor cores; loads stream from HBM through L2 and shared memory.'],
  ['Event / stream sync', 'runtime', 'The host continues asynchronously. A cudaStreamSynchronize, .item() or D2H copy is where the CPU actually waits for the GPU.'],
  ['Back to Python', 'app', 'Sampled token ids are copied D2H (tiny bytes, latency-relevant), detokenized and streamed by the event loop.'],
];

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="scope-grid">
      <div id="fw-steps"></div>
      <div class="panel-desc" id="fw-note" aria-live="polite"></div>
    </div>
    <div>
      <h4 class="ctl-label">Two timelines · one decode step</h4>
      <div class="scope-controls" id="fw-ctl"></div>
      <div id="fw-vis"></div>
      <div class="stat-row" id="fw-stats"></div>
      <div class="note"><b>Reading it.</b> The CPU lane shows Python + dispatcher + launch cost per op; the GPU lane shows kernel execution. When the CPU cannot issue work faster than the GPU finishes it, the GPU idles between kernels (grey gaps) and the step is <b>launch-bound</b>: the fix is fewer launches (fusion, torch.compile) or cheaper launches (CUDA Graphs replay the whole step with one launch). When kernels are long, the CPU runs ahead until the queue fills and the step is <b>GPU-bound</b>: the fix is faster kernels, better batching or more bandwidth.</div>
    </div>
  `));
  const stepsEl = root.querySelector('#fw-steps'), note = root.querySelector('#fw-note');
  let sel = 0;
  const drawSteps = () => {
    stepsEl.innerHTML = '';
    const rowH = 30, W = 420, s = canvas(W, STEPS.length * rowH + 10, 'Forward pass layers');
    STEPS.forEach(([t, sub], i) => {
      const y = 6 + i * rowH;
      const g = svg('g', { role: 'button', tabindex: 0, 'aria-label': t, 'aria-pressed': i === sel ? 'true' : 'false', style: 'cursor:pointer' }, s);
      svg('rect', { class: 'box sub-' + sub + (i === sel ? ' on' : ''), x: 90, y, width: 260, height: 22, rx: 4 }, g);
      svg('text', { x: 220, y: y + 15, 'text-anchor': 'middle' }, g, t);
      svg('text', { class: 'tiny mut', x: 84, y: y + 15, 'text-anchor': 'end' }, g, sub);
      if (i < STEPS.length - 1) svg('path', { class: 'arrow', d: `M220 ${y + 22} L220 ${y + rowH - 1}` }, s);
      const pick = () => { sel = i; drawSteps(); };
      g.addEventListener('click', pick); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    stepsEl.appendChild(s);
    note.innerHTML = `<p><b>${STEPS[sel][0]}.</b> ${STEPS[sel][2]}</p>`;
  };
  drawSteps();

  const ctl = root.querySelector('#fw-ctl'), vis = root.querySelector('#fw-vis'), stats = root.querySelector('#fw-stats');
  const f = {
    ops: field({ id: 'fw-ops', label: 'Kernels per step', type: 'range', value: 40, min: 5, max: 200, step: 5 }),
    cpu: field({ id: 'fw-cpu', label: 'CPU cost per launch (µs)', type: 'range', value: 12, min: 2, max: 60, step: 1, unit: ' µs' }),
    gpu: field({ id: 'fw-gpu', label: 'GPU time per kernel (µs)', type: 'range', value: 8, min: 1, max: 200, step: 1, unit: ' µs' }),
    mode: field({ id: 'fw-mode', label: 'Launch strategy', type: 'select', value: 'eager', options: [['eager', 'Eager launches'], ['fused', 'torch.compile (fewer, longer kernels)'], ['graph', 'CUDA Graph replay']] }),
  };
  Object.values(f).forEach(x => { ctl.appendChild(x.el); x.input.addEventListener('input', draw); });
  function draw() {
    let n = +f.ops.input.value, cpu = +f.cpu.input.value, gpu = +f.gpu.input.value; const mode = f.mode.input.value;
    if (mode === 'fused') { n = Math.max(3, Math.round(n / 3)); gpu = gpu * 2.4; }
    let cpuLaunch = cpu; if (mode === 'graph') cpuLaunch = 0;
    // simulate: CPU issues launch i at time i*cpuLaunch (graph: all at t=graphLaunch); GPU runs kernel i at max(prev end, issue time)
    const graphLaunch = mode === 'graph' ? 20 : 0;
    const gpuStart = [], gpuEnd = []; let prevEnd = graphLaunch; let issue = 0;
    for (let i = 0; i < n; i++) { issue = mode === 'graph' ? graphLaunch : (i + 1) * cpuLaunch; const st = Math.max(prevEnd, issue); gpuStart.push(st); gpuEnd.push(st + gpu); prevEnd = st + gpu; }
    const cpuEnd = mode === 'graph' ? graphLaunch : n * cpuLaunch; const stepEnd = Math.max(prevEnd, cpuEnd);
    const busy = n * gpu, util = busy / stepEnd;
    vis.innerHTML = '';
    const W = 760, H = 120, s = canvas(W, H, 'CPU and GPU timelines'); const sc = (W - 90) / stepEnd;
    svg('text', { class: 'mut', x: 8, y: 34 }, s, 'CPU'); svg('text', { class: 'mut', x: 8, y: 84 }, s, 'GPU');
    svg('rect', { class: 'lane', x: 50, y: 18, width: W - 60, height: 26, rx: 3 }, s); svg('rect', { class: 'lane', x: 50, y: 68, width: W - 60, height: 26, rx: 3 }, s);
    if (mode === 'graph') { svg('rect', { class: 'launch', x: 50, y: 21, width: Math.max(2, graphLaunch * sc), height: 20, rx: 2 }, s); svg('text', { class: 'tiny mut', x: 56 + graphLaunch * sc, y: 35 }, s, 'one graph launch, then the CPU is free'); }
    else for (let i = 0; i < n; i++) svg('rect', { class: 'launch', x: 50 + i * cpuLaunch * sc, y: 21, width: Math.max(1, cpuLaunch * sc - 0.5), height: 20 }, s);
    for (let i = 0; i < n; i++) { svg('rect', { class: 'gpu-lane', x: 50 + gpuStart[i] * sc, y: 71, width: Math.max(1, gpu * sc - 0.5), height: 20 }, s); if (i > 0 && gpuStart[i] > gpuEnd[i - 1] + 0.01) svg('rect', { class: 'gap', x: 50 + gpuEnd[i - 1] * sc, y: 71, width: (gpuStart[i] - gpuEnd[i - 1]) * sc, height: 20 }, s); }
    svg('text', { class: 'tiny mut', x: 50, y: 112 }, s, `0 µs`); svg('text', { class: 'tiny mut', x: W - 10, y: 112, 'text-anchor': 'end' }, s, `${stepEnd.toFixed(0)} µs`);
    vis.appendChild(s);
    const bound = util > 0.9 ? 'GPU-bound' : util > 0.6 ? 'mixed' : 'launch-bound (CPU)';
    stats.innerHTML = stat('step time', stepEnd.toFixed(0) + ' µs') + stat('GPU busy', (util * 100).toFixed(0) + '%', util > .9 ? 'ok' : util > .6 ? 'warn' : 'bad') + stat('regime', bound, util > .9 ? 'ok' : util > .6 ? 'warn' : 'bad') + stat('kernels', String(n)) + stat('tokens/s at batch 1', (1e6 / stepEnd).toFixed(0));
  }
  draw();
}
