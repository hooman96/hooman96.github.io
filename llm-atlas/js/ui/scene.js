/**
 * AtlasScene: SVG-rendered exploded 3D model of the LLM system.
 * Renders boxes (components) on plates (subsystems), edges, mode paths and labels.
 * All colours come from CSS custom properties; this module never sets a colour.
 */
import { boxFaces, project, polyPoints, bounds, clamp, lerp, deg } from '../lib/geometry.js';
import { SUBSYSTEM_LAYOUT, BOX, PLATE, computeSlots, plateSize } from '../data/layout.js';
import { SUBSYSTEMS } from '../data/schema.js';
import { MODE_PATHS } from '../data/modes.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const SUB_INDEX = Object.fromEntries(SUBSYSTEMS.map((s, i) => [s.id, i + 1]));
const SUB_NAME = Object.fromEntries(SUBSYSTEMS.map(s => [s.id, s.name]));

export const DEFAULT_VIEW = { yaw: deg(-32), pitch: deg(34), zoom: 1 };
const PITCH_MIN = deg(12), PITCH_MAX = deg(72);

/**
 * @param {SVGSVGElement} svg
 * @param {{components:Array, edges:Array, store:any}} opts
 */
export function createScene(svg, { components, edges, store }) {
  const slots = computeSlots();
  const byId = new Map(components.map(c => [c.id, c]));
  const adjacency = new Map();
  for (const e of edges) {
    if (!adjacency.has(e.a)) adjacency.set(e.a, new Set());
    if (!adjacency.has(e.b)) adjacency.set(e.b, new Set());
    adjacency.get(e.a).add(e.b); adjacency.get(e.b).add(e.a);
  }

  const scene = { cam: null, nodes: null, slots, render: null, animateTo: null, destroy: null };

  // ---- static DOM -------------------------------------------------------
  svg.innerHTML = '';
  const gPlates = el('g', { class: 'plates' }, svg);
  const gEdges = el('g', { class: 'edges' }, svg);
  const gNodes = el('g', { class: 'nodes' }, svg);
  const gPath = el('g', { class: 'paths' }, svg);
  const gLabels = el('g', { class: 'labels' }, svg);

  const plates = {};
  for (const s of SUBSYSTEMS) {
    const g = el('g', { class: 'plate', 'data-sub': s.id }, gPlates);
    const poly = el('polygon', { class: 'plate-top' }, g);
    const tag = el('g', { class: 'plate-tag' }, g);
    const tagBg = el('rect', { rx: 2, ry: 2, class: 'plate-tag-bg' }, tag);
    const tagTx = el('text', { class: 'plate-tag-text' }, tag);
    tagTx.textContent = `0${SUB_INDEX[s.id]} · ${s.name.toUpperCase()}`;
    plates[s.id] = { g, poly, tag, tagBg, tagTx };
  }

  const nodes = new Map();
  for (const c of components) {
    const g = el('g', { class: 'node', 'data-id': c.id, 'data-sub': c.subsystem, role: 'button', tabindex: '-1', 'aria-label': c.name }, gNodes);
    const faces = [el('polygon', { class: 'f' }, g), el('polygon', { class: 'f' }, g), el('polygon', { class: 'f' }, g)];
    const outline = el('polygon', { class: 'outline' }, g);
    const title = el('title', {}, g); title.textContent = c.name;
    nodes.set(c.id, { c, g, faces, outline, pos: null, top: null, depth: 0, level: 'normal' });
  }

  const edgeEls = edges.map(e => ({ e, line: el('line', { class: 'edge ' + e.kind }, gEdges) }));
  const pathLine = el('polyline', { class: 'mode-path' }, gPath);
  const pathDots = el('g', { class: 'mode-dots' }, gPath);

  const labelEls = new Map();
  const getLabel = id => {
    if (!labelEls.has(id)) {
      const g = el('g', { class: 'label', 'data-sub': byId.get(id).subsystem }, gLabels);
      const bg = el('rect', { rx: 3, ry: 3, class: 'label-bg' }, g);
      const tx = el('text', { class: 'label-text' }, g);
      tx.textContent = byId.get(id).name;
      const tick = el('line', { class: 'label-tick' }, g);
      labelEls.set(id, { g, bg, tx, tick });
    }
    return labelEls.get(id);
  };

  // ---- world positions ---------------------------------------------------
  function worldPositions(explode) {
    const centers = {};
    for (const s of SUBSYSTEMS) {
      const L = SUBSYSTEM_LAYOUT[s.id];
      centers[s.id] = [L.compact[0] + L.explode[0] * explode, L.compact[1] + L.explode[1] * explode, L.compact[2] + L.explode[2] * explode];
    }
    for (const n of nodes.values()) {
      const sl = slots.get(n.c.id);
      const cc = centers[n.c.subsystem];
      n.pos = [cc[0] + sl.lx, cc[1] + PLATE.h, cc[2] + sl.lz];
      n.size = { w: BOX.w, d: BOX.d, h: n.c.major ? BOX.hMajor : BOX.h };
    }
    return centers;
  }

  // ---- emphasis ------------------------------------------------------------
  function computeLevels(st) {
    const path = MODE_PATHS[st.mode] || [];
    const pathSet = new Set(path);
    const sel = st.selected;
    let isoSet = null;
    if (st.isolate && sel && byId.has(sel)) {
      isoSet = new Set([sel, ...(byId.get(sel).related || []), ...(adjacency.get(sel) || [])]);
    }
    for (const n of nodes.values()) {
      const c = n.c;
      let level = 'normal';
      if (!st.visible[c.subsystem]) level = 'hidden';
      else if (isoSet && !isoSet.has(c.id)) level = 'ghost';
      else if (st.matches && !st.matches.has(c.id)) level = 'dim';
      else if (st.mode !== 'system' && !c.modes.includes(st.mode) && !pathSet.has(c.id)) level = 'dim';
      n.level = level;
      n.onPath = pathSet.has(c.id) && level !== 'hidden';
      n.match = !!(st.matches && st.matches.has(c.id));
    }
  }

  // ---- render --------------------------------------------------------------
  let W = 0, H = 0;
  function measure() {
    const r = svg.getBoundingClientRect();
    W = r.width; H = r.height;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  }

  function render() {
    const st = store.get();
    if (!W || !H) measure();
    const centers = worldPositions(st.explode);
    computeLevels(st);

    // fit camera
    const cam0 = { yaw: st.yaw, pitch: st.pitch, scale: 1, cx: 0, cy: 0 };
    const pts = [];
    for (const s of SUBSYSTEMS) {
      if (!st.visible[s.id]) continue;
      const anyNode = [...nodes.values()].find(n => n.c.subsystem === s.id);
      const sz = plateSize(slots.get(anyNode.c.id).cols, slots.get(anyNode.c.id).rows);
      const c = centers[s.id];
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
        pts.push(project([c[0] + dx * sz.w / 2, c[1], c[2] + dz * sz.d / 2], cam0));
        pts.push(project([c[0] + dx * sz.w / 2, c[1] + 0.9, c[2] + dz * sz.d / 2], cam0));
      }
    }
    if (!pts.length) return;
    const b = bounds(pts);
    const pad = W < 640 ? 28 : 56;
    const fit = Math.min((W - pad * 2) / Math.max(b.w, 1), (H - pad * 2 - 30) / Math.max(b.h, 1));
    const scale = fit * st.zoom;
    const cam = { yaw: st.yaw, pitch: st.pitch, scale, cx: W / 2 - (b.minX + b.w / 2) * scale + st.panX, cy: H / 2 - (b.minY + b.h / 2) * scale + st.panY + 10 };
    scene.cam = cam;

    // plates
    for (const s of SUBSYSTEMS) {
      const P = plates[s.id];
      if (!st.visible[s.id]) { P.g.style.display = 'none'; continue; }
      P.g.style.display = '';
      const anyNode = [...nodes.values()].find(n => n.c.subsystem === s.id);
      const sz = plateSize(slots.get(anyNode.c.id).cols, slots.get(anyNode.c.id).rows);
      const c = centers[s.id];
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dz]) => project([c[0] + dx * sz.w / 2, c[1], c[2] + dz * sz.d / 2], cam));
      P.poly.setAttribute('points', polyPoints(corners));
      const dimmed = st.mode !== 'system' && ![...nodes.values()].some(n => n.c.subsystem === s.id && n.level === 'normal');
      P.g.classList.toggle('dim', dimmed);
      // tag at back-left corner (min y on screen among corners)
      const anchor = corners.reduce((a, p) => (p.y < a.y ? p : a), corners[0]);
      const tw = P.tagTx.textContent.length * 6.1 + 14;
      P.tagBg.setAttribute('x', anchor.x - 6); P.tagBg.setAttribute('y', anchor.y - 24);
      P.tagBg.setAttribute('width', tw); P.tagBg.setAttribute('height', 18);
      P.tagTx.setAttribute('x', anchor.x + 1); P.tagTx.setAttribute('y', anchor.y - 11);
    }

    // nodes
    const order = [];
    for (const n of nodes.values()) {
      if (n.level === 'hidden') { n.g.style.display = 'none'; continue; }
      n.g.style.display = '';
      const bf = boxFaces(n.pos, n.size, cam);
      n.top = bf.top; n.center = bf.center; n.depth = bf.depth; n.screenFaces = bf.faces;
      bf.faces.sort((a, b) => a.depth - b.depth);
      for (let i = 0; i < 3; i++) {
        const f = bf.faces[i];
        const p = n.faces[i];
        if (!f) { p.style.display = 'none'; continue; }
        p.style.display = '';
        p.setAttribute('points', polyPoints(f.pts));
        p.setAttribute('class', 'f f-' + f.kind);
      }
      // outline = union silhouette approximated by top face + visible sides (use top for selection ring)
      n.outline.setAttribute('points', polyPoints(bf.faces.find(f => f.kind === 'top')?.pts || bf.faces[0].pts));
      const g = n.g;
      g.classList.toggle('dim', n.level === 'dim');
      g.classList.toggle('ghost', n.level === 'ghost');
      g.classList.toggle('sel', st.selected === n.c.id);
      g.classList.toggle('hover', st.hovered === n.c.id);
      g.classList.toggle('match', n.match);
      g.classList.toggle('path', n.onPath);
      g.setAttribute('aria-pressed', st.selected === n.c.id ? 'true' : 'false');
      order.push(n);
    }
    order.sort((a, b) => a.depth - b.depth);
    for (const n of order) gNodes.appendChild(n.g);

    // edges
    for (const { e, line } of edgeEls) {
      const a = nodes.get(e.a), bb = nodes.get(e.b);
      if (!a || !bb || a.level === 'hidden' || bb.level === 'hidden') { line.style.display = 'none'; continue; }
      const weak = a.level !== 'normal' || bb.level !== 'normal';
      const active = (st.selected && (e.a === st.selected || e.b === st.selected)) || (st.hovered && (e.a === st.hovered || e.b === st.hovered));
      if (weak && !active) { line.style.display = 'none'; continue; }
      line.style.display = '';
      line.setAttribute('x1', a.top.x); line.setAttribute('y1', a.top.y);
      line.setAttribute('x2', bb.top.x); line.setAttribute('y2', bb.top.y);
      line.classList.toggle('active', !!active);
    }

    // mode path
    const path = (MODE_PATHS[st.mode] || []).map(id => nodes.get(id)).filter(n => n && n.level !== 'hidden');
    if (path.length > 1 && st.showFlow) {
      pathLine.style.display = '';
      pathLine.setAttribute('points', polyPoints(path.map(n => n.top)));
      pathLine.classList.toggle('animate', !st.reducedMotion);
      while (pathDots.childNodes.length < path.length) el('circle', { r: 3, class: 'mode-dot' }, pathDots);
      while (pathDots.childNodes.length > path.length) pathDots.removeChild(pathDots.lastChild);
      path.forEach((n, i) => { const d = pathDots.childNodes[i]; d.setAttribute('cx', n.top.x); d.setAttribute('cy', n.top.y); });
    } else { pathLine.style.display = 'none'; pathDots.innerHTML = ''; }

    // labels
    const wanted = new Set();
    for (const n of order) {
      const c = n.c;
      const show = st.labels === 'all'
        || st.selected === c.id || st.hovered === c.id || n.match
        || (st.labels === 'focus' && n.level === 'normal' && (c.major || n.onPath));
      if (show && st.labels !== 'none' || st.selected === c.id || st.hovered === c.id) wanted.add(c.id);
    }
    for (const [id, L] of labelEls) if (!wanted.has(id)) L.g.style.display = 'none';
    // simple greedy overlap avoidance: drop labels that would overlap a previously placed one (except selected/hovered/match)
    const placed = [];
    const wantedList = [...wanted].map(id => nodes.get(id)).sort((a, b) => {
      const pa = (st.selected === a.c.id ? 3 : st.hovered === a.c.id ? 2 : a.match ? 1 : 0);
      const pb = (st.selected === b.c.id ? 3 : st.hovered === b.c.id ? 2 : b.match ? 1 : 0);
      return pb - pa || b.depth - a.depth;
    });
    for (const n of wantedList) {
      const L = getLabel(n.c.id);
      const tw = n.c.name.length * 6.3 + 14, th = 18;
      const x = n.top.x - tw / 2, y = n.top.y - th - 14;
      const box = { x, y, w: tw, h: th };
      const priority = st.selected === n.c.id || st.hovered === n.c.id;
      const overlaps = placed.some(p => !(box.x + box.w < p.x || p.x + p.w < box.x || box.y + box.h < p.y || p.y + p.h < box.y));
      if (overlaps && !priority) { L.g.style.display = 'none'; continue; }
      placed.push(box);
      L.g.style.display = '';
      L.g.setAttribute('data-sub', n.c.subsystem);
      L.g.classList.toggle('sel', st.selected === n.c.id);
      L.g.classList.toggle('dim', n.level === 'dim' && !priority);
      L.bg.setAttribute('x', x); L.bg.setAttribute('y', y); L.bg.setAttribute('width', tw); L.bg.setAttribute('height', th);
      L.tx.setAttribute('x', n.top.x); L.tx.setAttribute('y', y + 12.5);
      L.tick.setAttribute('x1', n.top.x); L.tick.setAttribute('y1', y + th); L.tick.setAttribute('x2', n.top.x); L.tick.setAttribute('y2', n.top.y);
    }
  }

  let raf = 0;
  const requestRender = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

  // ---- interaction ----------------------------------------------------------
  let drag = null;
  svg.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    drag = { x: ev.clientX, y: ev.clientY, yaw: store.get().yaw, pitch: store.get().pitch, moved: false, id: ev.pointerId, target: ev.target.closest('.node')?.dataset.id || null };
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', ev => {
    if (drag && drag.id === ev.pointerId) {
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) {
        store.set({ yaw: drag.yaw + dx * 0.008, pitch: clamp(drag.pitch + dy * 0.006, PITCH_MIN, PITCH_MAX) });
        svg.classList.add('dragging');
      }
      return;
    }
    if (ev.pointerType !== 'mouse') return;
    const id = ev.target.closest('.node')?.dataset.id || null;
    if (id !== store.get().hovered) store.set({ hovered: id });
  });
  const endDrag = ev => {
    if (!drag || drag.id !== ev.pointerId) return;
    svg.classList.remove('dragging');
    if (!drag.moved) {
      const id = ev.target.closest('.node')?.dataset.id || null;
      const st = store.get();
      store.set({ selected: id === st.selected ? null : id, matches: null, query: id ? '' : st.query });
    }
    drag = null;
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('pointerleave', () => { if (store.get().hovered) store.set({ hovered: null }); });
  svg.addEventListener('wheel', ev => {
    if (!ev.ctrlKey && !ev.metaKey) return; // plain wheel scrolls the page
    ev.preventDefault();
    store.set({ zoom: clamp(store.get().zoom * (ev.deltaY < 0 ? 1.08 : 0.92), 0.5, 3) });
  }, { passive: false });

  // keyboard on the viewer container
  const viewer = svg.parentElement;
  viewer.addEventListener('keydown', ev => {
    const st = store.get();
    const step = deg(6);
    switch (ev.key) {
      case 'ArrowLeft': store.set({ yaw: st.yaw - step }); break;
      case 'ArrowRight': store.set({ yaw: st.yaw + step }); break;
      case 'ArrowUp': store.set({ pitch: clamp(st.pitch + step, PITCH_MIN, PITCH_MAX) }); break;
      case 'ArrowDown': store.set({ pitch: clamp(st.pitch - step, PITCH_MIN, PITCH_MAX) }); break;
      case '+': case '=': store.set({ zoom: clamp(st.zoom * 1.15, 0.5, 3) }); break;
      case '-': case '_': store.set({ zoom: clamp(st.zoom / 1.15, 0.5, 3) }); break;
      case 'Escape': store.set({ selected: null, isolate: false, matches: null, query: '' }); break;
      default: return;
    }
    ev.preventDefault();
  });

  // touch pinch zoom
  const touches = new Map();
  svg.addEventListener('touchstart', ev => { for (const t of ev.touches) touches.set(t.identifier, { x: t.clientX, y: t.clientY }); }, { passive: true });
  let pinchBase = null;
  svg.addEventListener('touchmove', ev => {
    if (ev.touches.length === 2) {
      ev.preventDefault();
      const [a, b] = ev.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (!pinchBase) pinchBase = { d, zoom: store.get().zoom };
      store.set({ zoom: clamp(pinchBase.zoom * (d / pinchBase.d), 0.5, 3) });
    }
  }, { passive: false });
  svg.addEventListener('touchend', () => { if (event.touches?.length < 2) pinchBase = null; }, { passive: true });

  // resize
  const ro = new ResizeObserver(() => { measure(); requestRender(); });
  ro.observe(svg);

  // ---- tween helper for reset / mode changes -------------------------------
  let tween = null;
  function animateTo(target, ms = 480) {
    if (store.get().reducedMotion) { store.set(target); return; }
    const from = { ...store.get() };
    const t0 = performance.now();
    if (tween) cancelAnimationFrame(tween);
    const step = now => {
      const t = clamp((now - t0) / ms, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      const patch = {};
      for (const k of Object.keys(target)) patch[k] = lerp(from[k], target[k], e);
      store.set(patch);
      if (t < 1) tween = requestAnimationFrame(step); else tween = null;
    };
    tween = requestAnimationFrame(step);
  }

  store.subscribe(requestRender);
  measure();
  render();

  Object.assign(scene, { render: requestRender, animateTo, nodes, destroy: () => ro.disconnect() });
  return scene;
}
