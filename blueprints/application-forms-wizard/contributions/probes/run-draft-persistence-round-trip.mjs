import runProbe from './draft-persistence-round-trip.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'application-forms-wizard-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js' };
runShim('draft-persistence-round-trip', engine, runProbe);
