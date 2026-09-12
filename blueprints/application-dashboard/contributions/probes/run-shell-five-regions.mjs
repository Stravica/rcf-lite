import runProbe from './shell-five-regions.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'application-dashboard-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-dashboard/server.js' };
runShim('shell-five-regions', engine, runProbe);
