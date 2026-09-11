import runProbe from './pkce-challenge-shape.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'fixture', image: 'fixture PKCE helper (local)', healthy: true };
runShim('pkce-challenge-shape', engine, runProbe);
