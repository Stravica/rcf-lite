import runProbe from './live-region-preseeding.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-notifications-in-app/server.js', healthy: true };
runShim('live-region-preseeding', engine, runProbe);
