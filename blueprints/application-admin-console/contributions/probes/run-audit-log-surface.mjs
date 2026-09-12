import runProbe from './audit-log-surface.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'fixture', image: 'test/fixtures/probe-pack-application-admin-console/server.js', healthy: true };
runShim('audit-log-surface', engine, runProbe);
