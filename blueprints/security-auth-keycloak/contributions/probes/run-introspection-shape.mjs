import runProbe from './introspection-shape.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'fixture', image: 'fixture RFC 7662 introspection adapter (local)', healthy: true };
runShim('introspection-shape', engine, runProbe);
