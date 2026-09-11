import runProbe from './toast-contract.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-notifications-in-app/server.js', healthy: true };
runShim('toast-contract', engine, runProbe);
