/**
 * Shim: run pool-posture-smoke.
 */

import runProbe from './pool-posture-smoke.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'postgres', image: 'postgres:17-alpine', healthy: true };
runShim('pool-posture-smoke', engine, runProbe);
