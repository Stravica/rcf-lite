/**
 * Shim: run put-get-round-trip against the sample-app fixture. The engine
 * descriptor carries a REAL health observation (MinIO /minio/health/live
 * fetch outcome), not a fabricated healthy flag.
 */
import runProbe from './put-get-round-trip.mjs';
import { runShim, observeMinioEngine } from './probe-utils.mjs';

const engine = await observeMinioEngine();
runShim('put-get-round-trip', engine, runProbe);
