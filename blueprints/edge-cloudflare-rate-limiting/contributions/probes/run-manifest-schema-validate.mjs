import runProbe from './manifest-schema-validate.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'source-scan', image: 'cf-edge fixture manifest directory validated against draft-07 JSON Schema (in-process)', healthy: true };
runShim('manifest-schema-validate', engine, runProbe);
