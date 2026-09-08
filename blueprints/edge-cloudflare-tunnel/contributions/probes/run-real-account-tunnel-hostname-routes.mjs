import runProbe from './real-account-tunnel-hostname-routes.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'real-account-tunnel-hostname-routes', image: 'account-bound', healthy: true };
runShim('real-account-tunnel-hostname-routes', engine, runProbe);
