import runProbe from './permission-matrix-grid.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-admin-console/server.js', healthy: true };
runShim('permission-matrix-grid', engine, runProbe);
