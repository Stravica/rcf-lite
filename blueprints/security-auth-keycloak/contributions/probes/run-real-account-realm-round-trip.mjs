import runProbe from './real-account-realm-round-trip.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'live-keycloak-realm', image: 'estate-owned Keycloak realm (or skipped)', healthy: true };
runShim('real-account-realm-round-trip', engine, runProbe);
