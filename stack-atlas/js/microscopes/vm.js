/** Microscope 06 — virtual memory: page-table walk, TLB reach, page faults, pinned memory and DMA, nested paging. */
import { html, canvas, svg, field, stat, fmt } from '/atlas-core/js/microscopes/util.js';

export const id = 'scope-vm';
export const short = 'Virtual memory';
export const title = 'Virtual memory, TLBs and DMA';
export const description = 'Every pointer your process holds is virtual. Hardware walks page tables to find physical frames, caches the translations in TLBs, and traps to the kernel when a page is missing. Devices bypass all of this with DMA, which is why memory for GPUs and NICs must be pinned. Walk an address, size a TLB, and see what a hypervisor adds.';

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="scope-grid">
      <div>
        <div class="scope-controls" style="margin-bottom:.6rem" id="vm-ctl"></div>
        <div id="vm-walk"></div>
      </div>
      <div class="panel-desc" id="vm-note"></div>
    </div>
    <div class="stat-row" id="vm-stats"></div>
    <div class="scope-grid" style="margin-top:.6rem">
      <div id="vm-dma"></div>
      <div class="panel-desc">
        <p><b>Faults.</b> A <b>minor</b> fault maps a page that is already in memory (first touch, copy-on-write, page-cache hit): a few microseconds. A <b>major</b> fault must read from disk: tens of microseconds on NVMe, milliseconds on spinning disks or network storage. mmap-loading a checkpoint is a stream of faults; read-ahead and huge pages reduce their count.</p>
        <p><b>DMA needs pinned pages.</b> A device writes physical addresses. If the kernel could move or swap the page mid-transfer, the DMA would corrupt memory, so the driver pins (page-locks) the buffer and the IOMMU translates and fences the device's view. cudaHostAlloc pins for you; pageable buffers are staged through a pinned bounce buffer.</p>
        <p><b>Nested paging in a VM.</b> The guest walks its own tables, and every guest-physical address is translated again through the hypervisor's tables (EPT/NPT). A miss in both can cost up to 24 memory references on a 4-level system instead of 4; huge pages in host and guest are the usual remedy.</p>
      </div>
    </div>
  `));
  const ctl = root.querySelector('#vm-ctl'), walk = root.querySelector('#vm-walk'), note = root.querySelector('#vm-note'), stats = root.querySelector('#vm-stats');
  const f = {
    page: field({ id: 'vm-page', label: 'Page size', type: 'select', value: '4096', options: [['4096', '4 KB'], ['2097152', '2 MB (huge)'], ['1073741824', '1 GB (giant)']] }),
    tlb: field({ id: 'vm-tlb', label: 'TLB entries (L2 dTLB)', value: 2048, min: 16, max: 65536 }),
    ws: field({ id: 'vm-ws', label: 'Working set (GB)', value: 64, min: 0.001, max: 4096, step: 0.5 }),
    vm: field({ id: 'vm-vm', label: 'Environment', type: 'select', value: 'bare', options: [['bare', 'Bare metal'], ['vm', 'Inside a VM (nested paging)']] }),
  };
  Object.values(f).forEach(x => { ctl.appendChild(x.el); x.input.addEventListener('input', draw); });
  function draw() {
    const page = +f.page.input.value, tlb = +f.tlb.input.value, ws = +f.ws.input.value * 1e9, nested = f.vm.input.value === 'vm';
    const levels = page === 4096 ? 4 : page === 2097152 ? 3 : 2;
    const reach = tlb * page; const pages = Math.ceil(ws / page);
    const walkRefs = nested ? levels * levels + 2 * levels : levels;
    walk.innerHTML = '';
    const W = 460, H = 150, s = canvas(W, H, 'Page table walk');
    const names = ['PGD', 'PUD', 'PMD', 'PTE'].slice(0, levels);
    svg('text', { class: 'mut', x: 8, y: 14 }, s, `48-bit virtual address → ${levels}-level walk → ${page === 4096 ? '4 KB' : page === 2097152 ? '2 MB' : '1 GB'} frame`);
    // VA bit fields
    const fields = [...names.map(n => [n, 9]), ['offset', Math.log2(page)]];
    const totalBits = fields.reduce((a, b) => a + b[1], 0); let x = 8;
    fields.forEach(([n, bits], i) => { const w = (bits / totalBits) * 440; svg('rect', { class: 'box ' + (i < names.length ? 'sub-kernel' : 'sub-cpu'), x, y: 24, width: w - 2, height: 22, rx: 3 }, s); svg('text', { class: 'tiny', x: x + (w - 2) / 2, y: 39, 'text-anchor': 'middle' }, s, `${n} (${bits}b)`); x += w; });
    x = 8; names.forEach((n, i) => { svg('rect', { class: 'box sub-kernel', x: 8 + i * 110, y: 70, width: 90, height: 24, rx: 3 }, s); svg('text', { class: 'tiny', x: 53 + i * 110, y: 86, 'text-anchor': 'middle' }, s, n + ' table'); if (i < names.length - 1) svg('path', { class: 'arrow', d: `M${98 + i * 110} 82 H${116 + i * 110}` }, s); });
    svg('text', { class: 'tiny mut', x: 8, y: 116 }, s, `${walkRefs} memory references on a full TLB miss${nested ? ' (nested: each guest level walks the host tables)' : ''}; TLB hit: 0`);
    svg('text', { class: 'tiny mut', x: 8, y: 134 }, s, `TLB reach = ${tlb} entries × page = ${reach >= 1e9 ? (reach / 1e9).toFixed(1) + ' GB' : (reach / 1e6).toFixed(0) + ' MB'}`);
    walk.appendChild(s);
    const covered = Math.min(1, reach / ws);
    stats.innerHTML = stat('pages in working set', fmt(pages)) + stat('TLB reach', reach >= 1e9 ? (reach / 1e9).toFixed(1) + ' GB' : (reach / 1e6).toFixed(0) + ' MB') + stat('working set covered', (covered * 100).toFixed(1) + '%', covered > .9 ? 'ok' : covered > .1 ? 'warn' : 'bad') + stat('refs per TLB miss', String(walkRefs), nested ? 'warn' : '') + stat('page-table size', fmt(pages * 8 / 1e6) + ' MB (8 B/PTE)');
    note.innerHTML = `<p>${covered < 0.1 ? '<b>TLB-bound.</b> Random access over this working set misses the TLB almost every time; each miss costs a page walk (partly cached in the page-walk caches). Huge pages multiply reach by 512.' : covered < 0.9 ? '<b>Partial coverage.</b> Hot subsets fit; streaming across the set will still miss.' : '<b>TLB covers the working set.</b> Translation is off the critical path for this access pattern.'}</p><p>GPU memory has the same structure: the driver manages GPU page tables (commonly 2 MB pages for HBM allocations), and unified memory takes GPU-side page faults that migrate pages over PCIe, which is why on-demand migration stalls kernels.</p>`;
  }
  draw();
  {
    const s = canvas(460, 150, 'Pageable versus pinned copy path');
    const box = (x, y, w, t, cls) => { svg('rect', { class: 'box ' + cls, x, y, width: w, height: 26, rx: 4 }, s); svg('text', { class: 'tiny', x: x + w / 2, y: y + 17, 'text-anchor': 'middle' }, s, t); };
    svg('text', { class: 'mut', x: 8, y: 14 }, s, 'pageable host buffer');
    box(8, 22, 110, 'pageable pages', 'sub-cpu'); box(150, 22, 120, 'pinned staging', 'sub-kernel'); box(310, 22, 130, 'HBM (DMA)', 'sub-gpu');
    svg('path', { class: 'arrow', d: 'M118 35 H148' }, s); svg('text', { class: 'tiny mut', x: 133, y: 30, 'text-anchor': 'middle' }, s, 'CPU memcpy'); svg('path', { class: 'arrow on', d: 'M270 35 H308' }, s);
    svg('text', { class: 'tiny mut', x: 8, y: 66 }, s, 'two copies, CPU busy, cannot fully overlap with compute');
    svg('text', { class: 'mut', x: 8, y: 96 }, s, 'pinned host buffer (cudaHostAlloc)');
    box(8, 104, 200, 'page-locked pages, IOMMU-mapped', 'sub-kernel'); box(310, 104, 130, 'HBM (DMA)', 'sub-gpu'); svg('path', { class: 'arrow on', d: 'M208 117 H308' }, s); svg('text', { class: 'tiny mut', x: 258, y: 112, 'text-anchor': 'middle' }, s, 'copy engine, async');
    svg('text', { class: 'tiny mut', x: 8, y: 146 }, s, 'one DMA, CPU free, overlaps with kernels on other streams');
    root.querySelector('#vm-dma').appendChild(s);
  }
}
