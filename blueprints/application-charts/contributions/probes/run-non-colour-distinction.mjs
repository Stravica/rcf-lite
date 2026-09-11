import runProbe from './non-colour-distinction.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-charts/server.js', healthy: true };
runShim('non-colour-distinction', engine, runProbe);
