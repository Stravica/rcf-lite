import runProbe from './real-account-resend-send.mjs';
import { runShim } from './probe-utils.mjs';
runShim('real-account-resend-send', { kind: 'https', driver: 'Resend REST API (live)', healthy: true }, runProbe);
