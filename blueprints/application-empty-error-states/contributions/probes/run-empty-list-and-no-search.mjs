import runProbe from './empty-list-and-no-search.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-empty-error-states/server.js', healthy: true };
runShim('empty-list-and-no-search', engine, runProbe);
