/**
 * Shim: run transaction-atomicity against the sample-app fixture and
 * write the per-blueprint report.
 */

import runProbe from './transaction-atomicity.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'postgres', image: 'postgres:17-alpine', healthy: true };
runShim('transaction-atomicity', engine, runProbe);
