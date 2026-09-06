/**
 * Shim: run facade-round-trip against the sample-app fixture and write
 * the per-blueprint report at .rcf/reports/blueprints/persistence-data-postgres/facade-round-trip.json.
 */

import runProbe from './facade-round-trip.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'postgres', image: 'postgres:17-alpine', healthy: true };
runShim('facade-round-trip', engine, runProbe);
