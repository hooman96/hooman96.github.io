/** Aggregates and validates all component content. */
import { MANIFEST, ALL_IDS } from './manifest.js';
import { REFERENCES } from './references.js';
import { DATA_COMPONENTS } from './components/data.js';
import { MODEL_COMPONENTS } from './components/model.js';
import { MOE_COMPONENTS } from './components/moe.js';
import { TRAINING_COMPONENTS } from './components/training.js';
import { POSTTRAINING_COMPONENTS } from './components/posttraining.js';
import { RUNTIME_COMPONENTS } from './components/runtime.js';
import { SERVING_COMPONENTS } from './components/serving.js';

/** @type {import('./schema.js').AtlasComponent[]} */
export const COMPONENTS = [
  ...DATA_COMPONENTS, ...MODEL_COMPONENTS, ...MOE_COMPONENTS, ...TRAINING_COMPONENTS,
  ...POSTTRAINING_COMPONENTS, ...RUNTIME_COMPONENTS, ...SERVING_COMPONENTS,
];

export const BY_ID = new Map(COMPONENTS.map(c => [c.id, c]));

/** Development-time validation: log (never throw) so a content typo cannot take the page down. */
export function validateContent() {
  const problems = [];
  const idSet = new Set(ALL_IDS);
  const seen = new Set();
  for (const c of COMPONENTS) {
    if (!idSet.has(c.id)) problems.push(`unknown id ${c.id}`);
    if (seen.has(c.id)) problems.push(`duplicate id ${c.id}`);
    seen.add(c.id);
    const expectedSub = Object.entries(MANIFEST).find(([, l]) => l.some(([id]) => id === c.id))?.[0];
    if (expectedSub && c.subsystem !== expectedSub) problems.push(`${c.id}: subsystem ${c.subsystem} ≠ ${expectedSub}`);
    for (const r of c.related || []) if (!idSet.has(r)) problems.push(`${c.id}: related → unknown ${r}`);
    for (const r of c.references || []) if (!REFERENCES[r]) problems.push(`${c.id}: reference → unknown ${r}`);
    if (!c.modes?.includes('system')) problems.push(`${c.id}: missing 'system' mode`);
  }
  for (const id of ALL_IDS) if (!seen.has(id)) problems.push(`missing content for ${id}`);
  if (problems.length) console.warn('[llm-atlas] content validation:', problems);
  return problems;
}
