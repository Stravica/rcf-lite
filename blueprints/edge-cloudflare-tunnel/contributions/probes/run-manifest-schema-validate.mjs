import runProbe from './manifest-schema-validate.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'schema-validate', image: 'edge-cloudflare-tunnel manifest schema (Ajv-free walker)', healthy: true };
runShim('manifest-schema-validate', engine, runProbe);
