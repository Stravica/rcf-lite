import runProbe from './single-cell-concurrent-increment.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'in-process', image: 'in-process SingleCellObject on cf-platform fixture', healthy: true };
runShim('single-cell-concurrent-increment', engine, runProbe);
