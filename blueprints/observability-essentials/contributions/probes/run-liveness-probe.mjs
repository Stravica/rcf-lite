import runProbe from './liveness-probe.mjs';
import { runShim } from './probe-utils.mjs';
runShim('liveness-probe', { kind: 'http', driver: 'node:http fixture probe-server on 127.0.0.1', healthy: true }, runProbe);
