/**
 * Simplified KV-cache and weight-memory estimators for conventional (non-MLA, non-hybrid) attention.
 * KV bytes ≈ 2 × layers × tokens × KV_heads × head_dim × bytes_per_element × sequences
 */
export function kvBytesPerToken({ layers, kvHeads, headDim, bytes }) {
  return 2 * layers * kvHeads * headDim * bytes;
}
export function kvBytesPerSequence(p) {
  return kvBytesPerToken(p) * p.tokens;
}
export function kvBytesTotal(p) {
  return kvBytesPerSequence(p) * p.sequences;
}
export function weightBytes({ params, bits }) {
  return (params * bits) / 8;
}
export function fmtBytes(b) {
  if (!isFinite(b)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return (b >= 100 ? b.toFixed(0) : b >= 10 ? b.toFixed(1) : b.toFixed(2)) + ' ' + units[i];
}
export const fmtNum = n => Intl.NumberFormat('en-US').format(Math.round(n));
