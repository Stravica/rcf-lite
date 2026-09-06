/**
 * Shim: run migration-apply against the sample-app fixture and write
 * the per-blueprint report at .rcf/reports/blueprints/persistence-data-postgres/migration-apply.json.
 */

import runProbe from './migration-apply.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'postgres', image: 'postgres:17-alpine', healthy: true };
runShim('migration-apply', engine, runProbe);
