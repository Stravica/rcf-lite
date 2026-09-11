import runProbe from './mismatched-key-refusal.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'sops+age', image: 'sops(1) fail-closed on wrong age key', healthy: true };
runShim('mismatched-key-refusal', engine, runProbe);
