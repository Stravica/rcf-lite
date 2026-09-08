import runProbe from './real-account-reload-burst.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'real-account-reload-burst', image: 'platform-docker-compose-host fixture', healthy: true };
runShim('real-account-reload-burst', engine, runProbe);
