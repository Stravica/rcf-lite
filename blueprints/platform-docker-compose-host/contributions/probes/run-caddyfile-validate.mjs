import runProbe from './caddyfile-validate.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'caddyfile-validate', image: 'platform-docker-compose-host fixture', healthy: true };
runShim('caddyfile-validate', engine, runProbe);
