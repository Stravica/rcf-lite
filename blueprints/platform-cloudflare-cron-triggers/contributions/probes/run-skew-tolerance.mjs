import runProbe from './skew-tolerance.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'in-process', image: 'in-process dispatcher on cf-platform fixture with fake clock', healthy: true };
runShim('skew-tolerance', engine, runProbe);
