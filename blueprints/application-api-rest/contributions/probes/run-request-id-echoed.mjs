import runProbe from './request-id-echoed.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'application-api-rest-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js' };
runShim('request-id-echoed', engine, runProbe);
