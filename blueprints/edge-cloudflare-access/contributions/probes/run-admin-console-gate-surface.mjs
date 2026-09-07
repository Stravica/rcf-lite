import runProbe from './admin-console-gate-surface.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'admin-console-fixture', image: 'node HTTP fixture (probe-pack-application-admin-console)', healthy: true };
runShim('admin-console-gate-surface', engine, runProbe);
