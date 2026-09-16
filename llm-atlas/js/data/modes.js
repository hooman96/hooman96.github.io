/**
 * Lifecycle-mode execution paths: ordered component ids that light up (and animate) in each mode.
 * Components not on a path but tagged with the mode in their `modes` field are emphasized without the flow line.
 */
export const MODE_PATHS = {
  system: [
    'raw-corpora', 'tokenization', 'sharding', 'token-embeddings', 'causal-attention', 'dense-mlp', 'lm-head', 'vocabulary-logits',
    'cross-entropy', 'backward-pass', 'adamw', 'checkpoint-saving', 'sft', 'dpo', 'evaluation', 'quantized-weights',
    'api-request', 'prefix-cache-lookup', 'prefill', 'kv-cache', 'decode-loop', 'sampling', 'tokenizer-decode', 'streaming-response', 'telemetry',
  ],
  transformer: [
    'token-embeddings', 'rmsnorm', 'q-projection', 'k-projection', 'v-projection', 'rope', 'causal-attention', 'residual-stream',
    'dense-mlp', 'final-norm', 'lm-head', 'vocabulary-logits',
  ],
  moe: [
    'residual-stream', 'moe-replacement', 'router-projection', 'router-logits', 'top-k-selection', 'token-permutation', 'expert-dispatch',
    'all-to-all', 'expert-mlps', 'weighted-combine', 'unpermutation', 'final-norm',
  ],
  pretraining: [
    'sharding', 'tokenization', 'token-embeddings', 'forward-pass', 'vocabulary-logits', 'cross-entropy', 'autograd', 'backward-pass',
    'gradient-buffers', 'gradient-accumulation', 'gradient-clipping', 'distributed-collectives', 'adamw', 'optimizer-moments', 'checkpoint-saving',
  ],
  posttraining: [
    'instruction-dataset', 'annotation-taxonomy', 'annotators', 'rubrics', 'annotator-calibration', 'chat-template', 'loss-masking', 'sft',
    'lora', 'preference-pairs', 'reward-modeling', 'rlhf-ppo', 'dpo', 'safety-tuning', 'red-teaming', 'evaluation',
  ],
  inference: [
    'api-gateway', 'model-routing', 'api-request', 'tokenizer-encode', 'admission-control', 'request-queue', 'prefix-cache-lookup', 'prefill',
    'kv-allocation', 'paged-kv-cache', 'continuous-batching', 'decode-loop', 'logit-processors', 'sampling', 'tokenizer-decode',
    'streaming-response', 'telemetry',
  ],
};
