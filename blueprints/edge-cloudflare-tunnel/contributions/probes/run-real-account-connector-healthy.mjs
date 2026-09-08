import runProbe from './real-account-connector-healthy.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'real-account-connector-healthy', image: 'account-bound', healthy: true };
runShim('real-account-connector-healthy', engine, runProbe);
