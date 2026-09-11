import runProbe from './session-bridge-shape.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'fixture', image: 'fixture session-bridge (local)', healthy: true };
runShim('session-bridge-shape', engine, runProbe);
