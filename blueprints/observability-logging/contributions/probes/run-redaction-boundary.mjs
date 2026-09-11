import runProbe from './redaction-boundary.mjs';
import { runShim } from './probe-utils.mjs';
runShim('redaction-boundary', { kind: 'logger', driver: 'in-process fixture logger factory (Node 24)', healthy: true }, runProbe);
