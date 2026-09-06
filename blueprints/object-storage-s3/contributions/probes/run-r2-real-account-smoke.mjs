import runProbe from './r2-real-account-smoke.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 's3', image: 'cloudflare-r2', healthy: true };
runShim('r2-real-account-smoke', engine, runProbe);
