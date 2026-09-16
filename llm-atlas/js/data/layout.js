/**
 * Geometry for the atlas: subsystem plates, explode vectors and per-component
 * grid slots. Content never lives here; ids must exist in manifest.js.
 *
 * World units: x right, y up, z toward the viewer. One box is ~1 unit wide.
 */
import { MANIFEST } from './manifest.js';

/** Grid pitch between component slots on a plate. */
export const PITCH = { x: 1.42, z: 1.12 };
/** Component box size. */
export const BOX = { w: 1.08, d: 0.78, h: 0.26, hMajor: 0.4 };
/** Plate thickness and padding around slots. */
export const PLATE = { h: 0.06, pad: 0.45 };

/**
 * @type {Record<string,{cols:number, compact:[number,number,number], explode:[number,number,number], anchor:'left'|'right'|'front'|'back'|'top'}>}
 * compact = plate center at explode 0; explode = additional offset at explode 1.
 */
export const SUBSYSTEM_LAYOUT = {
  data:         { cols: 3, compact: [-6.4,  0.0,  0.2], explode: [-5.6,  0.3,  0.0], anchor: 'left' },
  model:        { cols: 5, compact: [ 0.0,  0.0,  0.0], explode: [ 0.0,  0.0,  0.0], anchor: 'front' },
  moe:          { cols: 5, compact: [ 0.0,  0.85, -2.9], explode: [ 0.0,  2.4, -2.2], anchor: 'top' },
  training:     { cols: 5, compact: [ 7.9,  0.0, -2.6], explode: [ 5.4,  0.7, -2.4], anchor: 'right' },
  posttraining: { cols: 5, compact: [ 7.9,  0.0,  2.6], explode: [ 5.8, -0.3,  2.4], anchor: 'right' },
  runtime:      { cols: 4, compact: [-1.0, -0.95, 4.6], explode: [-1.0, -2.2,  2.9], anchor: 'front' },
  serving:      { cols: 6, compact: [ 0.6, -1.75, 9.6], explode: [ 1.2,  1.3,  5.6], anchor: 'front' },
};

/** Optional slot overrides: id -> [col,row]. Everything else is laid out serpentine in manifest order. */
const SLOT_OVERRIDES = {
  // Model core reads like a block diagram: top row = attention path, middle = MLP + MoE swap, bottom = head.
  'token-embeddings': [0, 0], 'rmsnorm': [1, 0], 'q-projection': [2, 0], 'k-projection': [3, 0], 'v-projection': [4, 0],
  'rope': [4, 1], 'causal-attention': [3, 1], 'gqa-mqa': [2, 1], 'flash-attention': [1, 1], 'residual-stream': [0, 1],
  'dense-mlp': [0, 2], 'moe-replacement': [1, 2], 'final-norm': [2, 2], 'lm-head': [3, 2], 'vocabulary-logits': [4, 2],
};

/**
 * Compute local (plate-relative) slot coordinates for every component.
 * @returns {Map<string,{sub:string, col:number, row:number, lx:number, lz:number, cols:number, rows:number}>}
 */
export function computeSlots() {
  const slots = new Map();
  for (const [sub, list] of Object.entries(MANIFEST)) {
    const cols = SUBSYSTEM_LAYOUT[sub].cols;
    const used = new Set();
    const pending = [];
    list.forEach(([id]) => {
      const o = SLOT_OVERRIDES[id];
      if (o) { used.add(o.join(',')); slots.set(id, { sub, col: o[0], row: o[1] }); }
      else pending.push(id);
    });
    // serpentine fill of the remaining slots
    let i = 0;
    for (const id of pending) {
      let col, row;
      do {
        row = Math.floor(i / cols);
        const c = i % cols;
        col = row % 2 === 0 ? c : cols - 1 - c;
        i++;
      } while (used.has(`${col},${row}`));
      slots.set(id, { sub, col, row });
    }
    const rows = Math.max(...list.map(([id]) => slots.get(id).row)) + 1;
    for (const [id] of list) {
      const s = slots.get(id);
      s.cols = cols; s.rows = rows;
      s.lx = (s.col - (cols - 1) / 2) * PITCH.x;
      s.lz = (s.row - (rows - 1) / 2) * PITCH.z;
    }
  }
  return slots;
}

/** Plate footprint (world units) for a subsystem given its grid size. */
export function plateSize(cols, rows) {
  return { w: (cols - 1) * PITCH.x + BOX.w + PLATE.pad * 2, d: (rows - 1) * PITCH.z + BOX.d + PLATE.pad * 2 };
}
