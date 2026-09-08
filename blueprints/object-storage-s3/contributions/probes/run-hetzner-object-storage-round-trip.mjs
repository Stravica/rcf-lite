/**
 * Shim: run hetzner-object-storage-round-trip against the extended
 * infra-s3-and-queue fixture and write
 * .rcf/reports/blueprints/object-storage-s3/hetzner-object-storage-round-trip.json.
 */

import runProbe from './hetzner-object-storage-round-trip.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 's3', image: 'hetzner-object-storage-cloud', healthy: true };
runShim('hetzner-object-storage-round-trip', engine, runProbe);
