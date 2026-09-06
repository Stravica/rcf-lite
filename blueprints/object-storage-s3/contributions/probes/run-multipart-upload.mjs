import runProbe from './multipart-upload.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 's3', image: 'minio/minio', healthy: true };
runShim('multipart-upload', engine, runProbe);
