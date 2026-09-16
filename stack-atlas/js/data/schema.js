/**
 * Stack Atlas content model. Same AtlasComponent contract as the LLM Atlas (see /llm-atlas/js/data/schema.js):
 * id, name, subtitle, subsystem, modes, aliases, keywords, summary, purpose, mechanics, input?, output?, tensorShape?
 * (here: "shape" of the state, e.g. a page table entry or a warp), memory?, compute?, communication?, knobs, metrics,
 * failureModes, trainingVsInference? (here: what changes between training and inference workloads), related, references?, major?
 *
 * @typedef {'app'|'runtime'|'kernel'|'virt'|'cpu'|'gpu'|'kernels'|'io'} Subsystem
 * @typedef {'system'|'forward'|'memory'|'scheduling'|'isolation'|'multigpu'|'kernelmode'} AtlasMode
 */
export const SUBSYSTEMS = /** @type {const} */ ([
  { id: 'app',     name: 'Application layer',     short: 'App',      blurb: 'Python process, GIL, event loop, PyTorch frontend, dispatcher, inference engine process, weight loading.' },
  { id: 'runtime', name: 'GPU runtime & compilers', short: 'Runtime', blurb: 'CUDA runtime/driver APIs, contexts, streams, caching allocator, cuBLAS, NCCL, Triton, torch.compile, launch path.' },
  { id: 'kernel',  name: 'OS kernel',             short: 'Kernel',   blurb: 'Syscalls, processes and threads, scheduler, virtual memory, page cache, I/O, network stack, GPU driver, DMA.' },
  { id: 'virt',    name: 'VMs & containers',      short: 'Virt',     blurb: 'Hypervisor, vCPUs, nested paging, GPU passthrough, containers, OCI images, runtimes, Kubernetes device plugins, MIG/MPS.' },
  { id: 'cpu',     name: 'CPU & host memory',     short: 'CPU',      blurb: 'Cores, SMT, cache hierarchy, coherence, speculation, SIMD, NUMA, DRAM, memory ordering, PCIe root complex.' },
  { id: 'gpu',     name: 'GPU hardware',          short: 'GPU',      blurb: 'Die, SMs, warp schedulers, CUDA/Tensor cores, register file, shared memory, L2, HBM, copy engines, NVLink, power.' },
  { id: 'kernels', name: 'GPU kernel code',       short: 'Kernels',  blurb: 'CUDA kernels, grid/block/thread, warps and divergence, coalescing, tiling, occupancy, GEMM, attention, fusion, roofline, PTX/SASS.' },
  { id: 'io',      name: 'Interconnect & I/O',    short: 'I/O',      blurb: 'PCIe, NVLink topology, RDMA, GPUDirect, NICs, NVMe, object storage, collectives over topology, H2D/D2H transfers.' },
]);

export const MODES = /** @type {const} */ ([
  { id: 'system',     label: 'Whole stack',        title: 'From a Python call to a tensor core, and back',
    lead: 'Every layer between an LLM application and the silicon it runs on. Select a component or switch modes to follow one path through the stack.' },
  { id: 'forward',    label: 'A forward pass',     title: 'What happens when you call model(x)',
    lead: 'Python → dispatcher → CUDA runtime → launch queue → driver → command processor → SMs → tensor cores → HBM, and the events that bring the result back.' },
  { id: 'memory',     label: 'Memory path',        title: 'Where the bytes live and how they move',
    lead: 'Virtual memory, page tables and the page cache on the host; pinned buffers, DMA and PCIe in between; HBM, L2, shared memory and registers on the GPU.' },
  { id: 'scheduling', label: 'Threads & scheduling', title: 'Who runs when: from the GIL to warp schedulers',
    lead: 'Python threads and the GIL, processes and the OS scheduler, cores and SMT on the CPU; grids, blocks, warps and occupancy on the GPU.' },
  { id: 'isolation',  label: 'VMs & containers',   title: 'Isolation layers and how a GPU reaches a container',
    lead: 'Hypervisors, vCPUs and nested paging; namespaces, cgroups, OCI images and runtimes; passthrough, MIG, MPS and time-slicing.' },
  { id: 'multigpu',   label: 'Multi-GPU comms',    title: 'How gradients and KV blocks cross the fabric',
    lead: 'NCCL over NVLink/NVSwitch inside a node, PCIe and NICs at the edge, RDMA and GPUDirect across nodes, and the topology that decides bandwidth.' },
  { id: 'kernelmode', label: 'Inside a kernel',    title: 'One CUDA kernel, from launch to roofline',
    lead: 'Grid, blocks, warps, coalescing, shared-memory tiling, occupancy, fusion and the roofline model that says whether a kernel is compute- or bandwidth-bound.' },
]);
