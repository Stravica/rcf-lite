import runProbe from './real-account-concurrency-smoke.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'queues', image: 'cloudflare/queues (accountBound)', healthy: true };
runShim('real-account-concurrency-smoke', engine, runProbe);
