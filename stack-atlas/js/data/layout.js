/**
 * Geometry config for the Stack Atlas: a layer cake. Application on top, runtime beneath it, the OS kernel below that,
 * hardware at the bottom (CPU left, GPU right), VMs/containers beside the kernel, GPU kernel code between runtime and
 * GPU, interconnect in front. Exploding separates the layers vertically while keeping their stacking order.
 */
export const SUBSYSTEM_LAYOUT = {
  app:     { cols: 4, compact: [ 0.0,  3.4, -5.4], explode: [ 0.0,  2.2, -1.6] },
  runtime: { cols: 5, compact: [ 0.0,  1.7, -2.7], explode: [ 0.0,  1.1, -0.8] },
  kernels: { cols: 5, compact: [ 9.2,  1.7, -2.7], explode: [ 3.0,  1.1, -0.8] },
  kernel:  { cols: 5, compact: [ 0.0,  0.0,  0.0], explode: [ 0.0,  0.0,  0.0] },
  virt:    { cols: 4, compact: [-8.6,  0.0,  0.0], explode: [-3.0,  0.0,  0.4] },
  cpu:     { cols: 4, compact: [-4.4, -1.6,  3.2], explode: [-2.4, -1.0,  1.0] },
  gpu:     { cols: 5, compact: [ 4.4, -1.6,  3.2], explode: [ 2.4, -1.0,  1.0] },
  io:      { cols: 6, compact: [ 0.0, -3.0,  6.8], explode: [ 0.0, -1.6,  2.0] },
};

/** Slot overrides: id -> [col,row]. GPU plate reads from front end to memory. */
export const SLOT_OVERRIDES = {
  'gpu-command-processor': [0, 0], 'gpu-die': [1, 0], 'streaming-multiprocessor': [2, 0], 'warp-scheduler': [3, 0], 'cuda-tensor-cores': [4, 0],
  'register-file': [4, 1], 'shared-memory-l1': [3, 1], 'l2-cache': [2, 1], 'hbm': [1, 1], 'copy-engines': [0, 1],
  'nvlink-nvswitch': [0, 2], 'gpu-clocks-power': [1, 2], 'ecc-reliability': [2, 2],
};
