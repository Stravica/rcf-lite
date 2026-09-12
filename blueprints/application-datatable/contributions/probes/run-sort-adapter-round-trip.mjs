import runProbe from './sort-adapter-round-trip.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'application-datatable-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js' };
runShim('sort-adapter-round-trip', engine, runProbe);
