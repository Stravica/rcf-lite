/**
 * Shim: run retry-and-fail against the fixture jobs-runtime + in-memory
 * queue seam and write
 * .rcf/reports/blueprints/jobs-background/retry-and-fail.json.
 */

import runProbe from './retry-and-fail.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'queues+jobs', image: 'cloudflare/wrangler-dev-equivalent (in-memory driver) + jobs-runtime SIMULATE_HANDLER_THROW=true', healthy: true };
runShim('retry-and-fail', engine, runProbe);
