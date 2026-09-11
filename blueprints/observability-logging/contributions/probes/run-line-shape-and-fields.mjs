import runProbe from './line-shape-and-fields.mjs';
import { runShim } from './probe-utils.mjs';
runShim('line-shape-and-fields', { kind: 'logger', driver: 'in-process fixture logger factory (Node 24)', healthy: true }, runProbe);
