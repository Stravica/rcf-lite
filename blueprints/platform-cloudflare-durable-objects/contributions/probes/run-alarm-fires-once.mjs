import runProbe from './alarm-fires-once.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'in-process', image: 'in-process SingleCellObject alarm on cf-platform fixture', healthy: true };
runShim('alarm-fires-once', engine, runProbe);
