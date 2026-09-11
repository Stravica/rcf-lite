import runProbe from './token-entropy-shape.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'in-process', image: 'fixture magic-link-manager entropy sweep (local)', healthy: true };
runShim('token-entropy-shape', engine, runProbe);
