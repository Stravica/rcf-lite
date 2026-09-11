import runProbe from './boot-open-migrate.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'sqlite', driver: 'node:sqlite (Node 24 built-in)', healthy: true };
runShim('boot-open-migrate', engine, runProbe);
