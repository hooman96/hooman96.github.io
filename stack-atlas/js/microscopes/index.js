/** Microscope registry for the Stack Atlas. */
import * as forward from './forward.js';
import * as roofline from './roofline.js';
import * as occupancy from './occupancy.js';
import * as tiling from './tiling.js';
import * as memory from './memory.js';
import * as vm from './vm.js';
import * as threads from './threads.js';
import * as isolation from './isolation.js';
import * as multigpu from './multigpu.js';

export const PANELS = [forward, roofline, occupancy, tiling, memory, vm, threads, isolation, multigpu];
