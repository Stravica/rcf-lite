import runProbe from './facade-round-trip.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'kv', image: 'in-memory KV driver realising Workers KV binding shape', healthy: true };
runShim('facade-round-trip', engine, runProbe);
