import runProbe from './real-account-magic-link-send.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'resend-http-api', image: 'live Resend HTTP API (sandbox sender + sandbox recipient) (or skipped)', healthy: true };
runShim('real-account-magic-link-send', engine, runProbe);
