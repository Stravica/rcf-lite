import runProbe from './secret-shape-scan.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'source-tree', image: 'AST-shaped source scan over probe-pack-edge-cloudflare-turnstile fixture', healthy: true };
runShim('secret-shape-scan', engine, runProbe);
