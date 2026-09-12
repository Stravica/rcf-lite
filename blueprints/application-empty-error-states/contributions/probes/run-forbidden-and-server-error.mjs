import runProbe from './forbidden-and-server-error.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-empty-error-states/server.js', healthy: true };
runShim('forbidden-and-server-error', engine, runProbe);
