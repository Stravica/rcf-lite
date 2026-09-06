import runProbe from './event-secrecy.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'queues', image: 'cloudflare/wrangler-dev-equivalent (in-memory driver)', healthy: true };
runShim('event-secrecy', engine, runProbe);
