import runProbe from './problem-details-on-error.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'application-api-rest-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js' };
runShim('problem-details-on-error', engine, runProbe);
