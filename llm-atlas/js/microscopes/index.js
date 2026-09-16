/** Microscope registry. Each module exports { id, number, title, description, mount(bodyEl, ctx) }. */
import * as tokenizer from './tokenizer.js';
import * as transformer from './transformer.js';
import * as moe from './moe.js';
import * as training from './training.js';
import * as parallelism from './parallelism.js';
import * as posttraining from './posttraining.js';
import * as prefix from './prefix.js';
import * as kv from './kv.js';
import * as batching from './batching.js';
import * as decoding from './decoding.js';
import * as quant from './quant.js';
import * as serving from './serving.js';

export const PANELS = [tokenizer, transformer, moe, training, parallelism, posttraining, prefix, kv, batching, decoding, quant, serving];

