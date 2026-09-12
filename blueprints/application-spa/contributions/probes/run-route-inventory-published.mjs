import runProbe from './route-inventory-published.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'application-spa-fixture', server: 'packages/rcf-lite/test/fixtures/probe-pack-application-spa/server.js' };
runShim('route-inventory-published', engine, runProbe);
