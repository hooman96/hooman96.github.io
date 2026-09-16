/**
 * Generic plate/slot layout for an atlas. Geometry only; content never lives here.
 * World units: x right, y up, z toward the viewer. One box is ~1 unit wide.
 */
export const PITCH = { x: 1.42, z: 1.12 };
export const BOX = { w: 1.08, d: 0.78, h: 0.26, hMajor: 0.4 };
export const PLATE = { h: 0.06, pad: 0.45 };

/**
 * @param {Record<string, Array<[string,string]>>} manifest      subsystem id -> [[componentId, name], ...]
 * @param {Record<string, {cols:number}>} subsystemLayout        per-subsystem grid columns
 * @param {Record<string,[number,number]>} [overrides]           componentId -> [col,row]
 * @returns {Map<string,{sub:string, col:number, row:number, lx:number, lz:number, cols:number, rows:number}>}
 */
export function computeSlots(manifest, subsystemLayout, overrides = {}) {
  const slots = new Map();
  for (const [sub, list] of Object.entries(manifest)) {
    const cols = subsystemLayout[sub].cols;
    const used = new Set();
    const pending = [];
    list.forEach(([id]) => {
      const o = overrides[id];
      if (o) { used.add(o.join(',')); slots.set(id, { sub, col: o[0], row: o[1] }); }
      else pending.push(id);
    });
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

export function plateSize(cols, rows) {
  return { w: (cols - 1) * PITCH.x + BOX.w + PLATE.pad * 2, d: (rows - 1) * PITCH.z + BOX.d + PLATE.pad * 2 };
}
