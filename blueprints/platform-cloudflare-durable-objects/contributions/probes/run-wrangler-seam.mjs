import runProbe from './wrangler-seam.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'wrangler-dev', image: 'wrangler dev (workerd) on cf-platform fixture', healthy: true };
runShim('wrangler-seam', engine, runProbe);
