import runProbe from './real-account-minimal-stack-up.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'real-account-minimal-stack-up', image: 'platform-docker-compose-host fixture', healthy: true };
runShim('real-account-minimal-stack-up', engine, runProbe);
