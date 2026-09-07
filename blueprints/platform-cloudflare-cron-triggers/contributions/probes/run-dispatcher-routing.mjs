import runProbe from './dispatcher-routing.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'in-process', image: 'in-process dispatcher on cf-platform fixture', healthy: true };
runShim('dispatcher-routing', engine, runProbe);
