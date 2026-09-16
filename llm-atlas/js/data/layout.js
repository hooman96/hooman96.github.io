/**
 * Geometry config for the LLM Atlas: subsystem plates, explode vectors and slot overrides.
 * compact = plate center at explode 0; explode = additional offset at explode 1. cols = grid columns.
 */
export const SUBSYSTEM_LAYOUT = {
  data:         { cols: 3, compact: [-6.4,  0.0,  0.2], explode: [-5.6,  0.3,  0.0] },
  model:        { cols: 5, compact: [ 0.0,  0.0,  0.0], explode: [ 0.0,  0.0,  0.0] },
  moe:          { cols: 5, compact: [ 0.0,  0.85, -2.9], explode: [ 0.0,  2.4, -2.2] },
  training:     { cols: 5, compact: [ 7.9,  0.0, -2.6], explode: [ 5.4,  0.7, -2.4] },
  posttraining: { cols: 5, compact: [ 7.9,  0.0,  2.6], explode: [ 5.8, -0.3,  2.4] },
  runtime:      { cols: 4, compact: [-1.0, -0.95, 4.6], explode: [-1.0, -2.2,  2.9] },
  serving:      { cols: 6, compact: [ 0.6, -1.75, 9.6], explode: [ 1.2,  1.3,  5.6] },
};

/** Slot overrides: id -> [col,row]. Model core reads like a block diagram. */
export const SLOT_OVERRIDES = {
  'token-embeddings': [0, 0], 'rmsnorm': [1, 0], 'q-projection': [2, 0], 'k-projection': [3, 0], 'v-projection': [4, 0],
  'rope': [4, 1], 'causal-attention': [3, 1], 'gqa-mqa': [2, 1], 'flash-attention': [1, 1], 'residual-stream': [0, 1],
  'dense-mlp': [0, 2], 'moe-replacement': [1, 2], 'final-norm': [2, 2], 'lm-head': [3, 2], 'vocabulary-logits': [4, 2],
};
