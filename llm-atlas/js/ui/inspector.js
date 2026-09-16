/** Right-hand component inspector. Renders one AtlasComponent from the content model. */
import { SUBSYSTEMS, MODES } from '../data/schema.js';
import { REFERENCES } from '../data/references.js';

const SUB_NAME = Object.fromEntries(SUBSYSTEMS.map(s => [s.id, s.name]));
const MODE_LABEL = Object.fromEntries(MODES.map(m => [m.id, m.label]));

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Render inline `code` spans from plain text (content strings never contain HTML). */
export const rich = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

const list = items => items && items.length ? `<ul>${items.map(i => `<li>${rich(i)}</li>`).join('')}</ul>` : '';
const section = (title, body) => body ? `<div class="insp-section"><h4>${title}</h4>${body}</div>` : '';

/** Map from component id to microscope panel id, so the inspector can deep-link. */
const SCOPE_FOR = {
  tokenization: 'scope-tokenizer', 'tokenizer-encode': 'scope-tokenizer', 'tokenizer-decode': 'scope-tokenizer', 'tokenizer-training': 'scope-tokenizer',
  'token-embeddings': 'scope-transformer', rmsnorm: 'scope-transformer', 'q-projection': 'scope-transformer', 'k-projection': 'scope-transformer', 'v-projection': 'scope-transformer',
  rope: 'scope-transformer', 'causal-attention': 'scope-transformer', 'gqa-mqa': 'scope-transformer', 'flash-attention': 'scope-transformer', 'residual-stream': 'scope-transformer',
  'dense-mlp': 'scope-transformer', 'final-norm': 'scope-transformer', 'lm-head': 'scope-transformer', 'vocabulary-logits': 'scope-decoding',
  'moe-replacement': 'scope-moe', 'router-projection': 'scope-moe', 'router-logits': 'scope-moe', 'top-k-selection': 'scope-moe', 'token-permutation': 'scope-moe',
  'expert-dispatch': 'scope-moe', 'all-to-all': 'scope-moe', 'expert-mlps': 'scope-moe', 'shared-experts': 'scope-moe', 'weighted-combine': 'scope-moe', unpermutation: 'scope-moe',
  'load-balancing': 'scope-moe', 'expert-parallelism': 'scope-parallelism', 'expert-placement': 'scope-moe', 'hot-expert-replication': 'scope-moe',
  'cross-entropy': 'scope-training', 'forward-pass': 'scope-training', autograd: 'scope-training', 'backward-pass': 'scope-training', 'gradient-buffers': 'scope-training',
  'gradient-accumulation': 'scope-training', 'gradient-clipping': 'scope-training', adamw: 'scope-training', 'optimizer-moments': 'scope-training', 'lr-scheduler': 'scope-training',
  'mixed-precision': 'scope-training', 'activation-checkpointing': 'scope-training', 'checkpoint-saving': 'scope-training',
  'distributed-collectives': 'scope-parallelism', 'data-parallel': 'scope-parallelism', 'tensor-parallel': 'scope-parallelism', 'pipeline-parallel': 'scope-parallelism',
  'context-parallel': 'scope-parallelism', 'fsdp-zero': 'scope-parallelism', 'tp-inference': 'scope-parallelism', 'pp-inference': 'scope-parallelism', 'ep-inference': 'scope-parallelism',
  'instruction-dataset': 'scope-posttraining', 'annotation-taxonomy': 'scope-posttraining', annotators: 'scope-posttraining', rubrics: 'scope-posttraining', 'annotator-calibration': 'scope-posttraining',
  'chat-template': 'scope-posttraining', sft: 'scope-posttraining', 'loss-masking': 'scope-posttraining', 'full-fine-tuning': 'scope-posttraining', lora: 'scope-posttraining', qlora: 'scope-posttraining',
  'preference-pairs': 'scope-posttraining', 'reward-modeling': 'scope-posttraining', 'rlhf-ppo': 'scope-posttraining', dpo: 'scope-posttraining', 'safety-tuning': 'scope-posttraining',
  'red-teaming': 'scope-posttraining', evaluation: 'scope-posttraining', 'multi-lora-serving': 'scope-serving',
  'prefix-cache-lookup': 'scope-prefix', 'kv-cache': 'scope-kv', 'kv-allocation': 'scope-kv', 'paged-kv-cache': 'scope-kv', 'quantized-kv-cache': 'scope-kv', 'kv-offloading': 'scope-kv',
  prefill: 'scope-batching', 'chunked-prefill': 'scope-batching', 'continuous-batching': 'scope-batching', 'decode-loop': 'scope-batching', 'request-queue': 'scope-batching', 'admission-control': 'scope-batching',
  'logit-processors': 'scope-decoding', sampling: 'scope-decoding', 'speculative-decoding': 'scope-decoding', 'draft-models': 'scope-decoding', 'prompt-lookup': 'scope-decoding', 'multi-token-prediction': 'scope-decoding',
  'quantized-weights': 'scope-quant', 'api-gateway': 'scope-serving', 'model-routing': 'scope-serving', 'disaggregated-serving': 'scope-serving', autoscaling: 'scope-serving',
  'canary-releases': 'scope-serving', backpressure: 'scope-serving', telemetry: 'scope-serving', 'latency-metrics': 'scope-serving', 'api-request': 'scope-tokenizer', 'streaming-response': 'scope-tokenizer',
  'cuda-graphs': 'scope-serving', 'kernel-compilation': 'scope-serving',
};

