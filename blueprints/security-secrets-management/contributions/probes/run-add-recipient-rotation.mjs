import runProbe from './add-recipient-rotation.mjs';
import { runShim } from './probe-utils.mjs';
const engine = { kind: 'sops+age', image: 'sops(1) --rotate --add-age with throwaway A + B keys', healthy: true };
runShim('add-recipient-rotation', engine, runProbe);
