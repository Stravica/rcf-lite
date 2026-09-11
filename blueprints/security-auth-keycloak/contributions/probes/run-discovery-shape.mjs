import runProbe from './discovery-shape.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'in-process', image: 'fixture discovery-client (local)', healthy: true };
runShim('discovery-shape', engine, runProbe);
