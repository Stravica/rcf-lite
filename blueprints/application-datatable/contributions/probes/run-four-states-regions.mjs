import runProbe from './four-states-regions.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'application-datatable-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js' };
runShim('four-states-regions', engine, runProbe);
