import runProbe from './shell-nav-present.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'application-spa-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-spa/server.js' };
runShim('shell-nav-present', engine, runProbe);
