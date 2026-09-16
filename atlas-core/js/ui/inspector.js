/** Right-hand component inspector. Renders one AtlasComponent from the content model. */

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Render inline `code` spans from plain text (content strings never contain HTML). */
export const rich = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

const list = items => items && items.length ? `<ul>${items.map(i => `<li>${rich(i)}</li>`).join('')}</ul>` : '';
const section = (title, body) => body ? `<div class="insp-section"><h4>${title}</h4>${body}</div>` : '';

export function createInspector(root, { byId, store, subsystems, modes, references: REFERENCES, scopeFor: SCOPE_FOR = {} }) {
  const SUB_NAME = Object.fromEntries(subsystems.map(s => [s.id, s.name]));
  const MODE_LABEL = Object.fromEntries(modes.map(m => [m.id, m.label]));
  function renderEmpty() {
    root.removeAttribute('data-sub'); root.style.removeProperty('--c');
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
    root.style.setProperty('--c', `var(--atlas-${c.subsystem})`);
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
