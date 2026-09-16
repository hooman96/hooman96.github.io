/** Dependency / data-flow edges. kind: 'flow' = execution order inside a subsystem, 'link' = cross-subsystem dependency. */
const FLOWS = [
  // app
  ['http-server', 'event-loop'], ['event-loop', 'python-process'], ['python-process', 'gil'], ['python-process', 'worker-processes'],
  ['python-process', 'pytorch-frontend'], ['pytorch-frontend', 'tensor-dispatcher'], ['tensor-dispatcher', 'c-extensions'],
  ['event-loop', 'inference-engine-process'], ['inference-engine-process', 'serialization-ipc'], ['inference-engine-process', 'model-weights-loading'],
  ['python-process', 'app-profiling'],
  // runtime
  ['cuda-runtime-api', 'cuda-driver-api'], ['cuda-driver-api', 'cuda-context'], ['cuda-runtime-api', 'streams-events'], ['streams-events', 'kernel-launch'],
  ['cuda-runtime-api', 'caching-allocator'], ['caching-allocator', 'pinned-unified-memory'], ['cublas-cudnn', 'kernel-launch'], ['nccl', 'kernel-launch'],
  ['triton-compiler', 'ptx-sass-jit'], ['torch-compile', 'triton-compiler'], ['ptx-sass-jit', 'kernel-launch'], ['kernel-launch', 'cuda-graphs'],
  // kernel
  ['syscall-interface', 'process-thread'], ['process-thread', 'cpu-scheduler'], ['cpu-scheduler', 'context-switch'], ['process-thread', 'virtual-memory'],
  ['virtual-memory', 'tlb-page-faults'], ['virtual-memory', 'page-cache-mmap'], ['page-cache-mmap', 'block-io'], ['syscall-interface', 'network-stack'],
  ['syscall-interface', 'gpu-driver'], ['gpu-driver', 'dma-iommu'], ['dma-iommu', 'interrupts'], ['process-thread', 'cgroups-namespaces'], ['virtual-memory', 'numa-policy'],
  // virt
  ['hypervisor', 'vcpu'], ['hypervisor', 'nested-paging'], ['hypervisor', 'gpu-passthrough'], ['container', 'oci-image'], ['oci-image', 'container-runtime'],
  ['container-runtime', 'nvidia-container-toolkit'], ['nvidia-container-toolkit', 'k8s-device-plugin'], ['k8s-device-plugin', 'mig-mps-timeslicing'], ['hypervisor', 'microvm-sandbox'],
  // cpu
  ['cpu-core', 'smt'], ['cpu-core', 'cache-hierarchy'], ['cache-hierarchy', 'cache-coherence'], ['cpu-core', 'branch-prediction'], ['cpu-core', 'simd'],
  ['cache-coherence', 'memory-ordering'], ['cache-hierarchy', 'numa-node'], ['numa-node', 'dram'], ['numa-node', 'pcie-root-complex'], ['cpu-core', 'cpu-frequency-power'],
  ['smt', 'hardware-threads'],
  // gpu
  ['gpu-command-processor', 'gpu-die'], ['gpu-die', 'streaming-multiprocessor'], ['streaming-multiprocessor', 'warp-scheduler'], ['warp-scheduler', 'cuda-tensor-cores'],
  ['streaming-multiprocessor', 'register-file'], ['streaming-multiprocessor', 'shared-memory-l1'], ['shared-memory-l1', 'l2-cache'], ['l2-cache', 'hbm'],
  ['hbm', 'copy-engines'], ['gpu-die', 'nvlink-nvswitch'], ['gpu-die', 'gpu-clocks-power'], ['hbm', 'ecc-reliability'],
  // kernels
  ['cuda-kernel', 'grid-block-thread'], ['grid-block-thread', 'warp-execution'], ['warp-execution', 'memory-coalescing'], ['memory-coalescing', 'shared-memory-tiling'],
  ['shared-memory-tiling', 'occupancy'], ['shared-memory-tiling', 'gemm-kernel'], ['gemm-kernel', 'attention-kernel'], ['gemm-kernel', 'kernel-fusion'],
  ['kernel-fusion', 'roofline'], ['gemm-kernel', 'async-copy-tma'], ['cuda-kernel', 'ptx-sass'], ['roofline', 'gpu-profiling'],
  // io
  ['pcie', 'host-device-transfer'], ['pcie', 'nvlink-topology'], ['nvlink-topology', 'collective-topology'], ['pcie', 'nic'], ['nic', 'rdma'], ['rdma', 'gpudirect'],
  ['pcie', 'nvme-storage'], ['nvme-storage', 'object-storage'], ['collective-topology', 'latency-vs-bandwidth'], ['pcie', 'cxl-memory'],
];
const LINKS = [
  ['tensor-dispatcher', 'cuda-runtime-api'], ['c-extensions', 'cuda-runtime-api'], ['inference-engine-process', 'cuda-graphs'], ['model-weights-loading', 'page-cache-mmap'],
  ['model-weights-loading', 'pinned-unified-memory'], ['serialization-ipc', 'virtual-memory'], ['gil', 'process-thread'], ['worker-processes', 'process-thread'],
  ['event-loop', 'network-stack'], ['http-server', 'network-stack'], ['app-profiling', 'gpu-profiling'],
  ['cuda-driver-api', 'gpu-driver'], ['cuda-context', 'gpu-driver'], ['kernel-launch', 'gpu-command-processor'], ['caching-allocator', 'hbm'],
  ['pinned-unified-memory', 'dma-iommu'], ['pinned-unified-memory', 'host-device-transfer'], ['nccl', 'nvlink-nvswitch'], ['nccl', 'collective-topology'], ['nccl', 'rdma'],
  ['cublas-cudnn', 'gemm-kernel'], ['triton-compiler', 'cuda-kernel'], ['ptx-sass-jit', 'ptx-sass'], ['cuda-graphs', 'kernel-launch'],
  ['cpu-scheduler', 'hardware-threads'], ['context-switch', 'cache-hierarchy'], ['tlb-page-faults', 'nested-paging'], ['virtual-memory', 'dram'],
  ['numa-policy', 'numa-node'], ['dma-iommu', 'pcie-root-complex'], ['dma-iommu', 'copy-engines'], ['gpu-driver', 'gpu-passthrough'], ['gpu-driver', 'nvidia-container-toolkit'],
  ['cgroups-namespaces', 'container'], ['vcpu', 'cpu-scheduler'], ['mig-mps-timeslicing', 'gpu-die'], ['mig-mps-timeslicing', 'cuda-context'],
  ['pcie-root-complex', 'pcie'], ['nvlink-nvswitch', 'nvlink-topology'], ['copy-engines', 'host-device-transfer'], ['hbm', 'roofline'], ['cuda-tensor-cores', 'roofline'],
  ['cuda-tensor-cores', 'gemm-kernel'], ['shared-memory-l1', 'shared-memory-tiling'], ['register-file', 'occupancy'], ['warp-scheduler', 'warp-execution'],
  ['streaming-multiprocessor', 'grid-block-thread'], ['l2-cache', 'memory-coalescing'], ['gpu-clocks-power', 'roofline'], ['block-io', 'nvme-storage'],
  ['network-stack', 'nic'], ['gpudirect', 'dma-iommu'], ['interrupts', 'nic'], ['simd', 'python-process'], ['dram', 'host-device-transfer'], ['gpu-profiling', 'roofline'],
];
export const EDGES = (() => {
  const out = []; const seen = new Set();
  const add = (a, b, kind) => { const k = a + '>' + b; if (!seen.has(k)) { seen.add(k); out.push({ a, b, kind }); } };
  for (const [a, b] of FLOWS) add(a, b, 'flow');
  for (const [a, b] of LINKS) add(a, b, 'link');
  return out;
})();
