import runProbe from './unverified-sender-refusal.mjs';
import { runShim } from './probe-utils.mjs';
runShim('unverified-sender-refusal', { kind: 'smtp', driver: 'node:net catch-all SMTP on 127.0.0.1', healthy: true }, runProbe);
