import runProbe from './real-account-session-inventory.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'clerk-backend-api', image: 'live Clerk Backend API sessions endpoint via https (or skipped)', healthy: true };
runShim('real-account-session-inventory', engine, runProbe);
