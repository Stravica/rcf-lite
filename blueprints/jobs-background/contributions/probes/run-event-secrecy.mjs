/**
 * Shim: run event-secrecy against the fixture jobs-runtime + in-memory
 * queue seam with a PII fixture input and write
 * .rcf/reports/blueprints/jobs-background/event-secrecy.json.
 */

import runProbe from './event-secrecy.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'queues+jobs', image: 'cloudflare/wrangler-dev-equivalent (in-memory driver) + jobs-runtime SIMULATE_PII_IN_JOB_INPUT=true', healthy: true };
runShim('event-secrecy', engine, runProbe);
