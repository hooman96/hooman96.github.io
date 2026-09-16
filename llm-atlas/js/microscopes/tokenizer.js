/** Microscope 01 — Encode / Decode terminology, toy tokenizer, and the Encode → Prefill → Decode walkthrough. */
import { html, esc, canvas, svg, prefersReducedMotion } from './util.js';

export const id = 'scope-tokenizer';
export const short = 'Encode → Decode';
export const title = 'Tokenization and the two meanings of “decode”';
export const description = 'Four distinct stages sit between a string and the text you see. A conventional decoder-only LLM has no separate text encoder module; its decoder stack builds contextual hidden states while predicting the next token. Type a sentence to see illustrative subword boxes, then step through encode → prefill → decode.';

// Illustrative subword splitter. NOT a real tokenizer: ids are hashes for display only.
const AFFIXES = ['ization', 'ational', 'ation', 'ness', 'ment', 'ing', 'tion', 'sion', 'able', 'ible', 'ers', 'ies', 'ed', 'er', 'ly', 's'];
const PREFIXES = ['pre', 'un', 'de', 're', 'multi', 'auto', 'inter', 'sub', 'trans'];
function splitWord(w) {
  if (w.length <= 5) return [w];
  const parts = []; let rest = w;
  for (const p of PREFIXES) if (rest.startsWith(p) && rest.length - p.length >= 3) { parts.push(p); rest = rest.slice(p.length); break; }
  let suffix = null;
  for (const a of AFFIXES) if (rest.endsWith(a) && rest.length - a.length >= 3) { suffix = a; rest = rest.slice(0, -a.length); break; }
  while (rest.length > 6) { parts.push(rest.slice(0, 4)); rest = rest.slice(4); }
  parts.push(rest); if (suffix) parts.push(suffix);
  return parts;
}
function toyTokenize(text) {
  const out = [];
  const re = /(\s+)|([A-Za-z]+)|(\d+)|([^\sA-Za-z\d])/g;
  let m, pendingSpace = false;
  while ((m = re.exec(text))) {
    if (m[1]) { pendingSpace = true; continue; }
    const raw = m[2] || m[3] || m[4];
    const pieces = m[2] ? splitWord(raw) : m[3] ? raw.match(/\d{1,3}/g) : [raw];
    pieces.forEach((p, i) => { out.push({ text: p, space: pendingSpace && i === 0 }); });
    pendingSpace = false;
  }
  return out.map(t => ({ ...t, id: toyId((t.space ? '▁' : '') + t.text) }));
}
function toyId(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return 1000 + (h >>> 0) % 31000; }

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="stage" role="list" aria-label="Four stages">
      <div role="listitem"><b>1 · Tokenizer encode</b><code>string → token IDs</code><br>Deterministic lookup in the trained vocabulary. No neural network involved.</div>
      <div role="listitem"><b>2 · Neural representation</b><code>IDs → embeddings → hidden states</code><br>The decoder stack turns ids into contextual vectors. There is no separate text “encoder” module in a conventional decoder-only LLM.</div>
      <div role="listitem"><b>3 · Generation decoding</b><code>logits → next token</code><br>A decoding policy (greedy, sampling, beam, constrained) chooses one id per step, repeated autoregressively.</div>
      <div role="listitem"><b>4 · Tokenizer decode</b><code>token IDs → string</code><br>Detokenization, incremental during streaming, with byte-fallback merging for partial UTF-8.</div>
    </div>
    <div class="note"><b>Terminology.</b> “Decode” can mean model generation (stage 3) or detokenization (stage 4) depending on context. Encoder-decoder models (T5-style) do contain a separate encoder over the input; multimodal models may contain independent modality encoders (a vision encoder feeding image tokens into the decoder).</div>
    <div class="scope-grid">
      <div>
        <div class="field"><label for="toy-text">Text (illustrative subword split, not a real tokenizer)</label><input type="text" id="toy-text" value="Prefix caching reduces repeated prefill work, not decoding." maxlength="160"></div>
        <div class="tok-row" id="toy-tokens" aria-live="polite" style="margin-top:.7rem"></div>
        <p class="ctl-help" id="toy-count"></p>
      </div>
      <div class="panel-desc">
        <p>Real tokenizers (BPE, unigram / SentencePiece) learn merges from data; the boxes here only illustrate that words become subword pieces and that leading whitespace is usually attached to the following token (shown as <code>▁</code>). The ids shown are display hashes, not vocabulary ids.</p>
        <p>What matters for systems: prompt length in tokens (not characters) drives prefill cost and KV-cache size, and every generated token costs one decode iteration.</p>
      </div>
    </div>
    <div>
      <div class="scope-controls" style="margin-bottom:.8rem">
        <button type="button" class="btn primary" id="wt-play">Play walkthrough</button>
        <button type="button" class="btn" id="wt-step">Step</button>
        <button type="button" class="btn" id="wt-reset">Reset</button>
        <span class="ctl-help" id="wt-status" aria-live="polite"></span>
      </div>
      <div id="wt-vis"></div>
    </div>
  `));

  const input = root.querySelector('#toy-text'), tokRow = root.querySelector('#toy-tokens'), count = root.querySelector('#toy-count');
  const renderTokens = () => {
    const toks = toyTokenize(input.value);
    tokRow.innerHTML = toks.map(t => `<span class="tok-chip${t.space ? ' sp' : ''}">${t.space ? '▁' : ''}${esc(t.text)}<small>${t.id}</small></span>`).join('');
    count.textContent = `${toks.length} illustrative tokens · ${input.value.length} characters`;
    return toks;
  };
  input.addEventListener('input', () => { renderTokens(); buildWalk(); });

  // ---- walkthrough ----
  const vis = root.querySelector('#wt-vis'), status = root.querySelector('#wt-status');
  const W = 760, H = 250; let step = 0, timer = null, toks = [];
  const GEN = ['▁It', '▁does', '▁not', '.'];
  function buildWalk() { step = 0; toks = renderTokens().slice(0, 9); draw(); }
  function draw() {
    vis.innerHTML = '';
    const s = canvas(W, H, 'Walkthrough of encode, prefill and decode phases');
    const lanes = [['Tokenizer encode', 26], ['Prefill (all prompt tokens in parallel)', 82], ['KV cache', 138], ['Decode loop (one token per iteration)', 194]];
    lanes.forEach(([t, y]) => { svg('rect', { class: 'lane', x: 8, y: y - 18, width: W - 16, height: 44, rx: 4 }, s); svg('text', { class: 'mut', x: 16, y: y - 6 }, s, t); });
    const n = toks.length, cw = Math.min(64, (W - 40) / (n + GEN.length + 1));
    // stage 1 tokens
    toks.forEach((t, i) => { const x = 16 + i * cw; svg('rect', { class: 'tok' + (step >= 1 ? ' done' : ''), x, y: 30, width: cw - 6, height: 18, rx: 3 }, s); svg('text', { class: 'tiny', x: x + (cw - 6) / 2, y: 43, 'text-anchor': 'middle' }, s, (t.space ? '▁' : '') + t.text.slice(0, 7)); });
    // stage 2 prefill
    if (step >= 2) { svg('rect', { class: 'tok active', x: 16, y: 86, width: n * cw - 6, height: 18, rx: 3 }, s); svg('text', { class: 'tiny', x: 16 + (n * cw - 6) / 2, y: 99, 'text-anchor': 'middle' }, s, `one forward pass over ${n} tokens · compute-bound · sets TTFT`); }
    // stage 3 KV
    const kvN = step >= 3 ? n + Math.max(0, Math.min(GEN.length, step - 4)) : 0;
    for (let i = 0; i < kvN; i++) { const x = 16 + i * cw; svg('rect', { class: 'tok ' + (i < n ? 'done' : 'active'), x, y: 142, width: cw - 6, height: 18, rx: 3 }, s); svg('text', { class: 'tiny', x: x + (cw - 6) / 2, y: 155, 'text-anchor': 'middle' }, s, 'K,V'); }
    if (kvN) svg('text', { class: 'tiny mut', x: 16 + kvN * cw + 4, y: 155 }, s, `${kvN} positions × layers`);
    // stage 4 decode
    const genN = Math.max(0, Math.min(GEN.length, step - 3));
    for (let i = 0; i < genN; i++) { const x = 16 + (n + i) * cw; svg('rect', { class: 'tok ' + (i === genN - 1 && step < 3 + GEN.length + 1 ? 'active' : 'done'), x, y: 198, width: cw - 6, height: 18, rx: 3 }, s); svg('text', { class: 'tiny', x: x + (cw - 6) / 2, y: 211, 'text-anchor': 'middle' }, s, GEN[i]); }
    if (genN) svg('text', { class: 'tiny mut', x: 16 + (n + genN) * cw + 4, y: 211 }, s, `iter ${genN}: weights + KV read, +1 K/V, sample`);
    vis.appendChild(s);
    const msgs = ['Ready. Text is a string.', 'Encode: string → ids (deterministic, no GPU).', 'Prefill: all prompt ids processed in one parallel pass; K/V written for every position.', 'KV cache holds one K and one V per layer per position (times KV heads × head_dim).',
      ...GEN.map((g, i) => `Decode iteration ${i + 1}: newest query attends to all cached K/V, logits → policy picks ${g.trim()} → tokenizer decode streams it.`), 'Done: stop token or max_tokens. The generated ids are detokenized into text (tokenizer decode).'];
    status.textContent = msgs[Math.min(step, msgs.length - 1)];
  }
  const maxStep = 3 + GEN.length + 1;
  root.querySelector('#wt-step').addEventListener('click', () => { step = Math.min(maxStep, step + 1); draw(); });
  root.querySelector('#wt-reset').addEventListener('click', () => { clearInterval(timer); timer = null; step = 0; draw(); });
  root.querySelector('#wt-play').addEventListener('click', () => {
    if (timer) { clearInterval(timer); timer = null; return; }
    if (prefersReducedMotion()) { step = maxStep; draw(); return; }
    step = 0; draw();
    timer = setInterval(() => { step++; draw(); if (step >= maxStep) { clearInterval(timer); timer = null; } }, 900);
  });
  buildWalk();
}
