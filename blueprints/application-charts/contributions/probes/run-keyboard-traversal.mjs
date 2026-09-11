import runProbe from './keyboard-traversal.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-charts/server.js', healthy: true };
runShim('keyboard-traversal', engine, runProbe);
