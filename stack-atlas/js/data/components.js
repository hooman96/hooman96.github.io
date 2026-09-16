/** Aggregates and validates all Stack Atlas content. */
import { MANIFEST, ALL_IDS } from './manifest.js';
import { REFERENCES } from './references.js';
import { APP_COMPONENTS } from './components/app.js';
import { RUNTIME_COMPONENTS } from './components/runtime.js';
import { KERNEL_COMPONENTS } from './components/kernel.js';
import { VIRT_COMPONENTS } from './components/virt.js';
import { CPU_COMPONENTS } from './components/cpu.js';
import { GPU_COMPONENTS } from './components/gpu.js';
import { KERNELS_COMPONENTS } from './components/kernels.js';
import { IO_COMPONENTS } from './components/io.js';

export const COMPONENTS = [
  ...APP_COMPONENTS, ...RUNTIME_COMPONENTS, ...KERNEL_COMPONENTS, ...VIRT_COMPONENTS,
  ...CPU_COMPONENTS, ...GPU_COMPONENTS, ...KERNELS_COMPONENTS, ...IO_COMPONENTS,
];
export const BY_ID = new Map(COMPONENTS.map(c => [c.id, c]));

export function validateContent() {
  const problems = [];
  const idSet = new Set(ALL_IDS); const seen = new Set();
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
  if (problems.length) console.warn('[stack-atlas] content validation:', problems);
  return problems;
}
