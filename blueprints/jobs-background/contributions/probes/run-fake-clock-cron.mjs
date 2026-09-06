/**
 * Shim: run fake-clock-cron against the fixture's in-memory queue seam +
 * fake-clock scheduler + jobs-runtime and write
 * .rcf/reports/blueprints/jobs-background/fake-clock-cron.json.
 */

import runProbe from './fake-clock-cron.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'queues+scheduler', image: 'cloudflare/wrangler-dev-equivalent (in-memory driver) + inProcess scheduler with injected fake clock', healthy: true };
runShim('fake-clock-cron', engine, runProbe);
