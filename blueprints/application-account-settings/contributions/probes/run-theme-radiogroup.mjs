import runProbe from './theme-radiogroup.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-account-settings/server.js', healthy: true };
runShim('theme-radiogroup', engine, runProbe);
