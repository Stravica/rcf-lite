import runProbe from './sessions-surface-shape.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-account-settings/server.js', healthy: true };
runShim('sessions-surface-shape', engine, runProbe);
