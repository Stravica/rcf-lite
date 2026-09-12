import runProbe from './real-account-realm-round-trip.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'keycloak' /* live-realm branch is honest-skip; slug AMBER */, image: 'estate-owned Keycloak realm (or skipped)', healthy: true };
runShim('real-account-realm-round-trip', engine, runProbe);
