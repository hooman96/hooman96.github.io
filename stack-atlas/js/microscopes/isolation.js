/** Microscope 07 — bare metal vs VM vs container vs container-in-VM, and GPU sharing modes. */
import { html, canvas, svg } from '/atlas-core/js/microscopes/util.js';

export const id = 'scope-isolation';
export const short = 'VMs & containers';
export const title = 'Isolation layers and GPU sharing';
export const description = 'Bare metal, a VM, a container and the usual production combination (a container inside a VM on Kubernetes) differ in what is shared, what is isolated and how a GPU reaches the workload. Then the four ways to share one GPU: passthrough, MIG, MPS and time-slicing.';

const STACKS = {
  bare: { name: 'Bare metal', layers: [['App + CUDA libraries', 'app'], ['Host Linux kernel + NVIDIA driver', 'kernel'], ['CPU · GPU · NIC', 'gpu']], note: 'One kernel, one tenant. Native performance, no isolation beyond users and cgroups. Typical for dedicated training clusters.' },
  vm: { name: 'Virtual machine', layers: [['App + CUDA libraries', 'app'], ['Guest Linux kernel + NVIDIA driver', 'kernel'], ['Virtual hardware (vCPUs, EPT, VFIO device)', 'virt'], ['Hypervisor (KVM) on host kernel', 'virt'], ['CPU · GPU (passthrough) · NIC', 'gpu']], note: 'Separate kernel per tenant, strong isolation. VM exits and nested paging cost a few percent; the GPU is passed through whole with VFIO (or partitioned with SR-IOV/vGPU) and runs the real driver in the guest.' },
  container: { name: 'Container', layers: [['App + CUDA libraries (image)', 'app'], ['Namespaces · cgroups · seccomp', 'virt'], ['Host Linux kernel + NVIDIA driver', 'kernel'], ['CPU · GPU · NIC', 'gpu']], note: 'Shared host kernel; the container toolkit injects the host driver libraries and device nodes. Near-zero overhead, weaker isolation than a VM, and the CUDA version in the image must be compatible with the host driver.' },
  k8s: { name: 'Container in a VM (Kubernetes node)', layers: [['Pod: app + CUDA libraries', 'app'], ['Namespaces · cgroups · device plugin allocation', 'virt'], ['Guest kernel + NVIDIA driver + kubelet', 'kernel'], ['VM: vCPUs · EPT · VFIO GPU', 'virt'], ['Hypervisor on host', 'virt'], ['CPU · GPU · NIC', 'gpu']], note: 'Cloud default: the node is a VM with GPUs passed through, pods are containers on it. The device plugin advertises nvidia.com/gpu; whole-GPU allocation unless MIG or time-slicing is configured.' },
};
const SHARING = [
  ['Passthrough (whole GPU)', 'one tenant', 'full', 'hardware', 'none', 'Dedicated performance and memory; no sharing. Default in Kubernetes.'],
  ['MIG (hardware partitions)', 'up to 7 instances', 'dedicated SMs, memory, L2 slices', 'hardware', 'fixed profiles', 'Predictable QoS and fault isolation per instance; loses NVLink for the partitions and cannot burst beyond the slice. Good for many small models.'],
  ['MPS (shared context)', 'many processes', 'shared memory, concurrent kernels', 'software', 'active-thread % limit', 'Kernels from several processes run concurrently in one context; high utilization for small kernels, but one crash or OOM can affect all clients.'],
  ['Time-slicing', 'many processes', 'shared memory, serialized', 'software', 'none', 'The GPU context-switches between processes; simple and no isolation. Memory is not partitioned, so one process can starve another.'],
];

export function mount(root) {
  root.innerHTML = '';
  root.appendChild(html(`
    <div class="tabs" role="tablist" aria-label="Deployment stack">${Object.entries(STACKS).map(([k, v], i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-k="${k}">${v.name}</button>`).join('')}</div>
    <div class="scope-grid">
      <div id="iso-vis"></div>
      <div class="panel-desc" id="iso-note" aria-live="polite"></div>
    </div>
    <h4 class="ctl-label" style="margin-top:1rem">Sharing one GPU · select a mode</h4>
    <div class="tabs" role="tablist" aria-label="GPU sharing mode" id="iso-share"></div>
    <div class="kv-list" id="iso-share-out"></div>
    <div class="note"><b>Decision rule (illustrative).</b> Need fault and memory isolation between tenants → MIG (or separate GPUs). Many small models from trusted processes needing high utilization → MPS. Batch/dev workloads where simplicity beats QoS → time-slicing. Latency-critical serving of one large model → the whole GPU, with tensor parallelism across whole GPUs, never across MIG slices.</div>
  `));
  const vis = root.querySelector('#iso-vis'), note = root.querySelector('#iso-note');
  const draw = k => {
    const S = STACKS[k]; vis.innerHTML = '';
    const H = S.layers.length * 36 + 10, s = canvas(460, H, S.name + ' layer diagram');
    S.layers.forEach(([t, sub], i) => { const y = 5 + i * 36; svg('rect', { class: 'box sub-' + sub, x: 10, y, width: 440, height: 30, rx: 4 }, s); svg('text', { x: 230, y: y + 19, 'text-anchor': 'middle' }, s, t); });
    vis.appendChild(s); note.innerHTML = `<p><b>${S.name}.</b> ${S.note}</p><p class="ctl-help">${S.layers.length} layers · each boundary crossed by a request costs time (VM exits, syscalls, namespace lookups) and each layer needs a compatible driver story.</p>`;
  };
  root.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => { root.querySelectorAll('[data-k]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false')); draw(b.dataset.k); }));
  draw('bare');
  const share = root.querySelector('#iso-share'), out = root.querySelector('#iso-share-out');
  share.innerHTML = SHARING.map((r, i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-i="${i}">${r[0]}</button>`).join('');
  const showShare = i => { const r = SHARING[i]; share.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-selected', j === i ? 'true' : 'false')); out.innerHTML = `<div><b>Tenants</b><span>${r[1]}</span></div><div><b>Resources</b><span>${r[2]}</span></div><div><b>Isolation</b><span>${r[3]}</span></div><div><b>QoS control</b><span>${r[4]}</span></div><div style="grid-column:1/-1"><b>When</b><span>${r[5]}</span></div>`; };
  share.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) showShare(+b.dataset.i); });
  showShare(0);
}
