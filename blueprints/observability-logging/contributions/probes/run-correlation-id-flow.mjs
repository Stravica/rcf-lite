import runProbe from './correlation-id-flow.mjs';
import { runShim } from './probe-utils.mjs';
runShim('correlation-id-flow', { kind: 'logger', driver: 'in-process fixture logger factory (Node 24)', healthy: true }, runProbe);
