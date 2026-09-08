import runProbe from './compose-config-lint.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'compose-config-lint', image: 'platform-docker-compose-host fixture', healthy: true };
runShim('compose-config-lint', engine, runProbe);
