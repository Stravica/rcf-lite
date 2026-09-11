import runProbe from './metrics-endpoint.mjs';
import { runShim } from './probe-utils.mjs';
runShim('metrics-endpoint', { kind: 'http', driver: 'node:http fixture probe-server on 127.0.0.1', healthy: true }, runProbe);
