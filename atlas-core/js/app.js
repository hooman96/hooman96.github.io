/**
 * createAtlas(config): wires data → store → scene / inspector / controls / microscopes for one atlas page.
 * Each atlas page supplies its own content model, layout, modes, references and microscope panels.
 */
import { createStore } from './lib/store.js';
import { createScene, DEFAULT_VIEW } from './ui/scene.js';
import { createInspector } from './ui/inspector.js';
import { createControls } from './ui/controls.js';
import { mountMicroscopes } from './microscopes/registry.js';

/**
 * @param {{
 *   components:Array, byId:Map, edges:Array, subsystems:Array, modes:Array, modePaths:Object, manifest:Object,
 *   layout:{subsystems:Object, overrides?:Object}, references:Object, scopeFor?:Object, panels:Array,
 *   titleBase:string, titleSuffix:string, storageKey:string, deepLinkExplode?:string[]
 * }} cfg
 */
export function createAtlas(cfg) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const initialHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const initialSel = initialHash.get('c');

  const store = createStore({
    ...DEFAULT_VIEW,
    explode: window.innerWidth <= 860 ? 0.3 : 0, panX: 0, panY: 0,
    mode: 'system',
    selected: cfg.byId.has(initialSel) ? initialSel : null,
    hovered: null,
    matches: null, query: '',
    isolate: false, showFlow: true, labels: 'focus',
    visible: Object.fromEntries(cfg.subsystems.map(s => [s.id, true])),
    reducedMotion,
  });

  const scene = createScene(document.getElementById('scene'), {
    components: cfg.components, edges: cfg.edges, store,
    subsystems: cfg.subsystems, manifest: cfg.manifest, layout: cfg.layout, modePaths: cfg.modePaths,
  });
  createInspector(document.getElementById('inspector'), { byId: cfg.byId, store, subsystems: cfg.subsystems, modes: cfg.modes, references: cfg.references, scopeFor: cfg.scopeFor });
  createControls({ components: cfg.components, byId: cfg.byId, store, scene, subsystems: cfg.subsystems, modes: cfg.modes, manifest: cfg.manifest, titleBase: cfg.titleBase, titleSuffix: cfg.titleSuffix });
  mountMicroscopes(document.getElementById('scope-list'), document.getElementById('scope-nav'), cfg.panels, { store, byId: cfg.byId });

  // Mode change: open the explode a little so the path is readable, without discarding user context.
  store.subscribe((st, changed) => {
    if (changed.includes('mode') && st.mode !== 'system' && st.explode < 0.35) scene.animateTo({ explode: 0.45 });
  });
  if (store.get().selected && cfg.deepLinkExplode) {
    const sub = cfg.byId.get(store.get().selected).subsystem;
    if (cfg.deepLinkExplode.includes(sub)) scene.animateTo({ explode: 0.6 });
  }

  // References list
  const refList = document.getElementById('ref-list');
  if (refList) refList.innerHTML = Object.values(cfg.references).map(r => `<li><a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.title}</a> <small>${[r.authors, r.venue, r.year].filter(Boolean).join(' · ')}</small></li>`).join('');

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
    try { localStorage.setItem(cfg.storageKey + '.theme', next); } catch (e) { /* private mode */ }
  });

  // Sticky nav state
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('sc', window.scrollY > 40);
  onScroll(); window.addEventListener('scroll', onScroll, { passive: true });

  // Collapse the mobile controls by default on narrow screens
  const details = document.getElementById('ctl-details');
  if (details && window.innerWidth <= 860) details.open = false;

  return { store, scene };
}
