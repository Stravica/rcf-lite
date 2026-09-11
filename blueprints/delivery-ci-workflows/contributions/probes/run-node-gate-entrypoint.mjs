import runProbe from './node-gate-entrypoint.mjs';
import { runShim } from './probe-utils.mjs';
runShim('node-gate-entrypoint', { kind: 'lint', driver: 'fixture template scan', healthy: true }, runProbe);
