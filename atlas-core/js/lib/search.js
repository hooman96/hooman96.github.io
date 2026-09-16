/** Small in-memory search index over atlas components. No dependencies. */

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9+/ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** @param {import('../data/schema.js').AtlasComponent[]} comps */
export function buildIndex(comps) {
  return comps.map(c => ({
    id: c.id,
    name: norm(c.name),
    aliases: (c.aliases || []).map(norm),
    keywords: (c.keywords || []).map(norm),
    subtitle: norm(c.subtitle),
    summary: norm(c.summary),
    subsystem: c.subsystem,
  }));
}

/**
 * Score components against a query. Returns matches sorted by score desc.
 * Exact name/alias > name prefix/contains > keyword > subtitle/summary.
 * @returns {{id:string, score:number}[]}
 */
export function search(index, query) {
  const q = norm(query);
  if (!q) return [];
  const terms = q.split(' ').filter(Boolean);
  const out = [];
  for (const e of index) {
    let score = 0;
    const wordStart = (s, t) => s.split(' ').some(w => w.startsWith(t));
    if (e.name === q || e.aliases.includes(q)) score += 100;
    else if (e.name.startsWith(q)) score += 70;
    else if (wordStart(e.name, q)) score += 55;
    else if (e.aliases.some(a => a.startsWith(q))) score += 40;
    else if (e.aliases.some(a => wordStart(a, q))) score += 30;
    for (const t of terms) {
      if (e.name.includes(t)) score += 25;
      else if (e.aliases.some(a => a.includes(t))) score += 22;
      else if (e.keywords.some(k => k.includes(t))) score += 12;
      else if (e.subtitle.includes(t)) score += 6;
      else if (e.summary.includes(t)) score += 2;
      else { score = 0; break; } // every term must hit somewhere
    }
    if (score > 0) out.push({ id: e.id, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
