import runProbe from './sessions-adapter-uniform.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-account-settings/server.js', healthy: true };
runShim('sessions-adapter-uniform', engine, runProbe);
