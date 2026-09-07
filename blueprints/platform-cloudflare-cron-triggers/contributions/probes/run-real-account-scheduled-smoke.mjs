import runProbe from './real-account-scheduled-smoke.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'real-account', image: 'Cloudflare Workers analytics REST API', healthy: true };
runShim('real-account-scheduled-smoke', engine, runProbe);
