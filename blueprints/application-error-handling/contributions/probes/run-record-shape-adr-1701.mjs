import runProbe from './record-shape-adr-1701.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'application-error-handling-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js' };
runShim('record-shape-adr-1701', engine, runProbe);
