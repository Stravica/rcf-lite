import runProbe from './smtp-round-trip.mjs';
import { runShim } from './probe-utils.mjs';
runShim('smtp-round-trip', { kind: 'smtp', driver: 'node:net catch-all SMTP on 127.0.0.1', healthy: true }, runProbe);
