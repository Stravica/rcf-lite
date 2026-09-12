import runProbe from './assertive-completion-slot.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'application-file-upload-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/server.js' };
runShim('assertive-completion-slot', engine, runProbe);
