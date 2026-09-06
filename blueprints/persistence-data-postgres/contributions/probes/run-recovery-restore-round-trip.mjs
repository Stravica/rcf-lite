/**
 * Shim: run recovery-restore-round-trip.
 */

import runProbe from './recovery-restore-round-trip.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'postgres', image: 'postgres:17-alpine', healthy: true };
runShim('recovery-restore-round-trip', engine, runProbe);
