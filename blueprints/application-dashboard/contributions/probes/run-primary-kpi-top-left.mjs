import runProbe from './primary-kpi-top-left.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'application-dashboard-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js' };
runShim('primary-kpi-top-left', engine, runProbe);
