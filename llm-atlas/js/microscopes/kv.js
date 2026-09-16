/** Microscope 08 — KV cache calculator and paged block table. */
import { html, canvas, svg, field, stat, rng } from './util.js';
import { kvBytesPerToken, kvBytesPerSequence, kvBytesTotal, fmtBytes } from '../lib/kvMemory.js';

export const id = 'scope-kv';
export const short = 'KV calculator';
export const title = 'KV cache calculator and paged memory';
export const description = 'Size the attention cache for a conventional-attention decoder and see how a paged allocator maps logical sequence blocks onto physical GPU blocks so variable-length requests share one pool without pre-allocating the maximum context.';

const PRESETS = { 'llama3-8b': [32, 8, 128], 'llama3-70b': [80, 8, 128], 'mixtral-8x7b': [32, 8, 128], 'custom': null };

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="formula">KV bytes ≈ 2 × layers × tokens × KV_heads × head_dim × bytes_per_element × sequences</div>
    <p class="ctl-help">Simplified approximation for conventional attention (the factor 2 is K and V). MLA (compressed latent KV), hybrid attention / state-space models and sliding-window layers change this model; GQA / MQA reduce KV_heads.</p>
    <div class="scope-controls" id="kv-ctl"></div>
    <div class="stat-row" id="kv-stats"></div>
    <div class="scope-grid" style="margin-top:.5rem">
      <div>
        <div class="scope-controls" style="margin-bottom:.6rem"><button type="button" class="btn" id="kv-add">Admit request</button><button type="button" class="btn" id="kv-grow">Decode step (+1 token each)</button><button type="button" class="btn" id="kv-finish">Finish oldest</button><button type="button" class="btn" id="kv-clear">Clear</button></div>
        <div id="kv-vis"></div>
      </div>
      <div class="panel-desc" id="kv-note">
        <p><b>Logical vs physical blocks.</b> Each sequence sees a contiguous list of logical blocks (block size = 16 tokens here, an example). A block table maps them to any free physical block in the GPU pool, so memory is allocated as the sequence grows and freed when it finishes.</p>
        <p><b>Why paging helps.</b> Contiguous pre-allocation for max_tokens wastes most of it (internal fragmentation) and prevents new requests from starting; paging brings waste down to less than one block per sequence and lets prefix-cached blocks be shared by reference count.</p>
        <p><b>Eviction and offloading.</b> Blocks of finished sequences stay cached until memory pressure evicts them (LRU). Cold blocks can be offloaded to CPU or NVMe tiers where the PCIe or network bandwidth justifies it.</p>
        <p><b>KV dtype.</b> FP8 / INT8 KV halves bytes per element versus BF16 (KV-cache quantization, distinct from weight quantization), at some precision risk on long contexts.</p>
      </div>
    </div>
  `));
  const ctl = root.querySelector('#kv-ctl'), stats = root.querySelector('#kv-stats');
  const f = {
    preset: field({ id: 'kv-preset', label: 'Preset (example shapes)', type: 'select', value: 'llama3-8b', options: [['llama3-8b', 'Llama 3 8B (32 L, 8 KV heads, 128)'], ['llama3-70b', 'Llama 3 70B (80 L, 8 KV heads, 128)'], ['mixtral-8x7b', 'Mixtral 8x7B (32 L, 8 KV heads, 128)'], ['custom', 'Custom']] }),
    layers: field({ id: 'kv-L', label: 'Layers', value: 32, min: 1, max: 512 }),
    tokens: field({ id: 'kv-T', label: 'Context tokens', value: 8192, min: 1, max: 2097152 }),
    heads: field({ id: 'kv-H', label: 'KV heads', value: 8, min: 1, max: 256 }),
    dim: field({ id: 'kv-D', label: 'Head dim', value: 128, min: 16, max: 1024 }),
    bytes: field({ id: 'kv-B', label: 'Bytes / element', type: 'select', value: '2', options: [['2', 'BF16 / FP16 (2)'], ['1', 'FP8 / INT8 (1)'], ['4', 'FP32 (4)']] }),
    seqs: field({ id: 'kv-S', label: 'Concurrent sequences', value: 32, min: 1, max: 100000 }),
    gpu: field({ id: 'kv-G', label: 'KV budget (GB)', value: 40, min: 1, max: 4000 }),
  };
  Object.values(f).forEach(x => { ctl.appendChild(x.el); x.input.addEventListener('input', () => { if (x === f.preset) { const p = PRESETS[f.preset.input.value]; if (p) { f.layers.input.value = p[0]; f.heads.input.value = p[1]; f.dim.input.value = p[2]; } } else if (x !== f.tokens && x !== f.bytes && x !== f.seqs && x !== f.gpu) f.preset.input.value = 'custom'; update(); }); });
  function update() {
    const p = { layers: +f.layers.input.value, tokens: +f.tokens.input.value, kvHeads: +f.heads.input.value, headDim: +f.dim.input.value, bytes: +f.bytes.input.value, sequences: +f.seqs.input.value };
    const perTok = kvBytesPerToken(p), perSeq = kvBytesPerSequence(p), total = kvBytesTotal(p), budget = +f.gpu.input.value * 1e9;
    const fit = Math.floor(budget / perSeq), util = total / budget;
    stats.innerHTML = stat('KV per token', fmtBytes(perTok)) + stat('KV per sequence', fmtBytes(perSeq)) + stat('total active KV', fmtBytes(total), util > 1 ? 'bad' : util > .85 ? 'warn' : 'ok')
      + stat('KV utilization', (util * 100).toFixed(0) + '%', util > 1 ? 'bad' : '') + stat('max sequences at this length', String(fit));
  }
  update();

  // ---- paged allocator toy ----
  const vis = root.querySelector('#kv-vis');
  const PHYS = 48, BS = 16; let seqs = [], nextId = 1; const r = rng(3);
  const free = () => { const used = new Set(seqs.flatMap(s => s.blocks)); return [...Array(PHYS).keys()].filter(i => !used.has(i)); };
  const alloc = n => { const fr = free(); const out = []; for (let i = 0; i < n && fr.length; i++) out.push(fr.splice(Math.floor(r() * fr.length), 1)[0]); return out; };
  function draw() {
    vis.innerHTML = '';
    const W = 460, cols = 12, cell = 34, H = 20 + Math.ceil(PHYS / cols) * cell + 20 + seqs.length * 16 + 10;
    const s = canvas(W, H, 'Physical KV block pool and per-sequence block tables');
    svg('text', { class: 'tiny mut', x: 8, y: 12 }, s, `physical pool: ${PHYS} blocks × ${BS} tokens · free ${free().length}`);
    const owner = new Map(); seqs.forEach((sq, i) => sq.blocks.forEach(b => owner.set(b, i)));
    for (let i = 0; i < PHYS; i++) {
      const x = 8 + (i % cols) * (cell + 2), y = 18 + Math.floor(i / cols) * cell;
      const o = owner.get(i);
      svg('rect', { class: 'tok' + (o === undefined ? '' : ' active'), x, y, width: cell - 2, height: cell - 6, rx: 3, style: o === undefined ? '' : `fill:color-mix(in srgb, var(--atlas-runtime) ${25 + (o % 6) * 12}%, var(--atlas-surface))` }, s);
      svg('text', { class: 'tiny', x: x + (cell - 2) / 2, y: y + (cell - 6) / 2 + 4, 'text-anchor': 'middle', style: 'font-size:8px' }, s, o === undefined ? String(i) : 'R' + seqs[o].id);
    }
    let y0 = 18 + Math.ceil(PHYS / cols) * cell + 12;
    seqs.forEach((sq, i) => { svg('text', { class: 'tiny', x: 8, y: y0 + i * 16 }, s, `R${sq.id}: ${sq.tokens} tokens → logical [${sq.blocks.map((_, j) => j).join(',')}] → physical [${sq.blocks.join(',')}]${sq.tokens % BS ? ` · last block ${sq.tokens % BS}/${BS} used` : ''}`); });
    vis.appendChild(s);
  }
  root.querySelector('#kv-add').addEventListener('click', () => { const tokens = 20 + Math.floor(r() * 90); const need = Math.ceil(tokens / BS); const blocks = alloc(need); if (blocks.length < need) return; seqs.push({ id: nextId++, tokens, blocks }); draw(); });
  root.querySelector('#kv-grow').addEventListener('click', () => { for (const sq of seqs) { sq.tokens++; if (sq.tokens > sq.blocks.length * BS) { const b = alloc(1); if (b.length) sq.blocks.push(b[0]); else sq.tokens--; } } draw(); });
  root.querySelector('#kv-finish').addEventListener('click', () => { seqs.shift(); draw(); });
  root.querySelector('#kv-clear').addEventListener('click', () => { seqs = []; draw(); });
  for (let i = 0; i < 3; i++) root.querySelector('#kv-add').click();
}
