import runProbe from './real-account-d1-round-trip.mjs';
import { runShim } from './probe-utils.mjs';
runShim('real-account-d1-round-trip', { kind: 'd1', driver: 'Cloudflare D1 REST API (live)', healthy: true }, runProbe);
