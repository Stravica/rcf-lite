import runProbe from './shell-tablist-per-capability.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-account-settings/server.js', healthy: true };
runShim('shell-tablist-per-capability', engine, runProbe);
