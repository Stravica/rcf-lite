import runProbe from './facade-round-trip.mjs';
import { runShim } from './probe-utils.mjs';
runShim('facade-round-trip', { kind: 'd1', driver: 'sqlite-backed D1 binding mock (node:sqlite)', healthy: true }, runProbe);
