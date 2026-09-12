import runProbe from './export-handle-formats.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'application-dashboard-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js' };
runShim('export-handle-formats', engine, runProbe);
