/**
 * Shim: run producer-facade-ready against the fixture's in-memory
 * queue-driver seam and write
 * .rcf/reports/blueprints/messaging-queue-cloudflare/producer-facade-ready.json.
 */

import runProbe from './producer-facade-ready.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'queues', image: 'cloudflare/wrangler-dev-equivalent (in-memory driver)', healthy: true };
runShim('producer-facade-ready', engine, runProbe);
