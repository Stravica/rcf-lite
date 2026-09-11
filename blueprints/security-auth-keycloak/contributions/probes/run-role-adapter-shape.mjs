import runProbe from './role-adapter-shape.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'fixture', image: 'fixture keycloak role-adapter (local)', healthy: true };
runShim('role-adapter-shape', engine, runProbe);
