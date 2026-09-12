import runProbe from './health-probes-distinct.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'application-api-rest-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/server.js' };
runShim('health-probes-distinct', engine, runProbe);
