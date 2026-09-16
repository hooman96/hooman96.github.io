/** Microscope 09 — prefill vs decode shapes, chunked prefill, and static / dynamic / continuous batching. */
import { html, canvas, svg, stat, rng, prefersReducedMotion } from './util.js';

export const id = 'scope-batching';
export const short = 'Batching';
export const title = 'Prefill, decode, chunked prefill and continuous batching';
export const description = 'Prefill and decode are different workloads: one dense parallel pass over prompt tokens versus a bandwidth-bound loop producing one token per sequence per iteration. Watch how a scheduler packs them, and why LLM serving is not ordinary web request batching.';

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="scope-grid">
      <div id="pd-vis"></div>
      <div class="two">
        <div class="panel-desc"><p><b>Prefill.</b> All prompt tokens at once. High arithmetic intensity (large GEMMs), creates the KV state, sets time-to-first-token. Prefix caching can shrink it.</p></div>
        <div class="panel-desc"><p><b>Decode.</b> Commonly one new token per sequence per iteration. Re-reads every weight and all cached K/V each step, appends one K/V entry, sets inter-token latency. Memory-bandwidth sensitive; batching many sequences amortises the weight reads.</p></div>
      </div>
    </div>
    <div>
      <h4 class="ctl-label">Chunked prefill</h4>
      <div id="cp-vis"></div>
      <p class="ctl-help">A single long prompt would occupy the whole iteration and stall every active decode. Splitting it into chunks that share iterations with decode steps trades a little prompt throughput and TTFT for steady inter-token latency and scheduler fairness; the per-iteration token budget is the knob.</p>
    </div>
    <div>
      <h4 class="ctl-label">Batching strategies · click Run</h4>
      <div class="tabs" role="tablist" aria-label="Batching strategy">
        <button type="button" role="tab" aria-selected="true" data-b="static">Static</button>
        <button type="button" role="tab" aria-selected="false" data-b="dynamic">Dynamic</button>
        <button type="button" role="tab" aria-selected="false" data-b="continuous">Continuous / in-flight</button>
      </div>
      <div class="scope-controls" style="margin-bottom:.6rem"><button type="button" class="btn primary" id="cb-run">Run</button><button type="button" class="btn" id="cb-step">Step</button><button type="button" class="btn" id="cb-reset">Reset</button><span class="ctl-help" id="cb-msg" aria-live="polite"></span></div>
      <div id="cb-vis"></div>
      <div class="stat-row" id="cb-stats"></div>
      <div class="panel-desc" id="cb-note"></div>
    </div>
  `));

  // ---- prefill vs decode shapes ----
  {
    const s = canvas(460, 190, 'Prefill and decode workload shapes');
    svg('text', { class: 'mut', x: 10, y: 16 }, s, 'Prefill: one iteration, T tokens wide');
    for (let i = 0; i < 24; i++) svg('rect', { class: 'prefill', x: 10 + i * 18, y: 24, width: 16, height: 40, rx: 2 }, s);
    svg('text', { class: 'tiny mut', x: 10, y: 80 }, s, 'compute-bound · big GEMMs · writes K/V for all positions · TTFT');
    svg('text', { class: 'mut', x: 10, y: 108 }, s, 'Decode: N iterations, 1 token each (per sequence)');
    for (let i = 0; i < 24; i++) { svg('rect', { class: 'decode', x: 10 + i * 18, y: 116, width: 16, height: 14, rx: 2 }, s); svg('rect', { class: 'idle', x: 10 + i * 18, y: 132, width: 16, height: 30, rx: 2, style: 'opacity:.5' }, s); }
    svg('text', { class: 'tiny mut', x: 10, y: 178 }, s, 'bandwidth-bound · reads all weights + KV every step · appends 1 K/V · ITL');
    root.querySelector('#pd-vis').appendChild(s);
  }
  // ---- chunked prefill ----
  {
    const s = canvas(760, 120, 'Chunked prefill interleaved with decode');
    svg('text', { class: 'mut', x: 10, y: 14 }, s, 'Without chunking');
    svg('rect', { class: 'prefill', x: 10, y: 20, width: 300, height: 18, rx: 2 }, s); svg('text', { class: 'tiny', x: 160, y: 33, 'text-anchor': 'middle' }, s, 'one 6k-token prefill monopolises the iteration');
    for (let i = 0; i < 12; i++) svg('rect', { class: 'wait', x: 10 + i * 25, y: 42, width: 22, height: 8, rx: 1 }, s);
    svg('text', { class: 'tiny mut', x: 320, y: 48 }, s, '← active decodes stall (ITL spike)');
    svg('text', { class: 'mut', x: 10, y: 74 }, s, 'With chunked prefill (budget per iteration)');
    for (let i = 0; i < 12; i++) { svg('rect', { class: 'prefill', x: 10 + i * 62, y: 80, width: 30, height: 18, rx: 2 }, s); svg('text', { class: 'tiny', x: 25 + i * 62, y: 93, 'text-anchor': 'middle', style: 'font-size:8px' }, s, 'c' + (i + 1)); svg('rect', { class: 'decode', x: 42 + i * 62, y: 80, width: 26, height: 18, rx: 2 }, s); }
    svg('text', { class: 'tiny mut', x: 10, y: 114 }, s, 'each iteration: one prompt chunk + all active decode steps · steadier ITL, slightly later TTFT for the long prompt');
    root.querySelector('#cp-vis').appendChild(s);
  }

  // ---- batching simulation ----
  const SLOTS = 4, ITERS = 40; let mode = 'static', t = 0, timer = null, state;
  const arrivals = () => { const r = rng(11); const a = []; for (let i = 0; i < 10; i++) a.push({ id: i + 1, arrive: i < 4 ? 0 : 2 + Math.floor(r() * 26), len: 4 + Math.floor(r() * 16) }); return a.sort((x, y) => x.arrive - y.arrive); };
  function reset() { clearInterval(timer); timer = null; t = 0; state = { reqs: arrivals(), slots: new Array(SLOTS).fill(null), done: [], timeline: [], batchStart: null, gatherUntil: null }; draw(); }
  function step() {
    if (t >= ITERS) return;
    const S = state; const waiting = S.reqs.filter(r => r.arrive <= t && !r.started);
    const slotsFree = S.slots.filter(s => s === null).length;
    if (mode === 'static') {
      if (S.slots.every(s => s === null) && waiting.length) waiting.slice(0, SLOTS).forEach((r, i) => { r.started = t; S.slots[i] = r; });
    } else if (mode === 'dynamic') {
      if (S.slots.every(s => s === null)) { if (waiting.length && S.gatherUntil === null) S.gatherUntil = t + 3; if (S.gatherUntil !== null && (t >= S.gatherUntil || waiting.length >= SLOTS)) { waiting.slice(0, SLOTS).forEach((r, i) => { r.started = t; S.slots[i] = r; }); S.gatherUntil = null; } }
    } else {
      if (slotsFree && waiting.length) S.slots.forEach((s, i) => { if (s === null && waiting.length) { const r = waiting.shift(); r.started = t; S.slots[i] = r; } });
    }
    const row = S.slots.map(r => r ? (r.started === t ? 'P' : 'D') : (mode !== 'continuous' && S.slots.some(x => x) ? 'I' : '-'));
    S.timeline.push(row);
    S.slots.forEach((r, i) => { if (!r) return; r.gen = (r.gen || 0) + 1; if (r.gen >= r.len) { r.finish = t; S.done.push(r); S.slots[i] = null; } });
    t++; draw();
  }
  const vis = root.querySelector('#cb-vis'), stats = root.querySelector('#cb-stats'), msg = root.querySelector('#cb-msg'), note = root.querySelector('#cb-note');
  const NOTES = {
    static: '<p><b>Static batching.</b> A batch starts together and no one joins until everyone finishes. Short sequences complete early and their slots sit idle (grey) while the longest request keeps the batch alive. Simple, but wasteful for LLMs because output lengths vary by an order of magnitude.</p>',
    dynamic: '<p><b>Dynamic batching.</b> The server waits a short window to gather arrivals so batches start fuller. Better initial packing than static, but membership is still fixed for the batch lifetime, so idle slots and queueing delay remain. This is the ordinary web-serving notion of batching.</p>',
    continuous: '<p><b>Continuous / in-flight batching.</b> At every decode iteration boundary, finished sequences leave and waiting ones join (their prefill runs in that iteration, marked P). Batch membership, the token budget and the KV allocation are repacked continuously. Iteration-level scheduling is why LLM engines keep GPUs busy with variable-length requests.</p>',
  };
  function draw() {
    vis.innerHTML = '';
    const W = 760, cw = 17, H = 20 + SLOTS * 22 + 24, s = canvas(W, H, 'Batch slot occupancy over decode iterations');
    for (let i = 0; i < SLOTS; i++) svg('text', { class: 'tiny mut', x: 8, y: 32 + i * 22 }, s, 'slot ' + i);
    state.timeline.forEach((row, x) => row.forEach((c, i) => { if (c === '-') return; svg('rect', { class: c === 'P' ? 'prefill' : c === 'D' ? 'decode' : 'idle', x: 50 + x * cw, y: 20 + i * 22, width: cw - 2, height: 18, rx: 2 }, s); }));
    const waitingNow = state.reqs.filter(r => r.arrive <= t && !r.started).length;
    svg('text', { class: 'tiny mut', x: 50, y: H - 6 }, s, `iteration ${t}/${ITERS} · blue = prefill, green = decode, grey = idle slot · waiting in queue: ${waitingNow}`);
    vis.appendChild(s);
    const usedCells = state.timeline.flat().filter(c => c === 'P' || c === 'D').length, cells = state.timeline.flat().filter(c => c !== '-').length || 1;
    const done = state.done; const avgWait = done.length ? done.reduce((a, r) => a + (r.started - r.arrive), 0) / done.length : 0;
    stats.innerHTML = stat('batch occupancy', (100 * usedCells / cells).toFixed(0) + '%', usedCells / cells > .85 ? 'ok' : usedCells / cells > .6 ? 'warn' : 'bad') + stat('completed', `${done.length} / ${state.reqs.length}`) + stat('avg queue wait (iters)', avgWait.toFixed(1), avgWait > 6 ? 'bad' : avgWait > 3 ? 'warn' : 'ok');
    note.innerHTML = NOTES[mode]; msg.textContent = t >= ITERS ? 'Run complete.' : '';
  }
  root.querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', () => { root.querySelectorAll('[data-b]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false')); mode = b.dataset.b; reset(); }));
  root.querySelector('#cb-step').addEventListener('click', step);
  root.querySelector('#cb-reset').addEventListener('click', reset);
  root.querySelector('#cb-run').addEventListener('click', () => { if (timer) { clearInterval(timer); timer = null; return; } if (t >= ITERS) reset(); if (prefersReducedMotion()) { while (t < ITERS) step(); return; } timer = setInterval(() => { step(); if (t >= ITERS) { clearInterval(timer); timer = null; } }, 220); });
  reset();
}
