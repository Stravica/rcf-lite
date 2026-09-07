import runProbe from './event-secrecy.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'kv', image: 'in-memory KV driver realising Workers KV binding shape', healthy: true };
runShim('event-secrecy', engine, runProbe);
