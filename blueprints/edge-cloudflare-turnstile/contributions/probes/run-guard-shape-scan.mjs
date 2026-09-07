import runProbe from './guard-shape-scan.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'source-tree-plus-live', image: 'source AST scan plus live POST against probe-pack-edge-cloudflare-turnstile fixture', healthy: true };
runShim('guard-shape-scan', engine, runProbe);
