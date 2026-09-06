/**
 * Shim: run put-get-round-trip against the sample-app fixture.
 */
import runProbe from './put-get-round-trip.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 's3', image: 'minio/minio', healthy: true };
runShim('put-get-round-trip', engine, runProbe);
