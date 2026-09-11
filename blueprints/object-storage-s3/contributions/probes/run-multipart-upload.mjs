/**
 * Shim: run multipart-upload against the sample-app fixture. The engine
 * descriptor carries a REAL health observation (MinIO /minio/health/live
 * fetch outcome), not a fabricated healthy flag.
 */
import runProbe from './multipart-upload.mjs';
import { runShim, observeMinioEngine } from './probe-utils.mjs';

const engine = await observeMinioEngine();
runShim('multipart-upload', engine, runProbe);
