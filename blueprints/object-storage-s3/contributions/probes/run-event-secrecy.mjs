import runProbe from './event-secrecy.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 's3', image: 'minio/minio', healthy: true };
runShim('event-secrecy', engine, runProbe);
