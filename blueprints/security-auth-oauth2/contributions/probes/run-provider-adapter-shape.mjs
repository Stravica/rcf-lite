import runProbe from './provider-adapter-shape.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'fixture', image: 'fixture provider-adapter (local)', healthy: true };
runShim('provider-adapter-shape', engine, runProbe);
