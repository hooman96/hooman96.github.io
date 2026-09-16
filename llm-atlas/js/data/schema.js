/**
 * LLM Atlas content model.
 *
 * Content (this folder), geometry (layout.js) and rendering (../ui) are kept
 * separate so the atlas can be maintained as a technical knowledge artifact.
 *
 * @typedef {'data'|'model'|'moe'|'training'|'posttraining'|'runtime'|'serving'} Subsystem
 * @typedef {'system'|'transformer'|'moe'|'pretraining'|'posttraining'|'inference'} AtlasMode
 *
 * @typedef {Object} AtlasComponent
 * @property {string} id                 kebab-case, unique, stable (used in URLs and edges)
 * @property {string} name               display name
 * @property {string} subtitle           one-line definition (<= 110 chars)
 * @property {Subsystem} subsystem
 * @property {AtlasMode[]} modes         lifecycle modes in which this component is emphasized
 * @property {string[]} aliases          alternative names / abbreviations (searchable)
 * @property {string[]} keywords         extra search terms, related technologies (searchable)
 * @property {string} summary            2-3 sentences: what it is
 * @property {string} purpose            why it exists
 * @property {string} mechanics          exact mechanics; may contain several sentences, plain text.
 *                                       Use `code` spans (backticks) for formulas/identifiers.
 * @property {string} [input]
 * @property {string} [output]
 * @property {string} [tensorShape]      tensor / state shape where appropriate
 * @property {string} [memory]           memory implications
 * @property {string} [compute]          compute implications
 * @property {string} [communication]    communication implications
 * @property {string[]} knobs            main tuning knobs
 * @property {string[]} metrics          metrics/signals that matter for it
 * @property {string[]} failureModes     common failure modes
 * @property {string} [trainingVsInference]
 * @property {string[]} related          ids of related components
 * @property {string[]} [references]     ids from references.js
 * @property {boolean} [major]           anchor component whose label is always shown in Whole System mode
 */
export const SUBSYSTEMS = /** @type {const} */ ([
  { id: 'data',         name: 'Data plane',        short: 'Data',      blurb: 'Corpora, governance, filtering, tokenizer training, packing and sharding.' },
  { id: 'model',        name: 'Model core',        short: 'Model',     blurb: 'The decoder-only Transformer: embeddings, attention, MLPs, LM head.' },
  { id: 'moe',          name: 'MoE subsystem',     short: 'MoE',       blurb: 'Routers, top-k dispatch, expert MLPs, combine, expert parallelism.' },
  { id: 'training',     name: 'Training',          short: 'Training',  blurb: 'Loss, autograd, optimizer, mixed precision, distributed collectives.' },
  { id: 'posttraining', name: 'Post-training',     short: 'Post-train',blurb: 'Annotation, SFT, LoRA/QLoRA, preference optimization, evaluation.' },
  { id: 'runtime',      name: 'Inference runtime', short: 'Runtime',   blurb: 'Request admission, prefix cache, prefill, paged KV, batching, decode.' },
  { id: 'serving',      name: 'Serving plane',     short: 'Serving',   blurb: 'Speculation, parallel inference, quantization, disaggregation, routing, telemetry.' },
]);

export const MODES = /** @type {const} */ ([
  { id: 'system',       label: 'Whole System',        title: 'From raw data to the next generated token',
    lead: 'Every subsystem of a modern LLM stack, in place. Select a component or switch modes to follow one lifecycle path.' },
  { id: 'transformer',  label: 'Inside Transformer',  title: 'One decoder block, token by token',
    lead: 'Embeddings, RMSNorm, Q/K/V projections, RoPE, causal attention, the residual stream, the MLP and the LM head.' },
  { id: 'moe',          label: 'MoE',                 title: 'Sparse experts: route, dispatch, compute, combine',
    lead: 'How a mixture-of-experts layer replaces the dense MLP, and what expert parallelism costs in communication.' },
  { id: 'pretraining',  label: 'Pre-training',        title: 'One optimizer step across thousands of accelerators',
    lead: 'Shards to tokens, forward, cross-entropy, backward, gradient collectives, AdamW, and the parallelism strategies that make it fit.' },
  { id: 'posttraining', label: 'SFT / Post-training', title: 'Turning a base model into an assistant',
    lead: 'Annotation pipelines, supervised fine-tuning, LoRA/QLoRA, preference optimization and evaluation.' },
  { id: 'inference',    label: 'Inference',           title: 'From API request to streamed token',
    lead: 'Admission, prefix-cache lookup, prefill, paged KV memory, continuous batching, the decode loop and the serving plane around it.' },
]);
