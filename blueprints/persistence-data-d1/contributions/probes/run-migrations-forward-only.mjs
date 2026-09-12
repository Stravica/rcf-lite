import runProbe from './migrations-forward-only.mjs';
import { runShim } from './probe-utils.mjs';
runShim('migrations-forward-only', { kind: 'd1', driver: 'sqlite-backed D1 binding mock (node:sqlite)', healthy: true }, runProbe);
