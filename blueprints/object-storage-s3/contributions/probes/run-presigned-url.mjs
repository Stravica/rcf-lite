import runProbe from './presigned-url.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 's3', image: 'minio/minio', healthy: true };
runShim('presigned-url', engine, runProbe);
