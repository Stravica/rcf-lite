import runProbe from './real-account-storage-smoke.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'accountBound', image: 'Cloudflare Workers real account (DO namespace)', healthy: true };
runShim('real-account-storage-smoke', engine, runProbe);
