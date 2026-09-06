/**
 * Shim: run facade-round-trip against the sample-app fixture and write
 * .rcf/reports/blueprints/object-storage-s3/facade-round-trip.json.
 */

import runProbe from './facade-round-trip.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 's3', image: 'minio/minio', healthy: true };
runShim('facade-round-trip', engine, runProbe);
