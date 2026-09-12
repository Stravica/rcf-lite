import runProbe from './not-found-and-recovery.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-empty-error-states/server.js', healthy: true };
runShim('not-found-and-recovery', engine, runProbe);
