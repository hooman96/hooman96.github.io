/** Microscope 03 — grid/block/warp hierarchy and an occupancy + wave calculator. */
import { html, canvas, svg, field, stat, fmt } from '/atlas-core/js/microscopes/util.js';

export const id = 'scope-occupancy';
export const short = 'Occupancy';
export const title = 'Grid, blocks, warps and occupancy';
export const description = 'A kernel launch is a grid of thread blocks; blocks are placed on streaming multiprocessors that have free registers, shared memory and warp slots; each block runs as warps of 32 threads. The calculator shows which resource limits residency, the resulting occupancy, and how many waves the grid takes on the whole GPU.';

const SM = { h100: { name: 'H100 SXM (example)', sms: 132, warps: 64, blocks: 32, regs: 65536, smem: 228 * 1024 }, a100: { name: 'A100 (example)', sms: 108, warps: 64, blocks: 32, regs: 65536, smem: 164 * 1024 } };

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="scope-grid">
      <div id="oc-hier"></div>
      <div class="panel-desc">
        <p><b>Thread → warp → block → grid.</b> Threads are grouped into warps of 32 that execute in lockstep (SIMT). Blocks of up to 1024 threads share an SM's shared memory and can synchronize; blocks are independent so the hardware can place them on any SM in any order. Grids can be much larger than the machine; blocks run in waves.</p>
        <p><b>Occupancy</b> = resident warps ÷ maximum warps per SM. It is limited by whichever runs out first: registers (65,536 32-bit per SM on H100), shared memory (up to 228 KB), warp slots (64) or block slots (32). High occupancy hides memory latency by switching warps; but a kernel with enough instruction-level parallelism can run at full speed with low occupancy. Tensor-core GEMMs often run at 25–50% by design.</p>
        <p><b>Waves and tails.</b> If the grid has 1.1× the blocks the GPU can hold at once, the second wave runs 10% of the blocks on an idle machine. Choose grid sizes (or use persistent kernels / stream-K) so the tail is small.</p>
      </div>
    </div>
    <div class="scope-controls" id="oc-ctl"></div>
    <div class="stat-row" id="oc-stats"></div>
    <div id="oc-vis"></div>
  `));
  // hierarchy drawing
  {
    const s = canvas(460, 150, 'Grid of blocks onto SMs as warps');
    svg('text', { class: 'mut', x: 8, y: 14 }, s, 'grid (blocks)'); for (let i = 0; i < 24; i++) svg('rect', { class: 'box sub-kernels', x: 8 + (i % 8) * 18, y: 22 + Math.floor(i / 8) * 18, width: 15, height: 15, rx: 2 }, s);
    svg('path', { class: 'arrow', d: 'M160 50 H200' }, s); svg('text', { class: 'tiny mut', x: 180, y: 44, 'text-anchor': 'middle' }, s, 'placed');
    svg('text', { class: 'mut', x: 210, y: 14 }, s, 'SMs (each holds several blocks)'); for (let i = 0; i < 4; i++) { svg('rect', { class: 'gpu', x: 210 + i * 62, y: 22, width: 54, height: 54, rx: 4 }, s); for (let b = 0; b < 3; b++) svg('rect', { class: 'box sub-kernels', x: 216 + b * 16, y: 30 + (i % 2) * 6, width: 12, height: 12, rx: 2 }, s); svg('text', { class: 'tiny mut', x: 237 + i * 62, y: 68, 'text-anchor': 'middle' }, s, 'SM' + i); }
    svg('text', { class: 'mut', x: 8, y: 104 }, s, 'one block = warps of 32 lanes'); for (let w = 0; w < 4; w++) { for (let l = 0; l < 32; l++) svg('rect', { x: 8 + l * 6, y: 112 + w * 8, width: 5, height: 6, fill: 'var(--atlas-gpu)', opacity: l < 24 || w < 3 ? 1 : .3 }, s); svg('text', { class: 'tiny mut', x: 206, y: 118 + w * 8 }, s, 'warp ' + w); }
    svg('text', { class: 'tiny mut', x: 250, y: 120 }, s, 'lanes execute the same instruction;'); svg('text', { class: 'tiny mut', x: 250, y: 132 }, s, 'divergent branches serialize (dim lanes idle)');
    root.querySelector('#oc-hier').appendChild(s);
  }
  const ctl = root.querySelector('#oc-ctl'), stats = root.querySelector('#oc-stats'), vis = root.querySelector('#oc-vis');
  const f = {
    gpu: field({ id: 'oc-gpu', label: 'GPU', type: 'select', value: 'h100', options: Object.entries(SM).map(([k, v]) => [k, v.name]) }),
    tpb: field({ id: 'oc-tpb', label: 'Threads / block', type: 'select', value: '256', options: [['64', '64'], ['128', '128'], ['256', '256'], ['512', '512'], ['1024', '1024']] }),
    regs: field({ id: 'oc-regs', label: 'Registers / thread', type: 'range', value: 64, min: 16, max: 255, step: 1 }),
    smem: field({ id: 'oc-smem', label: 'Shared memory / block (KB)', type: 'range', value: 48, min: 0, max: 227, step: 1, unit: ' KB' }),
    grid: field({ id: 'oc-grid', label: 'Blocks in grid', value: 2048, min: 1, max: 1000000 }),
  };
  Object.values(f).forEach(x => { ctl.appendChild(x.el); x.input.addEventListener('input', draw); });
  function draw() {
    const g = SM[f.gpu.input.value], tpb = +f.tpb.input.value, regs = +f.regs.input.value, smem = +f.smem.input.value * 1024, grid = +f.grid.input.value;
    const warpsPerBlock = Math.ceil(tpb / 32);
    const byWarps = Math.floor(g.warps / warpsPerBlock), byBlocks = g.blocks, byRegs = Math.floor(g.regs / (Math.ceil(regs / 8) * 8 * tpb)), bySmem = smem > 0 ? Math.floor(g.smem / (smem + 1024)) : g.blocks;
    const limits = { 'warp slots': byWarps, 'block slots': byBlocks, registers: byRegs, 'shared memory': bySmem };
    const blocksPerSM = Math.max(0, Math.min(...Object.values(limits)));
    const limiter = Object.entries(limits).find(([, v]) => v === blocksPerSM)?.[0];
    const residentWarps = blocksPerSM * warpsPerBlock, occ = residentWarps / g.warps;
    const capacity = blocksPerSM * g.sms, waves = capacity ? grid / capacity : Infinity; const tail = capacity ? (Math.ceil(waves) - waves) / Math.ceil(waves) : 0;
    stats.innerHTML = stat('blocks / SM', String(blocksPerSM), blocksPerSM ? '' : 'bad') + stat('limited by', limiter || '—', 'warn') + stat('resident warps', `${residentWarps} / ${g.warps}`) + stat('occupancy', (occ * 100).toFixed(0) + '%', occ >= .5 ? 'ok' : occ >= .25 ? 'warn' : 'bad') + stat('blocks per wave', fmt(capacity)) + stat('waves', waves.toFixed(2)) + stat('last-wave idle', (tail * 100).toFixed(0) + '%', tail > .3 ? 'bad' : tail > .1 ? 'warn' : 'ok');
    vis.innerHTML = '';
    const W = 760, H = 90, s = canvas(W, H, 'Residency limits');
    const maxV = Math.max(1, ...Object.values(limits));
    Object.entries(limits).forEach(([k, v], i) => { const x = 10 + i * 185; const w = Math.min(160, (Math.min(v, 64) / Math.min(maxV, 64)) * 160); svg('text', { class: 'tiny mut', x, y: 14 }, s, k); svg('rect', { class: 'lane', x, y: 20, width: 160, height: 16, rx: 3 }, s); svg('rect', { x, y: 20, width: Math.max(2, w), height: 16, rx: 3, fill: v === blocksPerSM ? 'var(--atlas-warn)' : 'var(--atlas-gpu)' }, s); svg('text', { class: 'tiny', x: x + 164, y: 32 }, s, `${v}`); });
    svg('text', { class: 'tiny mut', x: 10, y: 66 }, s, `${warpsPerBlock} warps/block · ${Math.ceil(regs / 8) * 8} regs/thread (allocated in groups of 8) · ${(smem / 1024).toFixed(0)} KB + 1 KB reserved smem/block`);
    svg('text', { class: 'tiny mut', x: 10, y: 82 }, s, 'the shortest bar is the binding limit; raising it changes nothing until the next limit binds');
    vis.appendChild(s);
  }
  draw();
}
