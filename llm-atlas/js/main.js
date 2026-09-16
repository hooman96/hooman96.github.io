/** Entry point for /llm-atlas: content model + config → shared atlas engine. */
import { COMPONENTS, BY_ID, validateContent } from './data/components.js';
import { EDGES } from './data/edges.js';
import { SUBSYSTEMS, MODES } from './data/schema.js';
import { MANIFEST } from './data/manifest.js';
import { MODE_PATHS } from './data/modes.js';
import { SUBSYSTEM_LAYOUT, SLOT_OVERRIDES } from './data/layout.js';
import { REFERENCES } from './data/references.js';
import { SCOPE_FOR } from './data/scopes.js';
import { PANELS } from './microscopes/index.js';
import { createAtlas } from '/atlas-core/js/app.js';

validateContent();

createAtlas({
  components: COMPONENTS, byId: BY_ID, edges: EDGES,
  subsystems: SUBSYSTEMS, modes: MODES, modePaths: MODE_PATHS, manifest: MANIFEST,
  layout: { subsystems: SUBSYSTEM_LAYOUT, overrides: SLOT_OVERRIDES },
  references: REFERENCES, scopeFor: SCOPE_FOR, panels: PANELS,
  titleBase: 'LLM Atlas', titleSuffix: ' — Interactive LLM Systems Explorer | Hooman Mohammadi',
  storageKey: 'llm-atlas', deepLinkExplode: ['moe', 'serving'],
});
