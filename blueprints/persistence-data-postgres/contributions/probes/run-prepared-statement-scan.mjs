/**
 * Shim: run prepared-statement-scan against the fixture facade
 * directory and write the report.
 */

import runProbe from './prepared-statement-scan.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'source-scan', target: 'infra-postgres/src', healthy: true };
runShim('prepared-statement-scan', engine, runProbe);
