import runProbe from './apg-table-shape.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'application-datatable-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-datatable/server.js' };
runShim('apg-table-shape', engine, runProbe);
