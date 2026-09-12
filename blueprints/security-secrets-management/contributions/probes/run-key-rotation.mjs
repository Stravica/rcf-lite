import runProbe from './key-rotation.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'sops+age', image: 'sops(1) --rotate --in-place on throwaway scope', healthy: true };
runShim('key-rotation', engine, runProbe);
