import runProbe from './real-account-principal-directory-round-trip.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'clerk-backend-api', image: 'live Clerk Backend API via https (or skipped)', healthy: true };
runShim('real-account-principal-directory-round-trip', engine, runProbe);
