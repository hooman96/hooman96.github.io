/** Microscope 05 — threads, cores and the GIL: a concurrency simulator for a Python serving process. */
import { html, canvas, svg, field, stat } from '/atlas-core/js/microscopes/util.js';

export const id = 'scope-threads';
export const short = 'Threads & GIL';
export const title = 'Threads, cores and the GIL';
export const description = 'Application thread → OS thread → hardware thread → core. Python adds one more constraint: only one thread runs bytecode at a time per interpreter. Simulate a serving process with a mix of Python work, GIL-released native work and I/O, and compare threads, processes and an async loop on the same cores.';

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="scope-grid">
      <div id="th-map"></div>
      <div class="panel-desc">
        <p><b>Four kinds of "thread".</b> An application thread (Python <code>threading.Thread</code>) is a kernel task scheduled by the OS onto a hardware thread; with SMT a core exposes two hardware threads that share its execution units. CUDA threads are something else entirely: SIMT lanes inside warps, scheduled by the GPU, thousands per SM.</p>
        <p><b>The GIL.</b> CPython lets one thread execute bytecode at a time. Threads still help when work releases the GIL: blocking I/O, most NumPy/PyTorch C++ ops, tokenizers written in Rust. Pure-Python scheduling logic, request parsing and JSON work do not scale across threads; they scale across processes.</p>
        <p><b>Async.</b> An event loop is one thread interleaving many coroutines at await points: high concurrency for I/O and token streaming, zero parallelism. Any CPU-bound call on the loop stalls every stream at once.</p>
      </div>
    </div>
    <div class="scope-controls" id="th-ctl"></div>
    <div id="th-vis"></div>
    <div class="stat-row" id="th-stats"></div>
    <div class="note"><b>Co-design reading.</b> An inference engine typically runs one process per GPU, keeps the Python scheduler loop tight, moves tokenization and HTTP into separate processes or threads that release the GIL, pins the engine thread to a core near the GPU's NUMA node, and avoids anything that blocks the launch thread, because a stalled launch thread starves the GPU.</div>
  `));
  {
    const s = canvas(460, 130, 'Thread mapping');
    const rows = [['app threads', 'app', 6], ['OS threads (tasks)', 'kernel', 6], ['hardware threads (SMT)', 'cpu', 4], ['cores', 'cpu', 2]];
    rows.forEach(([n, sub, k], i) => { const y = 10 + i * 30; svg('text', { class: 'tiny mut', x: 8, y: y + 14 }, s, n); for (let j = 0; j < k; j++) svg('rect', { class: 'box sub-' + sub, x: 170 + j * 46, y, width: 40, height: 20, rx: 3 }, s); });
    for (let j = 0; j < 6; j++) svg('path', { class: 'comm', d: `M${190 + j * 46} 30 V40` }, s);
    for (let j = 0; j < 6; j++) svg('path', { class: 'comm', d: `M${190 + j * 46} 60 L${190 + (j % 4) * 46} 70` }, s);
    for (let j = 0; j < 4; j++) svg('path', { class: 'comm', d: `M${190 + j * 46} 90 L${190 + Math.floor(j / 2) * 46} 100` }, s);
    svg('text', { class: 'tiny mut', x: 8, y: 126 }, s, 'many-to-few at each level; the OS scheduler and SMT decide who actually runs');
    root.querySelector('#th-map').appendChild(s);
  }
  const ctl = root.querySelector('#th-ctl'), vis = root.querySelector('#th-vis'), stats = root.querySelector('#th-stats');
  const f = {
    workers: field({ id: 'th-w', label: 'Workers (threads / processes / tasks)', type: 'range', value: 4, min: 1, max: 16, step: 1 }),
    cores: field({ id: 'th-c', label: 'CPU cores', type: 'range', value: 4, min: 1, max: 16, step: 1 }),
    py: field({ id: 'th-py', label: 'Python bytecode share', type: 'range', value: 0.4, min: 0, max: 1, step: 0.05 }),
    io: field({ id: 'th-io', label: 'Blocking I/O share', type: 'range', value: 0.3, min: 0, max: 1, step: 0.05 }),
    model: field({ id: 'th-m', label: 'Execution model', type: 'select', value: 'threads', options: [['threads', 'Threads (one GIL)'], ['procs', 'Processes (one GIL each)'], ['async', 'Async event loop (one thread)'], ['nogil', 'Free-threaded CPython (experimental)']] }),
  };
  Object.values(f).forEach(x => { ctl.appendChild(x.el); x.input.addEventListener('input', draw); });
  function draw() {
    const w = +f.workers.input.value, cores = +f.cores.input.value, py = Math.min(1, +f.py.input.value), io = Math.min(1 - py, +f.io.input.value), native = Math.max(0, 1 - py - io);
    const model = f.model.input.value;
    // Each worker has unit work: py (needs GIL + core), native (core, GIL released), io (no core). Estimate throughput relative to 1 worker.
    let speedup, explain;
    if (model === 'threads') { const pyCap = py > 0 ? 1 / py : Infinity; const coreCap = (py + native) > 0 ? cores / (py + native) : Infinity; speedup = Math.min(w, pyCap, coreCap); explain = 'GIL serializes the Python share; native work and I/O overlap.'; }
    else if (model === 'procs') { const coreCap = (py + native) > 0 ? cores / (py + native) : Infinity; speedup = Math.min(w, coreCap); explain = 'Each process has its own GIL; bound only by cores. Costs memory and IPC.'; }
    else if (model === 'async') { const cpu = py + native; speedup = cpu > 0 ? Math.min(w, 1 / cpu) : w; explain = 'One thread: only the I/O share overlaps. CPU work of any kind stalls all tasks.'; }
    else { const coreCap = (py + native) > 0 ? cores / (py + native) : Infinity; speedup = Math.min(w, coreCap); explain = 'No GIL: Python bytecode runs in parallel; bound by cores. Single-thread overhead and ecosystem support are the caveats (PEP 703).'; }
    const util = (speedup * (py + native)) / cores;
    vis.innerHTML = '';
    const W = 760, H = 30 + w * 14, s = canvas(W, H, 'Worker timelines'); const T = 100; const sc = (W - 80) / (T * Math.max(1, w / speedup));
    for (let i = 0; i < w; i++) {
      const y = 14 + i * 14; svg('text', { class: 'tiny mut', x: 8, y: y + 9 }, s, 'w' + i);
      // draw each worker's unit of work stretched by the contention factor for its serialized part
      const stretch = w / speedup; let x = 60;
      const segs = [[py, 'var(--atlas-app)', 'py'], [native, 'var(--atlas-runtime)', 'native'], [io, 'var(--atlas-io)', 'io']];
      const offset = (i * T * (stretch - 1) / Math.max(1, w - 1)) * sc; x += offset;
      for (const [share, col] of segs) { const wd = share * T * sc; if (wd > 0) { svg('rect', { x, y, width: wd, height: 10, fill: col }, s); x += wd; } }
    }
    svg('text', { class: 'tiny mut', x: 60, y: H - 4 }, s, 'pink = Python bytecode (needs the GIL) · violet = native / GIL released · grey = blocking I/O · offsets show serialization');
    vis.appendChild(s);
    stats.innerHTML = stat('effective parallelism', speedup.toFixed(2) + '×', speedup >= cores * .8 ? 'ok' : speedup > 1.5 ? 'warn' : 'bad') + stat('core utilization', (Math.min(1, util) * 100).toFixed(0) + '%') + stat('shares', `py ${(py * 100).toFixed(0)} · native ${(native * 100).toFixed(0)} · io ${(io * 100).toFixed(0)}`) + `<div class="stat" style="grid-column:span 2"><b style="font-size:.85rem;font-family:var(--sans);font-weight:400">${explain}</b><span>why</span></div>`;
  }
  draw();
}
