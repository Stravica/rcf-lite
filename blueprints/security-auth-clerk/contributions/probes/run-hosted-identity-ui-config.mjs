import runProbe from './hosted-identity-ui-config.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'in-process', image: 'fixture hosted-ui-config validator (local)', healthy: true };
runShim('hosted-identity-ui-config', engine, runProbe);
