import runProbe from './manifest-presence.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'source-scan', image: 'cf-edge fixture manifest directory (in-process JSON read)', healthy: true };
runShim('manifest-presence', engine, runProbe);
