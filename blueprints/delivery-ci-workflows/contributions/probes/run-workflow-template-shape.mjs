import runProbe from './workflow-template-shape.mjs';
import { runShim } from './probe-utils.mjs';
runShim('workflow-template-shape', { kind: 'lint', driver: 'fixture YAML shape scan + actionlint when available', healthy: true }, runProbe);
