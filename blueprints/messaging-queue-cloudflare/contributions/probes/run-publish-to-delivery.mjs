import runProbe from './publish-to-delivery.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'queues', image: 'cloudflare/wrangler-dev-equivalent (in-memory driver)', healthy: true };
runShim('publish-to-delivery', engine, runProbe);
