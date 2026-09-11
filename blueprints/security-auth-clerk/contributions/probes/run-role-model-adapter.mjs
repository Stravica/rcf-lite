import runProbe from './role-model-adapter.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'in-process', image: 'fixture role-adapter (local)', healthy: true };
runShim('role-model-adapter', engine, runProbe);