export function createInspector(root, { byId, store }) {
  function renderEmpty() {
    root.removeAttribute('data-sub');
    root.innerHTML = `
      <div class="insp-empty">
        <h3>Inspector</h3>
        <p>Select any component in the atlas to read its definition, mechanics, shapes, memory and compute implications, tuning knobs, failure modes and sources.</p>
        <ul>
          <li>Drag the model to rotate it. Use the explode slider to pull subsystems apart.</li>
          <li>Switch lifecycle modes to follow one execution path.</li>
          <li>Search for a concept such as <code>prefix</code>, <code>GQA</code> or <code>ZeRO</code>.</li>
        </ul>
      </div>`;
  }

  function render(id) {
    const c = byId.get(id);
    if (!c) return renderEmpty();
    root.setAttribute('data-sub', c.subsystem);
    const refs = (c.references || []).map(r => REFERENCES[r]).filter(Boolean);
    const scope = SCOPE_FOR[c.id];
    root.innerHTML = `
      <p class="insp-sub"><i></i>${esc(SUB_NAME[c.subsystem])}</p>
      <h3 class="insp-name">${esc(c.name)}</h3>
      <p class="insp-def">${rich(c.subtitle)}</p>
      <div class="insp-modes" aria-label="Appears in modes">${c.modes.filter(m => m !== 'system').map(m => `<button type="button" data-mode="${m}" title="Open ${esc(MODE_LABEL[m])} mode">${esc(MODE_LABEL[m])}</button>`).join('')}</div>
      <div class="insp-tools">
        <button type="button" class="btn" data-act="isolate" aria-pressed="${store.get().isolate ? 'true' : 'false'}">Isolate</button>
        ${scope ? `<a class="btn" href="#${scope}" data-act="scope">Open microscope ↓</a>` : ''}
        <button type="button" class="btn" data-act="copy">Copy link</button>
      </div>
      ${section('Summary', `<p>${rich(c.summary)}</p>`)}
      ${section('Why it exists', `<p>${rich(c.purpose)}</p>`)}
      ${section('Exact mechanics', `<p>${rich(c.mechanics)}</p>`)}
      ${(c.input || c.output) ? section('Input / output', `<div class="insp-io"><div><span>Input</span>${rich(c.input || '—')}</div><div><span>Output</span>${rich(c.output || '—')}</div></div>`) : ''}
      ${c.tensorShape ? section('Tensor / state shape', `<div class="insp-shape">${esc(c.tensorShape)}</div>`) : ''}
      ${(c.memory || c.compute || c.communication) ? section('Implications', `<div class="insp-impl">
          ${c.memory ? `<div><b>Memory</b>${rich(c.memory)}</div>` : ''}
          ${c.compute ? `<div><b>Compute</b>${rich(c.compute)}</div>` : ''}
          ${c.communication ? `<div><b>Communication</b>${rich(c.communication)}</div>` : ''}
        </div>`) : ''}
      ${section('Main tuning knobs', list(c.knobs))}
      ${section('Metrics to watch', list(c.metrics))}
      ${section('Common failure modes', list(c.failureModes))}
      ${c.trainingVsInference ? section('Training vs inference', `<p>${rich(c.trainingVsInference)}</p>`) : ''}
      ${section('Related', `<div class="insp-related">${(c.related || []).map(r => byId.get(r)).filter(Boolean).map(r => `<button type="button" data-select="${r.id}" style="--c2:var(--atlas-${r.subsystem})"><i></i>${esc(r.name)}</button>`).join('')}</div>`)}
      ${refs.length ? section('Sources', `<ul class="insp-refs">${refs.map(r => `<li><a href="${r.url}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a> <small>${esc([r.authors, r.venue, r.year].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>`) : ''}
    `;
  }

  root.addEventListener('click', ev => {
    const sel = ev.target.closest('[data-select]');
    if (sel) { store.set({ selected: sel.dataset.select, matches: null }); return; }
    const mode = ev.target.closest('[data-mode]');
    if (mode) { store.set({ mode: mode.dataset.mode }); return; }
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'isolate') store.set({ isolate: !store.get().isolate });
    if (act.dataset.act === 'copy') {
      const url = location.origin + location.pathname + '#c=' + store.get().selected;
      navigator.clipboard?.writeText(url).then(() => { act.textContent = 'Copied'; setTimeout(() => (act.textContent = 'Copy link'), 1400); }).catch(() => { location.hash = 'c=' + store.get().selected; });
    }
  });

  let last;
  store.subscribe((st, changed) => {
    if (changed.includes('selected') || changed.includes('isolate')) {
      if (st.selected !== last || changed.includes('isolate')) { last = st.selected; render(st.selected); if (changed.includes('selected') && st.selected && window.innerWidth <= 860) { /* keep in view on mobile */ root.scrollIntoView({ behavior: st.reducedMotion ? 'auto' : 'smooth', block: 'nearest' }); } }
    }
  });
  render(store.get().selected);
  return { render };
}
