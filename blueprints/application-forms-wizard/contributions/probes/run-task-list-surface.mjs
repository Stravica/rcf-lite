import runProbe from './task-list-surface.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'application-forms-wizard-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/server.js' };
runShim('task-list-surface', engine, runProbe);
