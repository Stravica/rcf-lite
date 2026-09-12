import runProbe from './cursor-pagination-round-trip.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'application-api-rest-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js' };
runShim('cursor-pagination-round-trip', engine, runProbe);
