import runProbe from './category-vocabulary.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'application-error-handling-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-error-handling/server.js' };
runShim('category-vocabulary', engine, runProbe);
