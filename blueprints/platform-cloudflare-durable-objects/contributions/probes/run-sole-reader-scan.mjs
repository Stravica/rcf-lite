import runProbe from './sole-reader-scan.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'in-process', image: 'source-tree AST-lite scan on cf-platform fixture', healthy: true };
runShim('sole-reader-scan', engine, runProbe);
