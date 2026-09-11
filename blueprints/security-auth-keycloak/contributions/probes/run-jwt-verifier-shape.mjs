import runProbe from './jwt-verifier-shape.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'in-process', image: 'node:crypto RS256 sign+verify (throwaway keys)', healthy: true };
runShim('jwt-verifier-shape', engine, runProbe);
