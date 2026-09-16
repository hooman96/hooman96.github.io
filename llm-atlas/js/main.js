/** Entry point for /llm-atlas. Wires data → store → scene / inspector / controls / microscopes. */
import { COMPONENTS, BY_ID, validateContent } from './data/components.js';
import { EDGES } from './data/edges.js';
import { SUBSYSTEMS } from './data/schema.js';
import { REFERENCES } from './data/references.js';
import { createStore } from './lib/store.js';
import { createScene, DEFAULT_VIEW } from './ui/scene.js';
import { createInspector } from './ui/inspector.js';
import { createControls } from './ui/controls.js';
import { mountMicroscopes } from './microscopes/index.js';

validateContent();

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const initialHash = new URLSearchParams(location.hash.replace(/^#/, ''));
const initialSel = initialHash.get('c');

const store = createStore({
  ...DEFAULT_VIEW,
  explode: window.innerWidth <= 860 ? 0.3 : 0, panX: 0, panY: 0,
  mode: 'system',
  selected: BY_ID.has(initialSel) ? initialSel : null,
  hovered: null,
  matches: null, query: '',
  isolate: false, showFlow: true, labels: 'focus',
  visible: Object.fromEntries(SUBSYSTEMS.map(s => [s.id, true])),
  reducedMotion,
});

const scene = createScene(document.getElementById('scene'), { components: COMPONENTS, edges: EDGES, store });
createInspector(document.getElementById('inspector'), { byId: BY_ID, store });
createControls({ components: COMPONENTS, byId: BY_ID, store, scene });
mountMicroscopes(document.getElementById('scope-list'), document.getElementById('scope-nav'), { store, byId: BY_ID });

// Mode change: gently open the explode a little so the path is readable, without discarding user context.
store.subscribe((st, changed) => {
  if (changed.includes('mode') && st.mode !== 'system' && st.explode < 0.35) scene.animateTo({ explode: 0.45 });
});
if (store.get().selected) {
  // Deep link: emphasize the linked component and make sure its subsystem is readable.
  const sub = BY_ID.get(store.get().selected).subsystem;
  if (sub === 'moe' || sub === 'serving') scene.animateTo({ explode: 0.6 });
}

// References list
const refList = document.getElementById('ref-list');
refList.innerHTML = Object.values(REFERENCES).map(r => `<li><a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.title}</a> <small>${[r.authors, r.venue, r.year].filter(Boolean).join(' · ')}</small></li>`).join('');

// Theme toggle (dark is the site default)
const themeBtn = document.getElementById('theme-btn');
const applyTheme = t => {
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme');
  themeBtn.setAttribute('aria-pressed', t === 'light' ? 'true' : 'false');
  themeBtn.setAttribute('aria-label', t === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', t === 'light' ? '#f5f7fb' : '#05070f');
};
applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try { localStorage.setItem('llm-atlas.theme', next); } catch (e) { /* private mode */ }
});

// Sticky nav state
const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('sc', window.scrollY > 40);
onScroll(); window.addEventListener('scroll', onScroll, { passive: true });

// Collapse the mobile controls by default on narrow screens
const details = document.getElementById('ctl-details');
if (window.innerWidth <= 860) details.open = false;
