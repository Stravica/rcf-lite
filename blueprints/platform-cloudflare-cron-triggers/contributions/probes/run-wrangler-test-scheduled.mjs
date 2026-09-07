import runProbe from './wrangler-test-scheduled.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'wrangler', image: 'wrangler dev --test-scheduled on cf-platform fixture', healthy: true };
runShim('wrangler-test-scheduled', engine, runProbe);
