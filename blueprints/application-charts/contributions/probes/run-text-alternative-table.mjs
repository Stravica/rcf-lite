import runProbe from './text-alternative-table.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-charts/server.js', healthy: true };
runShim('text-alternative-table', engine, runProbe);
