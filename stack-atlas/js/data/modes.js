/** Mode execution paths: ordered ids that light up and animate per lifecycle mode. */
export const MODE_PATHS = {
  system: [
    'http-server', 'python-process', 'pytorch-frontend', 'tensor-dispatcher', 'cuda-runtime-api', 'kernel-launch', 'gpu-command-processor',
    'streaming-multiprocessor', 'cuda-tensor-cores', 'hbm', 'streams-events', 'python-process',
  ],
  forward: [
    'http-server', 'event-loop', 'inference-engine-process', 'pytorch-frontend', 'tensor-dispatcher', 'cuda-runtime-api', 'caching-allocator',
    'kernel-launch', 'cuda-driver-api', 'gpu-command-processor', 'streaming-multiprocessor', 'warp-scheduler', 'cuda-tensor-cores', 'hbm',
    'streams-events', 'host-device-transfer', 'event-loop',
  ],
  memory: [
    'model-weights-loading', 'page-cache-mmap', 'virtual-memory', 'tlb-page-faults', 'pinned-unified-memory', 'dma-iommu', 'pcie',
    'host-device-transfer', 'copy-engines', 'hbm', 'l2-cache', 'shared-memory-l1', 'register-file',
  ],
  scheduling: [
    'http-server', 'event-loop', 'gil', 'worker-processes', 'process-thread', 'cpu-scheduler', 'context-switch', 'hardware-threads', 'smt', 'cpu-core',
    'numa-node', 'kernel-launch', 'gpu-command-processor', 'grid-block-thread', 'warp-execution', 'warp-scheduler', 'occupancy',
  ],
  isolation: [
    'hypervisor', 'vcpu', 'nested-paging', 'gpu-passthrough', 'gpu-driver', 'container', 'oci-image', 'container-runtime', 'nvidia-container-toolkit',
    'k8s-device-plugin', 'mig-mps-timeslicing', 'cgroups-namespaces',
  ],
  multigpu: [
    'nccl', 'collective-topology', 'nvlink-nvswitch', 'nvlink-topology', 'pcie-root-complex', 'pcie', 'nic', 'rdma', 'gpudirect', 'dma-iommu', 'hbm',
  ],
  kernelmode: [
    'cuda-kernel', 'kernel-launch', 'grid-block-thread', 'warp-execution', 'memory-coalescing', 'shared-memory-tiling', 'occupancy', 'gemm-kernel',
    'kernel-fusion', 'roofline', 'gpu-profiling', 'ptx-sass',
  ],
};
