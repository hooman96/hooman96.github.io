/** Left-hand controls: mode segment, search, explode, subsystem toggles, isolate/flow/reset, labels, keyboard list. */
import { SUBSYSTEMS, MODES } from '../data/schema.js';
import { MANIFEST } from '../data/manifest.js';
import { buildIndex, search } from '../lib/search.js';
import { DEFAULT_VIEW } from './scene.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createControls({ components, byId, store, scene }) {
  const $ = id => document.getElementById(id);
  const index = buildIndex(components);

  // ---- modes ----
  const seg = $('mode-seg');
  seg.innerHTML = MODES.map((m, i) => `<button type="button" data-mode="${m.id}" aria-pressed="${m.id === store.get().mode}" title="Press ${i + 1}">${esc(m.label)}</button>`).join('');
  seg.addEventListener('click', ev => { const b = ev.target.closest('[data-mode]'); if (b) store.set({ mode: b.dataset.mode }); });
  document.querySelectorAll('.link-btn[data-mode]').forEach(b => b.addEventListener('click', () => {
    store.set({ mode: b.dataset.mode });
    document.getElementById('viewer').scrollIntoView({ behavior: store.get().reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }));

  // ---- search ----
  const input = $('search'), results = $('search-results');
  let active = -1, current = [];
  const closeResults = () => { results.classList.remove('open'); input.setAttribute('aria-expanded', 'false'); active = -1; };
  const applyQuery = q => {
    const hits = search(index, q);
    current = hits.slice(0, 12);
    if (!q.trim()) { store.set({ matches: null, query: '' }); closeResults(); return; }
    if (hits.length === 1) { store.set({ selected: hits[0].id, matches: null, query: q, isolate: false }); }
    else store.set({ matches: new Set(hits.map(h => h.id)), query: q });
    results.innerHTML = current.map((h, i) => { const c = byId.get(h.id); return `<li role="option" id="sr-${i}" data-id="${c.id}" aria-selected="false" style="--c:var(--atlas-${c.subsystem})">${esc(c.name)}<small>${esc(c.subsystem)}</small></li>`; }).join('')
      || '<li role="option" aria-disabled="true" style="color:var(--dim)">No matches</li>';
    results.classList.add('open'); input.setAttribute('aria-expanded', 'true');
  };
  let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => applyQuery(input.value), 90); });
  input.addEventListener('focus', () => { if (input.value.trim() && current.length) results.classList.add('open'); });
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault(); if (!current.length) return;
      active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + current.length) % current.length;
      [...results.children].forEach((li, i) => li.setAttribute('aria-selected', i === active ? 'true' : 'false'));
      input.setAttribute('aria-activedescendant', 'sr-' + active);
    } else if (ev.key === 'Enter') {
      const pick = current[active >= 0 ? active : 0];
      if (pick) { store.set({ selected: pick.id, matches: null, isolate: false }); closeResults(); }
    } else if (ev.key === 'Escape') { input.value = ''; store.set({ matches: null, query: '' }); closeResults(); }
  });
  results.addEventListener('mousedown', ev => { const li = ev.target.closest('[data-id]'); if (li) { store.set({ selected: li.dataset.id, matches: null, isolate: false }); closeResults(); } });
  document.addEventListener('click', ev => { if (!ev.target.closest('.search-wrap')) closeResults(); });

  // ---- explode ----
  const explode = $('explode'), explodeOut = $('explode-out');
  explode.addEventListener('input', () => store.set({ explode: explode.value / 100 }));

  // ---- subsystem toggles + legend ----
  const toggles = $('sub-toggles');
  toggles.innerHTML = SUBSYSTEMS.map(s => `<li><button type="button" data-sub="${s.id}" aria-pressed="true" title="${esc(s.blurb)}"><i aria-hidden="true"></i>${esc(s.name)}<span class="n">${MANIFEST[s.id].length}</span></button></li>`).join('');
  toggles.addEventListener('click', ev => {
    const b = ev.target.closest('[data-sub]'); if (!b) return;
    const vis = { ...store.get().visible }; vis[b.dataset.sub] = !vis[b.dataset.sub]; store.set({ visible: vis });
  });
  $('legend').innerHTML = SUBSYSTEMS.map(s => `<span style="--c:var(--atlas-${s.id})"><i></i>${esc(s.short)}</span>`).join('');

  // ---- buttons ----
  $('isolate-btn').addEventListener('click', () => store.set({ isolate: !store.get().isolate }));
  $('flow-btn').addEventListener('click', () => store.set({ showFlow: !store.get().showFlow }));
  const resetAll = () => {
    input.value = '';
    store.set({ selected: null, hovered: null, matches: null, query: '', isolate: false, visible: Object.fromEntries(SUBSYSTEMS.map(s => [s.id, true])), mode: 'system', labels: 'focus', showFlow: true, panX: 0, panY: 0 });
    scene.animateTo({ ...DEFAULT_VIEW, explode: 0 });
  };
  $('reset-btn').addEventListener('click', resetAll);
  $('view-reset').addEventListener('click', () => scene.animateTo({ ...DEFAULT_VIEW }) || store.set({ panX: 0, panY: 0 }));
  $('zoom-in').addEventListener('click', () => store.set({ zoom: Math.min(3, store.get().zoom * 1.2) }));
  $('zoom-out').addEventListener('click', () => store.set({ zoom: Math.max(0.5, store.get().zoom / 1.2) }));
  $('labels-seg').addEventListener('click', ev => { const b = ev.target.closest('[data-labels]'); if (b) store.set({ labels: b.dataset.labels }); });

  // ---- keyboard component list ----
  const list = $('component-list');
  list.innerHTML = SUBSYSTEMS.map(s => `<div data-sub="${s.id}"><h4>${esc(s.name)}</h4>${MANIFEST[s.id].map(([id, name]) => `<button type="button" data-id="${id}" aria-pressed="false">${esc(name)}</button>`).join('')}</div>`).join('');
  list.addEventListener('click', ev => { const b = ev.target.closest('[data-id]'); if (b) store.set({ selected: b.dataset.id, matches: null }); });

  // ---- global shortcuts ----
  document.addEventListener('keydown', ev => {
    const tag = ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === '/') { ev.preventDefault(); input.focus(); input.select(); return; }
    const n = parseInt(ev.key, 10);
    if (n >= 1 && n <= MODES.length) { store.set({ mode: MODES[n - 1].id }); return; }
    if (ev.key === 'Escape') store.set({ selected: null, isolate: false, matches: null, query: '' });
  });

  // ---- reflect state ----
  const reflect = (st, changed) => {
    if (changed.includes('mode')) {
      seg.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === st.mode ? 'true' : 'false'));
      const m = MODES.find(x => x.id === st.mode);
      $('mode-title').textContent = m.title; $('mode-lead').textContent = m.lead;
      document.title = (st.mode === 'system' ? 'LLM Atlas' : `LLM Atlas · ${m.label}`) + ' — Interactive LLM Systems Explorer | Hooman Mohammadi';
    }
    if (changed.includes('explode')) { explode.value = Math.round(st.explode * 100); explodeOut.value = explodeOut.textContent = Math.round(st.explode * 100) + '%'; }
    if (changed.includes('visible')) toggles.querySelectorAll('[data-sub]').forEach(b => b.setAttribute('aria-pressed', st.visible[b.dataset.sub] ? 'true' : 'false'));
    if (changed.includes('selected') || changed.includes('isolate')) {
      const iso = $('isolate-btn'); iso.disabled = !st.selected; iso.setAttribute('aria-pressed', st.isolate && st.selected ? 'true' : 'false');
      list.querySelectorAll('[data-id]').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === st.selected ? 'true' : 'false'));
      if (st.selected) history.replaceState(null, '', '#c=' + st.selected); else if (location.hash.startsWith('#c=')) history.replaceState(null, '', location.pathname);
    }
    if (changed.includes('showFlow')) $('flow-btn').setAttribute('aria-pressed', st.showFlow ? 'true' : 'false');
    if (changed.includes('labels')) $('labels-seg').querySelectorAll('[data-labels]').forEach(b => b.setAttribute('aria-pressed', b.dataset.labels === st.labels ? 'true' : 'false'));
    if (changed.includes('query') && st.query !== input.value) input.value = st.query;
  };
  store.subscribe(reflect);
  reflect(store.get(), Object.keys(store.get()));
  return { resetAll };
}
