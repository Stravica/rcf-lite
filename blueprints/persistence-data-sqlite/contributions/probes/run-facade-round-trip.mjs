import runProbe from './facade-round-trip.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'sqlite', driver: 'node:sqlite (Node 24 built-in)', healthy: true };
runShim('facade-round-trip', engine, runProbe);
