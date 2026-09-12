import runProbe from './error-boundary-alert.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-empty-error-states/server.js', healthy: true };
runShim('error-boundary-alert', engine, runProbe);
