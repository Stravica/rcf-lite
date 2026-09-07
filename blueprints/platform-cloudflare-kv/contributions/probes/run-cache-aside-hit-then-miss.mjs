import runProbe from './cache-aside-hit-then-miss.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'kv', image: 'in-memory KV driver realising Workers KV binding shape', healthy: true };
runShim('cache-aside-hit-then-miss', engine, runProbe);
