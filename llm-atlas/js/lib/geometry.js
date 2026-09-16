/**
 * Tiny orthographic 3D → 2D projector with painter's-algorithm face sorting.
 * Kept free of DOM so it can be unit-tested and reused by the isometric fallback.
 */

/** @typedef {{yaw:number, pitch:number, scale:number, cx:number, cy:number}} Camera  angles in radians */

/** Rotate + project a world point. Returns screen x/y and depth (larger = closer). */
export function project(p, cam) {
  const [x, y, z] = p;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const x1 = x * cy - z * sy;
  const z1 = x * sy + z * cy;
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  return { x: cam.cx + x1 * cam.scale, y: cam.cy - y2 * cam.scale, depth: z2 };
}

/** Rotated-space normal z component; > 0 means the face points at the camera. */
export function facing(normal, cam) {
  const [nx, ny, nz] = normal;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  const z1 = nx * sy + nz * cy;
  return ny * sp + z1 * cp;
}

/**
 * Build the visible faces of an axis-aligned box.
 * @param {[number,number,number]} c   bottom-center of the box (x, y, z)
 * @param {{w:number,d:number,h:number}} s
 * @param {Camera} cam
 * @returns {{faces:Array<{kind:'top'|'side'|'side2'|'bottom', pts:Array<{x:number,y:number}>, depth:number, shade:number}>, top:{x:number,y:number}, depth:number}}
 */
export function boxFaces(c, s, cam) {
  const [x, y, z] = c;
  const hw = s.w / 2, hd = s.d / 2;
  const V = [
    [x - hw, y, z - hd], [x + hw, y, z - hd], [x + hw, y, z + hd], [x - hw, y, z + hd],             // bottom 0-3
    [x - hw, y + s.h, z - hd], [x + hw, y + s.h, z - hd], [x + hw, y + s.h, z + hd], [x - hw, y + s.h, z + hd], // top 4-7
  ];
  const P = V.map(v => project(v, cam));
  const defs = [
    { kind: 'top',    idx: [4, 5, 6, 7], n: [0, 1, 0] },
    { kind: 'bottom', idx: [0, 3, 2, 1], n: [0, -1, 0] },
    { kind: 'side',   idx: [3, 2, 6, 7], n: [0, 0, 1] },   // front
    { kind: 'side',   idx: [1, 0, 4, 5], n: [0, 0, -1] },  // back
    { kind: 'side2',  idx: [2, 1, 5, 6], n: [1, 0, 0] },   // right
    { kind: 'side2',  idx: [0, 3, 7, 4], n: [-1, 0, 0] },  // left
  ];
  const faces = [];
  for (const f of defs) {
    const fz = facing(f.n, cam);
    if (fz <= 0.001) continue;
    const pts = f.idx.map(i => P[i]);
    const depth = pts.reduce((a, p) => a + p.depth, 0) / pts.length;
    faces.push({ kind: f.kind, pts, depth, shade: fz });
  }
  const topC = project([x, y + s.h, z], cam);
  const center = project([x, y + s.h / 2, z], cam);
  return { faces, top: topC, depth: center.depth, center };
}

export function polyPoints(pts) {
  let s = '';
  for (const p of pts) s += p.x.toFixed(1) + ',' + p.y.toFixed(1) + ' ';
  return s;
}

/** Bounding box of projected points. */
export function bounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg = d => (d * Math.PI) / 180;
