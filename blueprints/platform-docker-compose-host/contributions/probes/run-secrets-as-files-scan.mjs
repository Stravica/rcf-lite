import runProbe from './secrets-as-files-scan.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'secrets-as-files-scan', image: 'platform-docker-compose-host fixture', healthy: true };
runShim('secrets-as-files-scan', engine, runProbe);
