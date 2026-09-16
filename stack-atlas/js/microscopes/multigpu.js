/** Microscope 08 — multi-GPU topology and a collective / transfer time calculator. */
import { html, canvas, svg, field, stat } from '/atlas-core/js/microscopes/util.js';

export const id = 'scope-multigpu';
export const short = 'Multi-GPU fabric';
export const title = 'Multi-GPU topology and collective cost';
export const description = 'Inside a node GPUs talk over NVLink (and NVSwitch); across nodes over NICs with RDMA; everything else goes through PCIe. A ring all-reduce moves 2·(n−1)/n of the payload through each GPU, so the slowest link in the ring sets the time. Size a gradient all-reduce or a KV transfer over each fabric.';

const FABRICS = { nvlink: ['NVLink 4 (H100, per direction per GPU, example)', 450, 2], nvswitch: ['NVSwitch full-mesh node (example)', 450, 2], pcie5: ['PCIe 5.0 x16 (achievable, example)', 50, 3], pcie4: ['PCIe 4.0 x16 (achievable, example)', 25, 3], ib400: ['InfiniBand NDR 400 Gb/s per NIC (example)', 50, 3], ib200: ['InfiniBand HDR 200 Gb/s per NIC (example)', 25, 3], eth100: ['100 GbE with RoCE (example)', 12, 6] };

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="scope-grid">
      <div>
        <div class="tabs" role="tablist" aria-label="Node topology"><button type="button" role="tab" aria-selected="true" data-t="nvswitch">NVSwitch node</button><button type="button" role="tab" aria-selected="false" data-t="pcie">PCIe-only node</button><button type="button" role="tab" aria-selected="false" data-t="multi">Two nodes over IB</button></div>
        <div id="mg-topo"></div>
      </div>
      <div class="panel-desc" id="mg-note"></div>
    </div>
    <h4 class="ctl-label" style="margin-top:1rem">Collective and transfer calculator</h4>
    <div class="scope-controls" id="mg-ctl"></div>
    <div class="stat-row" id="mg-stats"></div>
    <div class="kv-list">
      <div><b>Ring all-reduce</b><span>time ≈ 2·(n−1)/n · bytes / link_bw + 2·(n−1)·latency. Bandwidth-optimal; latency grows with n, which is why trees or hierarchical algorithms win for small messages and large n.</span></div>
      <div><b>Why TP stays in the node</b><span>Tensor parallelism all-reduces activations twice per layer per micro-step. Over NVLink that is microseconds; over a NIC it would dominate the step. Pipeline and data parallelism cross nodes because they move less, less often.</span></div>
      <div><b>Overlap</b><span>NCCL kernels run on SMs and copy engines concurrently with compute on other streams; well-tuned training hides most communication behind the backward pass.</span></div>
      <div><b>GPUDirect</b><span>NICs and NVMe can DMA straight into HBM (GPUDirect RDMA / Storage) when the driver and PCIe topology allow it; otherwise bytes bounce through host DRAM and PCIe twice.</span></div>
    </div>
  `));
  const topo = root.querySelector('#mg-topo'), note = root.querySelector('#mg-note');
  const drawTopo = t => {
    topo.innerHTML = ''; const s = canvas(460, 210, 'GPU topology');
    const gpu = (x, y, l) => { svg('rect', { class: 'gpu', x, y, width: 44, height: 30, rx: 4 }, s); svg('text', { class: 'tiny', x: x + 22, y: y + 19, 'text-anchor': 'middle' }, s, l); };
    if (t === 'nvswitch') {
      svg('rect', { x: 40, y: 88, width: 380, height: 28, rx: 5, fill: 'var(--atlas-gpu)', opacity: .3, stroke: 'var(--atlas-gpu)' }, s); svg('text', { class: 'tiny', x: 230, y: 106, 'text-anchor': 'middle' }, s, 'NVSwitch fabric · any GPU ↔ any GPU at full NVLink bandwidth');
      for (let i = 0; i < 8; i++) { const x = 30 + i * 52; gpu(x, i < 4 ? 30 : 140, 'GPU' + i); svg('path', { class: 'comm', d: `M${x + 22} ${i < 4 ? 60 : 140} V${i < 4 ? 88 : 116}` }, s); }
      svg('text', { class: 'tiny mut', x: 10, y: 200 }, s, 'DGX/HGX-class node (example): NVLink islands of 8; CPUs and NICs hang off PCIe');
      note.innerHTML = '<p><b>NVSwitch node.</b> Every pair of GPUs communicates at full NVLink bandwidth regardless of placement; all-reduce over 8 GPUs is bandwidth-bound at hundreds of GB/s. Tensor-parallel groups of 8 fit here, which is why TP=8 is the common upper bound.</p>';
    } else if (t === 'pcie') {
      svg('rect', { x: 180, y: 90, width: 100, height: 26, rx: 4, fill: 'var(--atlas-cpu)', opacity: .35, stroke: 'var(--atlas-cpu)' }, s); svg('text', { class: 'tiny', x: 230, y: 107, 'text-anchor': 'middle' }, s, 'CPU root complex');
      [[60, 30], [160, 30], [260, 30], [360, 30]].forEach(([x], i) => { svg('rect', { x: x - 20, y: 48, width: 84, height: 18, rx: 3, fill: 'var(--atlas-io)', opacity: .35, stroke: 'var(--atlas-io)' }, s); svg('text', { class: 'tiny', x: x + 22, y: 61, 'text-anchor': 'middle', style: 'font-size:8px' }, s, 'PCIe switch'); svg('path', { class: 'comm', d: `M${x + 22} 66 V90` }, s); gpu(x - 20, 8, 'GPU' + (2 * i)); gpu(x + 30, 8, 'GPU' + (2 * i + 1)); });
      svg('text', { class: 'tiny mut', x: 10, y: 150 }, s, 'pairs under one switch get P2P at PCIe speed; pairs across the root complex share its bandwidth');
      svg('text', { class: 'tiny mut', x: 10, y: 166 }, s, 'nvidia-smi topo -m shows PIX / PXB / PHB / SYS between each pair');
      note.innerHTML = '<p><b>PCIe-only node.</b> Typical of L40S/A10-class inference boxes. P2P bandwidth is tens of GB/s and shared, so tensor parallelism beyond 2 hurts; prefer replicas with data parallelism and keep each model on as few GPUs as fit.</p>';
    } else {
      for (let n = 0; n < 2; n++) { const ox = n * 240; svg('rect', { x: 10 + ox, y: 10, width: 200, height: 150, rx: 6, fill: 'none', stroke: 'var(--atlas-border-strong)', 'stroke-dasharray': '4 3' }, s); svg('text', { class: 'tiny mut', x: 16 + ox, y: 24 }, s, 'node ' + n); for (let i = 0; i < 4; i++) gpu(20 + ox + i * 48, 34, 'G' + i); svg('rect', { x: 20 + ox, y: 76, width: 180, height: 14, rx: 3, fill: 'var(--atlas-gpu)', opacity: .3 }, s); svg('text', { class: 'tiny', x: 110 + ox, y: 86, 'text-anchor': 'middle', style: 'font-size:8px' }, s, 'NVLink'); for (let i = 0; i < 4; i++) { svg('rect', { x: 20 + ox + i * 48, y: 110, width: 44, height: 18, rx: 3, fill: 'var(--atlas-io)', opacity: .4, stroke: 'var(--atlas-io)' }, s); svg('text', { class: 'tiny', x: 42 + ox + i * 48, y: 122, 'text-anchor': 'middle', style: 'font-size:8px' }, s, 'NIC'); svg('path', { class: 'comm', d: `M${42 + ox + i * 48} 64 V110` }, s); } }
      svg('rect', { x: 150, y: 172, width: 160, height: 22, rx: 4, fill: 'var(--atlas-io)', opacity: .3, stroke: 'var(--atlas-io)' }, s); svg('text', { class: 'tiny', x: 230, y: 187, 'text-anchor': 'middle' }, s, 'InfiniBand / RoCE switch');
      for (let n = 0; n < 2; n++) for (let i = 0; i < 4; i++) svg('path', { class: 'comm', d: `M${42 + n * 240 + i * 48} 128 L${190 + n * 80} 172` }, s);
      note.innerHTML = '<p><b>Two nodes over InfiniBand.</b> One NIC per GPU (rail-optimized, example) so each GPU has its own 400 Gb/s path; GPUDirect RDMA lets the NIC DMA into HBM. Cross-node bandwidth per GPU is ~10× lower than NVLink, so schedulers place TP inside nodes and PP/DP across them.</p>';
    }
    topo.appendChild(s);
  };
  root.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => { root.querySelectorAll('[data-t]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false')); drawTopo(b.dataset.t); }));
  drawTopo('nvswitch');
  const ctl = root.querySelector('#mg-ctl'), stats = root.querySelector('#mg-stats');
  const f = {
    what: field({ id: 'mg-what', label: 'Payload', type: 'select', value: 'grads', options: [['grads', 'Gradient all-reduce (params × 2 B)'], ['act', 'TP activation all-reduce (tokens × d_model × 2 B)'], ['kv', 'KV transfer, one request (P2P)']] }),
    params: field({ id: 'mg-p', label: 'Parameters (B) / tokens×d_model (M) / KV (GB)', value: 8, min: 0.001, max: 10000, step: 0.001 }),
    n: field({ id: 'mg-n', label: 'GPUs in the group', type: 'range', value: 8, min: 2, max: 64, step: 1 }),
    fab: field({ id: 'mg-fab', label: 'Fabric', type: 'select', value: 'nvswitch', options: Object.entries(FABRICS).map(([k, v]) => [k, v[0]]) }),
  };
  Object.values(f).forEach(x => { ctl.appendChild(x.el); x.input.addEventListener('input', calc); });
  function calc() {
    const what = f.what.input.value, v = +f.params.input.value, n = +f.n.input.value, [, bw, lat] = FABRICS[f.fab.input.value];
    const bytes = what === 'grads' ? v * 1e9 * 2 : what === 'act' ? v * 1e6 * 2 : v * 1e9;
    const gb = bytes / 1e9;
    const ring = what === 'kv' ? gb / bw * 1000 + lat / 1000 : (2 * (n - 1) / n) * gb / bw * 1000 + 2 * (n - 1) * lat / 1000;
    stats.innerHTML = stat('payload', gb >= 1 ? gb.toFixed(2) + ' GB' : (gb * 1000).toFixed(1) + ' MB') + stat('link bandwidth', bw + ' GB/s') + stat(what === 'kv' ? 'transfer time' : 'ring all-reduce time', ring >= 1000 ? (ring / 1000).toFixed(2) + ' s' : ring >= 1 ? ring.toFixed(2) + ' ms' : (ring * 1000).toFixed(0) + ' µs', ring > 100 ? 'bad' : ring > 5 ? 'warn' : 'ok') + stat('bytes moved per GPU', what === 'kv' ? gb.toFixed(2) + ' GB' : (2 * (n - 1) / n * gb).toFixed(2) + ' GB') + (what === 'act' ? stat('per layer, ×2 per layer', '') : '');
  }
  calc();
}
