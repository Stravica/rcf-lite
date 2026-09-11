import runProbe from './encrypt-decrypt-round-trip.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'sops+age', image: 'sops(1) + age(1) via throwaway keys in scratchpad', healthy: true };
runShim('encrypt-decrypt-round-trip', engine, runProbe);
