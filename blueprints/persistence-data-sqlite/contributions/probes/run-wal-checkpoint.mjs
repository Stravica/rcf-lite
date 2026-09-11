import runProbe from './wal-checkpoint.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'sqlite', driver: 'node:sqlite (Node 24 built-in)', healthy: true, walMode: true };
runShim('wal-checkpoint', engine, runProbe);
