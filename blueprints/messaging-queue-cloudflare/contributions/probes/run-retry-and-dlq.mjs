import runProbe from './retry-and-dlq.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'queues', image: 'cloudflare/wrangler-dev-equivalent (in-memory driver)', healthy: true };
runShim('retry-and-dlq', engine, runProbe);
