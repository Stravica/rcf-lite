import runProbe from './two-boundaries-registered.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'application-error-handling-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js' };
runShim('two-boundaries-registered', engine, runProbe);
