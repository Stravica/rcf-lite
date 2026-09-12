import runProbe from './step-page-shape.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'application-forms-wizard-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js' };
runShim('step-page-shape', engine, runProbe);
