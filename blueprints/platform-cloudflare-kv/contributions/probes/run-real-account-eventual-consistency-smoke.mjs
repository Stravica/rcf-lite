import runProbe from './real-account-eventual-consistency-smoke.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'kv', image: 'live Cloudflare Workers KV via REST API (or skipped)', healthy: true };
runShim('real-account-eventual-consistency-smoke', engine, runProbe);
