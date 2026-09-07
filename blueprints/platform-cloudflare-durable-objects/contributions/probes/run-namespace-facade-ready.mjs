import runProbe from './namespace-facade-ready.mjs';
import { runShim } from './probe-utils.mjs';

const engine = { kind: 'in-process', image: 'in-process DO facade on cf-platform fixture', healthy: true };
runShim('namespace-facade-ready', engine, runProbe);
