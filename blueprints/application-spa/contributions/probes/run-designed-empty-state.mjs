import runProbe from './designed-empty-state.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'application-spa-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-spa/server.js' };
runShim('designed-empty-state', engine, runProbe);
