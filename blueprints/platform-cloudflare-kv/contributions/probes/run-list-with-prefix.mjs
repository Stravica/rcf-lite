import runProbe from './list-with-prefix.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'kv', image: 'in-memory KV driver realising Workers KV binding shape', healthy: true };
runShim('list-with-prefix', engine, runProbe);
