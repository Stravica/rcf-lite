import runProbe from './permission-denied-and-offline.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-empty-error-states/server.js', healthy: true };
runShim('permission-denied-and-offline', engine, runProbe);
