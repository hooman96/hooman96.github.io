/** Microscope 04 — memory hierarchy explorer and a weight-loading path calculator. */
import { html, canvas, svg, field, stat, fmt } from '/atlas-core/js/microscopes/util.js';

export const id = 'scope-memory';
export const short = 'Memory hierarchy';
export const title = 'Memory hierarchy: where the bytes live';
export const description = 'Eleven tiers from a register to object storage, spanning nine orders of magnitude in latency and four in bandwidth. Then a calculator for the question every cold start asks: how long until the weights are in HBM, and which hop is the bottleneck?';

// [name, subsystem, latency ns, bandwidth GB/s, note] — illustrative, generation-dependent values
const TIERS = [
  ['Register', 'gpu', 0.5, 200000, 'per-SM register file; effectively free'],
  ['Shared memory / L1', 'gpu', 20, 30000, 'per-SM scratchpad, ~228 KB on H100 (example)'],
  ['GPU L2', 'gpu', 150, 12000, '50 MB on H100 (example), shared by all SMs'],
  ['HBM', 'gpu', 500, 3350, 'H100 SXM HBM3 (example)'],
  ['Peer GPU over NVLink', 'io', 2000, 450, 'per direction per GPU, NVLink 4 (example)'],
  ['Host DRAM via PCIe 5 x16', 'io', 3000, 64, 'nominal per direction; ~50 achievable'],
  ['Host DRAM (CPU-side)', 'cpu', 90, 300, 'DDR5 per socket (example); CPU sees it, GPU does not'],
  ['CPU L3', 'cpu', 15, 1000, 'tens of MB shared'],
  ['NVMe SSD (local)', 'io', 80000, 7, 'PCIe 4 x4 drive (example)'],
  ['RDMA network (400 Gb/s)', 'io', 2500, 50, 'InfiniBand NDR per NIC (example)'],
  ['Object storage (S3-class)', 'io', 50000000, 2, 'per node with parallel ranged GETs (example)'],
];

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div id="mh-vis"></div>
    <p class="ctl-help">Log scales. Values are typical, generation-dependent examples for one node with H100-class GPUs; the shape of the ladder matters more than any single number.</p>
    <div style="margin-top:1rem">
      <h4 class="ctl-label">Weight loading path · cold start calculator</h4>
      <div class="scope-controls" id="mh-ctl"></div>
      <div id="mh-path"></div>
      <div class="stat-row" id="mh-stats"></div>
      <div class="two">
        <div class="note"><b>Pinned vs pageable.</b> DMA engines can only read page-locked (pinned) host memory. A cudaMemcpy from ordinary pageable memory first copies into a pinned staging buffer, which halves effective bandwidth and blocks overlap. Engines that load fast pin a large staging buffer once and stream through it.</div>
        <div class="note"><b>Page cache.</b> The second load of the same file from local disk is served from host DRAM by the page cache, which is why warm restarts are fast and why memory pressure (or a fresh node) makes them slow again. mmap-based formats such as safetensors lean on this deliberately.</div>
      </div>
    </div>
  `));
  // ladder
  {
    const W = 760, rowH = 22, H = 30 + TIERS.length * rowH, s = canvas(W, H, 'Latency and bandwidth per memory tier');
    svg('text', { class: 'tiny mut', x: 200, y: 12 }, s, 'latency (0.1 ns … 100 ms, log)'); svg('text', { class: 'tiny mut', x: 500, y: 12 }, s, 'bandwidth (1 GB/s … 1 PB/s, log)');
    const lx = ns => 200 + (Math.log10(ns) + 1) / 10 * 260; const bx = gb => 500 + Math.log10(gb) / 6 * 250;
    TIERS.forEach(([n, sub, lat, bw], i) => {
      const y = 24 + i * rowH;
      svg('text', { class: 'tiny', x: 8, y: y + 12 }, s, n);
      svg('rect', { class: 'lane', x: 200, y: y + 2, width: 260, height: 14, rx: 2 }, s); svg('rect', { x: 200, y: y + 2, width: Math.max(2, lx(lat) - 200), height: 14, rx: 2, fill: `var(--atlas-${sub})` }, s);
      svg('text', { class: 'tiny mut', x: Math.min(lx(lat) + 4, 440), y: y + 12 }, s, lat >= 1e6 ? (lat / 1e6).toFixed(0) + ' ms' : lat >= 1000 ? (lat / 1000).toFixed(1) + ' µs' : lat + ' ns');
      svg('rect', { class: 'lane', x: 500, y: y + 2, width: 250, height: 14, rx: 2 }, s); svg('rect', { x: 500, y: y + 2, width: Math.max(2, bx(bw) - 500), height: 14, rx: 2, fill: `var(--atlas-${sub})`, opacity: .8 }, s);
      svg('text', { class: 'tiny mut', x: Math.min(bx(bw) + 4, 700), y: y + 12 }, s, bw >= 1000 ? (bw / 1000).toFixed(bw >= 10000 ? 0 : 1) + ' TB/s' : bw + ' GB/s');
    });
    root.querySelector('#mh-vis').appendChild(s);
  }
  const ctl = root.querySelector('#mh-ctl'), pathEl = root.querySelector('#mh-path'), stats = root.querySelector('#mh-stats');
  const f = {
    gb: field({ id: 'mh-gb', label: 'Weights (GB)', value: 140, min: 1, max: 5000 }),
    src: field({ id: 'mh-src', label: 'Source', type: 'select', value: 'nvme', options: [['s3', 'Object storage (2 GB/s)'], ['nvme', 'Local NVMe (7 GB/s)'], ['raid', 'NVMe RAID (25 GB/s)'], ['cache', 'Page cache (already in DRAM)']] }),
    host: field({ id: 'mh-host', label: 'Host memory path', type: 'select', value: 'pinned', options: [['pageable', 'Pageable (staged copy)'], ['pinned', 'Pinned staging buffer']] }),
    pcie: field({ id: 'mh-pcie', label: 'PCIe', type: 'select', value: '50', options: [['25', 'Gen4 x16 (~25 GB/s achievable)'], ['50', 'Gen5 x16 (~50 GB/s achievable)']] }),
    gpus: field({ id: 'mh-gpus', label: 'GPUs loading in parallel', type: 'range', value: 1, min: 1, max: 8, step: 1 }),
  };
  Object.values(f).forEach(x => { ctl.appendChild(x.el); x.input.addEventListener('input', draw); });
  function draw() {
    const gb = +f.gb.input.value, gpus = +f.gpus.input.value, perGpu = gb / gpus;
    const srcBw = { s3: 2, nvme: 7, raid: 25, cache: Infinity }[f.src.input.value];
    const pcieBw = +f.pcie.input.value * (f.host.input.value === 'pageable' ? 0.5 : 1);
    const hops = [
      ['storage → DRAM', srcBw === Infinity ? 0 : gb / srcBw, srcBw === Infinity ? 'page cache hit' : `${srcBw} GB/s shared by all GPUs`],
      ['DRAM → pinned staging', f.host.input.value === 'pageable' ? gb / 20 : 0, f.host.input.value === 'pageable' ? 'extra memcpy at ~20 GB/s' : 'no extra copy'],
      ['pinned → HBM over PCIe', perGpu / pcieBw, `${pcieBw} GB/s per GPU, ${gpus} in parallel`],
    ];
    const total = hops.reduce((a, h) => a + h[1], 0); const worst = hops.reduce((a, h) => (h[1] > a[1] ? h : a), hops[0]);
    pathEl.innerHTML = '';
    const W = 760, H = 80, s = canvas(W, H, 'Weight loading hops'); const sc = (W - 20) / Math.max(total, 1e-9);
    let x = 10; hops.forEach(([n, t, note], i) => { const w = Math.max(t * sc, t > 0 ? 4 : 0); if (w > 0) { svg('rect', { x, y: 20, width: w, height: 26, rx: 3, fill: i === 0 ? 'var(--atlas-io)' : i === 1 ? 'var(--atlas-cpu)' : 'var(--atlas-gpu)' }, s); if (w > 60) svg('text', { class: 'tiny', x: x + w / 2, y: 37, 'text-anchor': 'middle' }, s, `${n} · ${t.toFixed(1)} s`); x += w; } });
    svg('text', { class: 'tiny mut', x: 10, y: 66 }, s, hops.map(h => `${h[0]}: ${h[1].toFixed(1)} s (${h[2]})`).join('   ·   '));
    pathEl.appendChild(s);
    stats.innerHTML = stat('cold start (weights)', total.toFixed(1) + ' s') + stat('bottleneck hop', worst[0], 'warn') + stat('effective rate', (gb / Math.max(total, 1e-9)).toFixed(1) + ' GB/s') + stat('per GPU in HBM', perGpu.toFixed(1) + ' GB');
  }
  draw();
}
