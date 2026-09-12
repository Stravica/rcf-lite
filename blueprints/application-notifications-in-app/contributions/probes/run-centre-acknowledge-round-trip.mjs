import runProbe from './centre-acknowledge-round-trip.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-notifications-in-app/server.js', healthy: true };
runShim('centre-acknowledge-round-trip', engine, runProbe);
