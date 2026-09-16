/**
 * Dependency / data-flow edges between components.
 * kind: 'flow' = execution order inside a subsystem, 'link' = cross-subsystem dependency.
 * Ids must exist in manifest.js (validated at load time in components.js).
 */
import { MANIFEST } from './manifest.js';

/** Subsystems whose manifest order is a faithful execution chain. */
const CHAIN_SUBSYSTEMS = ['data', 'runtime'];

/** Explicit flows where manifest order is not a single chain. */
const EXPLICIT_FLOWS = [
  // model core
  ['token-embeddings', 'rmsnorm'], ['rmsnorm', 'q-projection'], ['rmsnorm', 'k-projection'], ['rmsnorm', 'v-projection'],
  ['q-projection', 'rope'], ['k-projection', 'rope'], ['rope', 'causal-attention'], ['v-projection', 'causal-attention'],
  ['causal-attention', 'gqa-mqa'], ['causal-attention', 'flash-attention'], ['causal-attention', 'residual-stream'],
  ['residual-stream', 'dense-mlp'], ['residual-stream', 'moe-replacement'], ['dense-mlp', 'final-norm'], ['moe-replacement', 'final-norm'],
  ['final-norm', 'lm-head'], ['lm-head', 'vocabulary-logits'],
  // moe
  ['router-projection', 'router-logits'], ['router-logits', 'top-k-selection'], ['top-k-selection', 'token-permutation'],
  ['token-permutation', 'expert-dispatch'], ['expert-dispatch', 'all-to-all'], ['all-to-all', 'expert-mlps'],
  ['expert-mlps', 'weighted-combine'], ['shared-experts', 'weighted-combine'], ['weighted-combine', 'unpermutation'],
  ['top-k-selection', 'load-balancing'], ['all-to-all', 'expert-parallelism'], ['expert-parallelism', 'expert-placement'],
  ['expert-placement', 'hot-expert-replication'],
  // training
  ['forward-pass', 'cross-entropy'], ['cross-entropy', 'autograd'], ['autograd', 'backward-pass'], ['backward-pass', 'gradient-buffers'],
  ['gradient-buffers', 'gradient-accumulation'], ['gradient-accumulation', 'gradient-clipping'], ['gradient-clipping', 'distributed-collectives'],
  ['distributed-collectives', 'adamw'], ['adamw', 'optimizer-moments'], ['lr-scheduler', 'adamw'], ['mixed-precision', 'forward-pass'],
  ['activation-checkpointing', 'backward-pass'], ['adamw', 'checkpoint-saving'],
  ['distributed-collectives', 'data-parallel'], ['distributed-collectives', 'tensor-parallel'], ['distributed-collectives', 'pipeline-parallel'],
  ['distributed-collectives', 'context-parallel'], ['distributed-collectives', 'fsdp-zero'],
  // post-training
  ['instruction-dataset', 'annotation-taxonomy'], ['annotation-taxonomy', 'annotators'], ['annotators', 'rubrics'], ['rubrics', 'annotator-calibration'],
  ['annotator-calibration', 'chat-template'], ['chat-template', 'loss-masking'], ['loss-masking', 'sft'], ['sft', 'full-fine-tuning'], ['sft', 'lora'],
  ['lora', 'qlora'], ['sft', 'preference-pairs'], ['preference-pairs', 'reward-modeling'], ['reward-modeling', 'rlhf-ppo'], ['preference-pairs', 'dpo'],
  ['rlhf-ppo', 'safety-tuning'], ['dpo', 'safety-tuning'], ['safety-tuning', 'red-teaming'], ['red-teaming', 'evaluation'],
  // serving plane
  ['api-gateway', 'model-routing'], ['model-routing', 'backpressure'], ['backpressure', 'autoscaling'], ['autoscaling', 'canary-releases'],
  ['canary-releases', 'telemetry'], ['telemetry', 'latency-metrics'],
  ['speculative-decoding', 'draft-models'], ['speculative-decoding', 'prompt-lookup'], ['speculative-decoding', 'multi-token-prediction'],
  ['tp-inference', 'pp-inference'], ['pp-inference', 'ep-inference'], ['quantized-weights', 'quantized-kv-cache'], ['quantized-kv-cache', 'kv-offloading'],
  ['cuda-graphs', 'kernel-compilation'], ['disaggregated-serving', 'multi-lora-serving'],
];

const LINKS = [
  ['sharding', 'forward-pass'], ['tokenization', 'token-embeddings'], ['tokenizer-training', 'tokenizer-encode'],
  ['vocabulary-logits', 'cross-entropy'], ['moe-replacement', 'router-projection'], ['unpermutation', 'moe-replacement'],
  ['adamw', 'sft'], ['checkpoint-saving', 'instruction-dataset'], ['expert-parallelism', 'ep-inference'], ['tensor-parallel', 'tp-inference'],
  ['pipeline-parallel', 'pp-inference'], ['lora', 'multi-lora-serving'], ['evaluation', 'quantized-weights'], ['quantized-weights', 'api-request'],
  ['api-gateway', 'api-request'], ['model-routing', 'api-request'], ['streaming-response', 'telemetry'], ['chat-template', 'tokenizer-encode'],
  ['kv-cache', 'causal-attention'], ['gqa-mqa', 'kv-cache'], ['flash-attention', 'prefill'], ['prefill', 'kv-cache'],
  ['prefix-cache-lookup', 'paged-kv-cache'], ['decode-loop', 'speculative-decoding'], ['paged-kv-cache', 'quantized-kv-cache'],
  ['paged-kv-cache', 'kv-offloading'], ['decode-loop', 'cuda-graphs'], ['prefill', 'disaggregated-serving'], ['decode-loop', 'disaggregated-serving'],
  ['request-queue', 'backpressure'], ['continuous-batching', 'autoscaling'], ['sampling', 'vocabulary-logits'], ['kv-cache', 'kv-allocation'],
  ['load-balancing', 'cross-entropy'], ['mixed-precision', 'quantized-weights'], ['dense-mlp', 'expert-mlps'],
];

export const EDGES = (() => {
  const out = [];
  const seen = new Set();
  const add = (a, b, kind) => { const k = a + '>' + b; if (!seen.has(k)) { seen.add(k); out.push({ a, b, kind }); } };
  for (const sub of CHAIN_SUBSYSTEMS) {
    const ids = MANIFEST[sub].map(([id]) => id);
    for (let i = 0; i < ids.length - 1; i++) add(ids[i], ids[i + 1], 'flow');
  }
  for (const [a, b] of EXPLICIT_FLOWS) add(a, b, 'flow');
  for (const [a, b] of LINKS) add(a, b, 'link');
  return out;
})();
